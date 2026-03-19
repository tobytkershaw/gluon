// src/audio/audio-engine.ts
import { DEFAULT_PARAMS } from './synth-interface';
import { createPreferredSynth } from './create-synth';
import type { ProcessorContract, ModulatorContract } from './module-contract';
import { moduleDescriptors } from './module-descriptors';
import type { ScheduledNote } from '../engine/sequencer-types';
import type { SynthParamValues, ModulationTarget } from '../engine/types';
import type { PlaitsExtendedParams } from './plaits-messages';
import { controlIdToRuntimeParam } from './instrument-registry';
import { recordQaAudioTrace } from '../qa/audio-trace';
import { VoicePool, ACCENT_BASELINE, STEAL_RAMP_TIME } from './voice-pool';

/** Duration (seconds) for the gain ramp used during chain rebuild to avoid clicks. */
const CHAIN_RAMP_SEC = 0.002; // ~2ms
/** Keep completed voices around briefly so generation cleanup still reaches processor tails. */
const TRACK_TAIL_GRACE_SEC = 2.0;
/** Number of synth voices per track for polyphonic overlap handling. */
const VOICES_PER_TRACK = 4;
/** Duration (seconds) for the gain ramp when choking a pad (avoids clicks). */
const CHOKE_RAMP_TIME = 0.005;

interface ProcessorSlot {
  id: string;
  type: string;
  engine: ProcessorContract;
  /** Whether this processor is wired into the chain. Default: true. */
  enabled: boolean;
  /** True if module creation failed and a pass-through was substituted. */
  degraded: boolean;
}

interface ModulatorSlot {
  id: string;
  type: string;
  engine: ModulatorContract;
  keepAliveGain: GainNode;  // gain=0 → destination (prevents GC)
}

interface ModulationRoute {
  id: string;
  modulatorSlotId: string;
  depthGain: GainNode;
  targetNode: AudioWorkletNode;
  targetParam: string;  // "mod-timbre" etc.
}

/** A single pad within a drum rack: one synth instance + per-pad gain and panner. */
interface DrumPadSlot {
  id: string;
  synth: import('./synth-interface').SynthEngine;
  accentGain: GainNode;
  padGain: GainNode;
  padPanner: StereoPannerNode;
  model: number;
  params: Record<string, number>;
  chokeGroup?: number;
  lastNoteTime: number;
  lastGateOffTime: number;
}

interface TrackSlot {
  pool: VoicePool | null; // null for bus tracks and drum rack tracks
  sourceOut: GainNode;   // routing node between source and processor chain
  chainOutGain: GainNode; // gain node at end of processor chain — ramped to 0 during rebuild to avoid clicks
  trackVolume: GainNode; // per-track volume (0.0–1.0)
  trackPanner: StereoPannerNode; // per-track pan (-1.0 to 1.0)
  muteGain: GainNode;    // controlled by mute/solo -- never touched by scheduleNote
  /** Bus input node: audio sent from other tracks is summed here, then into chainOutGain. */
  busInput: GainNode | null; // non-null only for bus tracks
  /** Per-track analyser for level metering in the sidebar. */
  analyser: AnalyserNode;
  processors: ProcessorSlot[];
  currentParams: SynthParamValues;
  currentModel: number;
  /** Whether this is a bus track (no voice pool). */
  isBus: boolean;
  /** Whether this is a drum rack track (pad pool instead of voice pool). */
  isDrumRack: boolean;
  /** Per-pad synth instances for drum rack tracks. */
  drumPads: Map<string, DrumPadSlot>;
}

/** Per-track send routing: a gain node controlling send level, connected to a bus's busInput. */
interface SendGainSlot {
  busId: string;
  sendGain: GainNode;
}

/** Sidechain routing slot: connects a source track's post-fader output to a compressor's sidechain input. */
interface SidechainSlot {
  sourceTrackId: string;
  targetTrackId: string;
  processorId: string;
  /** Gain node tapping the source track's muteGain into the compressor's sidechain input. */
  tapGain: GainNode;
}

interface ActiveVoice {
  eventId: string;
  generation: number;
  trackId: string;
  noteTime: number;
  gateOffTime: number;
  state: 'scheduled' | 'released' | 'silenced';
}

export interface ActiveVoiceSnapshot {
  eventId: string;
  generation: number;
  trackId: string;
  noteTime: number;
  gateOffTime: number;
  state: 'scheduled' | 'released' | 'silenced';
}

function toPlaitsExtendedParams(params: SynthParamValues): PlaitsExtendedParams {
  return {
    fm_amount: params.fm_amount ?? params['fm-amount'] ?? 0.0,
    timbre_mod_amount: params.timbre_mod_amount ?? params['timbre-mod-amount'] ?? 0.0,
    morph_mod_amount: params.morph_mod_amount ?? params['morph-mod-amount'] ?? 0.0,
    decay: params.decay ?? 0.5,
    lpg_colour: params.lpg_colour ?? params['lpg-colour'] ?? 0.5,
  };
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private tracks: Map<string, TrackSlot> = new Map();
  private mixer: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private masterPanner: StereoPannerNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserL: AnalyserNode | null = null;
  private analyserR: AnalyserNode | null = null;
  private channelSplitter: ChannelSplitterNode | null = null;
  private mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
  private _isRunning = false;
  /** Tracks processor IDs currently being created (async in-flight guard). */
  private pendingProcessors = new Set<string>();
  /** Monotonic transport generation propagated to worklets to invalidate stale events. */
  private generation = 0;
  private activeVoices = new Map<string, ActiveVoice>();
  /** Per-track send gain nodes: trackId → SendGainSlot[] */
  private sendSlots: Map<string, SendGainSlot[]> = new Map();
  /** Sidechain routing: keyed by "targetTrackId:processorId" → source info. */
  private sidechainSlots: Map<string, SidechainSlot> = new Map();
  /** The master bus track ID, used for routing all track outputs. */
  private masterBusId: string | null = null;
  /** Metronome gain node — connected directly to destination, bypassing tracks/mixer. */
  private metronomeGain: GainNode | null = null;

  get isRunning(): boolean {
    return this._isRunning;
  }

  async start(trackIds: string[], busTrackIds: string[] = [], masterBusId?: string, drumRackTrackIds: string[] = []): Promise<void> {
    if (this._isRunning) return;
    this.ctx = new AudioContext({ sampleRate: 48000 });

    this.mixer = this.ctx.createGain();
    this.mixer.gain.value = 1.0;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8; // default master volume

    this.masterPanner = this.ctx.createStereoPanner();
    this.masterPanner.pan.value = 0.0; // center

    this.analyser = this.ctx.createAnalyser();
    this.channelSplitter = this.ctx.createChannelSplitter(2);
    this.analyserL = this.ctx.createAnalyser();
    this.analyserR = this.ctx.createAnalyser();
    this.mediaStreamDest = this.ctx.createMediaStreamDestination();

    // Signal chain: mixer -> masterGain -> masterPanner -> analyser -> destination
    //                                                   -> mediaStreamDest
    //                                                   -> splitter -> analyserL/R
    this.mixer.connect(this.masterGain);
    this.masterGain.connect(this.masterPanner);
    this.masterPanner.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.masterPanner.connect(this.mediaStreamDest);
    this.masterPanner.connect(this.channelSplitter);
    this.channelSplitter.connect(this.analyserL, 0);
    this.channelSplitter.connect(this.analyserR, 1);

    // Metronome: direct to destination, not through mixer/master chain
    this.metronomeGain = this.ctx.createGain();
    this.metronomeGain.gain.value = 0.5;
    this.metronomeGain.connect(this.ctx.destination);

    const allBusIds = new Set(busTrackIds);
    const allDrumRackIds = new Set(drumRackTrackIds);
    this.masterBusId = masterBusId ?? null;

    // Create all bus tracks first so audio tracks can reference the master bus
    for (const busId of busTrackIds) {
      await this.createBusSlot(busId);
    }

    // Create audio and drum rack track slots
    for (const trackId of trackIds) {
      if (allBusIds.has(trackId)) continue; // already created as bus
      if (allDrumRackIds.has(trackId)) {
        await this.createDrumRackSlot(trackId);
      } else {
        await this.createAudioSlot(trackId);
      }
    }

    // Route non-master tracks to the master bus if it exists
    this.rerouteToMasterBus();

    this._isRunning = true;
  }

  /** Create an audio track slot with a voice pool. */
  private async createAudioSlot(trackId: string): Promise<void> {
    if (!this.ctx || !this.mixer) return;

    const sourceOut = this.ctx.createGain();
    sourceOut.gain.value = 1.0;
    const chainOutGain = this.ctx.createGain();
    chainOutGain.gain.value = 1.0;
    const trackVolume = this.ctx.createGain();
    trackVolume.gain.value = 0.8;
    const trackPanner = this.ctx.createStereoPanner();
    trackPanner.pan.value = 0.0;
    const muteGain = this.ctx.createGain();
    muteGain.gain.value = 1.0;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;
    sourceOut.connect(chainOutGain);
    chainOutGain.connect(trackVolume);
    trackVolume.connect(trackPanner);
    trackPanner.connect(muteGain);
    muteGain.connect(this.mixer);
    // Tap post-mute for level metering (reflects mute/solo state)
    muteGain.connect(analyser);

    const poolVoices = [];
    for (let i = 0; i < VOICES_PER_TRACK; i++) {
      const accentGain = this.ctx.createGain();
      accentGain.gain.value = ACCENT_BASELINE;
      const synth = await createPreferredSynth(this.ctx, accentGain);
      accentGain.connect(sourceOut);
      poolVoices.push({ synth, accentGain, lastNoteTime: 0, lastGateOffTime: 0 });
    }

    this.tracks.set(trackId, {
      pool: new VoicePool(poolVoices),
      sourceOut,
      chainOutGain,
      trackVolume,
      trackPanner,
      muteGain,
      busInput: null,
      analyser,
      processors: [],
      currentParams: { ...DEFAULT_PARAMS },
      currentModel: 0,
      isBus: false,
      isDrumRack: false,
      drumPads: new Map(),
    });
  }

  /** Create a bus track slot — gain/pan nodes but no voice pool. */
  private async createBusSlot(busId: string): Promise<void> {
    if (!this.ctx || !this.mixer) return;

    // Bus input: all sends sum here
    const busInput = this.ctx.createGain();
    busInput.gain.value = 1.0;
    // sourceOut isn't used by buses directly, but keeps the slot shape consistent
    const sourceOut = this.ctx.createGain();
    sourceOut.gain.value = 1.0;
    const chainOutGain = this.ctx.createGain();
    chainOutGain.gain.value = 1.0;
    const trackVolume = this.ctx.createGain();
    trackVolume.gain.value = 0.8;
    const trackPanner = this.ctx.createStereoPanner();
    trackPanner.pan.value = 0.0;
    const muteGain = this.ctx.createGain();
    muteGain.gain.value = 1.0;

    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;
    // Bus signal chain: busInput → [processors] → chainOutGain → trackVolume → trackPanner → muteGain → mixer
    busInput.connect(chainOutGain);
    chainOutGain.connect(trackVolume);
    trackVolume.connect(trackPanner);
    trackPanner.connect(muteGain);
    muteGain.connect(this.mixer);
    // Tap post-mute for level metering (reflects mute/solo state)
    muteGain.connect(analyser);

    this.tracks.set(busId, {
      pool: null,
      sourceOut,
      chainOutGain,
      trackVolume,
      trackPanner,
      muteGain,
      busInput,
      analyser,
      processors: [],
      currentParams: { ...DEFAULT_PARAMS },
      currentModel: 0,
      isBus: true,
      isDrumRack: false,
      drumPads: new Map(),
    });
  }

  /**
   * Route all non-master track muteGain outputs to the master bus's busInput
   * instead of directly to the mixer. The master bus then routes to the mixer.
   */
  private rerouteToMasterBus(): void {
    if (!this.masterBusId || !this.mixer) return;
    const masterSlot = this.tracks.get(this.masterBusId);
    if (!masterSlot?.busInput) return;

    for (const [trackId, slot] of this.tracks) {
      if (trackId === this.masterBusId) continue;
      // Disconnect from mixer, reconnect to master bus input
      slot.muteGain.disconnect();
      slot.muteGain.connect(masterSlot.busInput);
      slot.muteGain.connect(slot.analyser); // restore metering tap
    }
  }

  stop(): void {
    if (!this._isRunning) return;
    // Destroy modulators and routes
    for (const [, modSlots] of this.modulatorSlots) {
      for (const modSlot of modSlots) {
        modSlot.engine.destroy();
        modSlot.keepAliveGain.disconnect();
      }
    }
    for (const [, routes] of this.modulationRouteSlots) {
      for (const route of routes) {
        route.depthGain.disconnect();
      }
    }
    this.modulatorSlots.clear();
    this.modulationRouteSlots.clear();
    this.pendingModulators.clear();
    // Destroy sidechain gain nodes
    for (const [, sc] of this.sidechainSlots) {
      sc.tapGain.disconnect();
    }
    this.sidechainSlots.clear();
    // Destroy send gain nodes
    for (const [, slots] of this.sendSlots) {
      for (const s of slots) s.sendGain.disconnect();
    }
    this.sendSlots.clear();
    this.masterBusId = null;
    // Destroy processors, drum pads, and tracks
    for (const slot of this.tracks.values()) {
      for (const proc of slot.processors) {
        proc.engine.destroy();
      }
      if (slot.pool) slot.pool.destroy();
      for (const padSlot of slot.drumPads.values()) {
        padSlot.synth.destroy();
        padSlot.accentGain.disconnect();
        padSlot.padGain.disconnect();
        padSlot.padPanner.disconnect();
      }
      slot.drumPads.clear();
    }
    this.tracks.clear();
    this.activeVoices.clear();
    this.pendingProcessors.clear();
    this.mixer?.disconnect();
    this.masterGain?.disconnect();
    this.masterPanner?.disconnect();
    this.analyser?.disconnect();
    this.channelSplitter?.disconnect();
    this.analyserL?.disconnect();
    this.analyserR?.disconnect();
    this.metronomeGain?.disconnect();
    this.mediaStreamDest?.disconnect();
    this.ctx?.close();
    this.ctx = null;
    this.mixer = null;
    this.masterGain = null;
    this.masterPanner = null;
    this.analyser = null;
    this.channelSplitter = null;
    this.analyserL = null;
    this.analyserR = null;
    this.mediaStreamDest = null;
    this.metronomeGain = null;
    this._isRunning = false;
  }

  /** Create a drum rack track slot — no voice pool, pads added separately. */
  private async createDrumRackSlot(trackId: string): Promise<void> {
    if (!this.ctx || !this.mixer) return;

    const sourceOut = this.ctx.createGain();
    sourceOut.gain.value = 1.0;
    const chainOutGain = this.ctx.createGain();
    chainOutGain.gain.value = 1.0;
    const trackVolume = this.ctx.createGain();
    trackVolume.gain.value = 0.8;
    const trackPanner = this.ctx.createStereoPanner();
    trackPanner.pan.value = 0.0;
    const muteGain = this.ctx.createGain();
    muteGain.gain.value = 1.0;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;
    sourceOut.connect(chainOutGain);
    chainOutGain.connect(trackVolume);
    trackVolume.connect(trackPanner);
    trackPanner.connect(muteGain);
    muteGain.connect(this.mixer);
    muteGain.connect(analyser);

    this.tracks.set(trackId, {
      pool: null,
      sourceOut,
      chainOutGain,
      trackVolume,
      trackPanner,
      muteGain,
      busInput: null,
      analyser,
      processors: [],
      currentParams: { ...DEFAULT_PARAMS },
      currentModel: 0,
      isBus: false,
      isDrumRack: true,
      drumPads: new Map(),
    });
  }

  /**
   * Dynamically add a new track slot to the running audio engine.
   * Creates a voice pool and the per-track gain/pan chain.
   * For bus tracks, pass isBus=true to skip voice pool creation.
   * For drum rack tracks, pass isDrumRack=true — pads are added separately via addDrumPad().
   */
  async addTrack(trackId: string, isBus = false, isDrumRack = false): Promise<void> {
    if (!this.ctx || !this.mixer) return;
    if (this.tracks.has(trackId)) return;

    if (isBus) {
      await this.createBusSlot(trackId);
    } else if (isDrumRack) {
      await this.createDrumRackSlot(trackId);
    } else {
      await this.createAudioSlot(trackId);
    }

    // If a master bus exists, route this new track through it
    this.rerouteToMasterBus();
  }

  /**
   * Dynamically remove a track slot from the running audio engine.
   * Destroys voice pool, processors, modulators, sends, and disconnects all nodes.
   */
  removeTrack(trackId: string): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;

    // Destroy processors
    for (const proc of slot.processors) {
      proc.engine.destroy();
    }
    // Destroy modulators for this track
    const modSlots = this.modulatorSlots.get(trackId);
    if (modSlots) {
      for (const modSlot of modSlots) {
        modSlot.engine.destroy();
        modSlot.keepAliveGain.disconnect();
      }
      this.modulatorSlots.delete(trackId);
    }
    // Remove modulation routes for this track
    const routes = this.modulationRouteSlots.get(trackId);
    if (routes) {
      for (const route of routes) {
        route.depthGain.disconnect();
      }
      this.modulationRouteSlots.delete(trackId);
    }
    // Cancel pending processors/modulators for this track
    for (const key of [...this.pendingProcessors]) {
      if (key.startsWith(trackId + ':')) this.pendingProcessors.delete(key);
    }
    for (const key of [...this.pendingModulators]) {
      if (key.startsWith(trackId + ':')) this.pendingModulators.delete(key);
    }
    // Clean up send gain nodes from this track
    const sends = this.sendSlots.get(trackId);
    if (sends) {
      for (const s of sends) s.sendGain.disconnect();
      this.sendSlots.delete(trackId);
    }
    // Clean up sends from other tracks that point to this track (if it's a bus)
    if (slot.isBus) {
      for (const [otherTrackId, otherSends] of this.sendSlots) {
        const filtered = otherSends.filter(s => {
          if (s.busId === trackId) {
            s.sendGain.disconnect();
            return false;
          }
          return true;
        });
        this.sendSlots.set(otherTrackId, filtered);
      }
    }
    // Clean up sidechain slots involving this track (as source or target)
    for (const [key, sc] of this.sidechainSlots) {
      if (sc.sourceTrackId === trackId || sc.targetTrackId === trackId) {
        sc.tapGain.disconnect();
        this.sidechainSlots.delete(key);
      }
    }
    // Clean up active voices for this track
    for (const [eventId, voice] of this.activeVoices) {
      if (voice.trackId === trackId) this.activeVoices.delete(eventId);
    }
    // Destroy voice pool and drum pads, disconnect audio nodes
    if (slot.pool) slot.pool.destroy();
    for (const padSlot of slot.drumPads.values()) {
      padSlot.synth.destroy();
      padSlot.accentGain.disconnect();
      padSlot.padGain.disconnect();
      padSlot.padPanner.disconnect();
    }
    slot.drumPads.clear();
    slot.sourceOut.disconnect();
    slot.chainOutGain.disconnect();
    slot.trackVolume.disconnect();
    slot.trackPanner.disconnect();
    slot.muteGain.disconnect();
    slot.analyser.disconnect();
    if (slot.busInput) slot.busInput.disconnect();
    this.tracks.delete(trackId);

    // If master bus was removed, clear the reference
    if (trackId === this.masterBusId) {
      this.masterBusId = null;
    }
  }

  /** Check whether a track slot exists in the audio engine. */
  hasTrack(trackId: string): boolean {
    return this.tracks.has(trackId);
  }

  /** Return all track IDs currently in the audio engine. */
  getTrackIds(): string[] {
    return [...this.tracks.keys()];
  }

  setTrackModel(trackId: string, model: number): void {
    const slot = this.tracks.get(trackId);
    if (!slot || !slot.pool) return;
    slot.currentModel = model;
    slot.pool.setModel(model);
  }

  setTrackParams(trackId: string, params: SynthParamValues): void {
    const slot = this.tracks.get(trackId);
    if (!slot || !slot.pool) return;
    slot.currentParams = { ...params };
    slot.pool.setParams(params);           // base 4 → SynthParams
    slot.pool.setExtended(toPlaitsExtendedParams(params));  // extended 5
  }

  setTrackPortamento(trackId: string, time: number, mode: number): void {
    const slot = this.tracks.get(trackId);
    if (!slot || !slot.pool) return;
    slot.pool.setPortamento(time, mode);
  }

  muteTrack(trackId: string, muted: boolean): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    // Only touch muteGain -- accentGain is per-voice, controlled by scheduleNote.
    // Use setValueAtTime for reliable gain changes during active playback —
    // direct .value assignment can be ignored by the audio thread mid-render.
    const target = muted ? 0 : 1;
    if (this.ctx) {
      slot.muteGain.gain.setValueAtTime(target, this.ctx.currentTime);
    } else {
      slot.muteGain.gain.value = target;
    }
  }

  setTrackVolume(trackId: string, value: number): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    slot.trackVolume.gain.value = Math.max(0, Math.min(1, value));
  }

  setTrackPan(trackId: string, value: number): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    slot.trackPanner.pan.value = Math.max(-1, Math.min(1, value));
  }

  advanceGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  getGeneration(): number {
    return this.generation;
  }

  getActiveVoices(): ActiveVoiceSnapshot[] {
    this.pruneInactiveVoices();
    return [...this.activeVoices.values()].map(voice => ({ ...voice }));
  }

  scheduleNote(note: ScheduledNote, generation = this.generation): void {
    const slot = this.tracks.get(note.trackId);
    if (!slot) return;

    // Drum rack routing: route to the specific pad's synth
    if (slot.isDrumRack && note.padId) {
      this.scheduleDrumPadNote(slot, note, generation);
      return;
    }

    if (!slot.pool) return;
    this.pruneInactiveVoices(note.time);
    const eventId = note.eventId ?? `manual:${note.trackId}:${note.time}:${note.gateOffTime}`;
    const voiceGeneration = note.generation ?? generation;

    // Delegate to voice pool: allocates a voice, schedules accent + note on it
    slot.pool.scheduleNote(note, generation, eventId);
    this.activeVoices.set(eventId, {
      eventId,
      generation: voiceGeneration,
      trackId: note.trackId,
      noteTime: note.time,
      gateOffTime: note.gateOffTime,
      state: 'scheduled',
    });
    recordQaAudioTrace({
      type: 'audio.note',
      eventId,
      generation: voiceGeneration,
      trackId: note.trackId,
      time: note.time,
      gateOffTime: note.gateOffTime,
      accent: note.accent,
    });
  }

  /** Schedule a note on a specific drum pad, with choke group handling. */
  private scheduleDrumPadNote(slot: TrackSlot, note: ScheduledNote, generation: number): void {
    const padSlot = slot.drumPads.get(note.padId!);
    if (!padSlot) return;

    this.pruneInactiveVoices(note.time);
    const eventId = note.eventId ?? `manual:${note.trackId}:${note.padId}:${note.time}:${note.gateOffTime}`;
    const voiceGeneration = note.generation ?? generation;

    // Choke group logic: silence other pads in the same group
    if (padSlot.chokeGroup != null) {
      for (const otherPad of slot.drumPads.values()) {
        if (otherPad.id === padSlot.id) continue;
        if (otherPad.chokeGroup !== padSlot.chokeGroup) continue;
        // Ramp the choked pad's accentGain to 0 over CHOKE_RAMP_TIME and gate-off
        const rampStart = Math.max(0, note.time - CHOKE_RAMP_TIME);
        otherPad.accentGain.gain.cancelAndHoldAtTime(rampStart);
        otherPad.accentGain.gain.linearRampToValueAtTime(0, note.time);
        otherPad.synth.silence(generation);
        // Update lastGateOffTime so the voice-stealing guard works correctly
        // for the choked pad's next trigger
        otherPad.lastGateOffTime = note.time;
      }
    }

    // Schedule the note on this pad's synth
    const accentLevel = note.accent ? ACCENT_BASELINE * 2.0 : ACCENT_BASELINE;
    // If the pad is still sustaining from a previous note, ramp down first
    if (padSlot.lastGateOffTime > 0 && padSlot.lastGateOffTime >= note.time) {
      const rampStart = Math.max(0, note.time - STEAL_RAMP_TIME);
      padSlot.accentGain.gain.cancelAndHoldAtTime(rampStart);
      padSlot.accentGain.gain.linearRampToValueAtTime(0, note.time);
    }
    padSlot.accentGain.gain.setValueAtTime(accentLevel, note.time);
    if (note.accent) {
      padSlot.accentGain.gain.setValueAtTime(ACCENT_BASELINE, note.gateOffTime);
    }
    padSlot.synth.scheduleNote(note, generation);
    padSlot.lastNoteTime = note.time;
    padSlot.lastGateOffTime = note.gateOffTime;

    this.activeVoices.set(eventId, {
      eventId,
      generation: voiceGeneration,
      trackId: note.trackId,
      noteTime: note.time,
      gateOffTime: note.gateOffTime,
      state: 'scheduled',
    });
    recordQaAudioTrace({
      type: 'audio.note',
      eventId,
      generation: voiceGeneration,
      trackId: note.trackId,
      time: note.time,
      gateOffTime: note.gateOffTime,
      accent: note.accent,
      padId: note.padId,
    });
  }

  /** Silence a single track: close gate and reset accent gain. Used by keyboard piano for note-off. */
  releaseTrack(trackId: string): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    const now = this.ctx?.currentTime ?? 0;
    if (slot.pool) {
      slot.pool.release(now);
    }
    // Release drum rack pads
    for (const padSlot of slot.drumPads.values()) {
      padSlot.synth.silence();
      padSlot.accentGain.gain.cancelAndHoldAtTime(now);
      padSlot.accentGain.gain.setValueAtTime(ACCENT_BASELINE, now);
    }
    for (const voice of this.activeVoices.values()) {
      if (voice.trackId === trackId) {
        voice.state = 'released';
      }
    }
  }

  /** Restore accent gains to baseline after silence zeroed them. */
  restoreBaseline(): void {
    const now = this.ctx?.currentTime ?? 0;
    for (const slot of this.tracks.values()) {
      if (slot.pool) slot.pool.restoreBaseline(now);
      // Restore drum rack pad accent gains
      for (const padSlot of slot.drumPads.values()) {
        padSlot.accentGain.gain.cancelAndHoldAtTime(now);
        padSlot.accentGain.gain.setValueAtTime(ACCENT_BASELINE, now);
      }
    }
    // Resume modulator output after pause
    for (const [, modSlots] of this.modulatorSlots) {
      for (const modSlot of modSlots) {
        modSlot.engine.resume();
      }
    }
  }

  releaseGeneration(generation: number): void {
    this.generation = Math.max(this.generation, generation);
    const activeTrackIds = this.collectTrackIdsThroughGeneration(generation);

    const now = this.ctx?.currentTime ?? 0;
    const fadeTime = now + 0.05; // 50ms fade-out
    for (const trackId of activeTrackIds) {
      const slot = this.tracks.get(trackId);
      if (!slot) continue;
      if (slot.pool) slot.pool.releaseAll(this.generation, now, fadeTime);
      // Release drum rack pads
      for (const padSlot of slot.drumPads.values()) {
        padSlot.synth.silence(this.generation);
        padSlot.accentGain.gain.cancelAndHoldAtTime(now);
        padSlot.accentGain.gain.linearRampToValueAtTime(0, fadeTime);
      }
      // Clear scheduled events in downstream processors (Rings/Clouds)
      // so their tails don't sustain indefinitely. Don't damp() Rings —
      // that's hard-stop behaviour; let the resonance decay naturally.
      for (const proc of slot.processors) {
        proc.engine.silence(this.generation);
      }
    }
    // Pause modulators so they don't keep running during pause
    for (const [, modSlots] of this.modulatorSlots) {
      for (const modSlot of modSlots) {
        modSlot.engine.silence(this.generation);
        modSlot.engine.pause();
      }
    }
    for (const voice of this.activeVoices.values()) {
      if (voice.generation <= generation) {
        voice.state = 'released';
      }
    }
  }

  silenceGeneration(generation: number): void {
    this.generation = Math.max(this.generation, generation);
    const activeTrackIds = this.collectTrackIdsThroughGeneration(generation);

    const now = this.ctx?.currentTime ?? 0;
    for (const trackId of activeTrackIds) {
      const slot = this.tracks.get(trackId);
      if (!slot) continue;
      if (slot.pool) slot.pool.silenceAll(this.generation, now);
      // Silence drum rack pads
      for (const padSlot of slot.drumPads.values()) {
        padSlot.synth.silence(this.generation);
        padSlot.accentGain.gain.cancelAndHoldAtTime(now);
        padSlot.accentGain.gain.setValueAtTime(0, now);
      }
      // Clear scheduled events in downstream processors and damp resonators
      for (const proc of slot.processors) {
        proc.engine.silence(this.generation);
        const descriptor = moduleDescriptors.get(proc.type);
        if (descriptor && descriptor.commands.includes('damp')) {
          proc.engine.sendCommand({ type: 'damp' });
        }
      }
    }
    // Clear scheduled events in modulators and pause their output
    for (const [, modSlots] of this.modulatorSlots) {
      for (const modSlot of modSlots) {
        modSlot.engine.silence(this.generation);
        modSlot.engine.pause();
      }
    }
    for (const voice of this.activeVoices.values()) {
      if (voice.generation <= generation) {
        voice.state = 'silenced';
      }
    }
  }

  private collectTrackIdsThroughGeneration(generation: number): string[] {
    this.pruneInactiveVoices();
    const trackIds = new Set<string>();
    for (const voice of this.activeVoices.values()) {
      if (voice.generation <= generation) {
        trackIds.add(voice.trackId);
      }
    }
    return [...trackIds];
  }

  private pruneInactiveVoices(now = this.getCurrentTime()): void {
    for (const [eventId, voice] of this.activeVoices) {
      if (voice.state !== 'scheduled') {
        this.activeVoices.delete(eventId);
        continue;
      }
      if (voice.gateOffTime + TRACK_TAIL_GRACE_SEC <= now) {
        this.activeVoices.delete(eventId);
      }
    }
  }

  getCurrentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  getState(): AudioContextState | undefined {
    return this.ctx?.state;
  }

  /** Ensure AudioContext is running (may have been auto-suspended by the browser). */
  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  getStereoAnalysers(): [AnalyserNode, AnalyserNode] | null {
    return this.analyserL && this.analyserR ? [this.analyserL, this.analyserR] : null;
  }

  /** Get the per-track analyser node for level metering. */
  getTrackAnalyser(trackId: string): AnalyserNode | null {
    return this.tracks.get(trackId)?.analyser ?? null;
  }

  getMediaStreamDestination(): MediaStreamAudioDestinationNode | null {
    return this.mediaStreamDest;
  }

  getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  // --- Master channel ---

  setMasterVolume(value: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, value));
    }
  }

  setMasterPan(value: number): void {
    if (this.masterPanner) {
      this.masterPanner.pan.value = Math.max(-1, Math.min(1, value));
    }
  }

  // --- Processor chain ---

  async addProcessor(trackId: string, processorType: string, processorId: string): Promise<void> {
    const key = `${trackId}:${processorId}`;
    if (this.pendingProcessors.has(key)) return;

    const slot = this.tracks.get(trackId);
    if (!slot || !this.ctx) return;
    if (slot.processors.some(p => p.id === processorId)) return;

    const descriptor = moduleDescriptors.get(processorType);
    if (!descriptor || descriptor.role !== 'processor') return;

    this.pendingProcessors.add(key);
    try {
      const { engine, degraded } = await descriptor.create(this.ctx);
      // After async gap: only insert if still wanted (key not cancelled
      // by removeProcessor) and not already present (dedupe).
      if (this.pendingProcessors.has(key) && !slot.processors.some(p => p.id === processorId)) {
        slot.processors.push({ id: processorId, type: processorType, engine, enabled: true, degraded });
        this.rebuildChain(slot);
      } else {
        engine.destroy();
      }
    } finally {
      this.pendingProcessors.delete(key);
    }
  }

  removeProcessor(trackId: string, processorId: string): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;

    // Cancel any in-flight add for this processor
    const key = `${trackId}:${processorId}`;
    this.pendingProcessors.delete(key);

    // Clean up sidechain route if this processor had one
    this.removeSidechain(trackId, processorId);

    const idx = slot.processors.findIndex(p => p.id === processorId);
    if (idx === -1) return;
    slot.processors[idx].engine.destroy();
    slot.processors.splice(idx, 1);
    this.rebuildChain(slot);
  }

  setProcessorPatch(trackId: string, processorId: string, params: Record<string, number>): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    const proc = slot.processors.find(p => p.id === processorId);
    if (!proc) return;
    proc.engine.setPatch(params);
  }

  setProcessorModel(trackId: string, processorId: string, model: number): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    const proc = slot.processors.find(p => p.id === processorId);
    if (!proc) return;
    proc.engine.setModel(model);
  }

  /** Enable or bypass a processor, rebuilding the chain to wire around it. */
  setProcessorEnabled(trackId: string, processorId: string, enabled: boolean): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    const proc = slot.processors.find(p => p.id === processorId);
    if (!proc) return;
    if (proc.enabled === enabled) return;
    proc.enabled = enabled;
    this.rebuildChain(slot);
  }

  getProcessors(trackId: string): { id: string; type: string }[] {
    const slot = this.tracks.get(trackId);
    if (!slot) return [];
    const result = slot.processors.map(p => ({ id: p.id, type: p.type }));
    // Include in-flight processors so the sync effect doesn't re-add them
    for (const key of this.pendingProcessors) {
      const [vid, pid] = key.split(':');
      if (vid === trackId && !result.some(p => p.id === pid)) {
        result.push({ id: pid!, type: 'unknown' });
      }
    }
    return result;
  }

  private rebuildChain(slot: TrackSlot): void {
    const now = this.ctx?.currentTime ?? 0;

    // Ramp chainOutGain to 0 before disconnecting to avoid a hard audio click (#139).
    // The ramp converts the dropout into a smooth ~2ms fade-out/fade-in.
    slot.chainOutGain.gain.cancelScheduledValues(now);
    slot.chainOutGain.gain.setValueAtTime(slot.chainOutGain.gain.value, now);
    slot.chainOutGain.gain.linearRampToValueAtTime(0, now + CHAIN_RAMP_SEC);

    // For bus tracks, the input is busInput; for audio tracks, it's sourceOut
    const inputNode = slot.isBus && slot.busInput ? slot.busInput : slot.sourceOut;

    // Disconnect input and all processors, then rewire
    inputNode.disconnect();
    for (const proc of slot.processors) {
      proc.engine.outputNode.disconnect();
    }

    // Filter to only enabled processors for the active chain
    const activeProcs = slot.processors.filter(p => p.enabled !== false);

    if (activeProcs.length === 0) {
      // Direct: input -> chainOutGain (all processors bypassed or none exist)
      inputNode.connect(slot.chainOutGain);
    } else {
      // Chain: input -> proc[0].in, proc[0].out -> proc[1].in, ..., proc[n].out -> chainOutGain
      inputNode.connect(activeProcs[0].engine.inputNode);
      for (let i = 0; i < activeProcs.length - 1; i++) {
        activeProcs[i].engine.outputNode.connect(activeProcs[i + 1].engine.inputNode);
      }
      activeProcs[activeProcs.length - 1].engine.outputNode.connect(slot.chainOutGain);
    }

    // Ramp chainOutGain back to 1 after reconnect
    slot.chainOutGain.gain.linearRampToValueAtTime(1, now + CHAIN_RAMP_SEC * 2);
  }

  // --- Modulator chain ---

  /** Tracks modulator IDs currently being created (async in-flight guard). */
  private pendingModulators = new Set<string>();
  private modulatorSlots: Map<string, ModulatorSlot[]> = new Map();
  private modulationRouteSlots: Map<string, ModulationRoute[]> = new Map();

  async addModulator(trackId: string, modulatorType: string, modulatorId: string): Promise<void> {
    const key = `${trackId}:${modulatorId}`;
    if (this.pendingModulators.has(key)) return;

    const slot = this.tracks.get(trackId);
    if (!slot || !this.ctx) return;
    const existing = this.modulatorSlots.get(trackId) ?? [];
    if (existing.some(s => s.id === modulatorId)) return;

    const descriptor = moduleDescriptors.get(modulatorType);
    if (!descriptor || descriptor.role !== 'modulator') return;

    this.pendingModulators.add(key);
    try {
      const { engine } = await descriptor.create(this.ctx);

      // After async gap: only insert if still wanted
      if (!this.pendingModulators.has(key)) {
        engine.destroy();
        return;
      }
      const currentSlots = this.modulatorSlots.get(trackId) ?? [];
      if (currentSlots.some(s => s.id === modulatorId)) {
        engine.destroy();
        return;
      }

      // Keep-alive: connect to a silent gain → destination (prevents GC)
      const keepAliveGain = this.ctx.createGain();
      keepAliveGain.gain.value = 0;
      engine.outputNode.connect(keepAliveGain);
      keepAliveGain.connect(this.ctx.destination);

      currentSlots.push({ id: modulatorId, type: modulatorType, engine, keepAliveGain });
      this.modulatorSlots.set(trackId, currentSlots);
    } finally {
      this.pendingModulators.delete(key);
    }
  }

  removeModulator(trackId: string, modulatorId: string): void {
    const key = `${trackId}:${modulatorId}`;
    this.pendingModulators.delete(key);

    const slots = this.modulatorSlots.get(trackId);
    if (slots) {
      const idx = slots.findIndex(s => s.id === modulatorId);
      if (idx !== -1) {
        const modSlot = slots[idx];
        modSlot.engine.destroy();
        modSlot.keepAliveGain.disconnect();
        slots.splice(idx, 1);
      }
    }

    // Cascade remove associated routes
    const routes = this.modulationRouteSlots.get(trackId);
    if (routes) {
      const toRemove = routes.filter(r => r.modulatorSlotId === modulatorId);
      for (const route of toRemove) {
        route.depthGain.disconnect();
      }
      this.modulationRouteSlots.set(trackId, routes.filter(r => r.modulatorSlotId !== modulatorId));
    }
  }

  setModulatorPatch(trackId: string, modulatorId: string, params: Record<string, number>): void {
    const slots = this.modulatorSlots.get(trackId);
    if (!slots) return;
    const modSlot = slots.find(s => s.id === modulatorId);
    if (!modSlot) return;
    modSlot.engine.setPatch(params);
  }

  setModulatorModel(trackId: string, modulatorId: string, model: number): void {
    const slots = this.modulatorSlots.get(trackId);
    if (!slots) return;
    const modSlot = slots.find(s => s.id === modulatorId);
    if (!modSlot) return;
    modSlot.engine.setModel(model);
  }

  addModulationRoute(trackId: string, routeId: string, modulatorId: string, target: ModulationTarget, depth: number): void {
    if (!this.ctx) return;
    const trackSlot = this.tracks.get(trackId);
    if (!trackSlot) return;
    const modSlots = this.modulatorSlots.get(trackId) ?? [];
    const modSlot = modSlots.find(s => s.id === modulatorId);
    if (!modSlot) return;

    // Resolve the target AudioWorkletNode(s) and AudioParam
    const resolved = this.resolveModulationTargets(trackSlot, target);
    if (resolved.length === 0) return;

    // Create GainNode for depth scaling: Tides output → GainNode(depth) → target AudioParam(s)
    const depthGain = this.ctx.createGain();
    depthGain.gain.value = depth;
    modSlot.engine.outputNode.connect(depthGain);
    // Connect to AudioParam on each voice — Web Audio sums all inputs to the same param
    for (const r of resolved) {
      depthGain.connect(r.audioParam);
    }

    const routes = this.modulationRouteSlots.get(trackId) ?? [];
    routes.push({ id: routeId, modulatorSlotId: modulatorId, depthGain, targetNode: resolved[0].targetNode, targetParam: resolved[0].paramName });
    this.modulationRouteSlots.set(trackId, routes);
    recordQaAudioTrace({
      type: 'modulation.route.add',
      trackId,
      routeId,
      modulatorId,
      target,
      depth,
      targetParam: resolved[0].paramName,
      targetCount: resolved.length,
    });
  }

  removeModulationRoute(trackId: string, routeId: string): void {
    const routes = this.modulationRouteSlots.get(trackId);
    if (!routes) return;
    const idx = routes.findIndex(r => r.id === routeId);
    if (idx === -1) return;
    routes[idx].depthGain.disconnect();
    recordQaAudioTrace({
      type: 'modulation.route.remove',
      trackId,
      routeId,
      modulatorId: routes[idx].modulatorSlotId,
      targetParam: routes[idx].targetParam,
    });
    routes.splice(idx, 1);
  }

  setModulationDepth(trackId: string, routeId: string, depth: number): void {
    const routes = this.modulationRouteSlots.get(trackId);
    if (!routes) return;
    const route = routes.find(r => r.id === routeId);
    if (!route) return;
    route.depthGain.gain.value = depth;
    recordQaAudioTrace({
      type: 'modulation.route.depth',
      trackId,
      routeId,
      modulatorId: route.modulatorSlotId,
      depth,
      targetParam: route.targetParam,
    });
  }

  getModulators(trackId: string): { id: string; type: string }[] {
    const slots = this.modulatorSlots.get(trackId) ?? [];
    const result = slots.map(s => ({ id: s.id, type: s.type }));
    // Include in-flight modulators so the sync effect doesn't re-add them
    for (const key of this.pendingModulators) {
      const [vid, mid] = key.split(':');
      if (vid === trackId && !result.some(s => s.id === mid)) {
        result.push({ id: mid!, type: 'unknown' });
      }
    }
    return result;
  }

  getModulationRoutes(trackId: string): { id: string; modulatorId: string }[] {
    const routes = this.modulationRouteSlots.get(trackId) ?? [];
    return routes.map(r => ({ id: r.id, modulatorId: r.modulatorSlotId }));
  }

  /**
   * Resolve a ModulationTarget to AudioWorkletNode(s) and AudioParam(s) for connection.
   * Source targets connect to all worklet nodes in the voice pool (or all drum pad worklet nodes).
   * Processor targets use the processor's inputNode.
   */
  private resolveModulationTargets(trackSlot: TrackSlot, target: ModulationTarget): { targetNode: AudioWorkletNode; paramName: string; audioParam: AudioParam }[] {
    if (target.kind === 'source') {
      const results: { targetNode: AudioWorkletNode; paramName: string; audioParam: AudioParam }[] = [];
      const runtimeParam = controlIdToRuntimeParam[target.param] ?? target.param;
      const paramName = `mod-${runtimeParam}`;

      // For drum rack tracks, route modulation to all pad worklet nodes
      if (trackSlot.isDrumRack) {
        for (const padSlot of trackSlot.drumPads.values()) {
          const workletNode = padSlot.synth.workletNode;
          if (!workletNode) continue;
          const audioParam = workletNode.parameters.get(paramName);
          if (audioParam) {
            results.push({ targetNode: workletNode, paramName, audioParam });
          }
        }
        return results;
      }

      if (!trackSlot.pool) return results;
      for (const workletNode of trackSlot.pool.workletNodes) {
        const audioParam = workletNode.parameters.get(paramName);
        if (audioParam) {
          results.push({ targetNode: workletNode, paramName, audioParam });
        }
      }
      return results;
    } else {
      const proc = trackSlot.processors.find(p => p.id === target.processorId);
      if (!proc) return [];
      const targetNode = proc.engine.inputNode as AudioWorkletNode;
      const paramName = `mod-${target.param}`;
      const audioParam = targetNode.parameters.get(paramName);
      if (!audioParam) return [];
      return [{ targetNode, paramName, audioParam }];
    }
  }

  // --- Send routing ---

  /** Set the master bus ID and re-route all existing tracks through it. */
  setMasterBus(masterBusId: string): void {
    this.masterBusId = masterBusId;
    this.rerouteToMasterBus();
  }

  /** Whether a track slot is a bus. */
  isTrackBus(trackId: string): boolean {
    return this.tracks.get(trackId)?.isBus ?? false;
  }

  /**
   * Sync send routing for a track to match the given sends array.
   * Creates/removes/updates send gain nodes as needed.
   */
  syncSends(trackId: string, sends: Array<{ busId: string; level: number }>): void {
    if (!this.ctx) return;
    const slot = this.tracks.get(trackId);
    if (!slot) return;

    const existing = this.sendSlots.get(trackId) ?? [];
    const desiredBusIds = new Set(sends.map(s => s.busId));

    // Remove sends that are no longer desired
    const kept: SendGainSlot[] = [];
    for (const s of existing) {
      if (!desiredBusIds.has(s.busId)) {
        s.sendGain.disconnect();
      } else {
        kept.push(s);
      }
    }

    // Update or add sends
    const result: SendGainSlot[] = [];
    for (const send of sends) {
      const busSlot = this.tracks.get(send.busId);
      if (!busSlot?.busInput) continue; // target bus doesn't exist or isn't a bus

      const existingSlot = kept.find(s => s.busId === send.busId);
      if (existingSlot) {
        // Update level
        existingSlot.sendGain.gain.value = send.level;
        result.push(existingSlot);
      } else {
        // Create new send gain node
        // Tap from post-fader output (muteGain) to bus input
        const sendGain = this.ctx.createGain();
        sendGain.gain.value = send.level;
        slot.muteGain.connect(sendGain);
        sendGain.connect(busSlot.busInput);
        result.push({ busId: send.busId, sendGain });
      }
    }

    if (result.length > 0) {
      this.sendSlots.set(trackId, result);
    } else {
      this.sendSlots.delete(trackId);
    }
  }

  // --- Sidechain routing ---

  /**
   * Set up a sidechain route: the source track's post-fader audio feeds the
   * compressor's sidechain (second) input on the target track.
   */
  setSidechain(sourceTrackId: string, targetTrackId: string, processorId: string): void {
    if (!this.ctx) return;
    const sourceSlot = this.tracks.get(sourceTrackId);
    const targetSlot = this.tracks.get(targetTrackId);
    if (!sourceSlot || !targetSlot) return;

    const proc = targetSlot.processors.find(p => p.id === processorId);
    if (!proc) return;
    const descriptor = moduleDescriptors.get(proc.type);
    if (!descriptor?.sidechain) return;

    const key = `${targetTrackId}:${processorId}`;

    // Remove existing sidechain on this processor if any
    this.removeSidechainByKey(key);

    // Create a tap from the source track's muteGain to the processor's sidechain input
    const tapGain = this.ctx.createGain();
    tapGain.gain.value = 1.0;
    sourceSlot.muteGain.connect(tapGain);

    // Connect to the processor's sidechain input
    tapGain.connect(proc.engine.inputNode, 0, descriptor.sidechain.inputIndex);
    proc.engine.sendCommand({ type: 'sidechain-enabled', enabled: true });

    this.sidechainSlots.set(key, {
      sourceTrackId,
      targetTrackId,
      processorId,
      tapGain,
    });
  }

  /**
   * Remove a sidechain route from a compressor processor.
   */
  removeSidechain(targetTrackId: string, processorId: string): void {
    const key = `${targetTrackId}:${processorId}`;
    this.removeSidechainByKey(key);
  }

  /**
   * Get the current sidechain source for a compressor processor, if any.
   */
  getSidechain(targetTrackId: string, processorId: string): string | undefined {
    const key = `${targetTrackId}:${processorId}`;
    return this.sidechainSlots.get(key)?.sourceTrackId;
  }

  private removeSidechainByKey(key: string): void {
    const existing = this.sidechainSlots.get(key);
    if (existing) {
      existing.tapGain.disconnect();
      // Notify the worklet that the sidechain is disconnected
      const targetSlot = this.tracks.get(existing.targetTrackId);
      const proc = targetSlot?.processors.find(p => p.id === existing.processorId);
      if (proc) {
        proc.engine.sendCommand({ type: 'sidechain-enabled', enabled: false });
      }
      this.sidechainSlots.delete(key);
    }
  }

  // --- Metronome ---

  setMetronomeVolume(volume: number): void {
    if (this.metronomeGain) {
      this.metronomeGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Immediately silence the metronome by setting gain to 0.
   * Already-scheduled clicks become inaudible. Call on transport stop/pause
   * to prevent stale clicks from the lookahead window ringing out.
   */
  silenceMetronome(): void {
    if (this.metronomeGain) {
      this.metronomeGain.gain.value = 0;
    }
  }

  /**
   * Schedule a metronome click at the given audio time.
   * Uses a short oscillator burst — higher pitch for beat 1 (accent).
   */
  scheduleClick(time: number, accent: boolean): void {
    if (!this.ctx || !this.metronomeGain) return;
    const freq = accent ? 1000 : 800;
    const duration = accent ? 0.03 : 0.02;
    const gain = accent ? 0.8 : 0.5;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(env);
    env.connect(this.metronomeGain);

    osc.start(time);
    osc.stop(time + duration + 0.01);
  }

  // --- Drum rack pad management ---

  /**
   * Add a pad to a drum rack track. Creates a Plaits synth instance with
   * per-pad gain and panner, connected to the track's sourceOut.
   */
  async addDrumPad(trackId: string, padId: string, model: number, params: Record<string, number>, level: number, pan: number, chokeGroup?: number): Promise<void> {
    if (!this.ctx) return;
    const slot = this.tracks.get(trackId);
    if (!slot || !slot.isDrumRack) return;
    if (slot.drumPads.has(padId)) return;

    const accentGain = this.ctx.createGain();
    accentGain.gain.value = ACCENT_BASELINE;

    const synth = await createPreferredSynth(this.ctx, accentGain);

    const padGain = this.ctx.createGain();
    padGain.gain.value = Math.max(0, Math.min(1, level));

    const padPanner = this.ctx.createStereoPanner();
    // Convert 0-1 pan (0.5=center) to -1..1 range
    padPanner.pan.value = Math.max(-1, Math.min(1, (pan - 0.5) * 2));

    // Wire: accentGain → padGain → padPanner → sourceOut
    accentGain.connect(padGain);
    padGain.connect(padPanner);
    padPanner.connect(slot.sourceOut);

    // Set model and params
    synth.setModel(model);
    synth.setParams({
      harmonics: params.harmonics ?? 0.5,
      timbre: params.timbre ?? 0.5,
      morph: params.morph ?? 0.5,
      note: params.note ?? 0.47,
    });
    if (synth.setExtended) {
      synth.setExtended(toPlaitsExtendedParams(params as SynthParamValues));
    }

    slot.drumPads.set(padId, {
      id: padId,
      synth,
      accentGain,
      padGain,
      padPanner,
      model,
      params: { ...params },
      chokeGroup,
      lastNoteTime: 0,
      lastGateOffTime: 0,
    });
  }

  /**
   * Remove a pad from a drum rack track. Destroys the synth and disconnects audio nodes.
   */
  removeDrumPad(trackId: string, padId: string): void {
    const slot = this.tracks.get(trackId);
    if (!slot || !slot.isDrumRack) return;
    const padSlot = slot.drumPads.get(padId);
    if (!padSlot) return;

    padSlot.synth.destroy();
    padSlot.accentGain.disconnect();
    padSlot.padGain.disconnect();
    padSlot.padPanner.disconnect();
    slot.drumPads.delete(padId);
  }

  /** Set the Plaits model for a specific drum pad. */
  setDrumPadModel(trackId: string, padId: string, model: number): void {
    const slot = this.tracks.get(trackId);
    if (!slot || !slot.isDrumRack) return;
    const padSlot = slot.drumPads.get(padId);
    if (!padSlot) return;
    padSlot.model = model;
    padSlot.synth.setModel(model);
  }

  /** Set the synth params for a specific drum pad. */
  setDrumPadParams(trackId: string, padId: string, params: Record<string, number>): void {
    const slot = this.tracks.get(trackId);
    if (!slot || !slot.isDrumRack) return;
    const padSlot = slot.drumPads.get(padId);
    if (!padSlot) return;
    padSlot.params = { ...params };
    padSlot.synth.setParams({
      harmonics: params.harmonics ?? 0.5,
      timbre: params.timbre ?? 0.5,
      morph: params.morph ?? 0.5,
      note: params.note ?? 0.47,
    });
    if (padSlot.synth.setExtended) {
      padSlot.synth.setExtended(toPlaitsExtendedParams(params as SynthParamValues));
    }
  }

  /** Set the per-pad level (gain) for a specific drum pad. */
  setDrumPadLevel(trackId: string, padId: string, level: number): void {
    const slot = this.tracks.get(trackId);
    if (!slot || !slot.isDrumRack) return;
    const padSlot = slot.drumPads.get(padId);
    if (!padSlot) return;
    padSlot.padGain.gain.value = Math.max(0, Math.min(1, level));
  }

  /** Set the per-pad pan for a specific drum pad (0-1, 0.5=center). */
  setDrumPadPan(trackId: string, padId: string, pan: number): void {
    const slot = this.tracks.get(trackId);
    if (!slot || !slot.isDrumRack) return;
    const padSlot = slot.drumPads.get(padId);
    if (!padSlot) return;
    // Convert 0-1 pan (0.5=center) to -1..1 range
    padSlot.padPanner.pan.value = Math.max(-1, Math.min(1, (pan - 0.5) * 2));
  }

  /** Update the choke group assignment for a specific drum pad. */
  setDrumPadChokeGroup(trackId: string, padId: string, chokeGroup: number | undefined): void {
    const slot = this.tracks.get(trackId);
    if (!slot || !slot.isDrumRack) return;
    const padSlot = slot.drumPads.get(padId);
    if (!padSlot) return;
    padSlot.chokeGroup = chokeGroup;
  }

  /** Check whether a drum rack track has a specific pad. */
  hasDrumPad(trackId: string, padId: string): boolean {
    const slot = this.tracks.get(trackId);
    if (!slot || !slot.isDrumRack) return false;
    return slot.drumPads.has(padId);
  }

  /** Return the pad IDs for a drum rack track. */
  getDrumPadIds(trackId: string): string[] {
    const slot = this.tracks.get(trackId);
    if (!slot || !slot.isDrumRack) return [];
    return [...slot.drumPads.keys()];
  }

  /** Check whether a track slot is a drum rack. */
  isTrackDrumRack(trackId: string): boolean {
    return this.tracks.get(trackId)?.isDrumRack ?? false;
  }
}
