// src/audio/audio-engine.ts
import type { SynthParams } from './synth-interface';
import { DEFAULT_PARAMS } from './synth-interface';
import { createPreferredSynth } from './create-synth';
import type { RingsEngine } from './rings-synth';
import type { CloudsEngine } from './clouds-synth';
import type { ScheduledNote } from '../engine/sequencer-types';
import type { SynthParamValues, ModulationTarget } from '../engine/types';
import type { TidesEngine } from './tides-synth';
import type { TidesPatchParams } from './tides-messages';
import type { RingsPatchParams } from './rings-messages';
import type { CloudsPatchParams } from './clouds-messages';
import type { PlaitsExtendedParams } from './plaits-messages';
import { controlIdToRuntimeParam } from './instrument-registry';
import { recordQaAudioTrace } from '../qa/audio-trace';
import { VoicePool, ACCENT_BASELINE } from './voice-pool';

/** Duration (seconds) for the gain ramp used during chain rebuild to avoid clicks. */
const CHAIN_RAMP_SEC = 0.002; // ~2ms
/** Keep completed voices around briefly so generation cleanup still reaches processor tails. */
const TRACK_TAIL_GRACE_SEC = 2.0;
/** Number of synth voices per track for polyphonic overlap handling. */
const VOICES_PER_TRACK = 4;

type ProcessorEngine = RingsEngine | CloudsEngine;

interface ProcessorSlot {
  id: string;
  type: string;
  engine: ProcessorEngine;
  /** Whether this processor is wired into the chain. Default: true. */
  enabled: boolean;
}

interface ModulatorSlot {
  id: string;
  type: string;
  engine: TidesEngine;
  keepAliveGain: GainNode;  // gain=0 → destination (prevents GC)
}

interface ModulationRoute {
  id: string;
  modulatorSlotId: string;
  depthGain: GainNode;
  targetNode: AudioWorkletNode;
  targetParam: string;  // "mod-timbre" etc.
}

interface TrackSlot {
  pool: VoicePool | null; // null for bus tracks (they have no voices)
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
}

/** Per-track send routing: a gain node controlling send level, connected to a bus's busInput. */
interface SendGainSlot {
  busId: string;
  sendGain: GainNode;
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

function toRingsPatchParams(params: Record<string, number>): RingsPatchParams {
  return {
    structure: params.structure ?? 0.5,
    brightness: params.brightness ?? 0.5,
    damping: params.damping ?? 0.7,
    position: params.position ?? 0.5,
  };
}

function toCloudsPatchParams(params: Record<string, number>): CloudsPatchParams {
  return {
    position: params.position ?? 0.5,
    size: params.size ?? 0.5,
    density: params.density ?? 0.5,
    feedback: params.feedback ?? 0.5,
  };
}

function toCloudsExtendedParams(params: Record<string, number>): import('./clouds-messages').CloudsExtendedParams {
  return {
    texture: params.texture ?? 0.5,
    pitch: params.pitch ?? 0.5,
    dry_wet: params['dry-wet'] ?? 0.5,
    stereo_spread: params['stereo-spread'] ?? 0.0,
    reverb: params.reverb ?? 0.0,
  };
}

function toTidesPatchParams(params: Record<string, number>): TidesPatchParams {
  return {
    frequency: params.frequency ?? 0.5,
    shape: params.shape ?? 0.5,
    slope: params.slope ?? 0.5,
    smoothness: params.smoothness ?? 0.5,
  };
}

function toTidesExtendedParams(params: Record<string, number>): import('./tides-messages').TidesExtendedParams {
  return {
    shift: params.shift ?? 0.0,
    output_mode: Math.round(params['output-mode'] ?? 0),
    range: Math.round(params.range ?? 0),
  };
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
  /** The master bus track ID, used for routing all track outputs. */
  private masterBusId: string | null = null;
  /** Metronome gain node — connected directly to destination, bypassing tracks/mixer. */
  private metronomeGain: GainNode | null = null;

  get isRunning(): boolean {
    return this._isRunning;
  }

  async start(trackIds: string[], busTrackIds: string[] = [], masterBusId?: string): Promise<void> {
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
    this.masterBusId = masterBusId ?? null;

    // Create all bus tracks first so audio tracks can reference the master bus
    for (const busId of busTrackIds) {
      await this.createBusSlot(busId);
    }

    // Create audio track slots
    for (const trackId of trackIds) {
      if (allBusIds.has(trackId)) continue; // already created as bus
      await this.createAudioSlot(trackId);
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
    // Tap post-volume for level metering
    trackVolume.connect(analyser);

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
    // Tap post-volume for level metering
    trackVolume.connect(analyser);

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
    // Destroy send gain nodes
    for (const [, slots] of this.sendSlots) {
      for (const s of slots) s.sendGain.disconnect();
    }
    this.sendSlots.clear();
    this.masterBusId = null;
    // Destroy processors and tracks
    for (const slot of this.tracks.values()) {
      for (const proc of slot.processors) {
        proc.engine.destroy();
      }
      if (slot.pool) slot.pool.destroy();
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

  /**
   * Dynamically add a new track slot to the running audio engine.
   * Creates a voice pool and the per-track gain/pan chain.
   * For bus tracks, pass isBus=true to skip voice pool creation.
   */
  async addTrack(trackId: string, isBus = false): Promise<void> {
    if (!this.ctx || !this.mixer) return;
    if (this.tracks.has(trackId)) return;

    if (isBus) {
      await this.createBusSlot(trackId);
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
    // Clean up active voices for this track
    for (const [eventId, voice] of this.activeVoices) {
      if (voice.trackId === trackId) this.activeVoices.delete(eventId);
    }
    // Destroy voice pool and disconnect audio nodes
    if (slot.pool) slot.pool.destroy();
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

  muteTrack(trackId: string, muted: boolean): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    // Only touch muteGain -- accentGain is per-voice, controlled by scheduleNote
    slot.muteGain.gain.value = muted ? 0 : 1;
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
    if (!slot || !slot.pool) return;
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

  /** Silence a single track: close gate and reset accent gain. Used by keyboard piano for note-off. */
  releaseTrack(trackId: string): void {
    const slot = this.tracks.get(trackId);
    if (!slot || !slot.pool) return;
    const now = this.ctx?.currentTime ?? 0;
    slot.pool.release(now);
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
      // Clear scheduled events in downstream processors and damp resonators
      for (const proc of slot.processors) {
        proc.engine.silence(this.generation);
        if (proc.type === 'rings') {
          (proc.engine as import('./rings-synth').RingsEngine).damp();
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
        slot.processors.push({ id: processorId, type: processorType, engine, enabled: true });
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
    // Each processor type has its own setPatch shape — dispatch by type.
    // Continuous params go via setPatch; discrete/boolean params use dedicated setters.
    if (proc.type === 'rings') {
      const engine = proc.engine as import('./rings-synth').RingsEngine;
      engine.setPatch(toRingsPatchParams(params));
      if (params.polyphony !== undefined) engine.setPolyphony(Math.round(params.polyphony));
      if (params['internal-exciter'] !== undefined) engine.setInternalExciter(params['internal-exciter'] >= 0.5);
      if (params['fine-tune'] !== undefined) engine.setFineTune(params['fine-tune']);
    } else if (proc.type === 'clouds') {
      const engine = proc.engine as import('./clouds-synth').CloudsEngine;
      engine.setPatch(toCloudsPatchParams(params));
      engine.setExtended(toCloudsExtendedParams(params));
      if (params.freeze !== undefined) engine.setFreeze(params.freeze >= 0.5);
    }
  }

  setProcessorModel(trackId: string, processorId: string, model: number): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    const proc = slot.processors.find(p => p.id === processorId);
    if (!proc) return;
    if (proc.type === 'rings') {
      (proc.engine as import('./rings-synth').RingsEngine).setModel(model);
    } else if (proc.type === 'clouds') {
      (proc.engine as import('./clouds-synth').CloudsEngine).setMode(model);
    }
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
      proc.engine.inputNode.disconnect();
    }

    // Filter to only enabled processors for the active chain
    const activeProcs = slot.processors.filter(p => p.enabled !== false);

    if (activeProcs.length === 0) {
      // Direct: input -> chainOutGain (all processors bypassed or none exist)
      inputNode.connect(slot.chainOutGain);
    } else {
      // Chain: input -> proc[0] -> ... -> proc[n] -> chainOutGain
      inputNode.connect(activeProcs[0].engine.inputNode);
      for (let i = 0; i < activeProcs.length - 1; i++) {
        activeProcs[i].engine.inputNode.connect(activeProcs[i + 1].engine.inputNode);
      }
      activeProcs[activeProcs.length - 1].engine.inputNode.connect(slot.chainOutGain);
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

    this.pendingModulators.add(key);
    try {
      if (modulatorType !== 'tides') return;
      const { createTidesModulator } = await import('./create-synth');
      const engine = await createTidesModulator(this.ctx);

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
    modSlot.engine.setPatch(toTidesPatchParams(params));
    modSlot.engine.setExtended(toTidesExtendedParams(params));
  }

  setModulatorModel(trackId: string, modulatorId: string, model: number): void {
    const slots = this.modulatorSlots.get(trackId);
    if (!slots) return;
    const modSlot = slots.find(s => s.id === modulatorId);
    if (!modSlot) return;
    modSlot.engine.setMode(model);
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
   * Source targets connect to all worklet nodes in the voice pool.
   * Processor targets use the processor's inputNode.
   */
  private resolveModulationTargets(trackSlot: TrackSlot, target: ModulationTarget): { targetNode: AudioWorkletNode; paramName: string; audioParam: AudioParam }[] {
    if (target.kind === 'source') {
      const results: { targetNode: AudioWorkletNode; paramName: string; audioParam: AudioParam }[] = [];
      if (!trackSlot.pool) return results;
      const runtimeParam = controlIdToRuntimeParam[target.param] ?? target.param;
      const paramName = `mod-${runtimeParam}`;
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

  // Legacy single-track API (for Phase 1 compatibility during migration)
  setModel(model: number): void {
    const firstTrack = this.tracks.keys().next().value;
    if (firstTrack) this.setTrackModel(firstTrack, model);
  }

  setParams(params: Partial<SynthParams>): void {
    const firstTrack = this.tracks.entries().next().value;
    if (firstTrack) {
      const [id, slot] = firstTrack;
      const merged = { ...slot.currentParams, ...params };
      this.setTrackParams(id, merged);
    }
  }
}
