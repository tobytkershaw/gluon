declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const currentTime: number;
declare const sampleRate: number;
declare const globalThis: {
  createCloudsModule?: (options?: { locateFile?: (path: string) => string; wasmBinary?: ArrayBuffer }) => Promise<CloudsWasm>;
};

interface WorkletInitOptions {
  processorOptions?: {
    wasmBinary?: ArrayBuffer;
  };
}

interface CloudsPatch {
  position: number;
  size: number;
  density: number;
  feedback: number;
}

interface CloudsExtendedParams {
  texture: number;
  pitch: number;
  dry_wet: number;
  stereo_spread: number;
  reverb: number;
}

interface CloudsWasm {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _clouds_create(): number;
  _clouds_destroy(handle: number): void;
  _clouds_set_mode(handle: number, modeIndex: number): void;
  _clouds_set_parameters(handle: number, position: number, size: number, density: number, feedback: number): void;
  _clouds_set_extended(handle: number, texture: number, pitch: number, dry_wet: number, stereo_spread: number, reverb: number): void;
  _clouds_set_freeze(handle: number, freeze: number): void;
  _clouds_render(handle: number, inputPtr: number, outputPtr: number, frames: number): number;
  HEAPF32?: Float32Array;
  memory?: WebAssembly.Memory;
}

type ScheduledEvent =
  | { type: 'set-mode'; time?: number; seq: number; fence?: number; mode: number }
  | { type: 'set-patch'; time?: number; seq: number; fence?: number; patch: CloudsPatch }
  | { type: 'set-extended'; time?: number; seq: number; fence?: number; extended: CloudsExtendedParams }
  | { type: 'set-freeze'; time?: number; seq: number; fence?: number; freeze: boolean }
  | { type: 'clear-scheduled'; time?: undefined; seq: number; fence: number }
  | { type: 'destroy'; time?: undefined; seq: number; fence?: number };

class CloudsProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): Array<{ name: string; defaultValue: number; minValue: number; maxValue: number; automationRate: string }> {
    return [
      { name: 'mod-position', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-size', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-density', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-feedback', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'min-fence', defaultValue: 0, minValue: 0, maxValue: 1e9, automationRate: 'k-rate' },
    ];
  }

  private wasm: CloudsWasm | null = null;
  private handle = 0;
  private inputPtr = 0;
  private outputPtr = 0;
  private currentPatch: CloudsPatch = { position: 0.5, size: 0.5, density: 0.5, feedback: 0.0 };
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
      const createCloudsModule = globalThis.createCloudsModule;
      if (typeof createCloudsModule !== 'function') {
        throw new Error('createCloudsModule not found in AudioWorklet scope');
      }
      if (!this.wasmBinary) {
        throw new Error('Missing wasmBinary for Clouds processor');
      }
      const wasm = await createCloudsModule({
        locateFile: (path: string) => `/audio/${path}`,
        wasmBinary: this.wasmBinary,
      });
      // Clouds internally runs at 32kHz but we feed it 48kHz frames —
      // the DSP handles its own sample rate conversion internally.
      this.wasm = wasm;
      this.handle = wasm._clouds_create();
      // Allocate I/O buffers (128 frames each — Web Audio render quantum)
      this.inputPtr = wasm._malloc(128 * Float32Array.BYTES_PER_ELEMENT);
      this.outputPtr = wasm._malloc(128 * Float32Array.BYTES_PER_ELEMENT);
      wasm._clouds_set_parameters(
        this.handle,
        this.currentPatch.position,
        this.currentPatch.size,
        this.currentPatch.density,
        this.currentPatch.feedback,
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
      this.wasm._clouds_destroy(this.handle);
      this.handle = 0;
    }
    this.queue = [];
    this.ready = false;
    this.destroyed = true;
  }

  private applyEvent(event: ScheduledEvent): void {
    if (!this.wasm || !this.handle) return;
    switch (event.type) {
      case 'set-mode':
        this.wasm._clouds_set_mode(this.handle, event.mode);
        break;
      case 'set-patch':
        this.currentPatch = event.patch;
        break;
      case 'set-extended':
        this.wasm._clouds_set_extended(
          this.handle,
          event.extended.texture,
          event.extended.pitch,
          event.extended.dry_wet,
          event.extended.stereo_spread,
          event.extended.reverb,
        );
        break;
      case 'set-freeze':
        this.wasm._clouds_set_freeze(this.handle, event.freeze ? 1 : 0);
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

  private applyPatchWithModulation(modPosition: number, modSize: number, modDensity: number, modFeedback: number): void {
    if (!this.wasm || !this.handle) return;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    this.wasm._clouds_set_parameters(
      this.handle,
      clamp01(this.currentPatch.position + modPosition),
      clamp01(this.currentPatch.size + modSize),
      clamp01(this.currentPatch.density + modDensity),
      clamp01(this.currentPatch.feedback + modFeedback),
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

    const rendered = this.wasm._clouds_render(this.handle, this.inputPtr, this.outputPtr, frames);

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

    const input = inputs[0]?.[0] ?? new Float32Array(left.length);

    // Read k-rate modulation params (single value per block)
    const modPosition = parameters['mod-position'][0];
    const modSize = parameters['mod-size'][0];
    const modDensity = parameters['mod-density'][0];
    const modFeedback = parameters['mod-feedback'][0];

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
    this.applyPatchWithModulation(modPosition, modSize, modDensity, modFeedback);

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
          this.applyPatchWithModulation(modPosition, modSize, modDensity, modFeedback);
        }
      }
    }

    return true;
  }
}

registerProcessor('clouds-processor', CloudsProcessor);
