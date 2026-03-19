// src/audio/distortion-worklet.ts
// Pure-JS distortion with character modes, running in an AudioWorklet.
// No WASM needed — the DSP is straightforward waveshaping + filtering.

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;

interface DistortionPatch {
  drive: number;
  tone: number;
  mix: number;
  bits: number;
  downsample: number;
}

// Character mode indices
const MODE_TAPE = 0;
const MODE_OVERDRIVE = 1;
const MODE_FUZZ = 2;
const MODE_BITCRUSH = 3;

type ScheduledEvent =
  | { type: 'set-mode'; time?: number; seq: number; fence?: number; mode: number }
  | { type: 'set-patch'; time?: number; seq: number; fence?: number; patch: DistortionPatch }
  | { type: 'clear-scheduled'; time?: undefined; seq: number; fence: number }
  | { type: 'destroy'; time?: undefined; seq: number; fence?: number };

class DistortionProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): Array<{ name: string; defaultValue: number; minValue: number; maxValue: number; automationRate: string }> {
    return [
      { name: 'mod-drive', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-tone', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-mix', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-bits', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-downsample', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'min-fence', defaultValue: 0, minValue: 0, maxValue: 1e9, automationRate: 'k-rate' },
    ];
  }

  private currentPatch: DistortionPatch = {
    drive: 0.5,
    tone: 0.7,
    mix: 1.0,
    bits: 1.0,
    downsample: 0.0,
  };

  private mode = MODE_TAPE;
  private queue: ScheduledEvent[] = [];
  private seq = 0;
  private destroyed = false;
  private minFence = 0;

  // One-pole lowpass filter state (stereo)
  private lpStateL = 0;
  private lpStateR = 0;

  // Bitcrush sample-and-hold state
  private holdCounterL = 0;
  private holdCounterR = 0;
  private holdValueL = 0;
  private holdValueR = 0;

  constructor() {
    super();
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
    this.port.postMessage({ type: 'ready' });
  }

  private applyEvent(event: ScheduledEvent): void {
    switch (event.type) {
      case 'set-mode':
        this.mode = event.mode;
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
        this.destroyed = true;
        this.queue = [];
        break;
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0];
    if (!output?.length) return true;
    const outLeft = output[0];
    const outRight = output[1] ?? output[0];
    outLeft.fill(0);
    outRight.fill(0);

    if (this.destroyed) return false;

    const inLeft = inputs[0]?.[0];
    const inRight = inputs[0]?.[1] ?? inputs[0]?.[0];
    if (!inLeft) return true;

    // Read modulation params
    const modDrive = parameters['mod-drive'][0];
    const modTone = parameters['mod-tone'][0];
    const modMix = parameters['mod-mix'][0];
    const modBits = parameters['mod-bits'][0];
    const modDownsample = parameters['mod-downsample'][0];

    // Synchronous fence
    const newMinFence = Math.floor(parameters['min-fence'][0]);
    if (newMinFence > this.minFence) {
      this.minFence = newMinFence;
    }

    // Process immediate events
    while (this.queue.length > 0 && this.queue[0].time === undefined) {
      this.applyEvent(this.queue.shift()!);
    }

    // Drop stale events
    this.queue = this.queue.filter(e =>
      e.time === undefined || e.fence === undefined || e.fence >= this.minFence,
    );

    // Drain stale timed events
    while (this.queue.length > 0 && this.queue[0].time !== undefined) {
      this.applyEvent(this.queue.shift()!);
    }

    // Compute effective parameters (base + modulation, clamped 0-1)
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const effDrive = clamp01(this.currentPatch.drive + modDrive);
    const effTone = clamp01(this.currentPatch.tone + modTone);
    const effMix = clamp01(this.currentPatch.mix + modMix);
    const effBits = clamp01(this.currentPatch.bits + modBits);
    const effDownsample = clamp01(this.currentPatch.downsample + modDownsample);

    // Tone filter: one-pole lowpass, cutoff from 200Hz to 20kHz (log scale)
    const cutoffHz = 200 * Math.pow(100, effTone); // 200 * 100^tone -> 200..20000
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const dt = 1 / sampleRate;
    const lpAlpha = dt / (rc + dt);

    // Bitcrush parameters
    const levels = Math.pow(2, 1 + effBits * 15); // 2^1 to 2^16
    const holdInterval = Math.max(1, Math.floor(1 + effDownsample * 63)); // 1x to 64x reduction

    const isTape = this.mode === MODE_TAPE;
    const isOverdrive = this.mode === MODE_OVERDRIVE;
    const isFuzz = this.mode === MODE_FUZZ;
    const isBitcrush = this.mode === MODE_BITCRUSH;

    const frameCount = inLeft.length;

    for (let i = 0; i < frameCount; i++) {
      const dryL = inLeft[i];
      const dryR = inRight ? inRight[i] : dryL;

      let wetL: number;
      let wetR: number;

      if (isTape) {
        // Asymmetric soft clipping via tanh — subtle even harmonics
        const driveAmount = 1 + effDrive * 10;
        wetL = Math.tanh(dryL * driveAmount);
        wetR = Math.tanh(dryR * driveAmount);
      } else if (isOverdrive) {
        // Tube-style waveshaper — smooth even harmonics
        const driveAmount = 1 + effDrive * 20;
        const xL = dryL * driveAmount;
        const xR = dryR * driveAmount;
        wetL = xL / (1 + Math.abs(xL));
        wetR = xR / (1 + Math.abs(xR));
      } else if (isFuzz) {
        // Hard clipping — aggressive odd harmonics
        const driveAmount = 1 + effDrive * 40;
        wetL = Math.max(-1, Math.min(1, dryL * driveAmount));
        wetR = Math.max(-1, Math.min(1, dryR * driveAmount));
      } else if (isBitcrush) {
        // Quantize bit depth + sample-and-hold
        const quantL = Math.round(dryL * levels) / levels;
        const quantR = Math.round(dryR * levels) / levels;

        // Sample-and-hold for downsample
        this.holdCounterL++;
        this.holdCounterR++;
        if (this.holdCounterL >= holdInterval) {
          this.holdCounterL = 0;
          this.holdValueL = quantL;
        }
        if (this.holdCounterR >= holdInterval) {
          this.holdCounterR = 0;
          this.holdValueR = quantR;
        }
        wetL = this.holdValueL;
        wetR = this.holdValueR;
      } else {
        wetL = dryL;
        wetR = dryR;
      }

      // Post-distortion one-pole lowpass filter for tone
      this.lpStateL += lpAlpha * (wetL - this.lpStateL);
      this.lpStateR += lpAlpha * (wetR - this.lpStateR);
      wetL = this.lpStateL;
      wetR = this.lpStateR;

      // Dry/wet mix
      outLeft[i] = dryL * (1 - effMix) + wetL * effMix;
      outRight[i] = dryR * (1 - effMix) + wetR * effMix;
    }

    return true;
  }
}

registerProcessor('distortion-processor', DistortionProcessor);
