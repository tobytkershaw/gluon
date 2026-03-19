// src/audio/marbles-synth.ts
// Pure JS modulator synth wrapper for Marbles (no WASM needed).
import type { MarblesProcessorCommand, MarblesProcessorStatus, MarblesPatchParams } from './marbles-messages';

const WORKLET_URL = new URL('./marbles-worklet.ts', import.meta.url).href;
const INIT_TIMEOUT_MS = 5000;

export interface MarblesEngine {
  /** The AudioWorkletNode — connect its output to GainNodes for modulation routing */
  readonly outputNode: AudioNode;
  setMode(mode: number): void;
  setPatch(params: MarblesPatchParams): void;
  /** No extended params for Marbles (all params are in the patch). */
  setExtended(params: Record<string, number>): void;
  /** Clear all scheduled events from the worklet queue. */
  silence(fence?: number): void;
  /** Pause modulation output (fill with zeros). */
  pause(): void;
  /** Resume modulation output after pause. */
  resume(): void;
  destroy(): void;
}

export class MarblesSynth implements MarblesEngine {
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
    this.setMode(this.currentMode);
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

  setMode(mode: number): void {
    this.currentMode = Math.max(0, Math.min(2, mode));
    this.post({ type: 'set-mode', mode: this.currentMode });
  }

  setPatch(params: MarblesPatchParams): void {
    this.currentPatch = { ...params };
    this.post({
      type: 'set-patch',
      patch: {
        rate: params.rate ?? 0.5,
        spread: params.spread ?? 0.5,
        bias: params.bias ?? 0.5,
        steps: params.steps ?? 0.0,
        deja_vu: params.deja_vu ?? 0.0,
        length: params.length ?? 0.25,
      },
    });
  }

  setExtended(_params: Record<string, number>): void {
    // Marbles has no extended params — all controls are in the main patch.
    // This method exists for interface compatibility with the modulator slot.
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
