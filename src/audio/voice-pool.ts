// src/audio/voice-pool.ts
import type { SynthEngine, SynthParams } from './synth-interface';
import type { ScheduledNote } from '../engine/sequencer-types';

export const ACCENT_BASELINE = 0.3;

export interface PoolVoice {
  synth: SynthEngine;
  accentGain: GainNode;
  lastNoteTime: number;
  lastGateOffTime: number;
}

export class VoicePool {
  readonly voices: PoolVoice[];
  private nextIndex = 0;
  /** Maps eventId to the PoolVoice allocated for that event. */
  private eventVoiceMap = new Map<string, PoolVoice>();

  constructor(voices: PoolVoice[]) {
    this.voices = voices;
  }

  /** Return the voice allocated for a specific event, if still tracked. */
  getVoiceForEvent(eventId: string): PoolVoice | undefined {
    return this.eventVoiceMap.get(eventId);
  }

  /** Release tracking for a specific event (called on gate-off or silence). */
  releaseEvent(eventId: string): void {
    this.eventVoiceMap.delete(eventId);
  }

  /** Clear all event-voice mappings (called on generation change). */
  clearEventMap(): void {
    this.eventVoiceMap.clear();
  }

  /**
   * Allocate the next voice, preferring released voices over active ones.
   * A voice is considered released if its lastGateOffTime < currentTime.
   * Among released voices, the one idle longest (earliest lastGateOffTime) wins.
   * Falls back to round-robin if all voices are still active.
   */
  allocate(currentTime: number): PoolVoice {
    // Scan for released voices (gate-off in the past)
    let bestIdx = -1;
    let bestGateOff = Infinity;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.lastGateOffTime < currentTime && v.lastGateOffTime < bestGateOff) {
        bestGateOff = v.lastGateOffTime;
        bestIdx = i;
      }
    }
    if (bestIdx !== -1) {
      return this.voices[bestIdx];
    }
    // All voices still active — fall back to round-robin
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
    this.eventVoiceMap.clear();
  }

  /** Hard stop: cancel automation, set gain to 0 immediately. */
  silenceAll(generation: number, now: number): void {
    for (const voice of this.voices) {
      voice.synth.silence(generation);
      voice.accentGain.gain.cancelAndHoldAtTime(now);
      voice.accentGain.gain.setValueAtTime(0, now);
    }
    this.eventVoiceMap.clear();
  }

  /** Reset accent gains to baseline (called on play after pause). */
  restoreBaseline(now: number): void {
    for (const voice of this.voices) {
      voice.accentGain.gain.cancelAndHoldAtTime(now);
      voice.accentGain.gain.setValueAtTime(ACCENT_BASELINE, now);
    }
  }

  /**
   * Silence the entire track (keyboard note-off).
   * Silences ALL voices in the pool — intentional, since the keyboard doesn't
   * track which pool voice it was assigned. During sequenced playback a keyboard
   * note-off will also silence the sequenced voice; this matches pre-pool behaviour
   * where the single synth was shared.
   */
  release(now: number): void {
    for (const voice of this.voices) {
      voice.synth.silence();
      voice.accentGain.gain.cancelAndHoldAtTime(now);
      voice.accentGain.gain.setValueAtTime(ACCENT_BASELINE, now);
    }
    this.eventVoiceMap.clear();
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
  scheduleNote(note: ScheduledNote, generation: number, eventId?: string): PoolVoice {
    const voice = this.allocate(note.time);
    const accentLevel = note.accent ? ACCENT_BASELINE * 2.0 : ACCENT_BASELINE;
    voice.accentGain.gain.setValueAtTime(accentLevel, note.time);
    if (note.accent) {
      voice.accentGain.gain.setValueAtTime(ACCENT_BASELINE, note.gateOffTime);
    }
    voice.synth.scheduleNote(note, generation);
    voice.lastNoteTime = note.time;
    voice.lastGateOffTime = note.gateOffTime;
    // Track which voice handles this event for targeted gate-off
    if (eventId) {
      this.eventVoiceMap.set(eventId, voice);
    }
    return voice;
  }
}
