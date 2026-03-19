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

interface PlaitsExtendedParams {
  fm_amount: number;
  timbre_mod_amount: number;
  morph_mod_amount: number;
  decay: number;
  lpg_colour: number;
}

interface PlaitsWasm {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _plaits_create(sampleRate: number): number;
  _plaits_destroy(handle: number): void;
  _plaits_set_model(handle: number, modelIndex: number): void;
  _plaits_set_patch(handle: number, harmonics: number, timbre: number, morph: number, note: number): void;
  _plaits_set_extended(handle: number, fm_amount: number, timbre_mod_amount: number, morph_mod_amount: number, decay: number, lpg_colour: number): void;
  _plaits_trigger(handle: number, accentLevel: number): void;
  _plaits_set_gate(handle: number, open: number): void;
  _plaits_set_portamento(handle: number, time_normalized: number, mode: number): void;
  _plaits_render(handle: number, outputPtr: number, frames: number): number;
  HEAPF32?: Float32Array;
  memory?: WebAssembly.Memory;
}

type ScheduledEvent =
  | { type: 'set-model'; time?: number; seq: number; fence?: number; model: number }
  | { type: 'set-patch'; time?: number; seq: number; fence?: number; patch: SynthPatch }
  | { type: 'set-extended'; time?: number; seq: number; fence?: number; extended: PlaitsExtendedParams }
  | { type: 'trigger'; time: number; seq: number; fence?: number; accentLevel: number }
  | { type: 'set-gate'; time?: number; seq: number; fence?: number; open: boolean }
  | { type: 'set-portamento'; time?: undefined; seq: number; fence?: number; time_normalized: number; mode: number }
  | { type: 'clear-scheduled'; time?: undefined; seq: number; fence: number }
  | { type: 'destroy'; time?: undefined; seq: number; fence?: number };

class PlaitsProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): Array<{ name: string; defaultValue: number; minValue: number; maxValue: number; automationRate: string }> {
    return [
      { name: 'mod-timbre', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-harmonics', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-morph', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-note', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'min-fence', defaultValue: 0, minValue: 0, maxValue: 1e9, automationRate: 'k-rate' },
    ];
  }

  private wasm: PlaitsWasm | null = null;
  private handle = 0;
  private outputPtr = 0;
  private currentPatch: SynthPatch = { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 };
  private queue: ScheduledEvent[] = [];
  private seq = 0;
  private ready = false;
  private readonly wasmBinary: ArrayBuffer | null;
  private destroyed = false;
  /** Sequence fence: events with fence < minFence are stale and ignored. */
  private minFence = 0;
  /** Whether currentPatch has been updated but not yet flushed to WASM. */
  private patchDirty = false;
  /** Current k-rate modulation values, updated at the start of each process block. */
  private modTimbre = 0;
  private modHarmonics = 0;
  private modMorph = 0;
  private modNote = 0;
  /** Last values sent to WASM for dirty-check (NaN = never sent). */
  private lastH = NaN;
  private lastT = NaN;
  private lastMo = NaN;
  private lastN = NaN;
  private lastModT = NaN;
  private lastModH = NaN;
  private lastModMo = NaN;
  private lastModN = NaN;

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
        this.patchDirty = true;
        break;
      case 'set-extended':
        this.wasm._plaits_set_extended(
          this.handle,
          event.extended.fm_amount,
          event.extended.timbre_mod_amount,
          event.extended.morph_mod_amount,
          event.extended.decay,
          event.extended.lpg_colour,
        );
        break;
      case 'trigger':
        // Flush patch to WASM before triggering so the trigger fires with
        // the correct parameters. Without this, triggers that follow a
        // set-patch in the same drain batch fire with stale WASM values.
        if (this.patchDirty) {
          this.flushPatch();
        }
        this.wasm._plaits_trigger(this.handle, event.accentLevel);
        break;
      case 'set-gate':
        this.wasm._plaits_set_gate(this.handle, event.open ? 1 : 0);
        break;
      case 'set-portamento':
        this.wasm._plaits_set_portamento(this.handle, event.time_normalized, event.mode);
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

  /** Flush currentPatch + modulation to WASM and clear the dirty flag. */
  private flushPatch(): void {
    if (!this.wasm || !this.handle) return;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    this.wasm._plaits_set_patch(
      this.handle,
      clamp01(this.currentPatch.harmonics + this.modHarmonics),
      clamp01(this.currentPatch.timbre + this.modTimbre),
      clamp01(this.currentPatch.morph + this.modMorph),
      clamp01(this.currentPatch.note + this.modNote),
    );
    this.patchDirty = false;
  }

  private applyPatchWithModulation(modTimbre: number, modHarmonics: number, modMorph: number, modNote: number): void {
    if (!this.wasm || !this.handle) return;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const h = clamp01(this.currentPatch.harmonics + modHarmonics);
    const t = clamp01(this.currentPatch.timbre + modTimbre);
    const mo = clamp01(this.currentPatch.morph + modMorph);
    const n = clamp01(this.currentPatch.note + modNote);
    // Value-based dirty-check: skip WASM call when nothing changed.
    // Prevents per-block _plaits_set_patch from overriding per-step note
    // pitches set by timed set-patch events.
    if (h === this.lastH && t === this.lastT && mo === this.lastMo && n === this.lastN
        && modTimbre === this.lastModT && modHarmonics === this.lastModH
        && modMorph === this.lastModMo && modNote === this.lastModN) {
      return;
    }
    this.lastH = h; this.lastT = t; this.lastMo = mo; this.lastN = n;
    this.lastModT = modTimbre; this.lastModH = modHarmonics; this.lastModMo = modMorph;
    this.lastModN = modNote;
    this.wasm._plaits_set_patch(this.handle, h, t, mo, n);
    this.patchDirty = false;
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

  process(_inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
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

    // Read k-rate modulation params (single value per block).
    // Store as instance state so flushPatch() can access them from applyEvent.
    const modTimbre = this.modTimbre = parameters['mod-timbre'][0];
    const modHarmonics = this.modHarmonics = parameters['mod-harmonics'][0];
    const modMorph = this.modMorph = parameters['mod-morph'][0];
    const modNote = this.modNote = parameters['mod-note'][0];

    // Synchronous fence via AudioParam — read before draining the queue so
    // stale events are filtered in the same process() block as the fence update.
    // This eliminates the race condition where postMessage('clear-scheduled')
    // arrives between process() calls while pre-scheduled notes still fire.
    const newMinFence = Math.floor(parameters['min-fence'][0]);
    if (newMinFence > this.minFence) {
      this.minFence = newMinFence;
    }

    const blockStart = currentTime;
    const frameCount = left.length;
    const blockDuration = frameCount / sampleRate;
    const blockEnd = blockStart + blockDuration;

    while (this.queue.length > 0 && this.queue[0].time === undefined) {
      this.applyEvent(this.queue.shift()!);
    }

    // Drop stale events that belong to a previous play cycle (fence < minFence)
    this.queue = this.queue.filter(e =>
      e.time === undefined || e.fence === undefined || e.fence >= this.minFence,
    );

    // Drain stale events that were scheduled before this block
    // (prevents first-step silence and stale event accumulation)
    while (this.queue.length > 0 && this.queue[0].time !== undefined && this.queue[0].time! < blockStart) {
      this.applyEvent(this.queue.shift()!);
    }

    // Apply effective patch (base + modulation) after processing immediate events
    this.applyPatchWithModulation(modTimbre, modHarmonics, modMorph, modNote);

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
        // Re-apply modulation after any event that changes the patch
        if (event.type === 'set-patch') {
          this.applyPatchWithModulation(modTimbre, modHarmonics, modMorph, modNote);
        }
      }
    }

    return true;
  }
}

registerProcessor('plaits-processor', PlaitsProcessor);
