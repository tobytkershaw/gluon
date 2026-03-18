// src/audio/stereo-worklet.ts
// Pure-JS stereo imaging processor with width and pan-law modes, running in an AudioWorklet.
// No WASM needed — the DSP is straightforward M/S encoding + Haas effect.

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;

interface StereoPatch {
  width: number;
  mid_gain: number;
  side_gain: number;
  delay: number;
}

// Mode indices
const MODE_WIDTH = 0;
const MODE_PAN_LAW = 1;

type ScheduledEvent =
  | { type: 'set-mode'; time?: number; seq: number; fence?: number; mode: number }
  | { type: 'set-patch'; time?: number; seq: number; fence?: number; patch: StereoPatch }
  | { type: 'clear-scheduled'; time?: undefined; seq: number; fence: number }
  | { type: 'destroy'; time?: undefined; seq: number; fence?: number };

// --- DSP helpers ---

/** Map normalized 0-1 gain to dB range (-12 to +12), then to linear. */
function gainToLinear(norm: number): number {
  const dB = -12 + norm * 24; // 0 -> -12dB, 0.5 -> 0dB, 1 -> +12dB
  return Math.pow(10, dB / 20);
}

/** Max delay in samples for 30ms Haas effect. */
function maxDelaySamples(): number {
  return Math.ceil(sampleRate * 0.030); // 30ms
}

class StereoProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): Array<{ name: string; defaultValue: number; minValue: number; maxValue: number; automationRate: string }> {
    return [
      { name: 'mod-width', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-mid_gain', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-side_gain', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-delay', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'min-fence', defaultValue: 0, minValue: 0, maxValue: 1e9, automationRate: 'k-rate' },
    ];
  }

  private currentPatch: StereoPatch = {
    width: 0.5,
    mid_gain: 0.5,
    side_gain: 0.5,
    delay: 0.0,
  };

  private mode = MODE_WIDTH;
  private queue: ScheduledEvent[] = [];
  private seq = 0;
  private destroyed = false;
  private minFence = 0;

  // Haas delay circular buffer (right channel)
  private delayBuffer: Float32Array;
  private delayWriteIndex = 0;

  // Pan-law mode: one-pole filter state for low/high band split
  private lpStateL = 0;
  private lpStateR = 0;

  constructor() {
    super();
    // Allocate delay buffer for max 30ms
    const maxSamples = Math.ceil(48000 * 0.030); // use 48kHz as safe max at construction
    this.delayBuffer = new Float32Array(maxSamples + 1);

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
    const modWidth = parameters['mod-width'][0];
    const modMidGain = parameters['mod-mid_gain'][0];
    const modSideGain = parameters['mod-side_gain'][0];
    const modDelay = parameters['mod-delay'][0];

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
    const effWidth = clamp01(this.currentPatch.width + modWidth);
    const effMidGain = clamp01(this.currentPatch.mid_gain + modMidGain);
    const effSideGain = clamp01(this.currentPatch.side_gain + modSideGain);
    const effDelay = clamp01(this.currentPatch.delay + modDelay);

    // Map normalized values to DSP values
    const midGainLin = gainToLinear(effMidGain);
    const sideGainLin = gainToLinear(effSideGain);

    const frameCount = inLeft.length;

    if (this.mode === MODE_WIDTH) {
      // --- Width mode: M/S processing + Haas effect ---

      // Width: 0=mono, 0.5=original, 1=wide. Scale side signal.
      // Map 0-1 to 0-2 multiplier: 0->0 (mono), 0.5->1 (original), 1->2 (wide)
      const widthScale = effWidth * 2;

      // Haas delay in samples (0-1 maps to 0-30ms)
      const delaySamples = effDelay * maxDelaySamples();
      const delayInt = Math.floor(delaySamples);
      const delayFrac = delaySamples - delayInt;
      const bufLen = this.delayBuffer.length;

      for (let i = 0; i < frameCount; i++) {
        const dryL = inLeft[i];
        const dryR = inRight ? inRight[i] : dryL;

        // Encode to M/S
        let mid = (dryL + dryR) * 0.5;
        let side = (dryL - dryR) * 0.5;

        // Apply mid/side gains
        mid *= midGainLin;
        side *= sideGainLin;

        // Apply width scaling to side
        side *= widthScale;

        // Decode back to L/R
        let wetL = mid + side;
        let wetR = mid - side;

        // Haas effect: delay right channel
        if (delaySamples > 0) {
          // Write current right sample to delay buffer
          this.delayBuffer[this.delayWriteIndex] = wetR;

          // Read delayed sample (linear interpolation)
          let readIndex = this.delayWriteIndex - delayInt;
          if (readIndex < 0) readIndex += bufLen;
          let readIndexPrev = readIndex - 1;
          if (readIndexPrev < 0) readIndexPrev += bufLen;

          const s0 = this.delayBuffer[readIndex];
          const s1 = this.delayBuffer[readIndexPrev];
          wetR = s0 + (s1 - s0) * delayFrac;

          this.delayWriteIndex = (this.delayWriteIndex + 1) % bufLen;
        }

        outLeft[i] = wetL;
        outRight[i] = wetR;
      }
    } else {
      // --- Pan Law mode: Frequency-dependent panning ---
      // Low frequencies stay centered (mono-compatible), high frequencies follow width.

      // One-pole crossover at ~300Hz
      const crossoverFreq = 300;
      const lpCoeff = 1 - Math.exp(-2 * Math.PI * crossoverFreq / sampleRate);

      // Width controls high-frequency spatial placement
      // 0=mono, 0.5=original, 1=wide
      const widthScale = effWidth * 2;

      for (let i = 0; i < frameCount; i++) {
        const dryL = inLeft[i];
        const dryR = inRight ? inRight[i] : dryL;

        // Split into low and high bands via one-pole lowpass
        this.lpStateL += lpCoeff * (dryL - this.lpStateL);
        this.lpStateR += lpCoeff * (dryR - this.lpStateR);

        const lowL = this.lpStateL;
        const lowR = this.lpStateR;
        const highL = dryL - lowL;
        const highR = dryR - lowR;

        // Low frequencies: encode M/S, apply gains, keep centered (side=0 for mono compat)
        let lowMid = (lowL + lowR) * 0.5;
        lowMid *= midGainLin;
        // Low band stays mono (centered) — no side contribution
        const centeredLowL = lowMid;
        const centeredLowR = lowMid;

        // High frequencies: encode M/S, apply gains + width
        let highMid = (highL + highR) * 0.5;
        let highSide = (highL - highR) * 0.5;
        highMid *= midGainLin;
        highSide *= sideGainLin * widthScale;
        const wideHighL = highMid + highSide;
        const wideHighR = highMid - highSide;

        // Recombine
        outLeft[i] = centeredLowL + wideHighL;
        outRight[i] = centeredLowR + wideHighR;
      }
    }

    return true;
  }
}

registerProcessor('stereo-processor', StereoProcessor);
