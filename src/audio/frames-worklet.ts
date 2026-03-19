// src/audio/frames-worklet.ts
// Pure-JS Frames processor (quadruple VCA keyframer/mixer), running in an AudioWorklet.
// No WASM needed — the DSP is keyframe interpolation and gain application.

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare const sampleRate: number;

interface FramesPatch {
  frame: number;
  channel_1: number;
  channel_2: number;
  channel_3: number;
  channel_4: number;
  modulation: number;
  kf_count: number;
  [key: string]: number;
}

// Mode indices
const MODE_KEYFRAME = 0;
const _MODE_SEQUENCER = 1;

type ScheduledEvent =
  | { type: 'set-mode'; time?: number; seq: number; fence?: number; mode: number }
  | { type: 'set-patch'; time?: number; seq: number; fence?: number; patch: FramesPatch }
  | { type: 'clear-scheduled'; time?: undefined; seq: number; fence: number }
  | { type: 'destroy'; time?: undefined; seq: number; fence?: number };

// Maximum number of keyframes
const MAX_KEYFRAMES = 20;

// Smoothing time constant in seconds (~10ms to avoid clicks during morphing)
const SMOOTH_TIME = 0.010;

interface Keyframe {
  pos: number;
  ch1: number;
  ch2: number;
  ch3: number;
  ch4: number;
}

/** Extract keyframes from the patch params. */
function extractKeyframes(patch: FramesPatch): Keyframe[] {
  const count = Math.round(Math.max(0, Math.min(1, patch.kf_count)) * MAX_KEYFRAMES);
  const keyframes: Keyframe[] = [];
  for (let i = 0; i < count; i++) {
    keyframes.push({
      pos: patch[`kf_${i}_pos`] ?? 0,
      ch1: patch[`kf_${i}_ch1`] ?? 0,
      ch2: patch[`kf_${i}_ch2`] ?? 0,
      ch3: patch[`kf_${i}_ch3`] ?? 0,
      ch4: patch[`kf_${i}_ch4`] ?? 0,
    });
  }
  // Sort by position for correct interpolation
  keyframes.sort((a, b) => a.pos - b.pos);
  return keyframes;
}

/** Linear interpolation between two keyframes at a given position. */
function interpolateKeyframes(keyframes: Keyframe[], pos: number): [number, number, number, number] {
  if (keyframes.length === 0) return [0, 0, 0, 0];
  if (keyframes.length === 1) return [keyframes[0].ch1, keyframes[0].ch2, keyframes[0].ch3, keyframes[0].ch4];

  // Clamp position
  if (pos <= keyframes[0].pos) {
    return [keyframes[0].ch1, keyframes[0].ch2, keyframes[0].ch3, keyframes[0].ch4];
  }
  const last = keyframes[keyframes.length - 1];
  if (pos >= last.pos) {
    return [last.ch1, last.ch2, last.ch3, last.ch4];
  }

  // Find surrounding keyframes
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (pos >= a.pos && pos <= b.pos) {
      const range = b.pos - a.pos;
      if (range < 1e-9) {
        return [a.ch1, a.ch2, a.ch3, a.ch4];
      }
      // Raised cosine interpolation (smooth departure/arrival — Frames' default)
      const linearT = (pos - a.pos) / range;
      const t = 0.5 * (1 - Math.cos(linearT * Math.PI));
      return [
        a.ch1 + (b.ch1 - a.ch1) * t,
        a.ch2 + (b.ch2 - a.ch2) * t,
        a.ch3 + (b.ch3 - a.ch3) * t,
        a.ch4 + (b.ch4 - a.ch4) * t,
      ];
    }
  }

  return [last.ch1, last.ch2, last.ch3, last.ch4];
}

class FramesProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): Array<{ name: string; defaultValue: number; minValue: number; maxValue: number; automationRate: string }> {
    return [
      { name: 'mod-frame',      defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-channel_1',  defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-channel_2',  defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-channel_3',  defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-channel_4',  defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mod-modulation', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'min-fence',      defaultValue: 0, minValue: 0,  maxValue: 1e9, automationRate: 'k-rate' },
    ];
  }

  private currentPatch: FramesPatch = {
    frame: 0.0,
    channel_1: 0.0,
    channel_2: 0.0,
    channel_3: 0.0,
    channel_4: 0.0,
    modulation: 0.5,
    kf_count: 0.1, // 2 keyframes
    kf_0_pos: 0.0,
    kf_0_ch1: 0.0,
    kf_0_ch2: 0.0,
    kf_0_ch3: 0.0,
    kf_0_ch4: 0.0,
    kf_1_pos: 1.0,
    kf_1_ch1: 1.0,
    kf_1_ch2: 1.0,
    kf_1_ch3: 1.0,
    kf_1_ch4: 1.0,
  };

  private mode = MODE_KEYFRAME;
  private queue: ScheduledEvent[] = [];
  private seq = 0;
  private destroyed = false;
  private minFence = 0;

  // Cached keyframes (recomputed on patch change)
  private keyframes: Keyframe[] = [];
  private needsKeyframeUpdate = true;

  // Smoothed gain values (to avoid clicks)
  private smoothGain1 = 0;
  private smoothGain2 = 0;
  private smoothGain3 = 0;
  private smoothGain4 = 0;

  // Sequencer state
  private sequencerPhase = 0; // 0-1 cycling phase
  private currentStepIndex = 0;

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
        this.sequencerPhase = 0;
        this.currentStepIndex = 0;
        break;
      case 'set-patch':
        this.currentPatch = event.patch;
        this.needsKeyframeUpdate = true;
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
    const outL = output[0];
    const outR = output[1] ?? output[0];
    outL.fill(0);
    outR.fill(0);

    if (this.destroyed) return false;

    const inL = inputs[0]?.[0];
    const inR = inputs[0]?.[1] ?? inputs[0]?.[0];
    if (!inL) return true;

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

    // Recompute keyframes if patch changed
    if (this.needsKeyframeUpdate) {
      this.keyframes = extractKeyframes(this.currentPatch);
      this.needsKeyframeUpdate = false;
    }

    // Read modulation params
    const modFrame     = parameters['mod-frame'][0];
    const modChannel1  = parameters['mod-channel_1'][0];
    const modChannel2  = parameters['mod-channel_2'][0];
    const modChannel3  = parameters['mod-channel_3'][0];
    const modChannel4  = parameters['mod-channel_4'][0];
    const modModulation = parameters['mod-modulation'][0];

    const p = this.currentPatch;
    const frameCount = inL.length;
    const smooth = 1 - Math.exp(-1 / (SMOOTH_TIME * sampleRate));

    // Compute effective parameters (base + modulation, clamped 0-1)
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const effFrame      = clamp01(p.frame + modFrame);
    const _effChannel1   = clamp01(p.channel_1 + modChannel1);
    const _effChannel2   = clamp01(p.channel_2 + modChannel2);
    const _effChannel3   = clamp01(p.channel_3 + modChannel3);
    const _effChannel4   = clamp01(p.channel_4 + modChannel4);
    const effModulation = clamp01(p.modulation + modModulation);

    if (this.mode === MODE_KEYFRAME) {
      // --- Keyframe mode: interpolate based on frame position ---
      // Modulation is an attenuverter: 0.5 = no offset, 0 = -1, 1 = +1
      const modOffset = (effModulation - 0.5) * 2.0;
      const effectiveFrame = clamp01(effFrame + modOffset);

      const [targetG1, targetG2, targetG3, targetG4] = interpolateKeyframes(this.keyframes, effectiveFrame);

      for (let i = 0; i < frameCount; i++) {
        // Smooth gains per-sample
        this.smoothGain1 += smooth * (targetG1 - this.smoothGain1);
        this.smoothGain2 += smooth * (targetG2 - this.smoothGain2);
        this.smoothGain3 += smooth * (targetG3 - this.smoothGain3);
        this.smoothGain4 += smooth * (targetG4 - this.smoothGain4);

        // Combined gain: average of all 4 channels (Gluon processes stereo, not 4 separate channels)
        const gain = (this.smoothGain1 + this.smoothGain2 + this.smoothGain3 + this.smoothGain4) * 0.25;

        outL[i] = inL[i] * gain;
        outR[i] = (inR ? inR[i] : inL[i]) * gain;
      }
    } else {
      // --- Sequencer mode: step through keyframes at a rate derived from frame knob ---
      // frame param = step rate: 0 → 0.05 Hz, 1 → 10 Hz (log scale)
      const rateHz = 0.05 * Math.pow(200, effFrame);
      const phaseIncrement = rateHz / sampleRate;
      const numKeyframes = this.keyframes.length;

      if (numKeyframes === 0) {
        return true; // nothing to step through
      }

      for (let i = 0; i < frameCount; i++) {
        this.sequencerPhase += phaseIncrement;
        if (this.sequencerPhase >= 1.0) {
          this.sequencerPhase -= 1.0;
          this.currentStepIndex = (this.currentStepIndex + 1) % numKeyframes;
        }

        const kf = this.keyframes[this.currentStepIndex];
        const targetG1 = kf.ch1;
        const targetG2 = kf.ch2;
        const targetG3 = kf.ch3;
        const targetG4 = kf.ch4;

        // Smooth gains per-sample (even in sequencer mode, to avoid clicks on step changes)
        this.smoothGain1 += smooth * (targetG1 - this.smoothGain1);
        this.smoothGain2 += smooth * (targetG2 - this.smoothGain2);
        this.smoothGain3 += smooth * (targetG3 - this.smoothGain3);
        this.smoothGain4 += smooth * (targetG4 - this.smoothGain4);

        const gain = (this.smoothGain1 + this.smoothGain2 + this.smoothGain3 + this.smoothGain4) * 0.25;

        outL[i] = inL[i] * gain;
        outR[i] = (inR ? inR[i] : inL[i]) * gain;
      }
    }

    return true;
  }
}

registerProcessor('frames-processor', FramesProcessor);
