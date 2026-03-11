// src/audio/audio-engine.ts
import type { SynthParams } from './synth-interface';
import { DEFAULT_PARAMS } from './synth-interface';
import type { SynthEngine } from './synth-interface';
import { createPreferredSynth } from './create-synth';
import type { ScheduledNote } from '../engine/sequencer-types';

const ACCENT_GAIN_BOOST = 2.0; // +6dB ~ 2x linear gain

interface VoiceSlot {
  synth: SynthEngine;
  muteGain: GainNode;    // controlled by mute/solo -- never touched by scheduleNote
  accentGain: GainNode;  // controlled by scheduleNote for accent boosts
  currentParams: SynthParams;
  currentModel: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private voices: Map<string, VoiceSlot> = new Map();
  private mixer: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
  private _isRunning = false;

  get isRunning(): boolean {
    return this._isRunning;
  }

  async start(voiceIds: string[]): Promise<void> {
    if (this._isRunning) return;
    this.ctx = new AudioContext({ sampleRate: 48000 });

    this.mixer = this.ctx.createGain();
    this.mixer.gain.value = 1.0;

    this.analyser = this.ctx.createAnalyser();
    this.mediaStreamDest = this.ctx.createMediaStreamDestination();

    this.mixer.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.mixer.connect(this.mediaStreamDest);

    for (const voiceId of voiceIds) {
      // Two gain stages: accentGain (per-note dynamics) -> muteGain (mute/solo)
      const accentGain = this.ctx.createGain();
      accentGain.gain.value = 0.3;
      const muteGain = this.ctx.createGain();
      muteGain.gain.value = 1.0; // 1 = audible, 0 = muted
      accentGain.connect(muteGain);
      muteGain.connect(this.mixer);

      const synth = await createPreferredSynth(this.ctx, accentGain);
      this.voices.set(voiceId, {
        synth,
        muteGain,
        accentGain,
        currentParams: { ...DEFAULT_PARAMS },
        currentModel: 0,
      });
    }

    this._isRunning = true;
  }

  stop(): void {
    if (!this._isRunning) return;
    for (const slot of this.voices.values()) {
      slot.synth.destroy();
    }
    this.voices.clear();
    this.mixer?.disconnect();
    this.analyser?.disconnect();
    this.mediaStreamDest?.disconnect();
    this.ctx?.close();
    this.ctx = null;
    this.mixer = null;
    this.analyser = null;
    this.mediaStreamDest = null;
    this._isRunning = false;
  }

  setVoiceModel(voiceId: string, model: number): void {
    const slot = this.voices.get(voiceId);
    if (!slot) return;
    slot.currentModel = model;
    slot.synth.setModel(model);
  }

  setVoiceParams(voiceId: string, params: SynthParams): void {
    const slot = this.voices.get(voiceId);
    if (!slot) return;
    slot.currentParams = { ...params };
    slot.synth.setParams(params);
  }

  muteVoice(voiceId: string, muted: boolean): void {
    const slot = this.voices.get(voiceId);
    if (!slot) return;
    // Only touch muteGain -- accentGain is controlled by scheduleNote
    slot.muteGain.gain.value = muted ? 0 : 1;
  }

  scheduleNote(note: ScheduledNote): void {
    const slot = this.voices.get(note.voiceId);
    if (!slot) return;

    // --- Accent gain: schedule on accentGain (separate from muteGain) ---
    const accentLevel = note.accent ? 0.3 * ACCENT_GAIN_BOOST : 0.3;
    slot.accentGain.gain.setValueAtTime(accentLevel, note.time);
    if (note.accent) {
      // Revert accent at gate-off
      slot.accentGain.gain.setValueAtTime(0.3, note.gateOffTime);
    }
    slot.synth.scheduleNote(note);
  }

  getCurrentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  getMediaStreamDestination(): MediaStreamAudioDestinationNode | null {
    return this.mediaStreamDest;
  }

  // Legacy single-voice API (for Phase 1 compatibility during migration)
  setModel(model: number): void {
    const firstVoice = this.voices.keys().next().value;
    if (firstVoice) this.setVoiceModel(firstVoice, model);
  }

  setParams(params: Partial<SynthParams>): void {
    const firstVoice = this.voices.entries().next().value;
    if (firstVoice) {
      const [id, slot] = firstVoice;
      const merged = { ...slot.currentParams, ...params };
      this.setVoiceParams(id, merged);
    }
  }
}
