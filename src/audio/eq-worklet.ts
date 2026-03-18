declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;

interface EqPatch {
  low_freq: number;
  low_gain: number;
  mid1_freq: number;
  mid1_gain: number;
  mid1_q: number;
  mid2_freq: number;
  mid2_gain: number;
  mid2_q: number;
  high_freq: number;
  high_gain: number;
}

type ScheduledEvent =
  | { type: 'set-mode'; time?: number; seq: number; fence?: number; mode: number }
  | { type: 'set-patch'; time?: number; seq: number; fence?: number; patch: EqPatch }
  | { type: 'clear-scheduled'; time?: undefined; seq: number; fence: number }
  | { type: 'destroy'; time?: undefined; seq: number; fence?: number };

// --- Biquad filter state ---
interface BiquadState {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
  // Delay line (direct form II transposed)
  z1: number; z2: number;
}

function makeBiquad(): BiquadState {
  return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 };
}

/** Process one sample through a biquad filter (direct form II transposed). */
function biquadProcess(f: BiquadState, x: number): number {
  const y = f.b0 * x + f.z1;
  f.z1 = f.b1 * x - f.a1 * y + f.z2;
  f.z2 = f.b2 * x - f.a2 * y;
  // Flush denormals
  if (f.z1 > -1e-15 && f.z1 < 1e-15) f.z1 = 0;
  if (f.z2 > -1e-15 && f.z2 < 1e-15) f.z2 = 0;
  return y;
}

// --- Biquad coefficient computation (Robert Bristow-Johnson Audio EQ Cookbook) ---

/** Compute low-shelf biquad coefficients.
 *  freq: Hz, gain: dB, sr: sample rate */
function computeLowShelf(f: BiquadState, freq: number, gainDb: number, sr: number): void {
  const A = Math.pow(10, gainDb / 40); // sqrt of linear gain
  const w0 = 2 * Math.PI * freq / sr;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / 2 * Math.sqrt((A + 1 / A) * (1 / 0.707 - 1) + 2);
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

  const a0 = (A + 1) + (A - 1) * cosw0 + twoSqrtAAlpha;
  f.b0 = (A * ((A + 1) - (A - 1) * cosw0 + twoSqrtAAlpha)) / a0;
  f.b1 = (2 * A * ((A - 1) - (A + 1) * cosw0)) / a0;
  f.b2 = (A * ((A + 1) - (A - 1) * cosw0 - twoSqrtAAlpha)) / a0;
  f.a1 = (-2 * ((A - 1) + (A + 1) * cosw0)) / a0;
  f.a2 = ((A + 1) + (A - 1) * cosw0 - twoSqrtAAlpha) / a0;
}

/** Compute high-shelf biquad coefficients.
 *  freq: Hz, gain: dB, sr: sample rate */
function computeHighShelf(f: BiquadState, freq: number, gainDb: number, sr: number): void {
  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * freq / sr;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / 2 * Math.sqrt((A + 1 / A) * (1 / 0.707 - 1) + 2);
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

  const a0 = (A + 1) - (A - 1) * cosw0 + twoSqrtAAlpha;
  f.b0 = (A * ((A + 1) + (A - 1) * cosw0 + twoSqrtAAlpha)) / a0;
  f.b1 = (-2 * A * ((A - 1) + (A + 1) * cosw0)) / a0;
  f.b2 = (A * ((A + 1) + (A - 1) * cosw0 - twoSqrtAAlpha)) / a0;
  f.a1 = (2 * ((A - 1) - (A + 1) * cosw0)) / a0;
  f.a2 = ((A + 1) - (A - 1) * cosw0 - twoSqrtAAlpha) / a0;
}

/** Compute peaking EQ biquad coefficients.
 *  freq: Hz, gain: dB, Q: quality factor, sr: sample rate */
function computePeaking(f: BiquadState, freq: number, gainDb: number, Q: number, sr: number): void {
  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * freq / sr;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);

  const a0 = 1 + alpha / A;
  f.b0 = (1 + alpha * A) / a0;
  f.b1 = (-2 * cosw0) / a0;
  f.b2 = (1 - alpha * A) / a0;
  f.a1 = (-2 * cosw0) / a0;
  f.a2 = (1 - alpha / A) / a0;
}

/** Set filter to unity (pass-through). */
function setUnity(f: BiquadState): void {
  f.b0 = 1; f.b1 = 0; f.b2 = 0; f.a1 = 0; f.a2 = 0;
}

// --- Parameter mapping ---

/** Map normalised 0-1 to frequency in Hz (logarithmic). */
function mapFreq(normalised: number, minHz: number, maxHz: number): number {
  return minHz * Math.pow(maxHz / minHz, normalised);
}

/** Map normalised 0-1 gain to dB (-18 to +18, 0.5 = 0dB). */
function mapGain(normalised: number): number {
  return (normalised - 0.5) * 36; // 0→-18, 0.5→0, 1→+18
}

/** Map normalised 0-1 Q to 0.1–18 (logarithmic). */
function mapQ(normalised: number): number {
  return 0.1 * Math.pow(180, normalised); // 0→0.1, 1→18
}

// Exponential smoothing coefficient for ~5ms at 48kHz
const SMOOTH_COEFF = 1 - Math.exp(-1 / (0.005 * 48000));

// Number of bands per mode
const BANDS_4 = 4;
const BANDS_8 = 8;
const MAX_BANDS = BANDS_8;

class EqProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): Array<{ name: string; defaultValue: number; minValue: number; maxValue: number; automationRate: string }> {
    return [
      { name: 'min-fence', defaultValue: 0, minValue: 0, maxValue: 1e9, automationRate: 'k-rate' },
    ];
  }

  private currentPatch: EqPatch = {
    low_freq: 0.25, low_gain: 0.5,
    mid1_freq: 0.4, mid1_gain: 0.5, mid1_q: 0.3,
    mid2_freq: 0.6, mid2_gain: 0.5, mid2_q: 0.3,
    high_freq: 0.75, high_gain: 0.5,
  };

  /** Mode: 0 = 4-band, 1 = 8-band */
  private mode = 0;
  private queue: ScheduledEvent[] = [];
  private seq = 0;
  private destroyed = false;
  private minFence = 0;

  // Biquad filter banks — left and right channels each get their own state
  // to avoid cross-channel artifacts.
  // Max 8 bands; 4-band mode uses first 4.
  private filtersL: BiquadState[] = [];
  private filtersR: BiquadState[] = [];

  // Smoothed parameter cache — we smooth the mapped (Hz/dB/Q) values
  private smoothFreqs: number[] = [];
  private smoothGains: number[] = [];
  private smoothQs: number[] = [];
  private targetFreqs: number[] = [];
  private targetGains: number[] = [];
  private targetQs: number[] = [];

  // Whether coefficients need recomputing
  private needsUpdate = true;

  constructor() {
    super();

    for (let i = 0; i < MAX_BANDS; i++) {
      this.filtersL.push(makeBiquad());
      this.filtersR.push(makeBiquad());
      this.smoothFreqs.push(1000);
      this.smoothGains.push(0);
      this.smoothQs.push(1);
      this.targetFreqs.push(1000);
      this.targetGains.push(0);
      this.targetQs.push(1);
    }

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
        this.mode = Math.max(0, Math.min(1, event.mode));
        this.needsUpdate = true;
        break;
      case 'set-patch':
        this.currentPatch = event.patch;
        this.needsUpdate = true;
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

  /** Recompute target parameter values from the current patch. */
  private updateTargets(): void {
    const p = this.currentPatch;
    if (this.mode === 0) {
      // 4-band: low shelf, 2x peaking, high shelf
      this.targetFreqs[0] = mapFreq(p.low_freq, 20, 500);
      this.targetGains[0] = mapGain(p.low_gain);
      this.targetQs[0] = 0.707; // shelf Q (not used in shelf formula but stored for consistency)

      this.targetFreqs[1] = mapFreq(p.mid1_freq, 100, 8000);
      this.targetGains[1] = mapGain(p.mid1_gain);
      this.targetQs[1] = mapQ(p.mid1_q);

      this.targetFreqs[2] = mapFreq(p.mid2_freq, 100, 8000);
      this.targetGains[2] = mapGain(p.mid2_gain);
      this.targetQs[2] = mapQ(p.mid2_q);

      this.targetFreqs[3] = mapFreq(p.high_freq, 1000, 20000);
      this.targetGains[3] = mapGain(p.high_gain);
      this.targetQs[3] = 0.707;
    } else {
      // 8-band: low shelf, 6x peaking, high shelf
      // Spread the 4-band params across 8 bands by duplicating the mids
      this.targetFreqs[0] = mapFreq(p.low_freq, 20, 500);
      this.targetGains[0] = mapGain(p.low_gain);
      this.targetQs[0] = 0.707;

      // Mid bands: spread mid1 and mid2 across 6 peaking bands
      // Band 1-3 derived from mid1, bands 4-6 derived from mid2
      const mid1Freq = mapFreq(p.mid1_freq, 100, 8000);
      const mid1Gain = mapGain(p.mid1_gain);
      const mid1Q = mapQ(p.mid1_q);
      const mid2Freq = mapFreq(p.mid2_freq, 100, 8000);
      const mid2Gain = mapGain(p.mid2_gain);
      const mid2Q = mapQ(p.mid2_q);

      // Sub-divide each mid band into 3 bands at octave intervals around the center
      this.targetFreqs[1] = mid1Freq * 0.5;
      this.targetGains[1] = mid1Gain * 0.5;
      this.targetQs[1] = mid1Q * 2; // narrower
      this.targetFreqs[2] = mid1Freq;
      this.targetGains[2] = mid1Gain;
      this.targetQs[2] = mid1Q * 2;
      this.targetFreqs[3] = mid1Freq * 2;
      this.targetGains[3] = mid1Gain * 0.5;
      this.targetQs[3] = mid1Q * 2;

      this.targetFreqs[4] = mid2Freq * 0.5;
      this.targetGains[4] = mid2Gain * 0.5;
      this.targetQs[4] = mid2Q * 2;
      this.targetFreqs[5] = mid2Freq;
      this.targetGains[5] = mid2Gain;
      this.targetQs[5] = mid2Q * 2;
      this.targetFreqs[6] = mid2Freq * 2;
      this.targetGains[6] = mid2Gain * 0.5;
      this.targetQs[6] = mid2Q * 2;

      this.targetFreqs[7] = mapFreq(p.high_freq, 1000, 20000);
      this.targetGains[7] = mapGain(p.high_gain);
      this.targetQs[7] = 0.707;
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0];
    if (!output?.length) return true;
    const outL = output[0];
    const outR = output[1] ?? output[0];
    outL.fill(0);
    outR.fill(0);

    if (this.destroyed) return false;

    const inputL = inputs[0]?.[0] ?? new Float32Array(outL.length);
    const inputR = inputs[0]?.[1] ?? inputL; // mono→stereo fallback

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

    // Recompute targets if patch changed
    if (this.needsUpdate) {
      this.updateTargets();
      this.needsUpdate = false;
    }

    const numBands = this.mode === 0 ? BANDS_4 : BANDS_8;
    const frameCount = outL.length;
    const sr = sampleRate;
    const smooth = SMOOTH_COEFF;

    for (let i = 0; i < frameCount; i++) {
      let sampleL = inputL[i];
      let sampleR = inputR[i];

      for (let b = 0; b < numBands; b++) {
        // Smooth parameters per-sample
        this.smoothFreqs[b] += smooth * (this.targetFreqs[b] - this.smoothFreqs[b]);
        this.smoothGains[b] += smooth * (this.targetGains[b] - this.smoothGains[b]);
        this.smoothQs[b] += smooth * (this.targetQs[b] - this.smoothQs[b]);

        // Recompute coefficients from smoothed values
        const freq = this.smoothFreqs[b];
        const gain = this.smoothGains[b];
        const Q = this.smoothQs[b];
        const fL = this.filtersL[b];
        const fR = this.filtersR[b];

        // Skip near-unity bands (gain close to 0dB)
        if (Math.abs(gain) < 0.01) {
          setUnity(fL);
          setUnity(fR);
        } else if (b === 0) {
          // Low shelf
          computeLowShelf(fL, freq, gain, sr);
          fR.b0 = fL.b0; fR.b1 = fL.b1; fR.b2 = fL.b2;
          fR.a1 = fL.a1; fR.a2 = fL.a2;
        } else if (b === numBands - 1) {
          // High shelf
          computeHighShelf(fL, freq, gain, sr);
          fR.b0 = fL.b0; fR.b1 = fL.b1; fR.b2 = fL.b2;
          fR.a1 = fL.a1; fR.a2 = fL.a2;
        } else {
          // Peaking
          computePeaking(fL, freq, gain, Q, sr);
          fR.b0 = fL.b0; fR.b1 = fL.b1; fR.b2 = fL.b2;
          fR.a1 = fL.a1; fR.a2 = fL.a2;
        }

        sampleL = biquadProcess(fL, sampleL);
        sampleR = biquadProcess(fR, sampleR);
      }

      outL[i] = sampleL;
      outR[i] = sampleR;
    }

    return true;
  }
}

registerProcessor('eq-processor', EqProcessor);
