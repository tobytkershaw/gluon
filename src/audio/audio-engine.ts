// src/audio/audio-engine.ts

import type { SynthParams } from './synth-interface';
import { DEFAULT_PARAMS } from './synth-interface';
import { WebAudioSynth } from './web-audio-synth';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private synth: WebAudioSynth | null = null;
  private _isRunning = false;
  private currentParams: SynthParams = { ...DEFAULT_PARAMS };
  private currentModel = 0;

  get isRunning(): boolean {
    return this._isRunning;
  }

  async start(): Promise<void> {
    if (this._isRunning) return;
    this.ctx = new AudioContext({ sampleRate: 48000 });
    this.synth = new WebAudioSynth(this.ctx);
    this.synth.setModel(this.currentModel);
    this.synth.setParams(this.currentParams);
    this._isRunning = true;
  }

  stop(): void {
    if (!this._isRunning) return;
    this.synth?.destroy();
    this.ctx?.close();
    this.synth = null;
    this.ctx = null;
    this._isRunning = false;
  }

  setModel(model: number): void {
    this.currentModel = model;
    this.synth?.setModel(model);
  }

  setParams(params: Partial<SynthParams>): void {
    this.currentParams = { ...this.currentParams, ...params };
    this.synth?.setParams(this.currentParams);
  }

  getParams(): SynthParams {
    return { ...this.currentParams };
  }

  getAnalyser(): AnalyserNode | null {
    return this.synth?.getAnalyser() ?? null;
  }
}
