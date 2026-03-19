// src/audio/warps-synth.ts
import type { WarpsProcessorCommand, WarpsProcessorStatus, WarpsPatchParams } from './warps-messages';
import type { ProcessorContract, ModuleCommand } from './module-contract';
import { warnUnsupportedCommand } from './module-contract';

const WORKLET_URL = new URL('./warps-worklet.ts', import.meta.url).href;
const INIT_TIMEOUT_MS = 5000;

/** @deprecated Use ProcessorContract instead. */
export type WarpsEngine = ProcessorContract;

export class WarpsSynth implements ProcessorContract {
  private static moduleLoads = new WeakMap<AudioContext, Promise<void>>();

  static async create(ctx: AudioContext): Promise<WarpsSynth> {
    await this.ensureWorkletModule(ctx);
    const synth = new WarpsSynth(ctx);
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
  private currentPatch: WarpsPatchParams = {
    algorithm: 0.5,
    timbre: 0.5,
    level: 0.5,
  };
  private currentModel = 0;

  private constructor(ctx: AudioContext) {
    this.node = new AudioWorkletNode(ctx, 'warps-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // Do NOT connect output here — AudioEngine.rebuildChain() manages all connections
    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out waiting for Warps processor'));
      }, INIT_TIMEOUT_MS);

      this.node.port.onmessage = (event: MessageEvent<WarpsProcessorStatus>) => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          const error = new Error(message.message);
          console.error('Warps processor failed to initialize.', error);
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

  private post(message: WarpsProcessorCommand): void {
    this.node.port.postMessage(message);
  }

  get inputNode(): AudioNode {
    return this.node;
  }

  get outputNode(): AudioNode {
    return this.node;
  }

  setModel(model: number): void {
    this.currentModel = Math.max(0, Math.min(3, model));
    this.post({ type: 'set-model', model: this.currentModel });
  }

  setPatch(params: Record<string, number>): void {
    this.currentPatch = {
      algorithm: params.algorithm ?? this.currentPatch.algorithm,
      timbre: params.timbre ?? this.currentPatch.timbre,
      level: params.level ?? this.currentPatch.level,
    };
    this.post({ type: 'set-patch', patch: this.currentPatch });
  }

  sendCommand(command: ModuleCommand): void {
    warnUnsupportedCommand('warps', command);
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
