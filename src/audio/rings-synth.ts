import type { RingsProcessorCommand, RingsProcessorStatus, RingsPatchParams } from './rings-messages';
import type { ProcessorContract, ModuleCommand } from './module-contract';
import { warnUnsupportedCommand } from './module-contract';

const WORKLET_URL = '/audio/rings-worklet.js';
const MODULE_URL = '/audio/rings-module.js';
const WASM_URL = '/audio/rings.wasm';
const INIT_TIMEOUT_MS = 5000;

/** @deprecated Use ProcessorContract instead. */
export type RingsEngine = ProcessorContract;

export class RingsSynth implements ProcessorContract {
  private static moduleLoads = new WeakMap<AudioContext, Promise<void>>();
  private static wasmBinaryLoad: Promise<ArrayBuffer> | null = null;

  static async create(ctx: AudioContext): Promise<RingsSynth> {
    await this.ensureWorkletModule(ctx);
    const wasmBinary = await this.loadWasmBinary();
    const synth = new RingsSynth(ctx, wasmBinary);
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
            throw new Error(`Failed to fetch Rings WASM: ${response.status}`);
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
  private currentPatch: RingsPatchParams = { structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 };
  private currentModel = 0;

  private constructor(ctx: AudioContext, wasmBinary: ArrayBuffer) {
    this.node = new AudioWorkletNode(ctx, 'rings-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasmBinary },
    });

    // Do NOT connect output here — AudioEngine.rebuildChain() manages all connections
    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out waiting for Rings processor'));
      }, INIT_TIMEOUT_MS);

      this.node.port.onmessage = (event: MessageEvent<RingsProcessorStatus>) => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          const error = new Error(message.message);
          console.error('Rings processor failed to initialize.', error);
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

  private post(message: RingsProcessorCommand): void {
    this.node.port.postMessage(message);
  }

  get inputNode(): AudioNode {
    return this.node;
  }

  get outputNode(): AudioNode {
    return this.node;
  }

  setModel(model: number): void {
    this.currentModel = Math.max(0, Math.min(5, model));
    this.post({ type: 'set-model', model: this.currentModel });
  }

  setPatch(params: Record<string, number>): void {
    // Continuous params → worklet patch message
    this.currentPatch = {
      structure: params.structure ?? this.currentPatch.structure,
      brightness: params.brightness ?? this.currentPatch.brightness,
      damping: params.damping ?? this.currentPatch.damping,
      position: params.position ?? this.currentPatch.position,
    };
    this.post({ type: 'set-patch', patch: this.currentPatch });
    // Discrete params dispatched as commands
    if (params.polyphony !== undefined) {
      this.post({ type: 'set-polyphony', polyphony: Math.max(1, Math.min(4, Math.round(params.polyphony))) });
    }
    if (params['internal-exciter'] !== undefined) {
      this.post({ type: 'set-internal-exciter', enabled: params['internal-exciter'] >= 0.5 });
    }
    if (params['fine-tune'] !== undefined) {
      this.post({ type: 'set-fine-tune', offset: params['fine-tune'] });
    }
  }

  sendCommand(command: ModuleCommand): void {
    switch (command.type) {
      case 'strum':
        this.post({ type: 'strum', time: command.time });
        break;
      case 'damp':
        this.post({ type: 'damp' });
        break;
      case 'set-note':
        this.post({ type: 'set-note', tonic: command.tonic, note: command.note });
        break;
      case 'set-polyphony':
        this.post({ type: 'set-polyphony', polyphony: Math.max(1, Math.min(4, command.polyphony)) });
        break;
      case 'set-internal-exciter':
        this.post({ type: 'set-internal-exciter', enabled: command.enabled });
        break;
      case 'set-fine-tune':
        this.post({ type: 'set-fine-tune', offset: command.offset });
        break;
      default:
        warnUnsupportedCommand('rings', command);
    }
  }

  /** @deprecated Use sendCommand({ type: 'set-note', tonic, note }) instead. */
  setNote(tonic: number, note: number): void {
    this.sendCommand({ type: 'set-note', tonic, note });
  }

  /** @deprecated Use sendCommand({ type: 'set-fine-tune', offset }) instead. */
  setFineTune(offset: number): void {
    this.sendCommand({ type: 'set-fine-tune', offset });
  }

  /** @deprecated Use sendCommand({ type: 'set-polyphony', polyphony }) instead. */
  setPolyphony(polyphony: number): void {
    this.sendCommand({ type: 'set-polyphony', polyphony });
  }

  /** @deprecated Use sendCommand({ type: 'set-internal-exciter', enabled }) instead. */
  setInternalExciter(enabled: boolean): void {
    this.sendCommand({ type: 'set-internal-exciter', enabled });
  }

  /** @deprecated Use sendCommand({ type: 'strum', time }) instead. */
  strum(time: number): void {
    this.sendCommand({ type: 'strum', time });
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

  /** @deprecated Use sendCommand({ type: 'damp' }) instead. */
  damp(): void {
    this.sendCommand({ type: 'damp' });
  }

  destroy(): void {
    this.post({ type: 'destroy' });
    this.node.disconnect();
    this.node.port.close();
  }
}
