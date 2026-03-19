import type { ElementsProcessorCommand, ElementsProcessorStatus, ElementsPatchParams } from './elements-messages';
import type { ProcessorContract, ModuleCommand } from './module-contract';
import { warnUnsupportedCommand } from './module-contract';

const WORKLET_URL = '/audio/elements-worklet.js';
const MODULE_URL = '/audio/elements-module.js';
const WASM_URL = '/audio/elements.wasm';
const INIT_TIMEOUT_MS = 5000;

/** @deprecated Use ProcessorContract instead. */
export type ElementsEngine = ProcessorContract;

export class ElementsSynth implements ProcessorContract {
  private static moduleLoads = new WeakMap<AudioContext, Promise<void>>();
  private static wasmBinaryLoad: Promise<ArrayBuffer> | null = null;

  static async create(ctx: AudioContext): Promise<ElementsSynth> {
    await this.ensureWorkletModule(ctx);
    const wasmBinary = await this.loadWasmBinary();
    const synth = new ElementsSynth(ctx, wasmBinary);
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
            throw new Error(`Failed to fetch Elements WASM: ${response.status}`);
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
  private currentPatch: ElementsPatchParams = {
    bow_level: 0, bow_timbre: 0.5,
    blow_level: 0, blow_timbre: 0.5,
    strike_level: 0.8, strike_timbre: 0.5,
    coarse: 0.5, fine: 0.5,
    geometry: 0.5, brightness: 0.5,
    damping: 0.5, position: 0.5,
    space: 0.3,
  };
  private currentModel = 0;

  private constructor(ctx: AudioContext, wasmBinary: ArrayBuffer) {
    this.node = new AudioWorkletNode(ctx, 'elements-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasmBinary },
    });

    // Do NOT connect output here — AudioEngine.rebuildChain() manages all connections
    this.ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Timed out waiting for Elements processor'));
      }, INIT_TIMEOUT_MS);

      this.node.port.onmessage = (event: MessageEvent<ElementsProcessorStatus>) => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          const error = new Error(message.message);
          console.error('Elements processor failed to initialize.', error);
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

  private post(message: ElementsProcessorCommand): void {
    this.node.port.postMessage(message);
  }

  get inputNode(): AudioNode {
    return this.node;
  }

  get outputNode(): AudioNode {
    return this.node;
  }

  setModel(model: number): void {
    this.currentModel = Math.max(0, Math.min(1, model));
    this.post({ type: 'set-model', model: this.currentModel });
  }

  setPatch(params: Record<string, number>): void {
    this.currentPatch = {
      bow_level: params['bow_level'] ?? this.currentPatch.bow_level,
      bow_timbre: params['bow_timbre'] ?? this.currentPatch.bow_timbre,
      blow_level: params['blow_level'] ?? this.currentPatch.blow_level,
      blow_timbre: params['blow_timbre'] ?? this.currentPatch.blow_timbre,
      strike_level: params['strike_level'] ?? this.currentPatch.strike_level,
      strike_timbre: params['strike_timbre'] ?? this.currentPatch.strike_timbre,
      coarse: params.coarse ?? this.currentPatch.coarse,
      fine: params.fine ?? this.currentPatch.fine,
      geometry: params.geometry ?? this.currentPatch.geometry,
      brightness: params.brightness ?? this.currentPatch.brightness,
      damping: params.damping ?? this.currentPatch.damping,
      position: params.position ?? this.currentPatch.position,
      space: params.space ?? this.currentPatch.space,
    };
    this.post({ type: 'set-patch', patch: this.currentPatch });
  }

  sendCommand(command: ModuleCommand): void {
    switch (command.type) {
      case 'gate':
        this.post({ type: 'gate', gate: command.open, time: command.time });
        break;
      case 'damp':
        this.post({ type: 'damp' });
        break;
      case 'set-note':
        // Elements uses single note (not tonic+note like Rings)
        this.post({ type: 'set-note', note: command.note });
        break;
      default:
        warnUnsupportedCommand('elements', command);
    }
  }

  /** @deprecated Use sendCommand({ type: 'set-note', tonic: 0, note }) instead. */
  setNote(note: number): void {
    this.post({ type: 'set-note', note });
  }

  /** @deprecated Use sendCommand({ type: 'gate', open, time }) instead. */
  gate(gate: boolean, time?: number): void {
    this.sendCommand({ type: 'gate', open: gate, time });
  }

  silence(fence?: number): void {
    const f = fence ?? 0;
    const minFenceParam = this.node.parameters.get('min-fence');
    if (minFenceParam) {
      minFenceParam.setValueAtTime(f, 0);
    }
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
