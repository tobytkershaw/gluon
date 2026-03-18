// src/audio/warps-worklet.ts
// Pure-JS signal combiner worklet emulating Mutable Instruments Warps.
// Implements 4 algorithms: crossfade, fold, ring mod, frequency shift.
// No WASM needed — the DSP is straightforward math.

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;

interface WarpsPatch {
  algorithm: number;
  timbre: number;
  level: number;
}

// Model indices
const MODEL_CROSSFADE = 0;
const MODEL_FOLD = 1;
const MODEL_RING = 2;
const MODEL_FREQ_SHIFT = 3;

type ScheduledEvent =
  | { type: 'set-model'; time?: number; seq: number; fence?: number; model: number }
  | { type: 'set-patch'; time?: number; seq: number; fence?: number; patch: WarpsPatch }
  | { type: 'clear-scheduled'; time?: undefined; seq: number; fence: number }
  | { type: 'destroy'; time?: undefined; seq: number; fence?: number };

class WarpsProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): Array<{ name: string; defaultValue: number; minValue: number; maxValue: number; automationRate: string }> {
    return [
      { name: 'mod-algorithm', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-timbre', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-level', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'min-fence', defaultValue: 0, minValue: 0, maxValue: 1e9, automationRate: 'k-rate' },
    ];
  }

  private currentPatch: WarpsPatch = {
    algorithm: 0.5,
    timbre: 0.5,
    level: 0.5,
  };

  private model = MODEL_CROSSFADE;
  private queue: ScheduledEvent[] = [];
  private seq = 0;
  private destroyed = false;
  private minFence = 0;

  // Frequency shift state (Hilbert transform approximation)
  private hilbertPhase = 0;
  // Allpass filter state for Hilbert transform (4-stage)
  private allpassStateI: number[] = [0, 0, 0, 0];
  private allpassStateQ: number[] = [0, 0, 0, 0];

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
      case 'set-model':
        this.model = event.model;
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
    const modAlgorithm = parameters['mod-algorithm'][0];
    const modTimbre = parameters['mod-timbre'][0];
    const modLevel = parameters['mod-level'][0];

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
    const effAlgorithm = clamp01(this.currentPatch.algorithm + modAlgorithm);
    const effTimbre = clamp01(this.currentPatch.timbre + modTimbre);
    const effLevel = clamp01(this.currentPatch.level + modLevel);

    const frameCount = inLeft.length;
    const model = this.model;

    for (let i = 0; i < frameCount; i++) {
      const carrier = inLeft[i];
      const carrierR = inRight ? inRight[i] : carrier;

      // Internal modulator: simple sine derived from timbre for single-input mode
      // The level param controls the modulator amplitude
      const modulator = effLevel * Math.sin(this.hilbertPhase);

      let outL = 0;
      let outR = 0;

      switch (model) {
        case MODEL_CROSSFADE: {
          // Crossfade between dry carrier and modulated signal
          // algorithm controls the blend position
          const blend = effAlgorithm;
          const modulated = carrier * (1 - effTimbre) + carrier * modulator * effTimbre;
          outL = carrier * (1 - blend) + modulated * blend;
          outR = carrierR * (1 - blend) + (carrierR * (1 - effTimbre) + carrierR * modulator * effTimbre) * blend;
          break;
        }

        case MODEL_FOLD: {
          // Wavefolding — drive the signal through a folding waveshaper
          // timbre controls fold depth, algorithm controls pre-gain
          const preGain = 1 + effAlgorithm * 7; // 1x to 8x gain
          const foldDepth = 1 + effTimbre * 4; // number of folds
          let sigL = carrier * preGain * (1 + effLevel);
          let sigR = carrierR * preGain * (1 + effLevel);
          // Triangle fold waveshaper
          for (let f = 0; f < foldDepth; f++) {
            sigL = Math.abs(sigL);
            sigL = sigL > 1 ? 2 - sigL : sigL;
            sigL = sigL < -1 ? -2 - sigL : sigL;
            sigR = Math.abs(sigR);
            sigR = sigR > 1 ? 2 - sigR : sigR;
            sigR = sigR < -1 ? -2 - sigR : sigR;
          }
          outL = sigL;
          outR = sigR;
          break;
        }

        case MODEL_RING: {
          // Ring modulation — multiply carrier by modulator
          // algorithm blends from AM (offset) to pure ring mod
          // timbre controls internal osc frequency
          const amOffset = 1 - effAlgorithm; // 1 = AM, 0 = ring mod
          const ringMod = (amOffset + modulator) * effLevel + (1 - effLevel);
          outL = carrier * ringMod;
          outR = carrierR * ringMod;
          break;
        }

        case MODEL_FREQ_SHIFT: {
          // Frequency shifting via Hilbert transform approximation
          // algorithm controls shift amount, timbre controls feedback
          const shiftHz = (effAlgorithm - 0.5) * 1000; // -500 to +500 Hz
          const phaseInc = (2 * Math.PI * shiftHz) / sampleRate;

          // Simple allpass-based Hilbert approximation
          // Use a chain of allpass filters to create ~90 degree phase shift
          const ALLPASS_COEFFS = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737];

          let xI = carrier;
          let xQ = carrier;

          for (let s = 0; s < 4; s++) {
            const c = ALLPASS_COEFFS[s];
            const outI = c * (xI - this.allpassStateI[s]) + this.allpassStateI[s];
            this.allpassStateI[s] = xI;
            xI = outI;

            // Q path with different coefficients for quadrature
            const cQ = ALLPASS_COEFFS[(s + 2) % 4];
            const outQ = cQ * (xQ - this.allpassStateQ[s]) + this.allpassStateQ[s];
            this.allpassStateQ[s] = xQ;
            xQ = outQ;
          }

          // Complex multiply with shift oscillator
          const cosPhase = Math.cos(this.hilbertPhase);
          const sinPhase = Math.sin(this.hilbertPhase);
          const shifted = xI * cosPhase - xQ * sinPhase;

          // Mix dry/shifted based on level
          const wetAmount = effLevel;
          outL = carrier * (1 - wetAmount) + shifted * wetAmount;
          outR = carrierR * (1 - wetAmount) + shifted * wetAmount;

          this.hilbertPhase += phaseInc;
          // Keep phase in reasonable range to avoid precision loss
          if (this.hilbertPhase > 2 * Math.PI) this.hilbertPhase -= 2 * Math.PI;
          if (this.hilbertPhase < -2 * Math.PI) this.hilbertPhase += 2 * Math.PI;
          break;
        }

        default: {
          // Pass through
          outL = carrier;
          outR = carrierR;
        }
      }

      outLeft[i] = outL;
      outRight[i] = outR;
    }

    // Advance internal oscillator phase (for crossfade/ring modes)
    // Timbre controls frequency: 20Hz to 2000Hz
    if (model !== MODEL_FREQ_SHIFT) {
      const oscFreq = 20 * Math.pow(100, effTimbre);
      this.hilbertPhase += (2 * Math.PI * oscFreq * frameCount) / sampleRate;
      if (this.hilbertPhase > 2 * Math.PI) this.hilbertPhase -= 2 * Math.PI;
    }

    return true;
  }
}

registerProcessor('warps-processor', WarpsProcessor);
