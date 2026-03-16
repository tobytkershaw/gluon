import type { ScheduledNote } from '../engine/sequencer-types';
import type { SynthEngine, SynthParams } from './synth-interface';
import type { PlaitsProcessorCommand, PlaitsProcessorStatus, PlaitsExtendedParams } from './plaits-messages';

const WORKLET_URL = '/audio/plaits-worklet.js';
const MODULE_URL = '/audio/plaits-module.js';
const WASM_URL = '/audio/plaits.wasm';
const INIT_TIMEOUT_MS = 5000;
const GLUON_TO_PLAITS_ENGINE_OFFSET = 8;

function clampModel(model: number): number {
  return Math.max(0, Math.min(15, model));
}

function toPlaitsEngineIndex(model: number): number {
  return clampModel(model) + GLUON_TO_PLAITS_ENGINE_OFFSET;
}

export class PlaitsSynth implements SynthEngine {
  private static moduleLoads = new WeakMap<AudioContext, Promise<void>>();
  private static wasmBinaryLoad: Promise<ArrayBuffer> | null = null;

  static async create(ctx: AudioContext, output: AudioNode): Promise<PlaitsSynth> {
    await this.ensureWorkletModule(ctx);
    const wasmBinary = await this.loadWasmBinary();
    const synth = new PlaitsSynth(ctx, output, wasmBinary);
    await synth.waitUntilReady();
    return synth;
  }

  private static ensureWorkletModule(ctx: AudioContext): Promise<void> {
    let load = this.moduleLoads.get(ctx);
    if (!load) {
      if (!('audioWorklet' in ctx) || !ctx.audioWorklet) {
        throw new Error('AudioWorklet unsupported');
      }
      load = (async () => {
        await ctx.audioWorklet.addModule(MODULE_URL);
        await ctx.audioWorklet.addModule(WORKLET_URL);
      })().catch((error) => {
        this.moduleLoads.delete(ctx);
        throw error;
      });
      this.moduleLoads.set(ctx, load);
    }
    return load;
  }

  private static loadWasmBinary(): Promise<ArrayBuffer> {
    if (!this.wasmBinaryLoad) {
      this.wasmBinaryLoad = fetch(WASM_URL)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch Plaits WASM: ${response.status}`);
          }
          return response.arrayBuffer();
        })
        .catch((error) => {
          this.wasmBinaryLoad = null;
          throw error;
        });
    }
    return this.wasmBinaryLoad;
  }

  private readonly node: AudioWorkletNode;
  private readonly analyser: AnalyserNode;
  private readonly ready: Promise<void>;
  private currentParams: SynthParams | null = null;
  private currentModel = 0;

  private constructor(ctx: AudioContext, output: AudioNode, wasmBinary: ArrayBuffer) {
    this.node = new AudioWorkletNode(ctx, 'plaits-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasmBinary },
    });

    this.analyser = ctx.createAnalyser();
    this.node.connect(this.analyser);
    this.analyser.connect(output);

    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out waiting for Plaits processor'));
      }, INIT_TIMEOUT_MS);

      this.node.port.onmessage = (event: MessageEvent<PlaitsProcessorStatus>) => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          const error = new Error(message.message);
          console.error('Plaits processor failed to initialize.', error);
          reject(error);
        }
      };
    });
  }

  private async waitUntilReady(): Promise<void> {
    await this.ready;
    this.setModel(this.currentModel);
    if (this.currentParams) {
      this.setParams(this.currentParams);
    }
  }

  private post(message: PlaitsProcessorCommand): void {
    this.node.port.postMessage(message);
  }

  get workletNode(): AudioWorkletNode {
    return this.node;
  }

  setModel(model: number): void {
    this.currentModel = clampModel(model);
    this.post({ type: 'set-model', model: toPlaitsEngineIndex(this.currentModel) });
  }

  setParams(params: SynthParams): void {
    this.currentParams = { ...params };
    this.post({ type: 'set-patch', patch: this.currentParams });
  }

  setExtended(params: PlaitsExtendedParams): void {
    this.post({ type: 'set-extended', extended: params });
  }

  scheduleNote(note: ScheduledNote, fence?: number): void {
    // Only send a timed set-patch when this note has per-step overrides
    // (param locks or NoteEvent pitch). A timed set-patch would overwrite
    // live human knob changes made between scheduling and note-on because
    // the scheduler runs 100ms ahead. Notes without overrides rely on the
    // real-time sync effect to keep the worklet current; the worklet's
    // patchDirty/flushPatch mechanism ensures WASM is flushed before trigger.
    if (note.baseParams) {
      const allKeys = new Set([...Object.keys(note.params), ...Object.keys(note.baseParams)]);
      const hasOverrides = [...allKeys].some(
        k => Math.abs((note.params[k] ?? 0) - (note.baseParams![k] ?? 0)) > 0.001,
      );
      if (hasOverrides) {
        this.post({ type: 'set-patch', patch: note.params, time: note.time, fence });
      }
    } else {
      this.post({ type: 'set-patch', patch: note.params, time: note.time, fence });
    }
    this.post({ type: 'trigger', time: note.time, accentLevel: note.accent ? 1.0 : 0.8, fence });
    this.post({ type: 'set-gate', time: note.time, open: true, fence });
    this.post({ type: 'set-gate', time: note.gateOffTime, open: false, fence });
  }

  silence(fence?: number): void {
    this.post({ type: 'clear-scheduled', fence: fence ?? 0 });
    this.post({ type: 'set-gate', open: false });
  }

  destroy(): void {
    this.post({ type: 'destroy' });
    this.node.disconnect();
    this.analyser.disconnect();
    this.node.port.close();
  }
}
