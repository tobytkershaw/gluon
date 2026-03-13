// src/audio/audio-engine.ts
import type { SynthParams } from './synth-interface';
import { DEFAULT_PARAMS } from './synth-interface';
import type { SynthEngine } from './synth-interface';
import { createPreferredSynth } from './create-synth';
import type { RingsEngine } from './rings-synth';
import type { CloudsEngine } from './clouds-synth';
import type { ScheduledNote } from '../engine/sequencer-types';

const ACCENT_GAIN_BOOST = 2.0; // +6dB ~ 2x linear gain

type ProcessorEngine = RingsEngine | CloudsEngine;

interface ProcessorSlot {
  id: string;
  type: string;
  engine: ProcessorEngine;
}

interface VoiceSlot {
  synth: SynthEngine;
  sourceOut: GainNode;   // routing node between source and processor chain
  muteGain: GainNode;    // controlled by mute/solo -- never touched by scheduleNote
  accentGain: GainNode;  // controlled by scheduleNote for accent boosts
  processors: ProcessorSlot[];
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
  /** Tracks processor IDs currently being created (async in-flight guard). */
  private pendingProcessors = new Set<string>();

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
      // Signal chain: source -> sourceOut -> [processors] -> accentGain -> muteGain -> mixer
      const sourceOut = this.ctx.createGain();
      sourceOut.gain.value = 1.0;
      const accentGain = this.ctx.createGain();
      accentGain.gain.value = 0.3;
      const muteGain = this.ctx.createGain();
      muteGain.gain.value = 1.0; // 1 = audible, 0 = muted
      sourceOut.connect(accentGain);
      accentGain.connect(muteGain);
      muteGain.connect(this.mixer);

      const synth = await createPreferredSynth(this.ctx, sourceOut);
      this.voices.set(voiceId, {
        synth,
        sourceOut,
        muteGain,
        accentGain,
        processors: [],
        currentParams: { ...DEFAULT_PARAMS },
        currentModel: 0,
      });
    }

    this._isRunning = true;
  }

  stop(): void {
    if (!this._isRunning) return;
    for (const slot of this.voices.values()) {
      for (const proc of slot.processors) {
        proc.engine.destroy();
      }
      slot.synth.destroy();
    }
    this.voices.clear();
    this.pendingProcessors.clear();
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

  // --- Processor chain ---

  async addProcessor(voiceId: string, processorType: string, processorId: string): Promise<void> {
    const key = `${voiceId}:${processorId}`;
    if (this.pendingProcessors.has(key)) return;

    const slot = this.voices.get(voiceId);
    if (!slot || !this.ctx) return;
    if (slot.processors.some(p => p.id === processorId)) return;

    this.pendingProcessors.add(key);
    try {
      let engine: ProcessorEngine;
      if (processorType === 'rings') {
        const { createRingsProcessor } = await import('./create-synth');
        engine = await createRingsProcessor(this.ctx);
      } else if (processorType === 'clouds') {
        const { createCloudsProcessor } = await import('./create-synth');
        engine = await createCloudsProcessor(this.ctx);
      } else {
        return;
      }
      // After async gap: only insert if still wanted (key not cancelled
      // by removeProcessor) and not already present (dedupe).
      if (this.pendingProcessors.has(key) && !slot.processors.some(p => p.id === processorId)) {
        slot.processors.push({ id: processorId, type: processorType, engine });
        this.rebuildChain(slot);
      } else {
        engine.destroy();
      }
    } finally {
      this.pendingProcessors.delete(key);
    }
  }

  removeProcessor(voiceId: string, processorId: string): void {
    const slot = this.voices.get(voiceId);
    if (!slot) return;

    // Cancel any in-flight add for this processor
    const key = `${voiceId}:${processorId}`;
    this.pendingProcessors.delete(key);

    const idx = slot.processors.findIndex(p => p.id === processorId);
    if (idx === -1) return;
    slot.processors[idx].engine.destroy();
    slot.processors.splice(idx, 1);
    this.rebuildChain(slot);
  }

  setProcessorPatch(voiceId: string, processorId: string, params: Record<string, number>): void {
    const slot = this.voices.get(voiceId);
    if (!slot) return;
    const proc = slot.processors.find(p => p.id === processorId);
    if (!proc) return;
    // Each processor type has its own setPatch shape — dispatch by type
    if (proc.type === 'rings') {
      (proc.engine as import('./rings-synth').RingsEngine).setPatch(params as import('./rings-messages').RingsPatchParams);
    } else if (proc.type === 'clouds') {
      (proc.engine as import('./clouds-synth').CloudsEngine).setPatch(params as import('./clouds-messages').CloudsPatchParams);
    }
  }

  setProcessorModel(voiceId: string, processorId: string, model: number): void {
    const slot = this.voices.get(voiceId);
    if (!slot) return;
    const proc = slot.processors.find(p => p.id === processorId);
    if (!proc) return;
    if (proc.type === 'rings') {
      (proc.engine as import('./rings-synth').RingsEngine).setModel(model);
    } else if (proc.type === 'clouds') {
      (proc.engine as import('./clouds-synth').CloudsEngine).setMode(model);
    }
  }

  getProcessors(voiceId: string): { id: string; type: string }[] {
    const slot = this.voices.get(voiceId);
    if (!slot) return [];
    const result = slot.processors.map(p => ({ id: p.id, type: p.type }));
    // Include in-flight processors so the sync effect doesn't re-add them
    for (const key of this.pendingProcessors) {
      const [vid, pid] = key.split(':');
      if (vid === voiceId && !result.some(p => p.id === pid)) {
        result.push({ id: pid!, type: 'unknown' });
      }
    }
    return result;
  }

  private rebuildChain(slot: VoiceSlot): void {
    // Disconnect sourceOut and all processors, then rewire
    slot.sourceOut.disconnect();
    for (const proc of slot.processors) {
      proc.engine.inputNode.disconnect();
    }

    if (slot.processors.length === 0) {
      // Direct: sourceOut -> accentGain
      slot.sourceOut.connect(slot.accentGain);
    } else {
      // Chain: sourceOut -> proc[0] -> ... -> proc[n] -> accentGain
      slot.sourceOut.connect(slot.processors[0].engine.inputNode);
      for (let i = 0; i < slot.processors.length - 1; i++) {
        slot.processors[i].engine.inputNode.connect(slot.processors[i + 1].engine.inputNode);
      }
      slot.processors[slot.processors.length - 1].engine.inputNode.connect(slot.accentGain);
    }
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
