// src/audio/chorus-synth.ts
import type { ChorusProcessorCommand, ChorusProcessorStatus, ChorusPatchParams } from './chorus-messages';
import type { ProcessorContract, ModuleCommand } from './module-contract';
import { warnUnsupportedCommand } from './module-contract';

const WORKLET_URL = new URL('./chorus-worklet.ts', import.meta.url).href;
const INIT_TIMEOUT_MS = 5000;

/** @deprecated Use ProcessorContract instead. */
export type ChorusEngine = ProcessorContract;

export class ChorusSynth implements ProcessorContract {
  private static moduleLoads = new WeakMap<AudioContext, Promise<void>>();

  static async create(ctx: AudioContext): Promise<ChorusSynth> {
    await this.ensureWorkletModule(ctx);
    const synth = new ChorusSynth(ctx);
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
  private currentPatch: ChorusPatchParams = {
    rate: 0.3,
    depth: 0.5,
    feedback: 0.0,
    mix: 0.5,
    stereo: 0.5,
  };
  private currentMode = 0;

  private constructor(ctx: AudioContext) {
    this.node = new AudioWorkletNode(ctx, 'chorus-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // Do NOT connect output here — AudioEngine.rebuildChain() manages all connections
    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out waiting for Chorus processor'));
      }, INIT_TIMEOUT_MS);

      this.node.port.onmessage = (event: MessageEvent<ChorusProcessorStatus>) => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          const error = new Error(message.message);
          console.error('Chorus processor failed to initialize.', error);
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

  private post(message: ChorusProcessorCommand): void {
    this.node.port.postMessage(message);
  }

  get inputNode(): AudioNode {
    return this.node;
  }

  setModel(model: number): void {
    this.currentMode = Math.max(0, Math.min(2, model));
    this.post({ type: 'set-mode', mode: this.currentMode });
  }

  /** @deprecated Use setModel instead. */
  setMode(mode: number): void {
    this.setModel(mode);
  }

  setPatch(params: Record<string, number>): void {
    this.currentPatch = {
      rate: params.rate ?? this.currentPatch.rate,
      depth: params.depth ?? this.currentPatch.depth,
      feedback: params.feedback ?? this.currentPatch.feedback,
      mix: params.mix ?? this.currentPatch.mix,
      stereo: params.stereo ?? this.currentPatch.stereo,
    };
    this.post({ type: 'set-patch', patch: this.currentPatch });
  }

  sendCommand(command: ModuleCommand): void {
    warnUnsupportedCommand('chorus', command);
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
