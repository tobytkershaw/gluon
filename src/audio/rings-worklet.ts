declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const currentTime: number;
declare const sampleRate: number;
declare const globalThis: {
  createRingsModule?: (options?: { locateFile?: (path: string) => string; wasmBinary?: ArrayBuffer }) => Promise<RingsWasm>;
};

interface WorkletInitOptions {
  processorOptions?: {
    wasmBinary?: ArrayBuffer;
  };
}

interface RingsPatch {
  structure: number;
  brightness: number;
  damping: number;
  position: number;
}

interface RingsWasm {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _rings_create(): number;
  _rings_destroy(handle: number): void;
  _rings_set_model(handle: number, modelIndex: number): void;
  _rings_set_polyphony(handle: number, polyphony: number): void;
  _rings_set_patch(handle: number, structure: number, brightness: number, damping: number, position: number): void;
  _rings_set_note(handle: number, tonic: number, note: number): void;
  _rings_set_fine_tune(handle: number, offset: number): void;
  _rings_set_internal_exciter(handle: number, enabled: number): void;
  _rings_strum(handle: number): void;
  _rings_render(handle: number, inputPtr: number, outputPtr: number, frames: number): number;
  HEAPF32?: Float32Array;
  memory?: WebAssembly.Memory;
}

type ScheduledEvent =
  | { type: 'set-model'; time?: number; seq: number; fence?: number; model: number }
  | { type: 'set-patch'; time?: number; seq: number; fence?: number; patch: RingsPatch }
  | { type: 'set-note'; time?: number; seq: number; fence?: number; tonic: number; note: number }
  | { type: 'set-fine-tune'; time?: number; seq: number; fence?: number; offset: number }
  | { type: 'set-polyphony'; time?: number; seq: number; fence?: number; polyphony: number }
  | { type: 'set-internal-exciter'; time?: number; seq: number; fence?: number; enabled: boolean }
  | { type: 'strum'; time: number; seq: number; fence?: number }
  | { type: 'damp'; time?: undefined; seq: number; fence?: number }
  | { type: 'clear-scheduled'; time?: undefined; seq: number; fence: number }
  | { type: 'destroy'; time?: undefined; seq: number; fence?: number };

class RingsProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): Array<{ name: string; defaultValue: number; minValue: number; maxValue: number; automationRate: string }> {
    return [
      { name: 'mod-structure', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-brightness', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-damping', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-position', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'min-fence', defaultValue: 0, minValue: 0, maxValue: 1e9, automationRate: 'k-rate' },
    ];
  }

  private wasm: RingsWasm | null = null;
  private handle = 0;
  private inputPtr = 0;
  private outputPtr = 0;
  private currentPatch: RingsPatch = { structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 };
  private queue: ScheduledEvent[] = [];
  private seq = 0;
  private ready = false;
  private readonly wasmBinary: ArrayBuffer | null;
  private destroyed = false;
  private muted = false;
  /** Sequence fence: events with fence < minFence are stale and ignored. */
  private minFence = 0;

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
      const createRingsModule = globalThis.createRingsModule;
      if (typeof createRingsModule !== 'function') {
        throw new Error('createRingsModule not found in AudioWorklet scope');
      }
      if (!this.wasmBinary) {
        throw new Error('Missing wasmBinary for Rings processor');
      }
      const wasm = await createRingsModule({
        locateFile: (path: string) => `/audio/${path}`,
        wasmBinary: this.wasmBinary,
      });
      // Rings DSP is hardcoded to 48 kHz — reject other rates
      if (sampleRate !== 48000) {
        throw new Error(`Rings requires 48 kHz sample rate; got ${sampleRate}`);
      }
      this.wasm = wasm;
      this.handle = wasm._rings_create();
      // Allocate I/O buffers (128 frames each)
      this.inputPtr = wasm._malloc(128 * Float32Array.BYTES_PER_ELEMENT);
      this.outputPtr = wasm._malloc(128 * Float32Array.BYTES_PER_ELEMENT);
      wasm._rings_set_patch(
        this.handle,
        this.currentPatch.structure,
        this.currentPatch.brightness,
        this.currentPatch.damping,
        this.currentPatch.position,
      );
      this.ready = true;
      this.port.postMessage({ type: 'ready' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.port.postMessage({ type: 'error', message });
    }
  }

  private destroyWasm(): void {
    if (this.wasm && this.inputPtr) {
      this.wasm._free(this.inputPtr);
      this.inputPtr = 0;
    }
    if (this.wasm && this.outputPtr) {
      this.wasm._free(this.outputPtr);
      this.outputPtr = 0;
    }
    if (this.wasm && this.handle) {
      this.wasm._rings_destroy(this.handle);
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
        this.wasm._rings_set_model(this.handle, event.model);
        break;
      case 'set-patch':
        this.currentPatch = event.patch;
        break;
      case 'set-note':
        this.wasm._rings_set_note(this.handle, event.tonic, event.note);
        break;
      case 'set-fine-tune':
        this.wasm._rings_set_fine_tune(this.handle, event.offset);
        break;
      case 'set-polyphony':
        this.wasm._rings_set_polyphony(this.handle, event.polyphony);
        break;
      case 'set-internal-exciter':
        this.wasm._rings_set_internal_exciter(this.handle, event.enabled ? 1 : 0);
        break;
      case 'strum':
        this.muted = false;
        this.wasm._rings_strum(this.handle);
        break;
      case 'damp':
        this.muted = true;
        break;
      case 'clear-scheduled':
        // Set fence so events from previous play cycles are treated as stale.
        // Only remove timed events whose fence is older than the clear fence;
        // events posted after the clear (with fence >= clear fence) survive.
        this.minFence = event.fence;
        this.queue = this.queue.filter(e =>
          e.time === undefined || (e.fence !== undefined && e.fence >= this.minFence),
        );
        break;
      case 'destroy':
        this.destroyWasm();
        break;
    }
  }

  private applyPatchWithModulation(modStructure: number, modBrightness: number, modDamping: number, modPosition: number): void {
    if (!this.wasm || !this.handle) return;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    this.wasm._rings_set_patch(
      this.handle,
      clamp01(this.currentPatch.structure + modStructure),
      clamp01(this.currentPatch.brightness + modBrightness),
      clamp01(this.currentPatch.damping + modDamping),
      clamp01(this.currentPatch.position + modPosition),
    );
  }

  private getHeapF32(): Float32Array | null {
    if (!this.wasm) return null;
    if (this.wasm.HEAPF32) return this.wasm.HEAPF32;
    if (this.wasm.memory) return new Float32Array(this.wasm.memory.buffer);
    return null;
  }

  private renderSegment(startFrame: number, frames: number, input: Float32Array, left: Float32Array, right: Float32Array): void {
    if (!this.wasm || !this.handle || frames <= 0) return;

    // Re-read HEAPF32 before each use — with ALLOW_MEMORY_GROWTH, the
    // underlying ArrayBuffer can be detached when WASM memory grows.
    let heap = this.getHeapF32();
    if (!heap) return;

    // Copy input audio to WASM heap
    const inStart = this.inputPtr / Float32Array.BYTES_PER_ELEMENT;
    heap.set(input.subarray(startFrame, startFrame + frames), inStart);

    const rendered = this.wasm._rings_render(this.handle, this.inputPtr, this.outputPtr, frames);

    // Re-read heap after render — memory may have grown during the call
    heap = this.getHeapF32();
    if (!heap) return;

    const outStart = this.outputPtr / Float32Array.BYTES_PER_ELEMENT;
    const mono = heap.subarray(outStart, outStart + rendered);
    left.set(mono, startFrame);
    right.set(mono, startFrame);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
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

    // Get mono input (from source node connected to this processor)
    const input = inputs[0]?.[0] ?? new Float32Array(left.length);

    // Read k-rate modulation params (single value per block)
    const modStructure = parameters['mod-structure'][0];
    const modBrightness = parameters['mod-brightness'][0];
    const modDamping = parameters['mod-damping'][0];
    const modPosition = parameters['mod-position'][0];

    // Synchronous fence via AudioParam — read before draining the queue so
    // stale events are filtered in the same process() block as the fence update.
    const newMinFence = Math.floor(parameters['min-fence'][0]);
    if (newMinFence > this.minFence) {
      this.minFence = newMinFence;
    }

    const blockStart = currentTime;
    const frameCount = left.length;
    const blockDuration = frameCount / sampleRate;
    const blockEnd = blockStart + blockDuration;

    // Process immediate (untimed) events first
    while (this.queue.length > 0 && this.queue[0].time === undefined) {
      this.applyEvent(this.queue.shift()!);
    }

    // Drop stale events that belong to a previous play cycle (fence < minFence)
    this.queue = this.queue.filter(e =>
      e.time === undefined || e.fence === undefined || e.fence >= this.minFence,
    );

    // Drain stale events that were scheduled before this block
    while (this.queue.length > 0 && this.queue[0].time !== undefined && this.queue[0].time! < blockStart) {
      this.applyEvent(this.queue.shift()!);
    }

    // Apply effective patch (base + modulation) after processing immediate events
    this.applyPatchWithModulation(modStructure, modBrightness, modDamping, modPosition);

    // Sub-block event scheduling: render in segments, applying timed events at their offsets
    let cursor = 0;
    while (cursor < frameCount) {
      const nextEvent = this.queue.find((event) => event.time !== undefined && event.time! >= blockStart && event.time! < blockEnd);
      if (!nextEvent) {
        this.renderSegment(cursor, frameCount - cursor, input, left, right);
        break;
      }

      const eventFrame = Math.max(cursor, Math.min(frameCount, Math.round((nextEvent.time! - blockStart) * sampleRate)));
      this.renderSegment(cursor, eventFrame - cursor, input, left, right);
      cursor = eventFrame;

      const readyEvents = this.queue
        .filter((event) => event.time !== undefined && Math.round((event.time! - blockStart) * sampleRate) <= cursor)
        .sort((a, b) => (a.time! - b.time!) || (a.seq - b.seq));
      this.queue = this.queue.filter((event) => !readyEvents.includes(event));
      for (const event of readyEvents) {
        this.applyEvent(event);
        // Re-apply modulation after any event that changes the patch
        if (event.type === 'set-patch') {
          this.applyPatchWithModulation(modStructure, modBrightness, modDamping, modPosition);
        }
      }
    }

    // When damped, let DSP decay internally but silence the output
    if (this.muted) {
      left.fill(0);
      right.fill(0);
    }

    return true;
  }
}

registerProcessor('rings-processor', RingsProcessor);
