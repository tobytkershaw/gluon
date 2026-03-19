import type { TidesProcessorCommand, TidesProcessorStatus, TidesPatchParams, TidesExtendedParams } from './tides-messages';
import type { ModulatorContract } from './module-contract';

const WORKLET_URL = '/audio/tides-worklet.js';
const MODULE_URL = '/audio/tides-module.js';
const WASM_URL = '/audio/tides.wasm';
const INIT_TIMEOUT_MS = 5000;

/** @deprecated Use ModulatorContract instead. */
export type TidesEngine = ModulatorContract;

export class TidesSynth implements ModulatorContract {
  private static moduleLoads = new WeakMap<AudioContext, Promise<void>>();
  private static wasmBinaryLoad: Promise<ArrayBuffer> | null = null;

  static async create(ctx: AudioContext): Promise<TidesSynth> {
    await this.ensureWorkletModule(ctx);
    const wasmBinary = await this.loadWasmBinary();
    const synth = new TidesSynth(ctx, wasmBinary);
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
            throw new Error(`Failed to fetch Tides WASM: ${response.status}`);
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

  readonly role = 'modulator' as const;

  private readonly node: AudioWorkletNode;
  private readonly ready: Promise<void>;
  private currentMode = 1;  // Default: Looping
  private currentPatch: TidesPatchParams | null = null;

  private constructor(ctx: AudioContext, wasmBinary: ArrayBuffer) {
    this.node = new AudioWorkletNode(ctx, 'tides-processor', {
      numberOfInputs: 0,    // No audio input — Tides generates output
      numberOfOutputs: 1,
      outputChannelCount: [1],  // Mono modulation signal
      processorOptions: { wasmBinary },
    });

    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out waiting for Tides processor'));
      }, INIT_TIMEOUT_MS);

      this.node.port.onmessage = (event: MessageEvent<TidesProcessorStatus>) => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          const error = new Error(message.message);
          console.error('Tides processor failed to initialize.', error);
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

  private post(message: TidesProcessorCommand): void {
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
    const patch: TidesPatchParams = {
      frequency: params.frequency ?? this.currentPatch?.frequency ?? 0.5,
      shape: params.shape ?? this.currentPatch?.shape ?? 0.5,
      slope: params.slope ?? this.currentPatch?.slope ?? 0.5,
      smoothness: params.smoothness ?? this.currentPatch?.smoothness ?? 0.5,
    };
    this.currentPatch = patch;
    this.post({
      type: 'set-patch',
      frequency: patch.frequency,
      shape: patch.shape,
      slope: patch.slope,
      smoothness: patch.smoothness,
    });
    // Extended params merged into the single setPatch call
    const extended: TidesExtendedParams = {
      shift: params.shift ?? 0.0,
      output_mode: Math.round(params['output-mode'] ?? params.output_mode ?? 0),
      range: Math.round(params.range ?? 0),
    };
    this.post({ type: 'set-extended', extended });
  }

  /** @deprecated Use setPatch instead — extended params are now merged. */
  setExtended(params: TidesExtendedParams): void {
    this.post({ type: 'set-extended', extended: params });
  }

  silence(_fence?: number): void {
    // Tides has no scheduled events and no fence logic, but clear any pending messages
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
