// src/audio/compressor-synth.ts
import type { CompressorProcessorCommand, CompressorProcessorStatus, CompressorPatchParams } from './compressor-messages';

const WORKLET_URL = new URL('./compressor-worklet.ts', import.meta.url).href;
const INIT_TIMEOUT_MS = 5000;

export interface CompressorEngine {
  /** The AudioWorkletNode — connect a source to its input */
  readonly inputNode: AudioNode;
  setMode(mode: number): void;
  setPatch(params: CompressorPatchParams): void;
  /** Clear all scheduled events from the worklet queue. */
  silence(fence?: number): void;
  destroy(): void;
}

export class CompressorSynth implements CompressorEngine {
  private static moduleLoads = new WeakMap<AudioContext, Promise<void>>();

  static async create(ctx: AudioContext): Promise<CompressorSynth> {
    await this.ensureWorkletModule(ctx);
    const synth = new CompressorSynth(ctx);
    await synth.waitUntilReady();
    return synth;
  }

  private static ensureWorkletModule(ctx: AudioContext): Promise<void> {
    let load = this.moduleLoads.get(ctx);
    if (!load) {
      if (!('audioWorklet' in ctx) || !ctx.audioWorklet) {
        throw new Error('AudioWorklet unsupported');
      }
      load = ctx.audioWorklet.addModule(WORKLET_URL).catch((error) => {
        this.moduleLoads.delete(ctx);
        throw error;
      });
      this.moduleLoads.set(ctx, load);
    }
    return load;
  }

  private readonly node: AudioWorkletNode;
  private readonly ready: Promise<void>;
  private currentPatch: CompressorPatchParams = {
    threshold: 0.5,
    ratio: 0.3,
    attack: 0.3,
    release: 0.4,
    makeup: 0.0,
    mix: 1.0,
  };
  private currentMode = 0;

  private constructor(ctx: AudioContext) {
    this.node = new AudioWorkletNode(ctx, 'compressor-processor', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // Do NOT connect output here — AudioEngine.rebuildChain() manages all connections
    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out waiting for Compressor processor'));
      }, INIT_TIMEOUT_MS);

      this.node.port.onmessage = (event: MessageEvent<CompressorProcessorStatus>) => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          const error = new Error(message.message);
          console.error('Compressor processor failed to initialize.', error);
          reject(error);
        }
      };
    });
  }

  private async waitUntilReady(): Promise<void> {
    await this.ready;
    this.setMode(this.currentMode);
    this.setPatch(this.currentPatch);
  }

  private post(message: CompressorProcessorCommand): void {
    this.node.port.postMessage(message);
  }

  get inputNode(): AudioNode {
    return this.node;
  }

  /** The second input of the worklet node — connect a sidechain source here. */
  get sidechainInputNode(): AudioNode {
    return this.node;
  }

  /** The input index for sidechain connections (second input of the AudioWorkletNode). */
  get sidechainInputIndex(): number {
    return 1;
  }

  /** Notify the worklet that a sidechain source is connected or disconnected. */
  setSidechainEnabled(enabled: boolean): void {
    this.post({ type: 'sidechain', enabled });
  }

  setMode(mode: number): void {
    this.currentMode = Math.max(0, Math.min(3, mode));
    this.post({ type: 'set-mode', mode: this.currentMode });
  }

  setPatch(params: CompressorPatchParams): void {
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
