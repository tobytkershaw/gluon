// src/audio/render-worker.ts
// Web Worker that renders audio offline using Plaits/Rings/Clouds WASM.
// Receives a RenderSpec via postMessage, renders all voices, mixes to mono,
// and posts back the PCM Float32Array as a transferable.

import type {
  RenderSpec,
  RenderVoiceSpec,
  RenderProcessorSpec,
  RenderEvent,
  RenderSynthPatch,
} from './render-spec';

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
  _clouds_render(handle: number, inputPtr: number, outputPtr: number, frames: number): number;
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
}

export interface RenderWorkerResponse {
  type: 'done';
  pcm: Float32Array;
  sampleRate: number;
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

async function loadPlaitsModule(): Promise<PlaitsWasm> {
  if (!plaitsModulePromise) {
    plaitsModulePromise = (async () => {
      const wasmBinary = await fetchWasm('/audio/plaits.wasm');
      // Import the Emscripten module factory
      importScripts('/audio/plaits-module.js');
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
      importScripts('/audio/rings-module.js');
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
      importScripts('/audio/clouds-module.js');
      const factory = (self as unknown as Record<string, CreateModuleFn<CloudsWasm>>).createCloudsModule;
      if (!factory) throw new Error('createCloudsModule not found after loading module');
      return factory({ wasmBinary });
    })();
  }
  return cloudsModulePromise;
}

async function fetchWasm(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.arrayBuffer();
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
// Per-voice rendering
// ---------------------------------------------------------------------------

async function renderVoice(
  voice: RenderVoiceSpec,
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

  plaits._plaits_set_model(pHandle, voice.model);
  const currentPatch: RenderSynthPatch = { ...voice.params };
  plaits._plaits_set_patch(pHandle, currentPatch.harmonics, currentPatch.timbre, currentPatch.morph, currentPatch.note);

  // --- Load and init processors ---
  interface ProcessorHandle {
    type: 'rings' | 'clouds';
    wasm: RingsWasm | CloudsWasm;
    handle: number;
    inPtr: number;
    outPtr: number;
  }
  const procHandles: ProcessorHandle[] = [];

  for (const proc of voice.processors) {
    if (proc.type === 'rings') {
      const rings = await loadRingsModule();
      const rHandle = rings._rings_create();
      rings._rings_set_model(rHandle, proc.model);
      const p = proc.params;
      rings._rings_set_patch(rHandle, p.structure ?? 0.5, p.brightness ?? 0.5, p.damping ?? 0.7, p.position ?? 0.5);
      const inPtr = rings._malloc(BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT);
      const outPtr = rings._malloc(BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT);
      procHandles.push({ type: 'rings', wasm: rings, handle: rHandle, inPtr, outPtr });
    } else if (proc.type === 'clouds') {
      const clouds = await loadCloudsModule();
      const cHandle = clouds._clouds_create();
      clouds._clouds_set_mode(cHandle, proc.model);
      const p = proc.params;
      (clouds as CloudsWasm)._clouds_set_parameters(cHandle, p.position ?? 0.5, p.size ?? 0.5, p.density ?? 0.5, p.feedback ?? 0.0);
      const inPtr = clouds._malloc(BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT);
      const outPtr = clouds._malloc(BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT);
      procHandles.push({ type: 'clouds', wasm: clouds, handle: cHandle, inPtr, outPtr });
    }
  }

  // --- Sort events and prepare ---
  const sortedEvents = [...voice.events].sort((a, b) => a.beatTime - b.beatTime);
  let eventIndex = 0;

  const output = new Float32Array(totalFrames);
  const blockBuf = new Float32Array(BLOCK_SIZE);

  // --- Render loop ---
  for (let frame = 0; frame < totalFrames; frame += BLOCK_SIZE) {
    const framesToRender = Math.min(BLOCK_SIZE, totalFrames - frame);
    const blockBeatStart = frame / framesPerStep;
    const blockBeatEnd = (frame + framesToRender) / framesPerStep;

    // Apply events that fall within this block
    while (eventIndex < sortedEvents.length && sortedEvents[eventIndex].beatTime < blockBeatEnd) {
      const ev = sortedEvents[eventIndex];
      applyEvent(ev, plaits, pHandle, currentPatch);
      eventIndex++;
    }

    // Set current patch on Plaits
    plaits._plaits_set_patch(pHandle, currentPatch.harmonics, currentPatch.timbre, currentPatch.morph, currentPatch.note);

    // Render Plaits
    const rendered = plaits._plaits_render(pHandle, pOutPtr, framesToRender);
    let heap = getHeapF32(plaits);
    const pOutStart = pOutPtr / Float32Array.BYTES_PER_ELEMENT;
    blockBuf.set(heap.subarray(pOutStart, pOutStart + rendered));

    // Chain through processors
    for (const ph of procHandles) {
      if (ph.type === 'rings') {
        const rings = ph.wasm as RingsWasm;
        let rHeap = getHeapF32(rings);
        const rInStart = ph.inPtr / Float32Array.BYTES_PER_ELEMENT;
        rHeap.set(blockBuf.subarray(0, framesToRender), rInStart);
        const rRendered = rings._rings_render(ph.handle, ph.inPtr, ph.outPtr, framesToRender);
        rHeap = getHeapF32(rings);
        const rOutStart = ph.outPtr / Float32Array.BYTES_PER_ELEMENT;
        blockBuf.set(rHeap.subarray(rOutStart, rOutStart + rRendered));
      } else if (ph.type === 'clouds') {
        const clouds = ph.wasm as CloudsWasm;
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

  return output;
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
// Mix voices to mono
// ---------------------------------------------------------------------------

function mixVoices(voiceOutputs: Float32Array[]): Float32Array {
  if (voiceOutputs.length === 0) return new Float32Array(0);

  const maxLen = Math.max(...voiceOutputs.map(v => v.length));
  const mix = new Float32Array(maxLen);

  for (const voiceOut of voiceOutputs) {
    for (let i = 0; i < voiceOut.length; i++) {
      mix[i] += voiceOut[i];
    }
  }

  // Normalise to prevent clipping if multiple voices are loud
  if (voiceOutputs.length > 1) {
    const scale = 1 / Math.sqrt(voiceOutputs.length);
    for (let i = 0; i < mix.length; i++) {
      mix[i] *= scale;
    }
  }

  return mix;
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = async (event: MessageEvent<RenderWorkerRequest>) => {
  const { spec } = event.data;

  try {
    const stepsPerBar = 16;
    const totalSteps = spec.bars * stepsPerBar;

    const voiceOutputs = await Promise.all(
      spec.voices.map(voice => renderVoice(voice, spec.sampleRate, spec.bpm, totalSteps)),
    );

    const pcm = mixVoices(voiceOutputs);

    const response: RenderWorkerResponse = {
      type: 'done',
      pcm,
      sampleRate: spec.sampleRate,
    };

    // Transfer the buffer to avoid copying
    (self as unknown as Worker).postMessage(response, [pcm.buffer]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorResponse: RenderWorkerError = { type: 'error', message };
    (self as unknown as Worker).postMessage(errorResponse);
  }
};
