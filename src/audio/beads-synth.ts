import type { BeadsProcessorCommand, BeadsProcessorStatus, BeadsPatchParams } from './beads-messages';

const WORKLET_URL = '/audio/beads-worklet.js';
const MODULE_URL = '/audio/beads-module.js';
const WASM_URL = '/audio/beads.wasm';
const INIT_TIMEOUT_MS = 5000;

export interface BeadsEngine {
  /** The AudioWorkletNode — connect a source to its input */
  readonly inputNode: AudioNode;
  setModel(model: number): void;
  setPatch(params: BeadsPatchParams): void;
  /** Clear all scheduled events from the worklet queue. */
  silence(fence?: number): void;
  destroy(): void;
}

export class BeadsSynth implements BeadsEngine {
  private static moduleLoads = new WeakMap<AudioContext, Promise<void>>();
  private static wasmBinaryLoad: Promise<ArrayBuffer> | null = null;

  static async create(ctx: AudioContext): Promise<BeadsSynth> {
    await this.ensureWorkletModule(ctx);
    const wasmBinary = await this.loadWasmBinary();
    const synth = new BeadsSynth(ctx, wasmBinary);
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
            throw new Error(`Failed to fetch Beads WASM: ${response.status}`);
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
  private currentPatch: BeadsPatchParams = { time: 0.5, density: 0.5, texture: 0.5, position: 0.5, pitch: 0.5, dry_wet: 0.5 };
  private currentModel = 0;

  private constructor(ctx: AudioContext, wasmBinary: ArrayBuffer) {
    this.node = new AudioWorkletNode(ctx, 'beads-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasmBinary },
    });

    // Do NOT connect output here — AudioEngine.rebuildChain() manages all connections
    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out waiting for Beads processor'));
      }, INIT_TIMEOUT_MS);

      this.node.port.onmessage = (event: MessageEvent<BeadsProcessorStatus>) => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          const error = new Error(message.message);
          console.error('Beads processor failed to initialize.', error);
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

  private post(message: BeadsProcessorCommand): void {
    this.node.port.postMessage(message);
  }

  get inputNode(): AudioNode {
    return this.node;
  }

  setModel(model: number): void {
    this.currentModel = Math.max(0, Math.min(2, model));
    this.post({ type: 'set-model', model: this.currentModel });
  }

  setPatch(params: BeadsPatchParams): void {
    this.currentPatch = { ...params };
    this.post({ type: 'set-patch', patch: this.currentPatch });
  }

  silence(fence?: number): void {
    const f = fence ?? 0;
    // Synchronous: AudioParam is read in the same process() block,
    // eliminating the race where postMessage arrives between blocks.
    const minFenceParam = this.node.parameters.get('min-fence');
    if (minFenceParam) {
      minFenceParam.setValueAtTime(f, 0);
    }
    // Fallback: message-based clear (kept for compatibility)
    this.post({ type: 'clear-scheduled', fence: f });
  }

  destroy(): void {
    this.post({ type: 'destroy' });
    this.node.disconnect();
    this.node.port.close();
  }
}
