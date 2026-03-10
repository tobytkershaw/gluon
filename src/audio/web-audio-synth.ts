// src/audio/web-audio-synth.ts

import type { SynthEngine, SynthParams } from './synth-interface';
import { DEFAULT_PARAMS, noteToHz } from './synth-interface';

export class WebAudioSynth implements SynthEngine {
  private oscillator: OscillatorNode;
  private gain: GainNode;
  private filter: BiquadFilterNode;
  private analyser: AnalyserNode;
  private params: SynthParams = { ...DEFAULT_PARAMS };

  constructor(ctx: AudioContext) {
    this.oscillator = ctx.createOscillator();
    this.filter = ctx.createBiquadFilter();
    this.gain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.oscillator.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 2000;
    this.gain.gain.value = 0.3;
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
    this.gain.disconnect();
    this.analyser.disconnect();
  }
}
