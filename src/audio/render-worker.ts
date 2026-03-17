// src/audio/render-worker.ts
// Web Worker that renders audio offline using Plaits/Rings/Clouds WASM.
// Receives a RenderSpec via postMessage, renders all tracks, mixes to mono,
// and posts back the PCM Float32Array as a transferable.

import type {
  RenderSpec,
  RenderTrackSpec,
  RenderProcessorSpec,
  RenderEvent,
  RenderSynthPatch,
  RenderPlaitsExtended,
  RenderModulatorSpec,
} from './render-spec';
import { applyProcessorModulations, applySourceModulations, averageSignal } from './render-modulation';
import { applyStereoGain, applyStereoPan, downmixStereoToMono, mixStereoBuffers, monoToStereo } from './render-mix';
import { splitBlockAtEvents } from './render-timing';

// ---------------------------------------------------------------------------
// WASM interfaces (subset of what the worklet processors declare)
// ---------------------------------------------------------------------------

interface PlaitsWasm {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _plaits_create(sampleRate: number): number;
  _plaits_destroy(handle: number): void;
  _plaits_set_model(handle: number, modelIndex: number): void;
  _plaits_set_patch(handle: number, harmonics: number, timbre: number, morph: number, note: number): void;
  _plaits_set_extended(handle: number, fm_amount: number, timbre_mod_amount: number, morph_mod_amount: number, decay: number, lpg_colour: number): void;
  _plaits_trigger(handle: number, accentLevel: number): void;
  _plaits_set_gate(handle: number, open: number): void;
  _plaits_render(handle: number, outputPtr: number, frames: number): number;
  HEAPF32?: Float32Array;
  memory?: WebAssembly.Memory;
}

interface RingsWasm {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _rings_create(): number;
  _rings_destroy(handle: number): void;
  _rings_set_model(handle: number, modelIndex: number): void;
  _rings_set_patch(handle: number, structure: number, brightness: number, damping: number, position: number): void;
  _rings_set_note(handle: number, tonic: number, note: number): void;
  _rings_set_fine_tune(handle: number, offset: number): void;
  _rings_set_polyphony(handle: number, polyphony: number): void;
  _rings_set_internal_exciter(handle: number, enabled: number): void;
  _rings_render(handle: number, inputPtr: number, outputPtr: number, frames: number): number;
  HEAPF32?: Float32Array;
  memory?: WebAssembly.Memory;
}

interface CloudsWasm {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _clouds_create(): number;
  _clouds_destroy(handle: number): void;
  _clouds_set_mode(handle: number, modeIndex: number): void;
  _clouds_set_parameters(handle: number, position: number, size: number, density: number, feedback: number): void;
  _clouds_set_extended(handle: number, texture: number, pitch: number, dry_wet: number, stereo_spread: number, reverb: number): void;
  _clouds_set_freeze(handle: number, freeze: number): void;
  _clouds_render(handle: number, inputPtr: number, outputPtr: number, frames: number): number;
  HEAPF32?: Float32Array;
  memory?: WebAssembly.Memory;
}

interface TidesWasm {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _tides_create(): number;
  _tides_destroy(handle: number): void;
  _tides_set_mode(handle: number, modeIndex: number): void;
  _tides_set_parameters(handle: number, frequency: number, shape: number, slope: number, smoothness: number): void;
  _tides_set_extended(handle: number, shift: number, output_mode: number, range: number): void;
  _tides_render(handle: number, outputPtr: number, frames: number): number;
  HEAPF32?: Float32Array;
  memory?: WebAssembly.Memory;
}

type CreateModuleFn<T> = (options?: {
  locateFile?: (path: string) => string;
  wasmBinary?: ArrayBuffer;
}) => Promise<T>;

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface RenderWorkerRequest {
  type: 'render';
  spec: RenderSpec;
  stereo?: boolean;
}

export interface RenderWorkerResponse {
  type: 'done';
  pcm: Float32Array;
  sampleRate: number;
  channels: 1 | 2;
}

export interface RenderWorkerError {
  type: 'error';
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLOCK_SIZE = 128;

// ---------------------------------------------------------------------------
// WASM loading
// ---------------------------------------------------------------------------

/** Cache loaded WASM modules within the worker lifetime. */
let plaitsModulePromise: Promise<PlaitsWasm> | null = null;
let ringsModulePromise: Promise<RingsWasm> | null = null;
let cloudsModulePromise: Promise<CloudsWasm> | null = null;
let tidesModulePromise: Promise<TidesWasm> | null = null;

async function loadPlaitsModule(): Promise<PlaitsWasm> {
  if (!plaitsModulePromise) {
    plaitsModulePromise = (async () => {
      const wasmBinary = await fetchWasm('/audio/plaits.wasm');
      await loadScript('/audio/plaits-module.js');
      const factory = (self as unknown as Record<string, CreateModuleFn<PlaitsWasm>>).createPlaitsModule;
      if (!factory) throw new Error('createPlaitsModule not found after loading module');
      return factory({ wasmBinary });
    })();
  }
  return plaitsModulePromise;
}

async function loadRingsModule(): Promise<RingsWasm> {
  if (!ringsModulePromise) {
    ringsModulePromise = (async () => {
      const wasmBinary = await fetchWasm('/audio/rings.wasm');
      await loadScript('/audio/rings-module.js');
      const factory = (self as unknown as Record<string, CreateModuleFn<RingsWasm>>).createRingsModule;
      if (!factory) throw new Error('createRingsModule not found after loading module');
      return factory({ wasmBinary });
    })();
  }
  return ringsModulePromise;
}

async function loadCloudsModule(): Promise<CloudsWasm> {
  if (!cloudsModulePromise) {
    cloudsModulePromise = (async () => {
      const wasmBinary = await fetchWasm('/audio/clouds.wasm');
      await loadScript('/audio/clouds-module.js');
      const factory = (self as unknown as Record<string, CreateModuleFn<CloudsWasm>>).createCloudsModule;
      if (!factory) throw new Error('createCloudsModule not found after loading module');
      return factory({ wasmBinary });
    })();
  }
  return cloudsModulePromise;
}

async function loadTidesModule(): Promise<TidesWasm> {
  if (!tidesModulePromise) {
    tidesModulePromise = (async () => {
      const wasmBinary = await fetchWasm('/audio/tides.wasm');
      await loadScript('/audio/tides-module.js');
      const factory = (self as unknown as Record<string, CreateModuleFn<TidesWasm>>).createTidesModule;
      if (!factory) throw new Error('createTidesModule not found after loading module');
      return factory({ wasmBinary });
    })();
  }
  return tidesModulePromise;
}

async function fetchWasm(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.arrayBuffer();
}

/**
 * Load an Emscripten module JS file in a module worker context.
 * Module workers don't support importScripts(), so we fetch the script
 * text and evaluate it via indirect eval to set the factory on `self`.
 */
async function loadScript(url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const text = await response.text();
  // Indirect eval runs in global scope, same as importScripts
  (0, eval)(text);
}

// ---------------------------------------------------------------------------
// Heap helpers
// ---------------------------------------------------------------------------

function getHeapF32(wasm: { HEAPF32?: Float32Array; memory?: WebAssembly.Memory }): Float32Array {
  if (wasm.HEAPF32) return wasm.HEAPF32;
  if (wasm.memory) return new Float32Array(wasm.memory.buffer);
  throw new Error('Cannot access WASM heap');
}

// ---------------------------------------------------------------------------
// Per-track rendering
// ---------------------------------------------------------------------------

async function renderTrack(
  track: RenderTrackSpec,
  sampleRate: number,
  bpm: number,
  totalSteps: number,
): Promise<Float32Array> {
  const framesPerStep = (60 / bpm) * sampleRate / 4; // one 16th note
  const totalFrames = Math.ceil(totalSteps * framesPerStep);

  // --- Load and init Plaits ---
  const plaits = await loadPlaitsModule();
  const pHandle = plaits._plaits_create(sampleRate);
  const pOutPtr = plaits._malloc(BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT);

  plaits._plaits_set_model(pHandle, track.model);
  const currentPatch: RenderSynthPatch = { ...track.params };
  plaits._plaits_set_patch(pHandle, currentPatch.harmonics, currentPatch.timbre, currentPatch.morph, currentPatch.note);
  const currentExtended: RenderPlaitsExtended = { ...track.extendedParams };
  let extendedDirty = false;
  plaits._plaits_set_extended(pHandle, currentExtended.fm_amount, currentExtended.timbre_mod_amount, currentExtended.morph_mod_amount, currentExtended.decay, currentExtended.lpg_colour);

  // --- Load and init processors ---
  interface ProcessorHandle {
    type: 'rings' | 'clouds';
    wasm: RingsWasm | CloudsWasm;
    handle: number;
    inPtr: number;
    outPtr: number;
    spec: RenderProcessorSpec;
  }
  const procHandles: ProcessorHandle[] = [];

  for (const proc of track.processors) {
    if (proc.type === 'rings') {
      const rings = await loadRingsModule();
      const rHandle = rings._rings_create();
      rings._rings_set_model(rHandle, proc.model);
      const p = proc.params;
      rings._rings_set_patch(rHandle, p.structure ?? 0.5, p.brightness ?? 0.5, p.damping ?? 0.7, p.position ?? 0.5);
      if (p['fine-tune'] !== undefined) {
        rings._rings_set_fine_tune(rHandle, p['fine-tune']);
      }
      if (p.polyphony !== undefined) {
        rings._rings_set_polyphony(rHandle, Math.max(1, Math.min(4, Math.round(p.polyphony))));
      }
      if (p['internal-exciter'] !== undefined) {
        rings._rings_set_internal_exciter(rHandle, p['internal-exciter'] >= 0.5 ? 1 : 0);
      }
      const inPtr = rings._malloc(BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT);
      const outPtr = rings._malloc(BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT);
      procHandles.push({ type: 'rings', wasm: rings, handle: rHandle, inPtr, outPtr, spec: proc });
    } else if (proc.type === 'clouds') {
      const clouds = await loadCloudsModule();
      const cHandle = clouds._clouds_create();
      clouds._clouds_set_mode(cHandle, proc.model);
      const p = proc.params;
      (clouds as CloudsWasm)._clouds_set_parameters(cHandle, p.position ?? 0.5, p.size ?? 0.5, p.density ?? 0.5, p.feedback ?? 0.0);
      (clouds as CloudsWasm)._clouds_set_extended(cHandle, p.texture ?? 0.5, p.pitch ?? 0.5, p['dry-wet'] ?? 0.5, p['stereo-spread'] ?? 0.0, p.reverb ?? 0.0);
      if (p.freeze !== undefined) {
        clouds._clouds_set_freeze(cHandle, p.freeze >= 0.5 ? 1 : 0);
      }
      const inPtr = clouds._malloc(BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT);
      const outPtr = clouds._malloc(BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT);
      procHandles.push({ type: 'clouds', wasm: clouds, handle: cHandle, inPtr, outPtr, spec: proc });
    }
  }

  const modHandles: ModulatorHandle[] = [];
  for (const mod of track.modulators) {
    modHandles.push(await createTidesHandle(mod));
  }

  // --- Sort events and prepare ---
  const sortedEvents = [...track.events].sort((a, b) => a.beatTime - b.beatTime);
  let eventIndex = 0;

  const output = new Float32Array(totalFrames);
  const blockBuf = new Float32Array(BLOCK_SIZE);

  // --- Render loop (sub-block precision) ---
  for (let frame = 0; frame < totalFrames; frame += BLOCK_SIZE) {
    const framesToRender = Math.min(BLOCK_SIZE, totalFrames - frame);
    const blockBeatEnd = (frame + framesToRender) / framesPerStep;

    // Collect events that fall within this block
    const blockEvents: { beatTime: number; index: number }[] = [];
    while (eventIndex < sortedEvents.length && sortedEvents[eventIndex].beatTime < blockBeatEnd) {
      blockEvents.push({ beatTime: sortedEvents[eventIndex].beatTime, index: eventIndex });
      eventIndex++;
    }

    // Split the block into sub-segments at event boundaries
    const segments = splitBlockAtEvents(blockEvents, frame, framesToRender, framesPerStep);

    // Render modulation once per block (control-rate, matching live engine)
    const modulatorValues = renderModulationBlock(modHandles, framesToRender);

    // Process each sub-segment: apply events, then render
    let blockOffset = 0;
    for (const segment of segments) {
      // Apply events at this segment boundary
      for (const evIdx of segment.eventsToApply) {
        const ev = sortedEvents[evIdx];
        if (ev.type === 'set-extended' && ev.extended) {
          Object.assign(currentExtended, ev.extended);
          extendedDirty = true;
        } else {
          applyEvent(ev, plaits, pHandle, currentPatch);
        }
      }

      if (extendedDirty) {
        plaits._plaits_set_extended(pHandle, currentExtended.fm_amount, currentExtended.timbre_mod_amount, currentExtended.morph_mod_amount, currentExtended.decay, currentExtended.lpg_colour);
        extendedDirty = false;
      }

      // Apply modulated patch before rendering this segment
      const effectivePatch = applySourceModulations(currentPatch, track.modulations, modulatorValues);
      plaits._plaits_set_patch(
        pHandle,
        effectivePatch.harmonics,
        effectivePatch.timbre,
        effectivePatch.morph,
        effectivePatch.note,
      );

      // Render this segment through Plaits
      const segRendered = plaits._plaits_render(pHandle, pOutPtr, segment.length);
      let heap = getHeapF32(plaits);
      const pOutStart = pOutPtr / Float32Array.BYTES_PER_ELEMENT;
      blockBuf.set(heap.subarray(pOutStart, pOutStart + segRendered), blockOffset);
      blockOffset += segRendered;
    }

    // Chain through processors
    for (const ph of procHandles) {
      const effectiveProcessorParams = applyProcessorModulations(ph.spec, track.modulations, modulatorValues);
      if (ph.type === 'rings') {
        const rings = ph.wasm as RingsWasm;
        rings._rings_set_patch(
          ph.handle,
          effectiveProcessorParams.structure ?? 0.5,
          effectiveProcessorParams.brightness ?? 0.5,
          effectiveProcessorParams.damping ?? 0.7,
          effectiveProcessorParams.position ?? 0.5,
        );
        let rHeap = getHeapF32(rings);
        const rInStart = ph.inPtr / Float32Array.BYTES_PER_ELEMENT;
        rHeap.set(blockBuf.subarray(0, framesToRender), rInStart);
        const rRendered = rings._rings_render(ph.handle, ph.inPtr, ph.outPtr, framesToRender);
        rHeap = getHeapF32(rings);
        const rOutStart = ph.outPtr / Float32Array.BYTES_PER_ELEMENT;
        blockBuf.set(rHeap.subarray(rOutStart, rOutStart + rRendered));
      } else if (ph.type === 'clouds') {
        const clouds = ph.wasm as CloudsWasm;
        clouds._clouds_set_parameters(
          ph.handle,
          effectiveProcessorParams.position ?? 0.5,
          effectiveProcessorParams.size ?? 0.5,
          effectiveProcessorParams.density ?? 0.5,
          effectiveProcessorParams.feedback ?? 0.0,
        );
        clouds._clouds_set_extended(
          ph.handle,
          effectiveProcessorParams.texture ?? 0.5,
          effectiveProcessorParams.pitch ?? 0.5,
          effectiveProcessorParams['dry-wet'] ?? 0.5,
          effectiveProcessorParams['stereo-spread'] ?? 0.0,
          effectiveProcessorParams.reverb ?? 0.0,
        );
        let cHeap = getHeapF32(clouds);
        const cInStart = ph.inPtr / Float32Array.BYTES_PER_ELEMENT;
        cHeap.set(blockBuf.subarray(0, framesToRender), cInStart);
        const cRendered = clouds._clouds_render(ph.handle, ph.inPtr, ph.outPtr, framesToRender);
        cHeap = getHeapF32(clouds);
        const cOutStart = ph.outPtr / Float32Array.BYTES_PER_ELEMENT;
        blockBuf.set(cHeap.subarray(cOutStart, cOutStart + cRendered));
      }
    }

    // Copy block to output
    output.set(blockBuf.subarray(0, framesToRender), frame);
  }

  // --- Cleanup ---
  plaits._free(pOutPtr);
  plaits._plaits_destroy(pHandle);
  for (const ph of procHandles) {
    if (ph.type === 'rings') {
      const rings = ph.wasm as RingsWasm;
      rings._free(ph.inPtr);
      rings._free(ph.outPtr);
      rings._rings_destroy(ph.handle);
    } else if (ph.type === 'clouds') {
      const clouds = ph.wasm as CloudsWasm;
      clouds._free(ph.inPtr);
      clouds._free(ph.outPtr);
      clouds._clouds_destroy(ph.handle);
    }
  }
  for (const mod of modHandles) {
    mod.wasm._free(mod.outPtr);
    mod.wasm._tides_destroy(mod.handle);
  }

  return output;
}

async function createTidesHandle(mod: RenderModulatorSpec): Promise<ModulatorHandle> {
  const tides = await loadTidesModule();
  const handle = tides._tides_create();
  tides._tides_set_mode(handle, mod.model);
  tides._tides_set_parameters(
    handle,
    mod.params.frequency,
    mod.params.shape,
    mod.params.slope,
    mod.params.smoothness,
  );
  const ext = mod.extendedParams;
  tides._tides_set_extended(handle, ext.shift, ext.output_mode, ext.range);
  const outPtr = tides._malloc(BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT);
  return {
    id: mod.id,
    wasm: tides,
    handle,
    outPtr,
  };
}

interface ModulatorHandle {
  id: string;
  wasm: TidesWasm;
  handle: number;
  outPtr: number;
}

function renderModulationBlock(modulators: ModulatorHandle[], framesToRender: number): Record<string, number> {
  const values: Record<string, number> = {};
  for (const mod of modulators) {
    const rendered = mod.wasm._tides_render(mod.handle, mod.outPtr, framesToRender);
    const heap = getHeapF32(mod.wasm);
    const outStart = mod.outPtr / Float32Array.BYTES_PER_ELEMENT;
    values[mod.id] = averageSignal(heap.subarray(outStart, outStart + rendered), rendered);
  }
  return values;
}

function applyEvent(
  event: RenderEvent,
  plaits: PlaitsWasm,
  handle: number,
  currentPatch: RenderSynthPatch,
): void {
  switch (event.type) {
    case 'trigger':
      plaits._plaits_trigger(handle, event.accentLevel ?? 0.8);
      break;
    case 'gate-on':
      plaits._plaits_set_gate(handle, 1);
      break;
    case 'gate-off':
      plaits._plaits_set_gate(handle, 0);
      break;
    case 'set-patch':
      if (event.patch) {
        Object.assign(currentPatch, event.patch);
      }
      break;
    case 'set-note':
      if (event.note !== undefined) {
        currentPatch.note = event.note;
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = async (event: MessageEvent<RenderWorkerRequest>) => {
  const { spec, stereo: wantStereo } = event.data;

  try {
    const stepsPerBar = 16;
    const totalSteps = spec.bars * stepsPerBar;

    const trackOutputs = await Promise.all(
      spec.tracks.map(track => renderTrack(track, spec.sampleRate, spec.bpm, totalSteps)),
    );
    // Apply per-track volume and pan before mixing
    const trackStereo = trackOutputs.map((pcm, i) => {
      const trackSpec = spec.tracks[i];
      let stereo = monoToStereo(pcm);
      stereo = applyStereoGain(stereo, trackSpec.volume);
      stereo = applyStereoPan(stereo, trackSpec.pan);
      return stereo;
    });
    const mixed = mixStereoBuffers(trackStereo);
    const mastered = applyStereoPan(applyStereoGain(mixed, spec.master.volume), spec.master.pan);

    if (wantStereo) {
      // Interleave L R L R into a single Float32Array for transfer
      const frames = mastered.left.length;
      const interleaved = new Float32Array(frames * 2);
      for (let i = 0; i < frames; i++) {
        interleaved[i * 2] = mastered.left[i];
        interleaved[i * 2 + 1] = mastered.right[i];
      }
      const response: RenderWorkerResponse = {
        type: 'done',
        pcm: interleaved,
        sampleRate: spec.sampleRate,
        channels: 2,
      };
      (self as unknown as Worker).postMessage(response, [interleaved.buffer]);
    } else {
      const pcm = downmixStereoToMono(mastered);
      const response: RenderWorkerResponse = {
        type: 'done',
        pcm,
        sampleRate: spec.sampleRate,
        channels: 1,
      };
      (self as unknown as Worker).postMessage(response, [pcm.buffer]);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorResponse: RenderWorkerError = { type: 'error', message };
    (self as unknown as Worker).postMessage(errorResponse);
  }
};
