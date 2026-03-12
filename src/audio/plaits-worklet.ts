declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const currentTime: number;
declare const sampleRate: number;
declare const globalThis: {
  createPlaitsModule?: (options?: { locateFile?: (path: string) => string; wasmBinary?: ArrayBuffer }) => Promise<PlaitsWasm>;
};

interface WorkletInitOptions {
  processorOptions?: {
    wasmBinary?: ArrayBuffer;
  };
}

interface SynthPatch {
  harmonics: number;
  timbre: number;
  morph: number;
  note: number;
}

interface PlaitsWasm {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _plaits_create(sampleRate: number): number;
  _plaits_destroy(handle: number): void;
  _plaits_set_model(handle: number, modelIndex: number): void;
  _plaits_set_patch(handle: number, harmonics: number, timbre: number, morph: number, note: number): void;
  _plaits_trigger(handle: number, accentLevel: number): void;
  _plaits_set_gate(handle: number, open: number): void;
  _plaits_render(handle: number, outputPtr: number, frames: number): number;
  HEAPF32?: Float32Array;
  memory?: WebAssembly.Memory;
}

type ScheduledEvent =
  | { type: 'set-model'; time?: number; seq: number; model: number }
  | { type: 'set-patch'; time?: number; seq: number; patch: SynthPatch }
  | { type: 'trigger'; time: number; seq: number; accentLevel: number }
  | { type: 'set-gate'; time: number; seq: number; open: boolean }
  | { type: 'destroy'; time?: undefined; seq: number };

class PlaitsProcessor extends AudioWorkletProcessor {
  private wasm: PlaitsWasm | null = null;
  private handle = 0;
  private outputPtr = 0;
  private currentPatch: SynthPatch = { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 };
  private queue: ScheduledEvent[] = [];
  private seq = 0;
  private ready = false;
  private readonly wasmBinary: ArrayBuffer | null;
  private destroyed = false;

  constructor(options?: WorkletInitOptions) {
    super();
    this.wasmBinary = options?.processorOptions?.wasmBinary ?? null;
    this.port.onmessage = (event: MessageEvent<Omit<ScheduledEvent, 'seq'>>) => {
      const data = event.data;
      this.queue.push({ ...data, seq: this.seq++ } as ScheduledEvent);
      this.queue.sort((a, b) => {
        const at = a.time ?? -1;
        const bt = b.time ?? -1;
        if (at === bt) return a.seq - b.seq;
        return at - bt;
      });
    };
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const createPlaitsModule = globalThis.createPlaitsModule;
      if (typeof createPlaitsModule !== 'function') {
        throw new Error('createPlaitsModule not found in AudioWorklet scope');
      }
      if (!this.wasmBinary) {
        throw new Error('Missing wasmBinary for Plaits processor');
      }
      const wasm = await createPlaitsModule({
        locateFile: (path: string) => `/audio/${path}`,
        wasmBinary: this.wasmBinary,
      });
      this.wasm = wasm;
      this.handle = wasm._plaits_create(sampleRate);
      this.outputPtr = wasm._malloc(128 * Float32Array.BYTES_PER_ELEMENT);
      wasm._plaits_set_patch(
        this.handle,
        this.currentPatch.harmonics,
        this.currentPatch.timbre,
        this.currentPatch.morph,
        this.currentPatch.note,
      );
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
      this.wasm._plaits_destroy(this.handle);
      this.handle = 0;
    }
    this.queue = [];
    this.ready = false;
    this.destroyed = true;
  }

  private applyEvent(event: ScheduledEvent): void {
    if (!this.wasm || !this.handle) return;
    switch (event.type) {
      case 'set-model':
        this.wasm._plaits_set_model(this.handle, event.model);
        break;
      case 'set-patch':
        this.currentPatch = event.patch;
        this.wasm._plaits_set_patch(
          this.handle,
          event.patch.harmonics,
          event.patch.timbre,
          event.patch.morph,
          event.patch.note,
        );
        break;
      case 'trigger':
        this.wasm._plaits_trigger(this.handle, event.accentLevel);
        break;
      case 'set-gate':
        this.wasm._plaits_set_gate(this.handle, event.open ? 1 : 0);
        break;
      case 'destroy':
        this.destroyWasm();
        break;
    }
  }

  private getHeapF32(): Float32Array | null {
    if (!this.wasm) return null;
    if (this.wasm.HEAPF32) return this.wasm.HEAPF32;
    if (this.wasm.memory) return new Float32Array(this.wasm.memory.buffer);
    return null;
  }

  private renderSegment(startFrame: number, frames: number, left: Float32Array, right: Float32Array): void {
    if (!this.wasm || !this.handle || frames <= 0) return;
    const rendered = this.wasm._plaits_render(this.handle, this.outputPtr, frames);
    const heap = this.getHeapF32();
    if (!heap) return;
    const start = this.outputPtr / Float32Array.BYTES_PER_ELEMENT;
    const mono = heap.subarray(start, start + rendered);
    left.set(mono, startFrame);
    right.set(mono, startFrame);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output?.length) return true;
    const left = output[0];
    const right = output[1] ?? output[0];
    left.fill(0);
    right.fill(0);

    if (this.destroyed) {
      return false;
    }

    if (!this.ready || !this.wasm || !this.handle) {
      return true;
    }

    const blockStart = currentTime;
    const frameCount = left.length;
    const blockDuration = frameCount / sampleRate;
    const blockEnd = blockStart + blockDuration;

    while (this.queue.length > 0 && this.queue[0].time === undefined) {
      this.applyEvent(this.queue.shift()!);
    }

    let cursor = 0;
    while (cursor < frameCount) {
      const nextEvent = this.queue.find((event) => event.time !== undefined && event.time! >= blockStart && event.time! < blockEnd);
      if (!nextEvent) {
        this.renderSegment(cursor, frameCount - cursor, left, right);
        break;
      }

      const eventFrame = Math.max(cursor, Math.min(frameCount, Math.round((nextEvent.time! - blockStart) * sampleRate)));
      this.renderSegment(cursor, eventFrame - cursor, left, right);
      cursor = eventFrame;

      const readyEvents = this.queue
        .filter((event) => event.time !== undefined && Math.round((event.time! - blockStart) * sampleRate) <= cursor)
        .sort((a, b) => (a.time! - b.time!) || (a.seq - b.seq));
      this.queue = this.queue.filter((event) => !readyEvents.includes(event));
      for (const event of readyEvents) {
        this.applyEvent(event);
      }
    }

    return true;
  }
}

registerProcessor('plaits-processor', PlaitsProcessor);
