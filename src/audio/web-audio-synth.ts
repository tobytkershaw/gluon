// src/audio/web-audio-synth.ts
import type { SynthEngine, SynthParams } from './synth-interface';
import { DEFAULT_PARAMS, noteToHz } from './synth-interface';

export class WebAudioSynth implements SynthEngine {
  private ctx: AudioContext;
  private oscillator: OscillatorNode;
  private envelope: GainNode;
  private filter: BiquadFilterNode;
  private analyser: AnalyserNode;
  private params: SynthParams = { ...DEFAULT_PARAMS };
  private gateOpen = false;

  constructor(ctx: AudioContext, output?: AudioNode) {
    this.ctx = ctx;
    this.oscillator = ctx.createOscillator();
    this.filter = ctx.createBiquadFilter();
    this.envelope = ctx.createGain();
    this.analyser = ctx.createAnalyser();

    this.oscillator.connect(this.filter);
    this.filter.connect(this.envelope);
    this.envelope.connect(this.analyser);
    this.analyser.connect(output ?? ctx.destination);

    this.filter.type = 'lowpass';
    this.filter.frequency.value = 2000;
    this.envelope.gain.value = 0;
    this.oscillator.start();
    this.applyParams();
  }

  setModel(model: number): void {
    const typeMap: OscillatorType[] = [
      'sawtooth', 'square', 'sine', 'sawtooth', 'sine', 'square', 'sawtooth', 'square',
      'sawtooth', 'sawtooth', 'square', 'triangle', 'sine', 'sine', 'square', 'square',
    ];
    this.oscillator.type = typeMap[model] ?? 'sine';
  }

  setParams(params: SynthParams): void {
    this.params = { ...params };
    this.applyParams();
  }

  private applyParams(): void {
    this.oscillator.frequency.value = noteToHz(this.params.note);
    this.filter.frequency.value = 200 + this.params.timbre * 7800;
    this.filter.Q.value = 0.5 + this.params.morph * 14.5;
    this.oscillator.detune.value = (this.params.harmonics - 0.5) * 100;
  }

  trigger(): void {
    const now = this.ctx.currentTime;
    this.envelope.gain.cancelScheduledValues(now);
    this.envelope.gain.setValueAtTime(0.01, now);
    this.envelope.gain.linearRampToValueAtTime(0.3, now + 0.005);
    this.gateOpen = true;
  }

  setGateOpen(open: boolean): void {
    if (this.gateOpen === open) return;
    this.gateOpen = open;
    if (!open) {
      const now = this.ctx.currentTime;
      this.envelope.gain.cancelScheduledValues(now);
      this.envelope.gain.setTargetAtTime(0, now, 0.05);
    }
  }

  getSchedulableParams(): { frequency: AudioParam; filterFreq: AudioParam; filterQ: AudioParam; detune: AudioParam } {
    return {
      frequency: this.oscillator.frequency,
      filterFreq: this.filter.frequency,
      filterQ: this.filter.Q,
      detune: this.oscillator.detune,
    };
  }

  getAnalyser(): AnalyserNode {
    return this.analyser;
  }

  render(_output: Float32Array): Float32Array {
    return _output;
  }

  destroy(): void {
    this.oscillator.stop();
    this.oscillator.disconnect();
    this.filter.disconnect();
    this.envelope.disconnect();
    this.analyser.disconnect();
  }
}
