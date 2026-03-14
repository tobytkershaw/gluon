// src/audio/audio-engine.ts
import type { SynthParams } from './synth-interface';
import { DEFAULT_PARAMS } from './synth-interface';
import type { SynthEngine } from './synth-interface';
import { createPreferredSynth } from './create-synth';
import type { RingsEngine } from './rings-synth';
import type { CloudsEngine } from './clouds-synth';
import type { ScheduledNote } from '../engine/sequencer-types';
import type { ModulationTarget } from '../engine/types';
import type { TidesEngine } from './tides-synth';
import type { TidesPatchParams } from './tides-messages';
import type { RingsPatchParams } from './rings-messages';
import type { CloudsPatchParams } from './clouds-messages';
import { controlIdToRuntimeParam } from './instrument-registry';
import { recordQaAudioTrace } from '../qa/audio-trace';

const ACCENT_GAIN_BOOST = 2.0; // +6dB ~ 2x linear gain

type ProcessorEngine = RingsEngine | CloudsEngine;

interface ProcessorSlot {
  id: string;
  type: string;
  engine: ProcessorEngine;
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
  synth: SynthEngine;
  sourceOut: GainNode;   // routing node between source and processor chain
  muteGain: GainNode;    // controlled by mute/solo -- never touched by scheduleNote
  accentGain: GainNode;  // controlled by scheduleNote for accent boosts
  processors: ProcessorSlot[];
  currentParams: SynthParams;
  currentModel: number;
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

function toTidesPatchParams(params: Record<string, number>): TidesPatchParams {
  return {
    frequency: params.frequency ?? 0.5,
    shape: params.shape ?? 0.5,
    slope: params.slope ?? 0.5,
    smoothness: params.smoothness ?? 0.5,
  };
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private tracks: Map<string, TrackSlot> = new Map();
  private mixer: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private masterPanner: StereoPannerNode | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
  private _isRunning = false;
  /** Tracks processor IDs currently being created (async in-flight guard). */
  private pendingProcessors = new Set<string>();

  get isRunning(): boolean {
    return this._isRunning;
  }

  async start(trackIds: string[]): Promise<void> {
    if (this._isRunning) return;
    this.ctx = new AudioContext({ sampleRate: 48000 });

    this.mixer = this.ctx.createGain();
    this.mixer.gain.value = 1.0;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8; // default master volume

    this.masterPanner = this.ctx.createStereoPanner();
    this.masterPanner.pan.value = 0.0; // center

    this.analyser = this.ctx.createAnalyser();
    this.mediaStreamDest = this.ctx.createMediaStreamDestination();

    // Signal chain: mixer -> masterGain -> masterPanner -> analyser -> destination
    //                                                   -> mediaStreamDest
    this.mixer.connect(this.masterGain);
    this.masterGain.connect(this.masterPanner);
    this.masterPanner.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.masterPanner.connect(this.mediaStreamDest);

    for (const trackId of trackIds) {
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
      this.tracks.set(trackId, {
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
    // Destroy processors and tracks
    for (const slot of this.tracks.values()) {
      for (const proc of slot.processors) {
        proc.engine.destroy();
      }
      slot.synth.destroy();
    }
    this.tracks.clear();
    this.pendingProcessors.clear();
    this.mixer?.disconnect();
    this.masterGain?.disconnect();
    this.masterPanner?.disconnect();
    this.analyser?.disconnect();
    this.mediaStreamDest?.disconnect();
    this.ctx?.close();
    this.ctx = null;
    this.mixer = null;
    this.masterGain = null;
    this.masterPanner = null;
    this.analyser = null;
    this.mediaStreamDest = null;
    this._isRunning = false;
  }

  setTrackModel(trackId: string, model: number): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    slot.currentModel = model;
    slot.synth.setModel(model);
  }

  setTrackParams(trackId: string, params: SynthParams): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    slot.currentParams = { ...params };
    slot.synth.setParams(params);
  }

  muteTrack(trackId: string, muted: boolean): void {
    const slot = this.tracks.get(trackId);
    if (!slot) return;
    // Only touch muteGain -- accentGain is controlled by scheduleNote
    slot.muteGain.gain.value = muted ? 0 : 1;
  }

  scheduleNote(note: ScheduledNote): void {
    const slot = this.tracks.get(note.trackId);
    if (!slot) return;

    // --- Accent gain: schedule on accentGain (separate from muteGain) ---
    const accentLevel = note.accent ? 0.3 * ACCENT_GAIN_BOOST : 0.3;
    slot.accentGain.gain.setValueAtTime(accentLevel, note.time);
    if (note.accent) {
      // Revert accent at gate-off
      slot.accentGain.gain.setValueAtTime(0.3, note.gateOffTime);
    }
    slot.synth.scheduleNote(note);
    recordQaAudioTrace({
      type: 'audio.note',
      trackId: note.trackId,
      time: note.time,
      gateOffTime: note.gateOffTime,
      accent: note.accent,
    });
  }

  /** Restore accent gains to baseline after silenceAll() zeroed them. */
  restoreBaseline(): void {
    const now = this.ctx?.currentTime ?? 0;
    for (const slot of this.tracks.values()) {
      slot.accentGain.gain.cancelAndHoldAtTime(now);
      slot.accentGain.gain.setValueAtTime(0.3, now);
    }
    // Resume modulator output after pause
    for (const [, modSlots] of this.modulatorSlots) {
      for (const modSlot of modSlots) {
        modSlot.engine.resume();
      }
    }
  }

  silenceAll(): void {
    const now = this.ctx?.currentTime ?? 0;
    for (const slot of this.tracks.values()) {
      slot.synth.silence();
      // Cancel pending accent automation and hard-mute the track chain.
      // Setting gain to 0 (not baseline 0.3) ensures processor tails
      // (Rings resonance, Clouds reverb) are silenced immediately.
      // The scheduler restores gain via setValueAtTime on the next note.
      slot.accentGain.gain.cancelAndHoldAtTime(now);
      slot.accentGain.gain.setValueAtTime(0, now);
      // Clear scheduled events in downstream processors and damp resonators
      for (const proc of slot.processors) {
        proc.engine.silence();
        if (proc.type === 'rings') {
          (proc.engine as import('./rings-synth').RingsEngine).damp();
        }
      }
    }
    // Clear scheduled events in modulators and pause their output
    for (const [, modSlots] of this.modulatorSlots) {
      for (const modSlot of modSlots) {
        modSlot.engine.silence();
        modSlot.engine.pause();
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

  getMediaStreamDestination(): MediaStreamAudioDestinationNode | null {
    return this.mediaStreamDest;
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
        slot.processors.push({ id: processorId, type: processorType, engine });
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
    // Each processor type has its own setPatch shape — dispatch by type
    if (proc.type === 'rings') {
      (proc.engine as import('./rings-synth').RingsEngine).setPatch(toRingsPatchParams(params));
    } else if (proc.type === 'clouds') {
      (proc.engine as import('./clouds-synth').CloudsEngine).setPatch(toCloudsPatchParams(params));
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

    // Resolve the target AudioWorkletNode and AudioParam
    const resolved = this.resolveModulationTarget(trackSlot, target);
    if (!resolved) return;

    // Create GainNode for depth scaling: Tides output → GainNode(depth) → target AudioParam
    const depthGain = this.ctx.createGain();
    depthGain.gain.value = depth;
    modSlot.engine.outputNode.connect(depthGain);
    // Connect to AudioParam directly — Web Audio sums all inputs to the same param
    depthGain.connect(resolved.audioParam);

    const routes = this.modulationRouteSlots.get(trackId) ?? [];
    routes.push({ id: routeId, modulatorSlotId: modulatorId, depthGain, targetNode: resolved.targetNode, targetParam: resolved.paramName });
    this.modulationRouteSlots.set(trackId, routes);
    recordQaAudioTrace({
      type: 'modulation.route.add',
      trackId,
      routeId,
      modulatorId,
      target,
      depth,
      targetParam: resolved.paramName,
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
   * Resolve a ModulationTarget to the AudioWorkletNode and param index for connection.
   * Uses AudioWorkletNode.parameters to connect GainNode output to a specific AudioParam.
   *
   * Source targets use the Plaits worklet node (via synth.workletNode).
   * Processor targets use the processor's inputNode (which is an AudioWorkletNode).
   */
  private resolveModulationTarget(trackSlot: TrackSlot, target: ModulationTarget): { targetNode: AudioWorkletNode; paramName: string; audioParam: AudioParam } | null {
    if (target.kind === 'source') {
      const workletNode = trackSlot.synth.workletNode;
      if (!workletNode) return null;
      // Map canonical name → Plaits runtime param name via controlIdToRuntimeParam
      const runtimeParam = controlIdToRuntimeParam[target.param] ?? target.param;
      const paramName = `mod-${runtimeParam}`;
      const audioParam = workletNode.parameters.get(paramName);
      if (!audioParam) return null;
      return { targetNode: workletNode, paramName, audioParam };
    } else {
      const proc = trackSlot.processors.find(p => p.id === target.processorId);
      if (!proc) return null;
      const targetNode = proc.engine.inputNode as AudioWorkletNode;
      const paramName = `mod-${target.param}`;
      const audioParam = targetNode.parameters.get(paramName);
      if (!audioParam) return null;
      return { targetNode, paramName, audioParam };
    }
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
