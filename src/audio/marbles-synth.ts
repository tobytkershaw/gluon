// src/audio/marbles-synth.ts
// Pure JS modulator synth wrapper for Marbles (no WASM needed).
import type { MarblesProcessorCommand, MarblesProcessorStatus, MarblesPatchParams } from './marbles-messages';
import type { ModulatorContract } from './module-contract';

const WORKLET_URL = new URL('./marbles-worklet.ts', import.meta.url).href;
const INIT_TIMEOUT_MS = 5000;

/** @deprecated Use ModulatorContract instead. */
export type MarblesEngine = ModulatorContract;

export class MarblesSynth implements ModulatorContract {
  private static moduleLoads = new WeakMap<AudioContext, Promise<void>>();

  static async create(ctx: AudioContext): Promise<MarblesSynth> {
    await this.ensureWorkletModule(ctx);
    const synth = new MarblesSynth(ctx);
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

  readonly role = 'modulator' as const;

  private readonly node: AudioWorkletNode;
  private readonly ready: Promise<void>;
  private currentMode = 0;  // Default: Voltage
  private currentPatch: MarblesPatchParams | null = null;

  private constructor(ctx: AudioContext) {
    this.node = new AudioWorkletNode(ctx, 'marbles-processor', {
      numberOfInputs: 0,    // No audio input — Marbles generates output
      numberOfOutputs: 1,
      outputChannelCount: [2],  // Stereo for 'both' mode (voltage L, gate R)
    });

    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out waiting for Marbles processor'));
      }, INIT_TIMEOUT_MS);

      this.node.port.onmessage = (event: MessageEvent<MarblesProcessorStatus>) => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          const error = new Error(message.message);
          console.error('Marbles processor failed to initialize.', error);
          reject(error);
        }
      };
    });
  }

  private async waitUntilReady(): Promise<void> {
    await this.ready;
    this.setModel(this.currentMode);
    if (this.currentPatch) {
      this.setPatch(this.currentPatch);
    }
  }

  private post(message: MarblesProcessorCommand): void {
    this.node.port.postMessage(message);
  }

  get outputNode(): AudioNode {
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
    const patch: MarblesPatchParams = {
      rate: params.rate ?? this.currentPatch?.rate ?? 0.5,
      spread: params.spread ?? this.currentPatch?.spread ?? 0.5,
      bias: params.bias ?? this.currentPatch?.bias ?? 0.5,
      steps: params.steps ?? this.currentPatch?.steps ?? 0.0,
      deja_vu: params.deja_vu ?? this.currentPatch?.deja_vu ?? 0.0,
      length: params.length ?? this.currentPatch?.length ?? 0.25,
    };
    this.currentPatch = patch;
    this.post({ type: 'set-patch', patch });
  }

  silence(_fence?: number): void {
    this.post({ type: 'clear-scheduled' });
  }

  pause(): void {
    this.post({ type: 'pause' });
  }

  resume(): void {
    this.post({ type: 'resume' });
  }

  destroy(): void {
    this.post({ type: 'destroy' });
    this.node.disconnect();
    this.node.port.close();
  }
}
