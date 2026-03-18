declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const currentTime: number;
declare const sampleRate: number;
declare const globalThis: {
  createElementsModule?: (options?: { locateFile?: (path: string) => string; wasmBinary?: ArrayBuffer }) => Promise<ElementsWasm>;
};

interface WorkletInitOptions {
  processorOptions?: {
    wasmBinary?: ArrayBuffer;
  };
}

interface ElementsPatch {
  bow_level: number;
  bow_timbre: number;
  blow_level: number;
  blow_timbre: number;
  strike_level: number;
  strike_timbre: number;
  coarse: number;
  fine: number;
  geometry: number;
  brightness: number;
  damping: number;
  position: number;
  space: number;
}

interface ElementsWasm {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _elements_create(sampleRate: number): number;
  _elements_destroy(handle: number): void;
  _elements_set_model(handle: number, model: number): void;
  _elements_set_patch(
    handle: number,
    bow_level: number, bow_timbre: number,
    blow_level: number, blow_timbre: number,
    strike_level: number, strike_timbre: number,
    coarse: number, fine: number,
    geometry: number, brightness: number,
    damping: number, position: number,
    space: number,
  ): void;
  _elements_set_note(handle: number, note: number): void;
  _elements_gate(handle: number, gate: number): void;
  _elements_render(handle: number, inputPtr: number, outLeftPtr: number, outRightPtr: number, frames: number): number;
  HEAPF32?: Float32Array;
  memory?: WebAssembly.Memory;
}

type ScheduledEvent =
  | { type: 'set-model'; time?: number; seq: number; fence?: number; model: number }
  | { type: 'set-patch'; time?: number; seq: number; fence?: number; patch: ElementsPatch }
  | { type: 'set-note'; time?: number; seq: number; fence?: number; note: number }
  | { type: 'gate'; time?: number; seq: number; fence?: number; gate: boolean }
  | { type: 'damp'; time?: undefined; seq: number; fence?: number }
  | { type: 'clear-scheduled'; time?: undefined; seq: number; fence: number }
  | { type: 'destroy'; time?: undefined; seq: number; fence?: number };

class ElementsProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): Array<{ name: string; defaultValue: number; minValue: number; maxValue: number; automationRate: string }> {
    return [
      { name: 'mod-bow_level', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-blow_level', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-strike_level', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-geometry', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-brightness', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-damping', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-position', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-space', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'min-fence', defaultValue: 0, minValue: 0, maxValue: 1e9, automationRate: 'k-rate' },
    ];
  }

  private wasm: ElementsWasm | null = null;
  private handle = 0;
  private inputPtr = 0;
  private outLeftPtr = 0;
  private outRightPtr = 0;
  private currentPatch: ElementsPatch = {
    bow_level: 0, bow_timbre: 0.5,
    blow_level: 0, blow_timbre: 0.5,
    strike_level: 0.8, strike_timbre: 0.5,
    coarse: 0.5, fine: 0.5,
    geometry: 0.5, brightness: 0.5,
    damping: 0.5, position: 0.5,
    space: 0.3,
  };
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
      const createElementsModule = globalThis.createElementsModule;
      if (typeof createElementsModule !== 'function') {
        throw new Error('createElementsModule not found in AudioWorklet scope');
      }
      if (!this.wasmBinary) {
        throw new Error('Missing wasmBinary for Elements processor');
      }
      const wasm = await createElementsModule({
        locateFile: (path: string) => `/audio/${path}`,
        wasmBinary: this.wasmBinary,
      });
      this.wasm = wasm;
      this.handle = wasm._elements_create(sampleRate);
      // Allocate I/O buffers (128 frames each, stereo output)
      this.inputPtr = wasm._malloc(128 * Float32Array.BYTES_PER_ELEMENT);
      this.outLeftPtr = wasm._malloc(128 * Float32Array.BYTES_PER_ELEMENT);
      this.outRightPtr = wasm._malloc(128 * Float32Array.BYTES_PER_ELEMENT);
      this.applyPatch(this.currentPatch);
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
    if (this.wasm && this.outLeftPtr) {
      this.wasm._free(this.outLeftPtr);
      this.outLeftPtr = 0;
    }
    if (this.wasm && this.outRightPtr) {
      this.wasm._free(this.outRightPtr);
      this.outRightPtr = 0;
    }
    if (this.wasm && this.handle) {
      this.wasm._elements_destroy(this.handle);
      this.handle = 0;
    }
    this.queue = [];
    this.ready = false;
    this.destroyed = true;
  }

  private applyPatch(patch: ElementsPatch): void {
    if (!this.wasm || !this.handle) return;
    this.wasm._elements_set_patch(
      this.handle,
      patch.bow_level, patch.bow_timbre,
      patch.blow_level, patch.blow_timbre,
      patch.strike_level, patch.strike_timbre,
      patch.coarse, patch.fine,
      patch.geometry, patch.brightness,
      patch.damping, patch.position,
      patch.space,
    );
  }

  private applyEvent(event: ScheduledEvent): void {
    if (!this.wasm || !this.handle) return;
    switch (event.type) {
      case 'set-model':
        this.wasm._elements_set_model(this.handle, event.model);
        break;
      case 'set-patch':
        this.currentPatch = event.patch;
        break;
      case 'set-note':
        this.wasm._elements_set_note(this.handle, event.note);
        break;
      case 'gate':
        this.muted = false;
        this.wasm._elements_gate(this.handle, event.gate ? 1 : 0);
        break;
      case 'damp':
        this.muted = true;
        break;
      case 'clear-scheduled':
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

  private applyPatchWithModulation(mods: Record<string, number>): void {
    if (!this.wasm || !this.handle) return;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    this.wasm._elements_set_patch(
      this.handle,
      clamp01(this.currentPatch.bow_level + (mods['mod-bow_level'] || 0)),
      this.currentPatch.bow_timbre,
      clamp01(this.currentPatch.blow_level + (mods['mod-blow_level'] || 0)),
      this.currentPatch.blow_timbre,
      clamp01(this.currentPatch.strike_level + (mods['mod-strike_level'] || 0)),
      this.currentPatch.strike_timbre,
      this.currentPatch.coarse,
      this.currentPatch.fine,
      clamp01(this.currentPatch.geometry + (mods['mod-geometry'] || 0)),
      clamp01(this.currentPatch.brightness + (mods['mod-brightness'] || 0)),
      clamp01(this.currentPatch.damping + (mods['mod-damping'] || 0)),
      clamp01(this.currentPatch.position + (mods['mod-position'] || 0)),
      clamp01(this.currentPatch.space + (mods['mod-space'] || 0)),
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

    let heap = this.getHeapF32();
    if (!heap) return;

    // Copy input audio to WASM heap
    const inStart = this.inputPtr / Float32Array.BYTES_PER_ELEMENT;
    heap.set(input.subarray(startFrame, startFrame + frames), inStart);

    const rendered = this.wasm._elements_render(this.handle, this.inputPtr, this.outLeftPtr, this.outRightPtr, frames);

    // Re-read heap after render — memory may have grown during the call
    heap = this.getHeapF32();
    if (!heap) return;

    const leftStart = this.outLeftPtr / Float32Array.BYTES_PER_ELEMENT;
    const rightStart = this.outRightPtr / Float32Array.BYTES_PER_ELEMENT;
    left.set(heap.subarray(leftStart, leftStart + rendered), startFrame);
    right.set(heap.subarray(rightStart, rightStart + rendered), startFrame);
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

    // Read k-rate modulation params
    const mods: Record<string, number> = {};
    for (const key of Object.keys(parameters)) {
      if (key.startsWith('mod-')) {
        mods[key] = parameters[key][0];
      }
    }

    // Synchronous fence via AudioParam
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

    // Drop stale events that belong to a previous play cycle
    this.queue = this.queue.filter(e =>
      e.time === undefined || e.fence === undefined || e.fence >= this.minFence,
    );

    // Drain stale events that were scheduled before this block
    while (this.queue.length > 0 && this.queue[0].time !== undefined && this.queue[0].time! < blockStart) {
      this.applyEvent(this.queue.shift()!);
    }

    // Apply effective patch (base + modulation) after processing immediate events
    this.applyPatchWithModulation(mods);

    // Sub-block event scheduling
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
        if (event.type === 'set-patch') {
          this.applyPatchWithModulation(mods);
        }
      }
    }

    // When damped, silence the output
    if (this.muted) {
      left.fill(0);
      right.fill(0);
    }

    return true;
  }
}

registerProcessor('elements-processor', ElementsProcessor);
