// src/audio/frames-synth.ts
import type { FramesProcessorCommand, FramesProcessorStatus, FramesPatchParams } from './frames-messages';
import type { ProcessorContract, ModuleCommand } from './module-contract';
import { warnUnsupportedCommand } from './module-contract';

const WORKLET_URL = new URL('./frames-worklet.ts', import.meta.url).href;
const INIT_TIMEOUT_MS = 5000;

/** @deprecated Use ProcessorContract instead. */
export type FramesEngine = ProcessorContract;

export class FramesSynth implements ProcessorContract {
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

  readonly role = 'processor' as const;

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
    this.setModel(this.currentMode);
    this.setPatch(this.currentPatch);
  }

  private post(message: FramesProcessorCommand): void {
    this.node.port.postMessage(message);
  }

  get inputNode(): AudioNode {
    return this.node;
  }

  setModel(model: number): void {
    this.currentMode = Math.max(0, Math.min(1, model));
    this.post({ type: 'set-mode', mode: this.currentMode });
  }

  /** @deprecated Use setModel instead. */
  setMode(mode: number): void {
    this.setModel(mode);
  }

  setPatch(params: Record<string, number>): void {
    const result: FramesPatchParams = {
      frame: params.frame ?? this.currentPatch.frame,
      channel_1: params.channel_1 ?? this.currentPatch.channel_1,
      channel_2: params.channel_2 ?? this.currentPatch.channel_2,
      channel_3: params.channel_3 ?? this.currentPatch.channel_3,
      channel_4: params.channel_4 ?? this.currentPatch.channel_4,
      modulation: params.modulation ?? this.currentPatch.modulation,
      kf_count: params.kf_count ?? this.currentPatch.kf_count,
    };
    // Copy keyframe data params (kf_N_pos, kf_N_ch1..ch4)
    for (const key of Object.keys(params)) {
      if (key.startsWith('kf_') && key !== 'kf_count') {
        result[key] = params[key];
      }
    }
    // Preserve existing keyframe data not in current params
    for (const key of Object.keys(this.currentPatch)) {
      if (key.startsWith('kf_') && key !== 'kf_count' && !(key in params)) {
        result[key] = this.currentPatch[key];
      }
    }
    this.currentPatch = result;
    this.post({ type: 'set-patch', patch: this.currentPatch });
  }

  sendCommand(command: ModuleCommand): void {
    warnUnsupportedCommand('frames', command);
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
