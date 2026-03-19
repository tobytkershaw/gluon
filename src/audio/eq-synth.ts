import type { EqProcessorCommand, EqProcessorStatus, EqPatchParams } from './eq-messages';
import type { ProcessorContract, ModuleCommand } from './module-contract';
import { warnUnsupportedCommand } from './module-contract';

const WORKLET_URL = '/audio/eq-worklet.js';
const INIT_TIMEOUT_MS = 5000;

/** @deprecated Use ProcessorContract instead. */
export type EqEngine = ProcessorContract;

export class EqSynth implements ProcessorContract {
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

  readonly role = 'processor' as const;

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
    this.setModel(this.currentMode);
    this.setPatch(this.currentPatch);
  }

  private post(message: EqProcessorCommand): void {
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
    // Key normalization: hyphen → underscore for worklet
    this.currentPatch = {
      low_freq: params['low-freq'] ?? params.low_freq ?? this.currentPatch.low_freq,
      low_gain: params['low-gain'] ?? params.low_gain ?? this.currentPatch.low_gain,
      mid1_freq: params['mid1-freq'] ?? params.mid1_freq ?? this.currentPatch.mid1_freq,
      mid1_gain: params['mid1-gain'] ?? params.mid1_gain ?? this.currentPatch.mid1_gain,
      mid1_q: params['mid1-q'] ?? params.mid1_q ?? this.currentPatch.mid1_q,
      mid2_freq: params['mid2-freq'] ?? params.mid2_freq ?? this.currentPatch.mid2_freq,
      mid2_gain: params['mid2-gain'] ?? params.mid2_gain ?? this.currentPatch.mid2_gain,
      mid2_q: params['mid2-q'] ?? params.mid2_q ?? this.currentPatch.mid2_q,
      high_freq: params['high-freq'] ?? params.high_freq ?? this.currentPatch.high_freq,
      high_gain: params['high-gain'] ?? params.high_gain ?? this.currentPatch.high_gain,
    };
    this.post({ type: 'set-patch', patch: this.currentPatch });
  }

  sendCommand(command: ModuleCommand): void {
    warnUnsupportedCommand('eq', command);
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
