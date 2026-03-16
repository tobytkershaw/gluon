import type { RingsProcessorCommand, RingsProcessorStatus, RingsPatchParams } from './rings-messages';

const WORKLET_URL = '/audio/rings-worklet.js';
const MODULE_URL = '/audio/rings-module.js';
const WASM_URL = '/audio/rings.wasm';
const INIT_TIMEOUT_MS = 5000;

export interface RingsEngine {
  /** The AudioWorkletNode — connect a source to its input */
  readonly inputNode: AudioNode;
  setModel(model: number): void;
  setPatch(params: RingsPatchParams): void;
  setNote(tonic: number, note: number): void;
  setFineTune(offset: number): void;
  setPolyphony(polyphony: number): void;
  setInternalExciter(enabled: boolean): void;
  strum(time: number): void;
  /** Clear all scheduled events from the worklet queue. */
  silence(fence?: number): void;
  /** Mute resonator output until the next strum. */
  damp(): void;
  destroy(): void;
}

export class RingsSynth implements RingsEngine {
  private static moduleLoads = new WeakMap<AudioContext, Promise<void>>();
  private static wasmBinaryLoad: Promise<ArrayBuffer> | null = null;

  static async create(ctx: AudioContext): Promise<RingsSynth> {
    await this.ensureWorkletModule(ctx);
    const wasmBinary = await this.loadWasmBinary();
    const synth = new RingsSynth(ctx, wasmBinary);
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
            throw new Error(`Failed to fetch Rings WASM: ${response.status}`);
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
  private readonly ready: Promise<void>;
  private currentPatch: RingsPatchParams = { structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 };
  private currentModel = 0;

  private constructor(ctx: AudioContext, wasmBinary: ArrayBuffer) {
    this.node = new AudioWorkletNode(ctx, 'rings-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasmBinary },
    });

    // Do NOT connect output here — AudioEngine.rebuildChain() manages all connections
    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out waiting for Rings processor'));
      }, INIT_TIMEOUT_MS);

      this.node.port.onmessage = (event: MessageEvent<RingsProcessorStatus>) => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          const error = new Error(message.message);
          console.error('Rings processor failed to initialize.', error);
          reject(error);
        }
      };
    });
  }

  private async waitUntilReady(): Promise<void> {
    await this.ready;
    this.setModel(this.currentModel);
    this.setPatch(this.currentPatch);
  }

  private post(message: RingsProcessorCommand): void {
    this.node.port.postMessage(message);
  }

  get inputNode(): AudioNode {
    return this.node;
  }

  setModel(model: number): void {
    this.currentModel = Math.max(0, Math.min(5, model));
    this.post({ type: 'set-model', model: this.currentModel });
  }

  setPatch(params: RingsPatchParams): void {
    this.currentPatch = { ...params };
    this.post({ type: 'set-patch', patch: this.currentPatch });
  }

  setNote(tonic: number, note: number): void {
    this.post({ type: 'set-note', tonic, note });
  }

  setFineTune(offset: number): void {
    this.post({ type: 'set-fine-tune', offset });
  }

  setPolyphony(polyphony: number): void {
    this.post({ type: 'set-polyphony', polyphony: Math.max(1, Math.min(4, polyphony)) });
  }

  setInternalExciter(enabled: boolean): void {
    this.post({ type: 'set-internal-exciter', enabled });
  }

  strum(time: number): void {
    this.post({ type: 'strum', time });
  }

  silence(fence?: number): void {
    this.post({ type: 'clear-scheduled', fence: fence ?? 0 });
  }

  damp(): void {
    this.post({ type: 'damp' });
  }

  destroy(): void {
    this.post({ type: 'destroy' });
    this.node.disconnect();
    this.node.port.close();
  }
}
