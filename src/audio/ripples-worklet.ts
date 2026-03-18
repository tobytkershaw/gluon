declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;

interface RipplesPatch {
  cutoff: number;
  resonance: number;
  drive: number;
}

type ScheduledEvent =
  | { type: 'set-mode'; time?: number; seq: number; fence?: number; mode: number }
  | { type: 'set-patch'; time?: number; seq: number; fence?: number; patch: RipplesPatch }
  | { type: 'clear-scheduled'; time?: undefined; seq: number; fence: number }
  | { type: 'destroy'; time?: undefined; seq: number; fence?: number };

// --- SVF state for one 2-pole section ---
interface SvfState {
  lp: number;
  bp: number;
}

/** Clamp a value to avoid floating-point blowup. */
function clampSample(x: number): number {
  if (x > 4.0) return 4.0;
  if (x < -4.0) return -4.0;
  // Flush denormals
  if (x > -1e-15 && x < 1e-15) return 0;
  return x;
}

/** Soft-clip via tanh approximation (Pade). Fast and smooth. */
function tanhApprox(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

/** Map normalised cutoff (0-1) to frequency coefficient `f = 2 * sin(pi * fc / sr)`.
 *  Cutoff is mapped logarithmically: 20 Hz at 0.0, 20 kHz at 1.0. */
function cutoffToCoeff(normalised: number, sr: number): number {
  // Log map: 20 * (20000/20)^normalised = 20 * 1000^normalised
  const freqHz = 20 * Math.pow(1000, normalised);
  // Clamp to Nyquist * 0.45 to keep the SVF stable
  const maxFreq = sr * 0.45;
  const fc = Math.min(freqHz, maxFreq);
  return 2 * Math.sin(Math.PI * fc / sr);
}

/** Map normalised resonance (0-1) to the Q damping factor for the SVF.
 *  At 0.0: Q=0.5 (gentle). At 1.0: Q approaches infinity (self-oscillation). */
function resonanceToQ(normalised: number): number {
  // q_damp = 1/Q. At resonance=0 → q=2 (Q=0.5). At resonance=1 → q≈0.01 (self-osc).
  // Use exponential mapping for musical feel.
  const qDamp = 2 * Math.pow(0.005, normalised);
  return qDamp;
}

// Exponential smoothing coefficient for ~5ms at 48kHz
const SMOOTH_COEFF = 1 - Math.exp(-1 / (0.005 * 48000));

class RipplesProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): Array<{ name: string; defaultValue: number; minValue: number; maxValue: number; automationRate: string }> {
    return [
      { name: 'mod-cutoff', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-resonance', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-drive', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'min-fence', defaultValue: 0, minValue: 0, maxValue: 1e9, automationRate: 'k-rate' },
    ];
  }

  private currentPatch: RipplesPatch = { cutoff: 0.5, resonance: 0.0, drive: 0.0 };
  /** Current mode: 0=lp2, 1=lp4, 2=bp2, 3=hp2 */
  private mode = 0;
  private queue: ScheduledEvent[] = [];
  private seq = 0;
  private destroyed = false;
  private minFence = 0;

  // SVF state — two sections for 4-pole mode
  private svf1: SvfState = { lp: 0, bp: 0 };
  private svf2: SvfState = { lp: 0, bp: 0 };

  // Smoothed parameter values
  private smoothCutoff = 0.5;
  private smoothResonance = 0.0;
  private smoothDrive = 0.0;

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
    // No async init needed — pure JS DSP, ready immediately
    this.port.postMessage({ type: 'ready' });
  }

  private applyEvent(event: ScheduledEvent): void {
    switch (event.type) {
      case 'set-mode':
        this.mode = Math.max(0, Math.min(3, event.mode));
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
    const left = output[0];
    const right = output[1] ?? output[0];
    left.fill(0);
    right.fill(0);

    if (this.destroyed) return false;

    const input = inputs[0]?.[0] ?? new Float32Array(left.length);

    // Read k-rate modulation params
    const modCutoff = parameters['mod-cutoff'][0];
    const modResonance = parameters['mod-resonance'][0];
    const modDrive = parameters['mod-drive'][0];

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

    // Compute effective parameters (base + modulation), clamped 0-1
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const targetCutoff = clamp01(this.currentPatch.cutoff + modCutoff);
    const targetResonance = clamp01(this.currentPatch.resonance + modResonance);
    const targetDrive = clamp01(this.currentPatch.drive + modDrive);

    const frameCount = left.length;
    const sr = sampleRate;
    const mode = this.mode;
    const svf1 = this.svf1;
    const svf2 = this.svf2;
    const smooth = SMOOTH_COEFF;

    for (let i = 0; i < frameCount; i++) {
      // Per-sample parameter smoothing
      this.smoothCutoff += smooth * (targetCutoff - this.smoothCutoff);
      this.smoothResonance += smooth * (targetResonance - this.smoothResonance);
      this.smoothDrive += smooth * (targetDrive - this.smoothDrive);

      const f = cutoffToCoeff(this.smoothCutoff, sr);
      const qDamp = resonanceToQ(this.smoothResonance);

      // Apply drive: soft-clip input with gain
      const driveGain = 1 + this.smoothDrive * 3;
      const driven = tanhApprox(input[i] * driveGain);

      // --- First SVF section (always used) ---
      const hp1 = driven - svf1.lp - qDamp * svf1.bp;
      svf1.bp = clampSample(svf1.bp + f * hp1);
      svf1.lp = clampSample(svf1.lp + f * svf1.bp);

      let out: number;
      if (mode === 0) {
        // lp2: 2-pole low-pass
        out = svf1.lp;
      } else if (mode === 1) {
        // lp4: cascade two 2-pole LP sections
        const hp2 = svf1.lp - svf2.lp - qDamp * svf2.bp;
        svf2.bp = clampSample(svf2.bp + f * hp2);
        svf2.lp = clampSample(svf2.lp + f * svf2.bp);
        out = svf2.lp;
      } else if (mode === 2) {
        // bp2: 2-pole band-pass
        out = svf1.bp;
      } else {
        // hp2: 2-pole high-pass
        out = hp1;
      }

      left[i] = out;
      right[i] = out;
    }

    this.svf1 = svf1;
    this.svf2 = svf2;

    return true;
  }
}

registerProcessor('ripples-processor', RipplesProcessor);
