import type { EqProcessorCommand, EqProcessorStatus, EqPatchParams } from './eq-messages';

const WORKLET_URL = '/audio/eq-worklet.js';
const INIT_TIMEOUT_MS = 5000;

export interface EqEngine {
  /** The AudioWorkletNode — connect a source to its input */
  readonly inputNode: AudioNode;
  setMode(mode: number): void;
  setPatch(params: EqPatchParams): void;
  /** Clear all scheduled events from the worklet queue. */
  silence(fence?: number): void;
  destroy(): void;
}

export class EqSynth implements EqEngine {
  private static moduleLoads = new WeakMap<AudioContext, Promise<void>>();

  static async create(ctx: AudioContext): Promise<EqSynth> {
    await this.ensureWorkletModule(ctx);
    const synth = new EqSynth(ctx);
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
  private currentPatch: EqPatchParams = {
    low_freq: 0.25, low_gain: 0.5,
    mid1_freq: 0.4, mid1_gain: 0.5, mid1_q: 0.3,
    mid2_freq: 0.6, mid2_gain: 0.5, mid2_q: 0.3,
    high_freq: 0.75, high_gain: 0.5,
  };
  private currentMode = 0;

  private constructor(ctx: AudioContext) {
    this.node = new AudioWorkletNode(ctx, 'eq-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // Do NOT connect output here — AudioEngine.rebuildChain() manages all connections
    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out waiting for EQ processor'));
      }, INIT_TIMEOUT_MS);

      this.node.port.onmessage = (event: MessageEvent<EqProcessorStatus>) => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          const error = new Error(message.message);
          console.error('EQ processor failed to initialize.', error);
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

  private post(message: EqProcessorCommand): void {
    this.node.port.postMessage(message);
  }

  get inputNode(): AudioNode {
    return this.node;
  }

  setMode(mode: number): void {
    this.currentMode = Math.max(0, Math.min(1, mode));
    this.post({ type: 'set-mode', mode: this.currentMode });
  }

  setPatch(params: EqPatchParams): void {
    this.currentPatch = { ...params };
    this.post({ type: 'set-patch', patch: this.currentPatch });
  }

  silence(fence?: number): void {
    const f = fence ?? 0;
    const minFenceParam = this.node.parameters.get('min-fence');
    if (minFenceParam) {
      minFenceParam.setValueAtTime(f, 0);
    }
    this.post({ type: 'clear-scheduled', fence: f });
  }

  destroy(): void {
    this.post({ type: 'destroy' });
    this.node.disconnect();
    this.node.port.close();
  }
}
