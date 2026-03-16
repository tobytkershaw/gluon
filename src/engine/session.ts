// src/engine/session.ts
import type { Session, Track, Agency, ApprovalLevel, MusicalContext, SynthParamValues, ModelSnapshot, MasterChannel, MasterSnapshot, ApprovalSnapshot, TrackAddSnapshot, TrackRemoveSnapshot, SendSnapshot, Send, Reaction, OpenDecision, TrackKind, RegionCrudSnapshot } from './types';
import type { SourceAdapter, ControlState, Region } from './canonical-types';
import { updateTrack, DEFAULT_MASTER, MAX_TRACKS, MASTER_BUS_ID, getTrackKind, getActiveRegion } from './types';
import { getModelName, getEngineByIndex } from '../audio/instrument-registry';
import { createDefaultPattern } from './sequencer-helpers';
import { createDefaultRegion } from './region-helpers';

const TRACK_DEFAULTS: { model: number; engine: string }[] = [
  { model: 13, engine: 'plaits:analog_bass_drum' },
  { model: 0, engine: 'plaits:virtual_analog' },
  { model: 2, engine: 'plaits:fm' },
  { model: 4, engine: 'plaits:harmonic' },
];

function buildDefaultProvenance(modelIndex: number): ControlState {
  const engine = getEngineByIndex(modelIndex);
  if (!engine) return {};
  const provenance: ControlState = {};
  for (const control of engine.controls) {
    provenance[control.id] = {
      value: control.range?.default ?? 0.5,
      source: 'default',
    };
  }
  return provenance;
}

function createTrack(index: number): Track {
  const defaults = TRACK_DEFAULTS[index] ?? TRACK_DEFAULTS[0];
  const trackId = `v${index}`;
  return {
    id: trackId,
    engine: defaults.engine,
    model: defaults.model,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    agency: 'ON',
    pattern: createDefaultPattern(16),
    regions: [createDefaultRegion(trackId, 16)],
    views: [{ kind: 'step-grid', id: `step-grid-${trackId}` }],
    muted: false,
    solo: false,
    volume: 0.8,
    pan: 0.0,
    controlProvenance: buildDefaultProvenance(defaults.model),
    surface: {
      semanticControls: [],
      pinnedControls: [],
      xyAxes: { x: 'timbre', y: 'morph' },
      thumbprint: { type: 'static-color' },
    },
    approval: 'exploratory',
  };
}

/**
 * Create a bus track. Bus tracks have no source engine, empty patterns/regions,
 * and exist to receive audio from sends and apply processing.
 */
export function createBusTrack(trackId: string, name?: string): Track {
  return {
    id: trackId,
    name,
    kind: 'bus',
    engine: '',
    model: -1,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    agency: 'OFF',
    pattern: createDefaultPattern(16),
    regions: [createDefaultRegion(trackId, 16)],
    views: [],
    muted: false,
    solo: false,
    volume: 0.8,
    pan: 0.0,
    sends: [],
    surface: {
      semanticControls: [],
      pinnedControls: [],
      xyAxes: { x: 'timbre', y: 'morph' },
      thumbprint: { type: 'static-color' },
    },
    approval: 'exploratory',
  };
}

/** Create the master bus track. */
function createMasterBus(): Track {
  return createBusTrack(MASTER_BUS_ID, 'Master');
}

export function createSession(): Session {
  const audioTracks = Array.from({ length: 4 }, (_, i) => createTrack(i));
  const tracks = [...audioTracks, createMasterBus()];
  const context: MusicalContext = {
    key: null,
    scale: null,
    tempo: null,
    energy: 0.3,
    density: 0.2,
  };

  return {
    tracks,
    activeTrackId: tracks[0].id,
    transport: { status: 'stopped', playing: false, bpm: 120, swing: 0, metronome: { enabled: false, volume: 0.5 } },
    master: { ...DEFAULT_MASTER },
    undoStack: [],
    redoStack: [],
    context,
    messages: [],
    recentHumanActions: [],
  };
}

/**
 * Derive the next unique track ID by scanning existing IDs.
 * Track IDs follow the pattern "v0", "v1", etc.
 */
function nextTrackId(session: Session): string {
  const existing = new Set(session.tracks.map(t => t.id));
  for (let i = 0; i < MAX_TRACKS + 1; i++) {
    const id = `v${i}`;
    if (!existing.has(id)) return id;
  }
  return `v${Date.now()}`; // fallback
}

/**
 * Create a new empty track with no source module.
 * The track starts with an empty pattern and region, default volume/pan,
 * and no engine/model (engine index -1).
 */
export function createEmptyTrack(trackId: string): Track {
  return {
    id: trackId,
    engine: '',
    model: -1,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    agency: 'ON',
    pattern: createDefaultPattern(16),
    regions: [createDefaultRegion(trackId, 16)],
    views: [{ kind: 'step-grid', id: `step-grid-${trackId}` }],
    muted: false,
    solo: false,
    volume: 0.8,
    pan: 0.0,
    surface: {
      semanticControls: [],
      pinnedControls: [],
      xyAxes: { x: 'timbre', y: 'morph' },
      thumbprint: { type: 'static-color' },
    },
    approval: 'exploratory',
  };
}

/**
 * Add a new empty track to the session. Returns null if at MAX_TRACKS.
 * Pushes an undo snapshot so the add can be reverted.
 *
 * Audio tracks are inserted before bus tracks. Bus tracks are inserted
 * before the master bus. The master bus always remains last.
 */
export function addTrack(session: Session, kind: TrackKind = 'audio'): Session | null {
  if (session.tracks.length >= MAX_TRACKS) return null;

  const trackId = nextTrackId(session);
  const newTrack = kind === 'bus'
    ? createBusTrack(trackId)
    : createEmptyTrack(trackId);

  const snapshot: TrackAddSnapshot = {
    kind: 'track-add',
    trackId,
    timestamp: Date.now(),
    description: `Add ${kind} track ${trackId}`,
  };

  // Insert at the correct position to maintain ordering:
  // audio tracks → bus tracks → master bus
  const newTracks = [...session.tracks];
  let insertIndex: number;
  if (kind === 'audio') {
    // Insert before the first bus track
    insertIndex = newTracks.findIndex(t => getTrackKind(t) === 'bus');
    if (insertIndex === -1) insertIndex = newTracks.length;
  } else {
    // Insert before the master bus (or at end if no master)
    insertIndex = newTracks.findIndex(t => t.id === MASTER_BUS_ID);
    if (insertIndex === -1) insertIndex = newTracks.length;
  }
  newTracks.splice(insertIndex, 0, newTrack);

  return {
    ...session,
    tracks: newTracks,
    activeTrackId: trackId,
    undoStack: [...session.undoStack, snapshot],
  };
}

/**
 * Remove a track from the session. Returns null if only one audio track remains
 * or if attempting to remove the master bus.
 * Also removes any sends targeting this track from other tracks.
 * Pushes an undo snapshot so the removal can be reverted.
 */
export function removeTrack(session: Session, trackId: string): Session | null {
  // Never remove the master bus
  if (trackId === MASTER_BUS_ID) return null;

  const index = session.tracks.findIndex(t => t.id === trackId);
  if (index === -1) return null;

  // Must keep at least 1 audio track
  const audioCount = session.tracks.filter(t => getTrackKind(t) === 'audio').length;
  const removingAudio = getTrackKind(session.tracks[index]) === 'audio';
  if (removingAudio && audioCount <= 1) return null;

  const removedTrack = session.tracks[index];

  // Collect sends that point at the removed track before stripping them
  const affectedSends: Array<{ trackId: string; prevSends: Send[] }> = [];
  for (const t of session.tracks) {
    if (t.id === trackId) continue;
    const sends = t.sends;
    if (!sends || sends.length === 0) continue;
    if (sends.some(s => s.busId === trackId)) {
      affectedSends.push({ trackId: t.id, prevSends: [...sends] });
    }
  }

  // Remove sends targeting this track from all other tracks
  let newTracks = session.tracks
    .filter(t => t.id !== trackId)
    .map(t => {
      const sends = t.sends;
      if (!sends || sends.length === 0) return t;
      const filtered = sends.filter(s => s.busId !== trackId);
      if (filtered.length === sends.length) return t;
      return { ...t, sends: filtered };
    });

  // If the removed track was active, switch to an adjacent audio track
  let newActiveTrackId = session.activeTrackId;
  if (session.activeTrackId === trackId) {
    const audioTracks = newTracks.filter(t => getTrackKind(t) === 'audio');
    if (audioTracks.length > 0) {
      const newIndex = Math.min(index, audioTracks.length - 1);
      newActiveTrackId = audioTracks[newIndex].id;
    } else {
      newActiveTrackId = newTracks[0].id;
    }
  }

  const snapshot: TrackRemoveSnapshot = {
    kind: 'track-remove',
    removedTrack,
    removedIndex: index,
    prevActiveTrackId: session.activeTrackId,
    affectedSends: affectedSends.length > 0 ? affectedSends : undefined,
    timestamp: Date.now(),
    description: `Remove track ${trackId}`,
  };

  return {
    ...session,
    tracks: newTracks,
    activeTrackId: newActiveTrackId,
    undoStack: [...session.undoStack, snapshot],
  };
}

export function setAgency(session: Session, trackId: string, agency: Agency): Session {
  return updateTrack(session, trackId, { agency });
}

export function updateTrackParams(
  session: Session,
  trackId: string,
  params: Partial<SynthParamValues>,
  trackAsHuman = false,
  adapter?: Pick<SourceAdapter, 'mapRuntimeParamKey'>,
): Session {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return session;

  const newActions = trackAsHuman
    ? [
        ...session.recentHumanActions,
        ...Object.entries(params).map(([param, to]) => ({
          trackId,
          param,
          from: track.params[param] ?? 0,
          to: to as number,
          timestamp: Date.now(),
        })),
      ].slice(-20)
    : session.recentHumanActions;

  let newProvenance = track.controlProvenance;
  if (adapter && trackAsHuman && newProvenance) {
    newProvenance = { ...newProvenance };
    for (const paramKey of Object.keys(params)) {
      const controlId = adapter.mapRuntimeParamKey(paramKey);
      if (controlId && newProvenance[controlId]) {
        newProvenance[controlId] = {
          value: params[paramKey] as number,
          source: 'human',
          updatedAt: Date.now(),
        };
      }
    }
  }

  return {
    ...updateTrack(session, trackId, {
      params: { ...track.params, ...params } as SynthParamValues,
      ...(newProvenance !== track.controlProvenance ? { controlProvenance: newProvenance } : {}),
    }),
    recentHumanActions: newActions,
  };
}

export function setModel(session: Session, trackId: string, model: number): Session {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return session;

  const name = getModelName(model);
  const engineName = name.startsWith('Unknown')
    ? `plaits:unknown_${model}`
    : `plaits:${name.toLowerCase().replace(/[\s/]+/g, '_')}`;

  const snapshot: ModelSnapshot = {
    kind: 'model',
    trackId,
    prevModel: track.model,
    prevEngine: track.engine,
    timestamp: Date.now(),
    description: `Change model to ${name}`,
  };

  const result = updateTrack(session, trackId, { model, engine: engineName });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

export function setActiveTrack(session: Session, trackId: string): Session {
  if (!session.tracks.find(v => v.id === trackId)) return session;
  return { ...session, activeTrackId: trackId };
}

export function toggleMute(session: Session, trackId: string): Session {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return session;
  return updateTrack(session, trackId, { muted: !track.muted });
}

export function toggleSolo(session: Session, trackId: string): Session {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return session;
  return updateTrack(session, trackId, { solo: !track.solo });
}

export function renameTrack(session: Session, trackId: string, name: string): Session {
  return updateTrack(session, trackId, { name });
}

export function setTrackVolume(session: Session, trackId: string, volume: number): Session {
  return updateTrack(session, trackId, { volume: Math.max(0, Math.min(1, volume)) });
}

export function setTrackPan(session: Session, trackId: string, pan: number): Session {
  return updateTrack(session, trackId, { pan: Math.max(-1, Math.min(1, pan)) });
}

export function setTransportBpm(session: Session, bpm: number): Session {
  return {
    ...session,
    transport: { ...session.transport, bpm: Math.max(20, Math.min(300, bpm)) },
  };
}

export function toggleMetronome(session: Session): Session {
  const prev = session.transport.metronome;
  return {
    ...session,
    transport: { ...session.transport, metronome: { ...prev, enabled: !prev.enabled } },
  };
}

export function setMetronomeVolume(session: Session, volume: number): Session {
  return {
    ...session,
    transport: { ...session.transport, metronome: { ...session.transport.metronome, volume: Math.max(0, Math.min(1, volume)) } },
  };
}

export function setTransportSwing(session: Session, swing: number): Session {
  return {
    ...session,
    transport: { ...session.transport, swing: Math.max(0, Math.min(1, swing)) },
  };
}

export function playTransport(session: Session, fromStep?: number): Session {
  return {
    ...session,
    transport: { ...session.transport, status: 'playing', playing: true, playFromStep: fromStep },
  };
}

export function pauseTransport(session: Session): Session {
  return {
    ...session,
    transport: { ...session.transport, status: 'paused', playing: false },
  };
}

export function stopTransport(session: Session): Session {
  return {
    ...session,
    transport: { ...session.transport, status: 'stopped', playing: false },
  };
}

// --- Loop region helpers ---

export function toggleLoop(session: Session): Session {
  return {
    ...session,
    transport: { ...session.transport, loopEnabled: !session.transport.loopEnabled },
  };
}

export function setLoopStart(session: Session, step: number): Session {
  const clamped = Math.max(0, Math.floor(step));
  const loopEnd = session.transport.loopEnd ?? 16;
  return {
    ...session,
    transport: {
      ...session.transport,
      loopStart: Math.min(clamped, loopEnd - 1),
    },
  };
}

export function setLoopEnd(session: Session, step: number): Session {
  const loopStart = session.transport.loopStart ?? 0;
  const clamped = Math.max(loopStart + 1, Math.floor(step));
  return {
    ...session,
    transport: { ...session.transport, loopEnd: clamped },
  };
}

// --- Master channel helpers ---

export function setMasterVolume(session: Session, volume: number): Session {
  const clamped = Math.max(0, Math.min(1, volume));
  return { ...session, master: { ...session.master, volume: clamped } };
}

export function setMasterPan(session: Session, pan: number): Session {
  const clamped = Math.max(-1, Math.min(1, pan));
  return { ...session, master: { ...session.master, pan: clamped } };
}

// --- Reaction history helpers ---

/** Maximum number of reactions to keep in history. Older entries are discarded. */
export const MAX_REACTION_HISTORY = 50;

/** Append a reaction and bound the history to the most recent MAX_REACTION_HISTORY entries. */
export function addReaction(session: Session, reaction: Reaction): Session {
  const prev = session.reactionHistory ?? [];
  const next = [...prev, reaction].slice(-MAX_REACTION_HISTORY);
  return { ...session, reactionHistory: next };
}

export function setTrackImportance(session: Session, trackId: string, importance: number, musicalRole?: string): Session {
  const clamped = Math.max(0, Math.min(1, importance));
  return updateTrack(session, trackId, {
    importance: clamped,
    ...(musicalRole !== undefined ? { musicalRole } : {}),
  });
}

export function setMaster(session: Session, update: Partial<MasterChannel>): Session {
  const prev = session.master;
  const snapshot: MasterSnapshot = {
    kind: 'master',
    prevMaster: { ...prev },
    timestamp: Date.now(),
    description: 'Set master channel',
  };
  const next: MasterChannel = {
    volume: update.volume != null ? Math.max(0, Math.min(1, update.volume)) : prev.volume,
    pan: update.pan != null ? Math.max(-1, Math.min(1, update.pan)) : prev.pan,
  };
  return { ...session, master: next, undoStack: [...session.undoStack, snapshot] };
}

// --- Open decisions helpers ---

/** Maximum number of open (unresolved) decisions to keep. Resolved ones are pruned first. */
export const MAX_OPEN_DECISIONS = 20;

/** Add a new open decision, pruning resolved decisions and enforcing the bound. */
export function addDecision(session: Session, decision: OpenDecision): Session {
  const prev = session.openDecisions ?? [];
  // Prune resolved decisions first
  const unresolved = prev.filter(d => !d.resolved);
  const next = [...unresolved, decision].slice(-MAX_OPEN_DECISIONS);
  return { ...session, openDecisions: next };
}

/** Mark an existing decision as resolved. */
export function resolveDecision(session: Session, decisionId: string): Session {
  const prev = session.openDecisions ?? [];
  const next = prev.map(d => d.id === decisionId ? { ...d, resolved: true } : d);
  // Prune resolved decisions to keep list bounded
  const unresolved = next.filter(d => !d.resolved);
  return { ...session, openDecisions: unresolved };
}

// --- Approval helpers ---

export function setApproval(session: Session, trackId: string, level: ApprovalLevel, description?: string): Session {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return session;

  const prevApproval = track.approval ?? 'exploratory';
  if (prevApproval === level) return session; // no-op

  const snapshot: ApprovalSnapshot = {
    kind: 'approval',
    trackId,
    prevApproval,
    timestamp: Date.now(),
    description: description ?? `Set approval: ${prevApproval} → ${level}`,
  };

  const result = updateTrack(session, trackId, { approval: level });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

// --- Send routing helpers ---

/**
 * Add a send from a track to a bus track. Returns null if the bus doesn't exist,
 * the send already exists, or if trying to send from a bus to itself.
 */
export function addSend(session: Session, trackId: string, busId: string, level = 1.0): Session | null {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return null;
  // Target must be a bus
  const bus = session.tracks.find(t => t.id === busId);
  if (!bus || getTrackKind(bus) !== 'bus') return null;
  // No self-sends
  if (trackId === busId) return null;
  const sends = track.sends ?? [];
  // No duplicate sends
  if (sends.some(s => s.busId === busId)) return null;

  const snapshot: SendSnapshot = {
    kind: 'send',
    trackId,
    prevSends: [...sends],
    timestamp: Date.now(),
    description: `Add send from ${trackId} to ${busId}`,
  };

  const clamped = Math.max(0, Math.min(1, level));
  const result = updateTrack(session, trackId, { sends: [...sends, { busId, level: clamped }] });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/**
 * Remove a send from a track to a bus track.
 */
export function removeSend(session: Session, trackId: string, busId: string): Session | null {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return null;
  const sends = track.sends ?? [];
  if (!sends.some(s => s.busId === busId)) return null;

  const snapshot: SendSnapshot = {
    kind: 'send',
    trackId,
    prevSends: [...sends],
    timestamp: Date.now(),
    description: `Remove send from ${trackId} to ${busId}`,
  };

  const result = updateTrack(session, trackId, { sends: sends.filter(s => s.busId !== busId) });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/**
 * Set the send level for an existing send.
 */
export function setSendLevel(session: Session, trackId: string, busId: string, level: number): Session {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return session;
  const sends = track.sends ?? [];
  const idx = sends.findIndex(s => s.busId === busId);
  if (idx === -1) return session;

  const snapshot: SendSnapshot = {
    kind: 'send',
    trackId,
    prevSends: [...sends],
    timestamp: Date.now(),
    description: `Set send level from ${trackId} to ${busId}`,
  };

  const clamped = Math.max(0, Math.min(1, level));
  const newSends = [...sends];
  newSends[idx] = { ...newSends[idx], level: clamped };
  const result = updateTrack(session, trackId, { sends: newSends });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

// --- Region CRUD helpers ---

/** Maximum regions per track. */
export const MAX_REGIONS_PER_TRACK = 16;

/**
 * Derive a unique region ID within a track.
 */
function nextRegionId(track: Track): string {
  const existing = new Set(track.regions.map(r => r.id));
  for (let i = 0; i < MAX_REGIONS_PER_TRACK + 1; i++) {
    const id = `${track.id}-region-${i}`;
    if (!existing.has(id)) return id;
  }
  return `${track.id}-region-${Date.now()}`;
}

/**
 * Add a new empty region to a track. Inserts after `afterRegionId` if given,
 * otherwise appends at the end. Returns null if at MAX_REGIONS_PER_TRACK.
 * Sets the new region as active and pushes an undo snapshot.
 */
export function addRegion(session: Session, trackId: string, afterRegionId?: string): Session | null {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return null;
  if (track.regions.length >= MAX_REGIONS_PER_TRACK) return null;

  const activeRegion = getActiveRegion(track);
  const newId = nextRegionId(track);
  const duration = activeRegion?.duration ?? 16;

  let start: number;
  if (afterRegionId) {
    const afterRegion = track.regions.find(r => r.id === afterRegionId);
    start = afterRegion ? afterRegion.start + afterRegion.duration : 0;
  } else {
    const lastRegion = track.regions[track.regions.length - 1];
    start = lastRegion ? lastRegion.start + lastRegion.duration : 0;
  }

  const newRegion: Region = {
    id: newId,
    kind: 'pattern',
    start,
    duration,
    loop: true,
    events: [],
  };

  const newRegions = [...track.regions];
  if (afterRegionId) {
    const idx = newRegions.findIndex(r => r.id === afterRegionId);
    newRegions.splice(idx === -1 ? newRegions.length : idx + 1, 0, newRegion);
  } else {
    newRegions.push(newRegion);
  }

  const snapshot: RegionCrudSnapshot = {
    kind: 'region-crud',
    trackId,
    action: 'add',
    addedRegionId: newId,
    prevActiveRegionId: track.activeRegionId,
    timestamp: Date.now(),
    description: `Add region to ${trackId}`,
  };

  const result = updateTrack(session, trackId, {
    regions: newRegions,
    activeRegionId: newId,
    _regionDirty: true,
  });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/**
 * Remove a region from a track. Returns null if only one region remains.
 * Pushes an undo snapshot.
 */
export function removeRegion(session: Session, trackId: string, regionId: string): Session | null {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return null;
  if (track.regions.length <= 1) return null;

  const index = track.regions.findIndex(r => r.id === regionId);
  if (index === -1) return null;

  const removedRegion = track.regions[index];
  const newRegions = track.regions.filter(r => r.id !== regionId);

  // If the removed region was active, select an adjacent one
  let newActiveRegionId = track.activeRegionId;
  if (track.activeRegionId === regionId || !track.activeRegionId) {
    const newIdx = Math.min(index, newRegions.length - 1);
    newActiveRegionId = newRegions[newIdx].id;
  }

  const snapshot: RegionCrudSnapshot = {
    kind: 'region-crud',
    trackId,
    action: 'remove',
    removedRegion,
    removedIndex: index,
    prevActiveRegionId: track.activeRegionId,
    timestamp: Date.now(),
    description: `Remove region ${regionId} from ${trackId}`,
  };

  const result = updateTrack(session, trackId, {
    regions: newRegions,
    activeRegionId: newActiveRegionId,
    _regionDirty: true,
  });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/**
 * Duplicate a region on a track. The copy is inserted immediately after the source.
 * Returns null if at MAX_REGIONS_PER_TRACK.
 */
export function duplicateRegion(session: Session, trackId: string, regionId: string): Session | null {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return null;
  if (track.regions.length >= MAX_REGIONS_PER_TRACK) return null;

  const sourceRegion = track.regions.find(r => r.id === regionId);
  if (!sourceRegion) return null;

  const newId = nextRegionId(track);
  const lastRegion = track.regions[track.regions.length - 1];
  const copyStart = lastRegion ? lastRegion.start + lastRegion.duration : 0;
  const copy: Region = {
    ...sourceRegion,
    id: newId,
    name: sourceRegion.name ? `${sourceRegion.name} (copy)` : undefined,
    start: copyStart,
    events: sourceRegion.events.map(e => ({ ...e })),
  };

  const newRegions = [...track.regions];
  const sourceIdx = newRegions.findIndex(r => r.id === regionId);
  newRegions.splice(sourceIdx + 1, 0, copy);

  const snapshot: RegionCrudSnapshot = {
    kind: 'region-crud',
    trackId,
    action: 'duplicate',
    addedRegionId: newId,
    prevActiveRegionId: track.activeRegionId,
    timestamp: Date.now(),
    description: `Duplicate region ${regionId} on ${trackId}`,
  };

  const result = updateTrack(session, trackId, {
    regions: newRegions,
    activeRegionId: newId,
    _regionDirty: true,
  });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/** Rename a region. */
export function renameRegion(session: Session, trackId: string, regionId: string, name: string): Session {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return session;
  const region = track.regions.find(r => r.id === regionId);
  if (!region) return session;

  const snapshot: RegionCrudSnapshot = {
    kind: 'region-crud',
    trackId,
    action: 'rename',
    regionId,
    previousName: region.name,
    timestamp: Date.now(),
    description: `Rename region ${regionId} on ${trackId}`,
  };

  const result = updateTrack(session, trackId, {
    regions: track.regions.map(r => r.id === regionId ? { ...r, name } : r),
  });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/** Set the active region on a track. */
export function setActiveRegionOnTrack(session: Session, trackId: string, regionId: string): Session {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return session;
  if (!track.regions.some(r => r.id === regionId)) return session;
  return updateTrack(session, trackId, { activeRegionId: regionId });
}
