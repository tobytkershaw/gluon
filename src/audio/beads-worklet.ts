declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const currentTime: number;
declare const sampleRate: number;
declare const globalThis: {
  createBeadsModule?: (options?: { locateFile?: (path: string) => string; wasmBinary?: ArrayBuffer }) => Promise<BeadsWasm>;
};

interface WorkletInitOptions {
  processorOptions?: {
    wasmBinary?: ArrayBuffer;
  };
}

interface BeadsPatch {
  time: number;
  density: number;
  texture: number;
  position: number;
  pitch: number;
  dry_wet: number;
}

interface BeadsWasm {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _beads_create(sampleRate: number): number;
  _beads_destroy(handle: number): void;
  _beads_set_model(handle: number, modelIndex: number): void;
  _beads_set_patch(handle: number, time: number, density: number, texture: number, position: number, pitch: number, dry_wet: number): void;
  _beads_process(handle: number, inputPtr: number, outLeftPtr: number, outRightPtr: number, frames: number): number;
  HEAPF32?: Float32Array;
  memory?: WebAssembly.Memory;
}

type ScheduledEvent =
  | { type: 'set-model'; time?: number; seq: number; fence?: number; model: number }
  | { type: 'set-patch'; time?: number; seq: number; fence?: number; patch: BeadsPatch }
  | { type: 'clear-scheduled'; time?: undefined; seq: number; fence: number }
  | { type: 'destroy'; time?: undefined; seq: number; fence?: number };

class BeadsProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): Array<{ name: string; defaultValue: number; minValue: number; maxValue: number; automationRate: string }> {
    return [
      { name: 'mod-time', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-density', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-texture', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-position', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'min-fence', defaultValue: 0, minValue: 0, maxValue: 1e9, automationRate: 'k-rate' },
    ];
  }

  private wasm: BeadsWasm | null = null;
  private handle = 0;
  private inputPtr = 0;
  private outLeftPtr = 0;
  private outRightPtr = 0;
  private currentPatch: BeadsPatch = { time: 0.5, density: 0.5, texture: 0.5, position: 0.5, pitch: 0.5, dry_wet: 0.5 };
  private queue: ScheduledEvent[] = [];
  private seq = 0;
  private ready = false;
  private readonly wasmBinary: ArrayBuffer | null;
  private destroyed = false;
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
      const createBeadsModule = globalThis.createBeadsModule;
      if (typeof createBeadsModule !== 'function') {
        throw new Error('createBeadsModule not found in AudioWorklet scope');
      }
      if (!this.wasmBinary) {
        throw new Error('Missing wasmBinary for Beads processor');
      }
      const wasm = await createBeadsModule({
        locateFile: (path: string) => `/audio/${path}`,
        wasmBinary: this.wasmBinary,
      });
      this.wasm = wasm;
      this.handle = wasm._beads_create(sampleRate);
      // Allocate I/O buffers (128 frames each — Web Audio render quantum)
      this.inputPtr = wasm._malloc(128 * Float32Array.BYTES_PER_ELEMENT);
      this.outLeftPtr = wasm._malloc(128 * Float32Array.BYTES_PER_ELEMENT);
      this.outRightPtr = wasm._malloc(128 * Float32Array.BYTES_PER_ELEMENT);
      wasm._beads_set_patch(
        this.handle,
        this.currentPatch.time,
        this.currentPatch.density,
        this.currentPatch.texture,
        this.currentPatch.position,
        this.currentPatch.pitch,
        this.currentPatch.dry_wet,
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
    if (this.wasm && this.outLeftPtr) {
      this.wasm._free(this.outLeftPtr);
      this.outLeftPtr = 0;
    }
    if (this.wasm && this.outRightPtr) {
      this.wasm._free(this.outRightPtr);
      this.outRightPtr = 0;
    }
    if (this.wasm && this.handle) {
      this.wasm._beads_destroy(this.handle);
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
        this.wasm._beads_set_model(this.handle, event.model);
        break;
      case 'set-patch':
        this.currentPatch = event.patch;
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

  private applyPatchWithModulation(modTime: number, modDensity: number, modTexture: number, modPosition: number): void {
    if (!this.wasm || !this.handle) return;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    this.wasm._beads_set_patch(
      this.handle,
      clamp01(this.currentPatch.time + modTime),
      clamp01(this.currentPatch.density + modDensity),
      clamp01(this.currentPatch.texture + modTexture),
      clamp01(this.currentPatch.position + modPosition),
      this.currentPatch.pitch,
      this.currentPatch.dry_wet,
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

    const inStart = this.inputPtr / Float32Array.BYTES_PER_ELEMENT;
    heap.set(input.subarray(startFrame, startFrame + frames), inStart);

    const rendered = this.wasm._beads_process(this.handle, this.inputPtr, this.outLeftPtr, this.outRightPtr, frames);

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

    const input = inputs[0]?.[0] ?? new Float32Array(left.length);

    // Read k-rate modulation params (single value per block)
    const modTime = parameters['mod-time'][0];
    const modDensity = parameters['mod-density'][0];
    const modTexture = parameters['mod-texture'][0];
    const modPosition = parameters['mod-position'][0];

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

    // Drop stale events that belong to a previous play cycle (fence < minFence)
    this.queue = this.queue.filter(e =>
      e.time === undefined || e.fence === undefined || e.fence >= this.minFence,
    );

    // Drain stale events that were scheduled before this block
    while (this.queue.length > 0 && this.queue[0].time !== undefined && this.queue[0].time! < blockStart) {
      this.applyEvent(this.queue.shift()!);
    }

    // Apply effective patch (base + modulation) after processing immediate events
    this.applyPatchWithModulation(modTime, modDensity, modTexture, modPosition);

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
        // Re-apply modulation after any event that changes the patch
        if (event.type === 'set-patch') {
          this.applyPatchWithModulation(modTime, modDensity, modTexture, modPosition);
        }
      }
    }

    return true;
  }
}

registerProcessor('beads-processor', BeadsProcessor);
