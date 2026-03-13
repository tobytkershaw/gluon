// Tides v2 AudioWorklet processor.
// Generates modulation waveforms — output goes to AudioParams on target worklets,
// not to speakers. The audio output IS the modulation signal (-1..+1).
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;
declare const globalThis: {
  createTidesModule?: (options?: { locateFile?: (path: string) => string; wasmBinary?: ArrayBuffer }) => Promise<TidesWasm>;
};

interface WorkletInitOptions {
  processorOptions?: {
    wasmBinary?: ArrayBuffer;
  };
}

interface TidesWasm {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _tides_create(): number;
  _tides_destroy(handle: number): void;
  _tides_set_mode(handle: number, mode: number): void;
  _tides_set_parameters(handle: number, frequency: number, shape: number, slope: number, smoothness: number): void;
  _tides_render(handle: number, outputPtr: number, frames: number): number;
  HEAPF32?: Float32Array;
  memory?: WebAssembly.Memory;
}

type ProcessorCommand =
  | { type: 'set-patch'; frequency: number; shape: number; slope: number; smoothness: number }
  | { type: 'set-mode'; mode: number }
  | { type: 'destroy' };

class TidesProcessor extends AudioWorkletProcessor {
  private wasm: TidesWasm | null = null;
  private handle = 0;
  private outputPtr = 0;
  private ready = false;
  private destroyed = false;
  private readonly wasmBinary: ArrayBuffer | null;

  // Current params (updated via messages)
  private frequency = 0.5;
  private shape = 0.5;
  private slope = 0.5;
  private smoothness = 0.5;
  private paramsChanged = true;

  constructor(options?: WorkletInitOptions) {
    super();
    this.wasmBinary = options?.processorOptions?.wasmBinary ?? null;
    this.port.onmessage = (event: MessageEvent<ProcessorCommand>) => {
      const data = event.data;
      switch (data.type) {
        case 'set-patch':
          this.frequency = data.frequency;
          this.shape = data.shape;
          this.slope = data.slope;
          this.smoothness = data.smoothness;
          this.paramsChanged = true;
          break;
        case 'set-mode':
          if (this.wasm && this.handle) {
            this.wasm._tides_set_mode(this.handle, data.mode);
          }
          break;
        case 'destroy':
          this.destroyWasm();
          break;
      }
    };
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const createTidesModule = globalThis.createTidesModule;
      if (typeof createTidesModule !== 'function') {
        throw new Error('createTidesModule not found in AudioWorklet scope');
      }
      if (!this.wasmBinary) {
        throw new Error('Missing wasmBinary for Tides processor');
      }
      const wasm = await createTidesModule({
        locateFile: (path: string) => `/audio/${path}`,
        wasmBinary: this.wasmBinary,
      });
      if (sampleRate !== 48000) {
        throw new Error(`Tides requires 48 kHz sample rate; got ${sampleRate}`);
      }
      this.wasm = wasm;
      this.handle = wasm._tides_create();
      this.outputPtr = wasm._malloc(128 * Float32Array.BYTES_PER_ELEMENT);
      // Default to looping mode
      wasm._tides_set_mode(this.handle, 1);
      this.ready = true;
      this.port.postMessage({ type: 'ready' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.port.postMessage({ type: 'error', message });
    }
  }

  private destroyWasm(): void {
    if (this.wasm && this.outputPtr) {
      this.wasm._free(this.outputPtr);
      this.outputPtr = 0;
    }
    if (this.wasm && this.handle) {
      this.wasm._tides_destroy(this.handle);
      this.handle = 0;
    }
    this.ready = false;
    this.destroyed = true;
  }

  private getHeapF32(): Float32Array | null {
    if (!this.wasm) return null;
    if (this.wasm.HEAPF32) return this.wasm.HEAPF32;
    if (this.wasm.memory) return new Float32Array(this.wasm.memory.buffer);
    return null;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0];
    if (!output?.length) return true;
    const left = output[0];

    if (this.destroyed) return false;
    if (!this.ready || !this.wasm || !this.handle) {
      left.fill(0);
      return true;
    }

    // Apply params if changed
    if (this.paramsChanged) {
      this.wasm._tides_set_parameters(this.handle, this.frequency, this.shape, this.slope, this.smoothness);
      this.paramsChanged = false;
    }

    const frames = left.length;
    const rendered = this.wasm._tides_render(this.handle, this.outputPtr, frames);

    const heap = this.getHeapF32();
    if (!heap) {
      left.fill(0);
      return true;
    }

    const outStart = this.outputPtr / Float32Array.BYTES_PER_ELEMENT;
    left.set(heap.subarray(outStart, outStart + rendered));

    // Fill remaining frames with last value if partial render
    if (rendered < frames) {
      const lastVal = rendered > 0 ? left[rendered - 1] : 0;
      left.fill(lastVal, rendered);
    }

    // Copy to right channel if present (mono modulation signal)
    if (output[1]) {
      output[1].set(left);
    }

    return true;
  }
}

registerProcessor('tides-processor', TidesProcessor);
