// src/audio/marbles-worklet.ts
// Marbles AudioWorklet processor — pure JS controlled randomness modulator.
// Based on Mutable Instruments Marbles: random voltage/gate generator with
// probability distribution shaping, quantization, and deja vu loop memory.
//
// Generates modulation waveforms — output goes to AudioParams on target worklets,
// not to speakers. The audio output IS the modulation signal (-1..+1).

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;

interface MarblesPatch {
  rate: number;
  spread: number;
  bias: number;
  steps: number;
  deja_vu: number;
  length: number;
}

type ProcessorCommand =
  | { type: 'set-patch'; patch: MarblesPatch }
  | { type: 'set-mode'; mode: number }
  | { type: 'clear-scheduled' }
  | { type: 'destroy' }
  | { type: 'pause' }
  | { type: 'resume' };

// --- xoshiro128** PRNG (fast, good quality, 32-bit) ---

class Xoshiro128ss {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    // SplitMix32 to expand seed into 4 state words (chained from prior z)
    let z = (seed + 0x9e3779b9) | 0;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    this.s0 = (z ^ (z >>> 16)) | 0;
    z = (z + 0x9e3779b9) | 0;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    this.s1 = (z ^ (z >>> 16)) | 0;
    z = (z + 0x9e3779b9) | 0;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    this.s2 = (z ^ (z >>> 16)) | 0;
    z = (z + 0x9e3779b9) | 0;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    this.s3 = (z ^ (z >>> 16)) | 0;
  }

  /** Returns a float in [0, 1) */
  next(): number {
    const result = Math.imul(this.rotl(Math.imul(this.s1, 5), 7), 9);
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = this.rotl(this.s3, 11);
    return (result >>> 0) / 4294967296;
  }

  private rotl(x: number, k: number): number {
    return (x << k) | (x >>> (32 - k));
  }
}

// Mode indices
const MODE_VOLTAGE = 0;
const MODE_GATE = 1;
const MODE_BOTH = 2;

// Parameter smoothing time constant (~5ms at 48kHz)
const SMOOTH_COEFF_BASE = 0.005;

class MarblesProcessor extends AudioWorkletProcessor {
  private destroyed = false;
  private paused = false;
  private rng: Xoshiro128ss;

  // Current params (updated via messages)
  private rate = 0.5;
  private spread = 0.5;
  private bias = 0.5;
  private steps = 0.0;
  private dejaVu = 0.0;
  private length = 0.25;
  private mode = MODE_VOLTAGE;

  // Smoothed params for audio-rate interpolation
  private smoothRate = 0.5;
  private smoothSpread = 0.5;
  private smoothBias = 0.5;
  private smoothSteps = 0.0;
  private smoothDejaVu = 0.0;
  private smoothLength = 0.25;

  // Smoothing coefficient (computed from sample rate)
  private smoothCoeff: number;

  // Phase accumulator for rate-based clocking
  private phase = 0;

  // Current output value (voltage mode)
  private currentVoltage = 0;
  private targetVoltage = 0;

  // Gate state
  private gateOpen = false;
  private gateSamplesRemaining = 0;

  // Deja vu loop buffer (stores generated values for replay)
  private loopBuffer: Float32Array;
  private loopGateBuffer: Float32Array;
  private loopWritePos = 0;
  private loopLength = 4;  // effective length in steps
  private loopFilled = 0;  // how many steps have been written
  private loopReadPos = 0; // current read position for replay

  // Independent gate loop positions (gate pipeline needs its own state)
  private gateLoopWritePos = 0;
  private gateLoopReadPos = 0;

  constructor() {
    super();
    this.rng = new Xoshiro128ss(Date.now() ^ (Math.random() * 0xffffffff));
    this.loopBuffer = new Float32Array(16);
    this.loopGateBuffer = new Float32Array(16);
    this.smoothCoeff = 1.0 - Math.exp(-1.0 / (SMOOTH_COEFF_BASE * sampleRate));

    this.port.onmessage = (event: MessageEvent<ProcessorCommand>) => {
      const data = event.data;
      switch (data.type) {
        case 'set-patch':
          this.rate = data.patch.rate;
          this.spread = data.patch.spread;
          this.bias = data.patch.bias;
          this.steps = data.patch.steps;
          this.dejaVu = data.patch.deja_vu;
          this.length = data.patch.length;
          break;
        case 'set-mode':
          this.mode = Math.max(0, Math.min(2, data.mode));
          break;
        case 'clear-scheduled':
          // No event queue — no-op
          break;
        case 'destroy':
          this.destroyed = true;
          break;
        case 'pause':
          this.paused = true;
          break;
        case 'resume':
          this.paused = false;
          break;
      }
    };
    this.port.postMessage({ type: 'ready' });
  }

  /** Map normalized rate (0-1) to frequency in Hz (log scale: 0.05-100 Hz) */
  private rateToHz(norm: number): number {
    return 0.05 * Math.pow(2000, norm);
  }

  /**
   * Generate a random value shaped by spread.
   * Spread controls distribution shape (matches hardware behavior):
   * - 0.0: constant (center value)
   * - ~0.25: bell-shaped (values concentrate toward center)
   * - ~0.5: uniform (equal probability across range)
   * - ~0.75-1.0: extreme values favored (bimodal)
   */
  private generateShaped(spread: number): number {
    if (spread < 0.01) {
      // Constant output
      return 0.5;
    }

    if (spread < 0.4) {
      // Bell-shaped: sum multiple uniform samples (approaches Gaussian via CLT)
      // Narrower bell as spread approaches 0
      const width = spread / 0.4; // 0..1
      const sum = (this.rng.next() + this.rng.next() + this.rng.next()) / 3;
      // Blend between constant center (0.5) and bell-shaped
      return 0.5 + (sum - 0.5) * width;
    }

    if (spread < 0.65) {
      // Uniform distribution
      return this.rng.next();
    }

    // Bimodal: extreme values favored
    // Use beta-like distribution that pushes toward 0 and 1
    const intensity = (spread - 0.65) / 0.35; // 0..1
    const raw = this.rng.next();
    // Power curve toward extremes: push values away from center
    const sign = raw < 0.5 ? -1 : 1;
    const centered = Math.abs(raw - 0.5) * 2; // 0..1
    const shaped = Math.pow(centered, 1.0 - intensity * 0.8);
    return 0.5 + sign * shaped * 0.5;
  }

  /**
   * Apply bias: skew distribution toward low or high values.
   * bias=0.5 is symmetric, <0.5 favors low, >0.5 favors high.
   */
  private applyBias(value: number, bias: number): number {
    if (Math.abs(bias - 0.5) < 0.01) return value;
    // Map bias to power curve exponent
    // bias 0 -> exponent ~4 (strongly favor low)
    // bias 0.5 -> exponent 1 (no change)
    // bias 1 -> exponent ~0.25 (strongly favor high)
    const exponent = Math.pow(4, 1 - 2 * bias);
    return Math.pow(value, exponent);
  }

  /**
   * Quantize value to scale degrees.
   * steps=0: smooth continuous output
   * steps~0.5: chromatic quantization (12 levels per octave equivalent)
   * steps=1: only octaves (2 levels)
   */
  private quantize(value: number, steps: number): number {
    if (steps < 0.01) return value;

    // Map steps to number of discrete levels
    // 0 = continuous, 0.5 = 12 levels (chromatic), 1.0 = 2 levels (octaves)
    let numLevels: number;
    if (steps <= 0.5) {
      // 0->continuous, 0.5->12 levels
      numLevels = Math.round(2 + (1 - steps * 2) * 30); // 32 down to 2
      // Actually: low steps = many levels (nearly continuous), mid = 12
      numLevels = Math.max(2, Math.round(32 - steps * 40));
    } else {
      // 0.5->12 levels, 1.0->2 levels
      const t = (steps - 0.5) * 2; // 0..1
      numLevels = Math.max(2, Math.round(12 - t * 10));
    }

    const quantized = Math.round(value * (numLevels - 1)) / (numLevels - 1);
    // Crossfade: smoothly blend from continuous to quantized
    const blend = Math.min(1, steps * 4); // reaches full quantization by steps=0.25
    return value + (quantized - value) * blend;
  }

  /** Get the effective loop buffer length (1-16) from normalized param */
  private getLoopLength(): number {
    return Math.max(1, Math.min(16, Math.round(1 + this.smoothLength * 15)));
  }

  /**
   * Process deja vu for a newly generated value.
   * Deja vu has two halves (matching hardware behavior):
   * - 0.0 to 0.5: increasing probability of replaying past values (0.5 = locked loop)
   * - 0.5 to 1.0: random permutations within the stored loop
   */
  private processDejaVu(freshValue: number, bufferIndex: number): number {
    const dv = this.smoothDejaVu;
    const len = this.getLoopLength();

    if (dv < 0.01) {
      // Fully random — write to buffer and return fresh value
      this.loopBuffer[this.loopWritePos % len] = freshValue;
      this.loopWritePos = (this.loopWritePos + 1) % len;
      if (this.loopFilled < len) this.loopFilled++;
      return freshValue;
    }

    if (this.loopFilled === 0) {
      // Buffer empty — must write fresh value
      this.loopBuffer[0] = freshValue;
      this.loopFilled = 1;
      this.loopWritePos = 1;
      this.loopReadPos = 0;
      return freshValue;
    }

    if (dv <= 0.5) {
      // First half: probability of replay increases from 0 to 1
      const replayProb = dv * 2; // 0..1
      if (this.rng.next() < replayProb && this.loopFilled > 0) {
        // Replay from buffer at current read position
        const readPos = this.loopReadPos % Math.min(len, this.loopFilled);
        const value = this.loopBuffer[readPos];
        this.loopReadPos = (readPos + 1) % Math.min(len, this.loopFilled);
        return value;
      } else {
        // Fresh value — write to buffer
        this.loopBuffer[this.loopWritePos % len] = freshValue;
        this.loopWritePos = (this.loopWritePos + 1) % len;
        if (this.loopFilled < len) this.loopFilled++;
        return freshValue;
      }
    } else {
      // Second half: locked loop with increasing random permutation
      const permutationProb = (dv - 0.5) * 2; // 0..1
      const effectiveLen = Math.min(len, this.loopFilled);
      if (effectiveLen === 0) return freshValue;

      if (this.rng.next() < permutationProb) {
        // Random jump within the loop
        const randomPos = Math.floor(this.rng.next() * effectiveLen);
        this.loopReadPos = (randomPos + 1) % effectiveLen;
        return this.loopBuffer[randomPos];
      } else {
        // Sequential replay
        const readPos = this.loopReadPos % effectiveLen;
        this.loopReadPos = (readPos + 1) % effectiveLen;
        return this.loopBuffer[readPos];
      }
    }
  }

  /** Generate a voltage value through the full pipeline */
  private generateVoltage(): number {
    // 1. Generate distribution-shaped random value
    const raw = this.generateShaped(this.smoothSpread);

    // 2. Apply bias
    const biased = this.applyBias(raw, this.smoothBias);

    // 3. Process through deja vu loop
    const looped = this.processDejaVu(biased, 0);

    // 4. Apply quantization
    // Quantize in unipolar space, then convert
    const quantized = this.quantize(looped, this.smoothSteps);
    return quantized * 2 - 1;
  }

  /** Generate a gate trigger decision */
  private generateGate(): boolean {
    const dv = this.smoothDejaVu;
    const len = this.getLoopLength();

    // Generate raw gate decision
    const rawDecision = this.rng.next();

    // Process through deja vu gate buffer (uses dedicated gate loop positions)
    let gateValue: number;
    if (dv < 0.01 || this.loopFilled === 0) {
      gateValue = rawDecision;
      this.loopGateBuffer[this.gateLoopWritePos % len] = gateValue;
      this.gateLoopWritePos = (this.gateLoopWritePos + 1) % len;
    } else if (dv <= 0.5) {
      const replayProb = dv * 2;
      if (this.rng.next() < replayProb && this.loopFilled > 0) {
        const effectiveLen = Math.min(len, this.loopFilled);
        gateValue = this.loopGateBuffer[this.gateLoopReadPos % effectiveLen];
        this.gateLoopReadPos = (this.gateLoopReadPos + 1) % effectiveLen;
      } else {
        gateValue = rawDecision;
        this.loopGateBuffer[this.gateLoopWritePos % len] = gateValue;
        this.gateLoopWritePos = (this.gateLoopWritePos + 1) % len;
      }
    } else {
      const permutationProb = (dv - 0.5) * 2;
      const effectiveLen = Math.min(len, this.loopFilled);
      if (effectiveLen > 0 && this.rng.next() < permutationProb) {
        const randomPos = Math.floor(this.rng.next() * effectiveLen);
        this.gateLoopReadPos = (randomPos + 1) % effectiveLen;
        gateValue = this.loopGateBuffer[randomPos];
      } else {
        const readPos = this.gateLoopReadPos % Math.max(1, effectiveLen);
        this.gateLoopReadPos = (readPos + 1) % Math.max(1, effectiveLen);
        gateValue = this.loopGateBuffer[readPos];
      }
    }

    // Bias controls gate probability: 0.5 = 50%, <0.5 = fewer, >0.5 = more
    return gateValue < this.smoothBias;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0];
    if (!output?.length) return true;
    const left = output[0];
    const right = output[1];

    if (this.destroyed) return false;

    if (this.paused) {
      left.fill(0);
      if (right) right.fill(0);
      return true;
    }

    // Smooth parameters (one-pole filter per block)
    const sc = this.smoothCoeff;
    this.smoothRate += (this.rate - this.smoothRate) * sc;
    this.smoothSpread += (this.spread - this.smoothSpread) * sc;
    this.smoothBias += (this.bias - this.smoothBias) * sc;
    this.smoothSteps += (this.steps - this.smoothSteps) * sc;
    this.smoothDejaVu += (this.dejaVu - this.smoothDejaVu) * sc;
    this.smoothLength += (this.length - this.smoothLength) * sc;

    const freqHz = this.rateToHz(this.smoothRate);
    const phaseIncrement = freqHz / sampleRate;

    // Gate pulse duration: 1ms or half the clock period, whichever is shorter
    const clockPeriodSamples = sampleRate / freqHz;
    const gatePulseSamples = Math.max(1, Math.min(
      Math.floor(sampleRate * 0.001),
      Math.floor(clockPeriodSamples * 0.5),
    ));

    // Update effective loop length
    this.loopLength = this.getLoopLength();

    const frames = left.length;

    for (let i = 0; i < frames; i++) {
      this.phase += phaseIncrement;

      // Clock tick: when phase wraps past 1.0
      if (this.phase >= 1.0) {
        this.phase -= 1.0;

        if (this.mode === MODE_VOLTAGE || this.mode === MODE_BOTH) {
          this.targetVoltage = this.generateVoltage();
        }

        if (this.mode === MODE_GATE || this.mode === MODE_BOTH) {
          if (this.generateGate()) {
            this.gateOpen = true;
            this.gateSamplesRemaining = gatePulseSamples;
          }
        }
      }

      // Smooth transition to target voltage (one-pole ~5ms)
      this.currentVoltage += (this.targetVoltage - this.currentVoltage) * sc;

      // Gate countdown
      if (this.gateOpen) {
        this.gateSamplesRemaining--;
        if (this.gateSamplesRemaining <= 0) {
          this.gateOpen = false;
        }
      }

      // Output based on mode
      if (this.mode === MODE_VOLTAGE) {
        left[i] = this.currentVoltage;
        if (right) right[i] = this.currentVoltage;
      } else if (this.mode === MODE_GATE) {
        const gateOut = this.gateOpen ? 1.0 : 0.0;
        left[i] = gateOut;
        if (right) right[i] = gateOut;
      } else {
        // MODE_BOTH: voltage on left, gate on right
        left[i] = this.currentVoltage;
        if (right) right[i] = this.gateOpen ? 1.0 : 0.0;
      }
    }

    return true;
  }
}

registerProcessor('marbles-processor', MarblesProcessor);
