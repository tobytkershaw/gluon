// src/audio/compressor-worklet.ts
// Pure-JS dynamics compressor with character modes, running in an AudioWorklet.
// No WASM needed — the DSP is straightforward envelope follower + gain computer.

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;

interface CompressorPatch {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  makeup: number;
  mix: number;
}

// Character mode indices
const MODE_CLEAN = 0;
const MODE_OPTO = 1;
const MODE_BUS = 2;
const MODE_LIMIT = 3;

type ScheduledEvent =
  | { type: 'set-mode'; time?: number; seq: number; fence?: number; mode: number }
  | { type: 'set-patch'; time?: number; seq: number; fence?: number; patch: CompressorPatch }
  | { type: 'clear-scheduled'; time?: undefined; seq: number; fence: number }
  | { type: 'destroy'; time?: undefined; seq: number; fence?: number };

// --- DSP helpers ---

/** Convert normalized 0-1 to dB: 0 -> -60dB, 1 -> 0dB */
function thresholdToDb(norm: number): number {
  return -60 + norm * 60;
}

/** Convert normalized 0-1 to ratio: 0 -> 1:1, 1 -> 20:1 */
function ratioFromNorm(norm: number): number {
  return 1 + norm * 19;
}

/** Convert normalized 0-1 to time in seconds (log scale) */
function attackFromNorm(norm: number): number {
  // 0 -> 0.1ms, 1 -> 100ms (log scale)
  return 0.0001 * Math.pow(1000, norm);
}

function releaseFromNorm(norm: number): number {
  // 0 -> 10ms, 1 -> 1000ms (log scale)
  return 0.01 * Math.pow(100, norm);
}

/** Convert normalized 0-1 to makeup gain in linear: 0 -> 0dB, 1 -> 24dB */
function makeupToLinear(norm: number): number {
  const dB = norm * 24;
  return Math.pow(10, dB / 20);
}

/** Convert linear amplitude to dB */
function linearToDb(x: number): number {
  return 20 * Math.log10(Math.max(x, 1e-12));
}

/** Convert dB to linear amplitude */
function dbToLinear(dB: number): number {
  return Math.pow(10, dB / 20);
}

/** Compute the one-pole coefficient for a given time constant */
function timeToCoeff(timeSec: number, sr: number): number {
  if (timeSec <= 0) return 1;
  return 1 - Math.exp(-1 / (timeSec * sr));
}

/** Soft clipping (tanh approximation) for opto saturation */
function softClip(x: number): number {
  // Fast tanh approximation
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

class CompressorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): Array<{ name: string; defaultValue: number; minValue: number; maxValue: number; automationRate: string }> {
    return [
      { name: 'mod-threshold', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-ratio', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-attack', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-release', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-makeup', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-mix', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'min-fence', defaultValue: 0, minValue: 0, maxValue: 1e9, automationRate: 'k-rate' },
    ];
  }

  private currentPatch: CompressorPatch = {
    threshold: 0.5,
    ratio: 0.3,
    attack: 0.3,
    release: 0.4,
    makeup: 0.0,
    mix: 1.0,
  };

  private mode = MODE_CLEAN;
  private queue: ScheduledEvent[] = [];
  private seq = 0;
  private destroyed = false;
  private minFence = 0;

  // Envelope follower state
  private envLevel = 0; // current envelope level in linear
  // RMS state for opto mode
  private rmsSquaredSum = 0;

  // Gain smoothing state
  private smoothedGainDb = 0;

  // Opto: program-dependent release state
  private optoReleaseAccum = 0;

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

    // Sidechain: if a second input is connected, use it as the detector signal
    const scLeft = inputs[1]?.[0];
    const scRight = inputs[1]?.[1] ?? inputs[1]?.[0];
    const hasSidechain = scLeft !== undefined && scLeft.length > 0;

    // Read modulation params
    const modThreshold = parameters['mod-threshold'][0];
    const modRatio = parameters['mod-ratio'][0];
    const modAttack = parameters['mod-attack'][0];
    const modRelease = parameters['mod-release'][0];
    const modMakeup = parameters['mod-makeup'][0];
    const modMix = parameters['mod-mix'][0];

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

    // Drain stale timed events (no sub-block scheduling needed for compressor —
    // patch changes are smooth by nature of the envelope follower)
    while (this.queue.length > 0 && this.queue[0].time !== undefined) {
      this.applyEvent(this.queue.shift()!);
    }

    // Compute effective parameters (base + modulation, clamped 0-1)
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const effThreshold = clamp01(this.currentPatch.threshold + modThreshold);
    const effRatio = clamp01(this.currentPatch.ratio + modRatio);
    const effAttack = clamp01(this.currentPatch.attack + modAttack);
    const effRelease = clamp01(this.currentPatch.release + modRelease);
    const effMakeup = clamp01(this.currentPatch.makeup + modMakeup);
    const effMix = clamp01(this.currentPatch.mix + modMix);

    // Map normalized values to DSP values
    const threshDb = thresholdToDb(effThreshold);
    const threshLin = dbToLinear(threshDb);
    let ratio = ratioFromNorm(effRatio);
    let attackSec = attackFromNorm(effAttack);
    const releaseSec = releaseFromNorm(effRelease);
    const makeupGain = makeupToLinear(effMakeup);

    // Mode overrides
    const isOpto = this.mode === MODE_OPTO;
    const isBus = this.mode === MODE_BUS;
    const isLimit = this.mode === MODE_LIMIT;

    if (isLimit) {
      attackSec = 0.0001; // 0.1ms fixed
      ratio = 100; // brickwall
    }

    // Bus mode: soft knee width in dB
    const kneeWidthDb = isBus ? 6 : 0;

    const attackCoeff = timeToCoeff(attackSec, sampleRate);
    const releaseCoeff = timeToCoeff(releaseSec, sampleRate);

    // RMS window for opto mode (approx 10ms)
    const rmsWindowSamples = Math.round(sampleRate * 0.01);

    const frameCount = inLeft.length;

    for (let i = 0; i < frameCount; i++) {
      const dryL = inLeft[i];
      const dryR = inRight ? inRight[i] : dryL;

      // Mono detection signal (max of abs L/R for peak, average for RMS)
      // When sidechain is connected, use the sidechain audio as the detector source
      const detL = hasSidechain ? scLeft[i] : dryL;
      const detR = hasSidechain ? (scRight ? scRight[i] : detL) : dryR;
      let detectorInput: number;

      if (isOpto) {
        // RMS detection
        const mono = (detL + detR) * 0.5;
        this.rmsSquaredSum += mono * mono;
        this.rmsSquaredSum -= this.rmsSquaredSum / rmsWindowSamples;
        detectorInput = Math.sqrt(Math.max(0, this.rmsSquaredSum / rmsWindowSamples));
      } else {
        // Peak detection
        detectorInput = Math.max(Math.abs(detL), Math.abs(detR));
      }

      // Envelope follower (attack/release ballistics)
      if (detectorInput > this.envLevel) {
        this.envLevel += attackCoeff * (detectorInput - this.envLevel);
      } else {
        // Opto: program-dependent release — release gets slower at high compression
        let effReleaseCoeff = releaseCoeff;
        if (isOpto) {
          // The deeper the compression, the slower the release
          const compressionDepth = Math.max(0, this.envLevel - threshLin);
          const slowFactor = 1 + compressionDepth * 4;
          effReleaseCoeff = timeToCoeff(releaseSec * slowFactor, sampleRate);
          this.optoReleaseAccum = compressionDepth;
        }
        this.envLevel += effReleaseCoeff * (detectorInput - this.envLevel);
      }

      // Gain computer: convert envelope to gain reduction in dB
      const envDb = linearToDb(this.envLevel);
      let gainReductionDb = 0;

      if (kneeWidthDb > 0 && envDb > threshDb - kneeWidthDb / 2 && envDb < threshDb + kneeWidthDb / 2) {
        // Soft knee region (bus mode)
        const x = envDb - threshDb + kneeWidthDb / 2;
        gainReductionDb = ((1 / ratio - 1) * x * x) / (2 * kneeWidthDb);
      } else if (envDb > threshDb) {
        // Above threshold
        gainReductionDb = (threshDb - envDb) * (1 - 1 / ratio);
      }

      // Smooth the gain change (ballistics on the gain itself)
      const targetGainDb = gainReductionDb;
      if (targetGainDb < this.smoothedGainDb) {
        this.smoothedGainDb += attackCoeff * (targetGainDb - this.smoothedGainDb);
      } else {
        this.smoothedGainDb += releaseCoeff * (targetGainDb - this.smoothedGainDb);
      }

      // Apply gain
      const gainLin = dbToLinear(this.smoothedGainDb) * makeupGain;

      let wetL = dryL * gainLin;
      let wetR = dryR * gainLin;

      // Opto mode: subtle soft-clip on output
      if (isOpto) {
        wetL = softClip(wetL);
        wetR = softClip(wetR);
      }

      // Dry/wet mix
      outLeft[i] = dryL * (1 - effMix) + wetL * effMix;
      outRight[i] = dryR * (1 - effMix) + wetR * effMix;
    }

    return true;
  }
}

registerProcessor('compressor-processor', CompressorProcessor);
