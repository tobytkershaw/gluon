import type { CloudsProcessorCommand, CloudsProcessorStatus, CloudsPatchParams, CloudsExtendedParams } from './clouds-messages';
import type { ProcessorContract, ModuleCommand } from './module-contract';
import { warnUnsupportedCommand } from './module-contract';

const WORKLET_URL = '/audio/clouds-worklet.js';
const MODULE_URL = '/audio/clouds-module.js';
const WASM_URL = '/audio/clouds.wasm';
const INIT_TIMEOUT_MS = 5000;

/** @deprecated Use ProcessorContract instead. */
export type CloudsEngine = ProcessorContract;

export class CloudsSynth implements ProcessorContract {
  private static moduleLoads = new WeakMap<AudioContext, Promise<void>>();
  private static wasmBinaryLoad: Promise<ArrayBuffer> | null = null;

  static async create(ctx: AudioContext): Promise<CloudsSynth> {
    await this.ensureWorkletModule(ctx);
    const wasmBinary = await this.loadWasmBinary();
    const synth = new CloudsSynth(ctx, wasmBinary);
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
            throw new Error(`Failed to fetch Clouds WASM: ${response.status}`);
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

  readonly role = 'processor' as const;

  private readonly node: AudioWorkletNode;
  private readonly ready: Promise<void>;
  private currentPatch: CloudsPatchParams = { position: 0.5, size: 0.5, density: 0.5, feedback: 0.0 };
  private currentExtended: CloudsExtendedParams = { texture: 0.5, pitch: 0.5, dry_wet: 0.5, stereo_spread: 0.0, reverb: 0.0 };
  private currentMode = 0;

  private constructor(ctx: AudioContext, wasmBinary: ArrayBuffer) {
    this.node = new AudioWorkletNode(ctx, 'clouds-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasmBinary },
    });

    // Do NOT connect output here — AudioEngine.rebuildChain() manages all connections
    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out waiting for Clouds processor'));
      }, INIT_TIMEOUT_MS);

      this.node.port.onmessage = (event: MessageEvent<CloudsProcessorStatus>) => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          const error = new Error(message.message);
          console.error('Clouds processor failed to initialize.', error);
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

  private post(message: CloudsProcessorCommand): void {
    this.node.port.postMessage(message);
  }

  get inputNode(): AudioNode {
    return this.node;
  }

  setModel(model: number): void {
    this.currentMode = Math.max(0, Math.min(3, model));
    this.post({ type: 'set-mode', mode: this.currentMode });
  }

  /** @deprecated Use setModel instead. */
  setMode(mode: number): void {
    this.setModel(mode);
  }

  setPatch(params: Record<string, number>): void {
    // Base params
    this.currentPatch = {
      position: params.position ?? this.currentPatch.position,
      size: params.size ?? this.currentPatch.size,
      density: params.density ?? this.currentPatch.density,
      feedback: params.feedback ?? this.currentPatch.feedback,
    };
    this.post({ type: 'set-patch', patch: this.currentPatch });
    // Extended params
    const extended: CloudsExtendedParams = {
      texture: params.texture ?? this.currentExtended.texture,
      pitch: params.pitch ?? this.currentExtended.pitch,
      dry_wet: params['dry-wet'] ?? params.dry_wet ?? this.currentExtended.dry_wet,
      stereo_spread: params['stereo-spread'] ?? params.stereo_spread ?? this.currentExtended.stereo_spread,
      reverb: params.reverb ?? this.currentExtended.reverb,
    };
    this.currentExtended = extended;
    this.post({ type: 'set-extended', extended });
    // Discrete: freeze
    if (params.freeze !== undefined) {
      this.post({ type: 'set-freeze', freeze: params.freeze >= 0.5 });
    }
  }

  sendCommand(command: ModuleCommand): void {
    switch (command.type) {
      case 'freeze':
        this.post({ type: 'set-freeze', freeze: command.enabled });
        break;
      default:
        warnUnsupportedCommand('clouds', command);
    }
  }

  /** @deprecated Use setPatch or sendCommand instead. */
  setExtended(params: CloudsExtendedParams): void {
    this.post({ type: 'set-extended', extended: params });
  }

  /** @deprecated Use sendCommand({ type: 'freeze', enabled }) instead. */
  setFreeze(freeze: boolean): void {
    this.sendCommand({ type: 'freeze', enabled: freeze });
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
