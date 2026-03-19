// src/audio/frames-synth.ts
import type { FramesProcessorCommand, FramesProcessorStatus, FramesPatchParams } from './frames-messages';

const WORKLET_URL = new URL('./frames-worklet.ts', import.meta.url).href;
const INIT_TIMEOUT_MS = 5000;

export interface FramesEngine {
  /** The AudioWorkletNode — connect a source to its input */
  readonly inputNode: AudioNode;
  setMode(mode: number): void;
  setPatch(params: FramesPatchParams): void;
  /** Clear all scheduled events from the worklet queue. */
  silence(fence?: number): void;
  destroy(): void;
}

export class FramesSynth implements FramesEngine {
  private static moduleLoads = new WeakMap<AudioContext, Promise<void>>();

  static async create(ctx: AudioContext): Promise<FramesSynth> {
    await this.ensureWorkletModule(ctx);
    const synth = new FramesSynth(ctx);
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
  private currentPatch: FramesPatchParams = {
    frame: 0.0,
    channel_1: 0.0,
    channel_2: 0.0,
    channel_3: 0.0,
    channel_4: 0.0,
    modulation: 0.5,
    kf_count: 0.1, // 2 keyframes (0.1 * 20 = 2)
    kf_0_pos: 0.0,
    kf_0_ch1: 0.0,
    kf_0_ch2: 0.0,
    kf_0_ch3: 0.0,
    kf_0_ch4: 0.0,
    kf_1_pos: 1.0,
    kf_1_ch1: 1.0,
    kf_1_ch2: 1.0,
    kf_1_ch3: 1.0,
    kf_1_ch4: 1.0,
  };
  private currentMode = 0;

  private constructor(ctx: AudioContext) {
    this.node = new AudioWorkletNode(ctx, 'frames-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // Do NOT connect output here — AudioEngine.rebuildChain() manages all connections
    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out waiting for Frames processor'));
      }, INIT_TIMEOUT_MS);

      this.node.port.onmessage = (event: MessageEvent<FramesProcessorStatus>) => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          const error = new Error(message.message);
          console.error('Frames processor failed to initialize.', error);
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

  private post(message: FramesProcessorCommand): void {
    this.node.port.postMessage(message);
  }

  get inputNode(): AudioNode {
    return this.node;
  }

  setMode(mode: number): void {
    this.currentMode = Math.max(0, Math.min(1, mode));
    this.post({ type: 'set-mode', mode: this.currentMode });
  }

  setPatch(params: FramesPatchParams): void {
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
