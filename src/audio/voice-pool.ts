// src/audio/voice-pool.ts
import type { SynthEngine, SynthParams } from './synth-interface';
import type { ScheduledNote } from '../engine/sequencer-types';

const ACCENT_BASELINE = 0.3;

export interface PoolVoice {
  synth: SynthEngine;
  accentGain: GainNode;
  lastNoteTime: number;
  lastGateOffTime: number;
}

export class VoicePool {
  readonly voices: PoolVoice[];
  private nextIndex = 0;

  constructor(voices: PoolVoice[]) {
    this.voices = voices;
  }

  /** Round-robin allocate the next voice, returning it for scheduling. */
  allocate(): PoolVoice {
    const voice = this.voices[this.nextIndex];
    this.nextIndex = (this.nextIndex + 1) % this.voices.length;
    return voice;
  }

  /** Fade-out release (pause): cancel automation, ramp gain to 0 over ~50ms. */
  releaseAll(generation: number, now: number, fadeTime: number): void {
    for (const voice of this.voices) {
      voice.synth.silence(generation);
      voice.accentGain.gain.cancelAndHoldAtTime(now);
      voice.accentGain.gain.linearRampToValueAtTime(0, fadeTime);
    }
  }

  /** Hard stop: cancel automation, set gain to 0 immediately. */
  silenceAll(generation: number, now: number): void {
    for (const voice of this.voices) {
      voice.synth.silence(generation);
      voice.accentGain.gain.cancelAndHoldAtTime(now);
      voice.accentGain.gain.setValueAtTime(0, now);
    }
  }

  /** Reset accent gains to baseline (called on play after pause). */
  restoreBaseline(now: number): void {
    for (const voice of this.voices) {
      voice.accentGain.gain.cancelAndHoldAtTime(now);
      voice.accentGain.gain.setValueAtTime(ACCENT_BASELINE, now);
    }
  }

  /** Release a single track (keyboard note-off): close gate and reset accent. */
  release(now: number): void {
    for (const voice of this.voices) {
      voice.synth.silence();
      voice.accentGain.gain.cancelAndHoldAtTime(now);
      voice.accentGain.gain.setValueAtTime(ACCENT_BASELINE, now);
    }
  }

  setModel(model: number): void {
    for (const voice of this.voices) {
      voice.synth.setModel(model);
    }
  }

  setParams(params: SynthParams): void {
    for (const voice of this.voices) {
      voice.synth.setParams(params);
    }
  }

  destroy(): void {
    for (const voice of this.voices) {
      voice.synth.destroy();
      voice.accentGain.disconnect();
    }
  }

  /** Return all worklet nodes for modulation routing. */
  get workletNodes(): AudioWorkletNode[] {
    return this.voices
      .map(v => v.synth.workletNode)
      .filter((n): n is AudioWorkletNode => n != null);
  }

  /** Schedule a note on the next available voice with per-voice accent automation. */
  scheduleNote(note: ScheduledNote, generation: number): PoolVoice {
    const voice = this.allocate();
    const accentLevel = note.accent ? ACCENT_BASELINE * 2.0 : ACCENT_BASELINE;
    voice.accentGain.gain.setValueAtTime(accentLevel, note.time);
    if (note.accent) {
      voice.accentGain.gain.setValueAtTime(ACCENT_BASELINE, note.gateOffTime);
    }
    voice.synth.scheduleNote(note, generation);
    voice.lastNoteTime = note.time;
    voice.lastGateOffTime = note.gateOffTime;
    return voice;
  }
}
