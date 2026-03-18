// src/audio/chorus-worklet.ts
// Pure-JS chorus/flanger/phaser processor, running in an AudioWorklet.
// No WASM needed — the DSP uses modulated delay lines and allpass filters.

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;

interface ChorusPatch {
  rate: number;
  depth: number;
  feedback: number;
  mix: number;
  stereo: number;
}

// Mode indices
const MODE_CHORUS = 0;
const MODE_FLANGER = 1;
const MODE_PHASER = 2;

type ScheduledEvent =
  | { type: 'set-mode'; time?: number; seq: number; fence?: number; mode: number }
  | { type: 'set-patch'; time?: number; seq: number; fence?: number; patch: ChorusPatch }
  | { type: 'clear-scheduled'; time?: undefined; seq: number; fence: number }
  | { type: 'destroy'; time?: undefined; seq: number; fence?: number };

// --- DSP helpers ---

/** Map normalized rate (0-1) to LFO frequency in Hz (log scale: 0.01-10 Hz) */
function rateToHz(norm: number): number {
  return 0.01 * Math.pow(1000, norm);
}

/** Two-pi constant */
const TWO_PI = 2 * Math.PI;

/** Maximum delay buffer length in samples (~100ms at 96kHz) */
const MAX_DELAY_SAMPLES = 9600;

/** Number of allpass stages for phaser mode */
const ALLPASS_STAGES = 6;

/** Number of chorus taps */
const CHORUS_TAPS = 4;

class ChorusProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): Array<{ name: string; defaultValue: number; minValue: number; maxValue: number; automationRate: string }> {
    return [
      { name: 'mod-rate', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-depth', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-feedback', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-mix', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-stereo', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'min-fence', defaultValue: 0, minValue: 0, maxValue: 1e9, automationRate: 'k-rate' },
    ];
  }

  private currentPatch: ChorusPatch = {
    rate: 0.3,
    depth: 0.5,
    feedback: 0.0,
    mix: 0.5,
    stereo: 0.5,
  };

  private mode = MODE_CHORUS;
  private queue: ScheduledEvent[] = [];
  private seq = 0;
  private destroyed = false;
  private minFence = 0;

  // LFO state — phase in radians [0, 2pi)
  private lfoPhase = 0;

  // Delay buffers (stereo)
  private delayBufferL: Float32Array;
  private delayBufferR: Float32Array;
  private writePos = 0;

  // Feedback state
  private feedbackL = 0;
  private feedbackR = 0;

  // Allpass filter state for phaser mode (per channel, per stage)
  private allpassStateL: Float32Array; // one state per stage
  private allpassStateR: Float32Array;

  constructor() {
    super();
    this.delayBufferL = new Float32Array(MAX_DELAY_SAMPLES);
    this.delayBufferR = new Float32Array(MAX_DELAY_SAMPLES);
    this.allpassStateL = new Float32Array(ALLPASS_STAGES);
    this.allpassStateR = new Float32Array(ALLPASS_STAGES);

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

  /** Read from delay buffer with linear interpolation */
  private readDelay(buffer: Float32Array, delaySamples: number): number {
    const bufLen = buffer.length;
    const readPos = this.writePos - delaySamples;
    const readPosWrapped = ((readPos % bufLen) + bufLen) % bufLen;
    const idx0 = Math.floor(readPosWrapped);
    const idx1 = (idx0 + 1) % bufLen;
    const frac = readPosWrapped - idx0;
    return buffer[idx0] * (1 - frac) + buffer[idx1] * frac;
  }

  /** First-order allpass filter: y[n] = -coeff * x[n] + state; state = x[n] + coeff * y[n] */
  private allpass(x: number, coeff: number, stateArr: Float32Array, stageIdx: number): number {
    const state = stateArr[stageIdx];
    const y = -coeff * x + state;
    stateArr[stageIdx] = x + coeff * y;
    return y;
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
    const modRate = parameters['mod-rate'][0];
    const modDepth = parameters['mod-depth'][0];
    const modFeedback = parameters['mod-feedback'][0];
    const modMix = parameters['mod-mix'][0];
    const modStereo = parameters['mod-stereo'][0];

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
    const effRate = clamp01(this.currentPatch.rate + modRate);
    const effDepth = clamp01(this.currentPatch.depth + modDepth);
    const effFeedback = clamp01(this.currentPatch.feedback + modFeedback);
    const effMix = clamp01(this.currentPatch.mix + modMix);
    const effStereo = clamp01(this.currentPatch.stereo + modStereo);

    const lfoFreqHz = rateToHz(effRate);
    const lfoIncrement = (TWO_PI * lfoFreqHz) / sampleRate;
    // Stereo phase offset: 0-180 degrees
    const stereoOffsetRad = effStereo * Math.PI;

    const frameCount = inLeft.length;
    const bufLen = this.delayBufferL.length;
    const isChorus = this.mode === MODE_CHORUS;
    const isFlanger = this.mode === MODE_FLANGER;
    const isPhaser = this.mode === MODE_PHASER;

    for (let i = 0; i < frameCount; i++) {
      const dryL = inLeft[i];
      const dryR = inRight ? inRight[i] : dryL;

      // LFO values (sine) for left and right channels
      const lfoL = Math.sin(this.lfoPhase);
      const lfoR = Math.sin(this.lfoPhase + stereoOffsetRad);

      let wetL = 0;
      let wetR = 0;

      if (isChorus) {
        // --- Chorus mode ---
        // 2-4 modulated delay taps (2-20ms range)
        // Each tap has an independent LFO phase offset
        const minDelaySec = 0.002; // 2ms
        const maxDelaySec = 0.020; // 20ms
        const centerDelay = (minDelaySec + maxDelaySec) / 2;
        const depthRange = (maxDelaySec - minDelaySec) / 2;

        // Write input + feedback to delay buffer
        this.delayBufferL[this.writePos] = dryL + this.feedbackL * effFeedback;
        this.delayBufferR[this.writePos] = dryR + this.feedbackR * effFeedback;

        let sumL = 0;
        let sumR = 0;
        for (let tap = 0; tap < CHORUS_TAPS; tap++) {
          const tapPhaseOffset = (tap / CHORUS_TAPS) * TWO_PI;
          const tapLfoL = Math.sin(this.lfoPhase + tapPhaseOffset);
          const tapLfoR = Math.sin(this.lfoPhase + tapPhaseOffset + stereoOffsetRad);

          const delayL = (centerDelay + tapLfoL * depthRange * effDepth) * sampleRate;
          const delayR = (centerDelay + tapLfoR * depthRange * effDepth) * sampleRate;

          sumL += this.readDelay(this.delayBufferL, delayL);
          sumR += this.readDelay(this.delayBufferR, delayR);
        }
        wetL = sumL / CHORUS_TAPS;
        wetR = sumR / CHORUS_TAPS;
        this.feedbackL = wetL;
        this.feedbackR = wetR;

      } else if (isFlanger) {
        // --- Flanger mode ---
        // Single modulated delay (0.5-5ms) with feedback
        const minDelaySec = 0.0005; // 0.5ms
        const maxDelaySec = 0.005;  // 5ms
        const centerDelay = (minDelaySec + maxDelaySec) / 2;
        const depthRange = (maxDelaySec - minDelaySec) / 2;

        // Write input + feedback to delay buffer
        this.delayBufferL[this.writePos] = dryL + this.feedbackL * effFeedback;
        this.delayBufferR[this.writePos] = dryR + this.feedbackR * effFeedback;

        const delayL = (centerDelay + lfoL * depthRange * effDepth) * sampleRate;
        const delayR = (centerDelay + lfoR * depthRange * effDepth) * sampleRate;

        wetL = this.readDelay(this.delayBufferL, delayL);
        wetR = this.readDelay(this.delayBufferR, delayR);
        // Clamp feedback to prevent runaway
        this.feedbackL = Math.max(-1, Math.min(1, wetL));
        this.feedbackR = Math.max(-1, Math.min(1, wetR));

      } else if (isPhaser) {
        // --- Phaser mode ---
        // Chain of 6 first-order allpass filters with LFO-modulated coefficient
        // Map LFO to allpass coefficient range (controls notch frequencies)
        const minCoeff = 0.1;
        const maxCoeff = 0.9;
        const coeffRange = (maxCoeff - minCoeff) / 2;
        const coeffCenter = (minCoeff + maxCoeff) / 2;

        const coeffL = coeffCenter + lfoL * coeffRange * effDepth;
        const coeffR = coeffCenter + lfoR * coeffRange * effDepth;

        // Feed input + feedback through allpass chain
        let apL = dryL + this.feedbackL * effFeedback;
        let apR = dryR + this.feedbackR * effFeedback;

        for (let stage = 0; stage < ALLPASS_STAGES; stage++) {
          apL = this.allpass(apL, coeffL, this.allpassStateL, stage);
          apR = this.allpass(apR, coeffR, this.allpassStateR, stage);
        }

        wetL = apL;
        wetR = apR;
        // Clamp feedback to prevent runaway
        this.feedbackL = Math.max(-1, Math.min(1, wetL));
        this.feedbackR = Math.max(-1, Math.min(1, wetR));
      }

      // Advance write position for delay-based modes
      if (isChorus || isFlanger) {
        this.writePos = (this.writePos + 1) % bufLen;
      }

      // Advance LFO phase
      this.lfoPhase += lfoIncrement;
      if (this.lfoPhase >= TWO_PI) {
        this.lfoPhase -= TWO_PI;
      }

      // Dry/wet mix
      outLeft[i] = dryL * (1 - effMix) + wetL * effMix;
      outRight[i] = dryR * (1 - effMix) + wetR * effMix;
    }

    return true;
  }
}

registerProcessor('chorus-processor', ChorusProcessor);
