// src/engine/session.ts
import type { Session, Track, ApprovalLevel, MusicalContext, SynthParamValues, ModelSnapshot, MasterChannel, MasterSnapshot, ApprovalSnapshot, TrackAddSnapshot, TrackRemoveSnapshot, SendSnapshot, Send, Reaction, OpenDecision, TrackKind, PatternCrudSnapshot, TransportSnapshot, TrackPropertySnapshot, SequenceEditSnapshot, ABRestoreSnapshot, ActionGroupSnapshot } from './types';
import type { SourceAdapter, Pattern } from './canonical-types';
import type { TransportMode } from './sequencer-types';
import { updateTrack, DEFAULT_MASTER, MAX_TRACKS, MASTER_BUS_ID, getTrackKind, getActivePattern } from './types';
import { getModelName } from '../audio/instrument-registry';
import { createDefaultStepGrid } from './sequencer-helpers';
import { createDefaultPattern } from './region-helpers';
import type { SequenceAutomationPoint } from './sequencer-types';
import { splitSequenceAutomationAcrossRefs } from './sequence-automation';

function createDefaultTrack(index: number): Track {
  const trackId = `v${index}`;
  const track = createEmptyTrack(trackId);
  return { ...track, name: `T${index + 1}` };
}

let nextTransportCommandRequestId = 1;

function createPlayFromStepCommand(step: number) {
  return {
    kind: 'play-from-step' as const,
    step,
    requestId: nextTransportCommandRequestId++,
  };
}

/**
 * Create a bus track. Bus tracks have no source engine, empty patterns,
 * and exist to receive audio from sends and apply processing.
 */
export function createBusTrack(trackId: string, name?: string): Track {
  const defaultPattern = createDefaultPattern(trackId, 16);
  return {
    id: trackId,
    name,
    kind: 'bus',
    engine: '',
    model: -1,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    stepGrid: createDefaultStepGrid(16),
    patterns: [defaultPattern],
    sequence: [{ patternId: defaultPattern.id }],
    views: [],
    muted: false,
    solo: false,
    volume: 0.8,
    pan: 0.0,
    sends: [],
    surface: {
      modules: [],
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
  const audioTracks = Array.from({ length: 1 }, (_, i) => createDefaultTrack(i));
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
    transport: { status: 'stopped', bpm: 120, swing: 0, metronome: { enabled: false, volume: 0.5 }, timeSignature: { numerator: 4, denominator: 4 } },
    transportCommand: undefined,
    master: { ...DEFAULT_MASTER },
    undoStack: [],
    redoStack: [],
    context,
    messages: [],
    recentHumanActions: [],
    expandedTrackIds: [],
  };
}

/**
 * Derive the next unique track name by scanning existing names.
 * Names follow the pattern "T1", "T2", etc. Skips any number already in use.
 */
export function nextTrackName(session: Session): string {
  const existingNames = new Set(session.tracks.map(t => t.name).filter(Boolean));
  for (let i = 1; i <= MAX_TRACKS + 1; i++) {
    const name = `T${i}`;
    if (!existingNames.has(name)) return name;
  }
  return `T${Date.now()}`; // fallback
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
 * The track starts with an empty pattern, default volume/pan,
 * and no engine/model (engine index -1).
 */
export function createEmptyTrack(trackId: string): Track {
  const defaultPattern = createDefaultPattern(trackId, 16);
  return {
    id: trackId,
    engine: '',
    model: -1,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    stepGrid: createDefaultStepGrid(16),
    patterns: [defaultPattern],
    sequence: [{ patternId: defaultPattern.id }],
    views: [{ kind: 'step-grid', id: `step-grid-${trackId}` }],
    muted: false,
    solo: false,
    volume: 0.8,
    pan: 0.0,
    controlProvenance: {},
    surface: {
      modules: [],
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
    : { ...createEmptyTrack(trackId), name: nextTrackName(session) };

  const snapshot: TrackAddSnapshot = {
    kind: 'track-add',
    trackId,
    prevActiveTrackId: session.activeTrackId,
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

  // Auto-expand the newly added track
  const expandedTrackIds = session.expandedTrackIds ?? [];

  return {
    ...session,
    tracks: newTracks,
    activeTrackId: trackId,
    expandedTrackIds: [...expandedTrackIds, trackId],
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
  const newTracks = session.tracks
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
          kind: 'param' as const,
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

/** Toggle a track's expanded/collapsed state in the sidebar (accordion-style). */
export function toggleTrackExpanded(session: Session, trackId: string): Session {
  const expanded = session.expandedTrackIds ?? [];
  const isExpanded = expanded.includes(trackId);
  return {
    ...session,
    expandedTrackIds: isExpanded
      ? expanded.filter(id => id !== trackId)
      : [...expanded, trackId],
  };
}

export function toggleMute(session: Session, trackId: string): Session {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return session;
  const withSnapshot = pushTrackPropertySnapshot(session, trackId, { muted: track.muted }, `Toggle mute on ${track.name}`);
  return updateTrack(withSnapshot, trackId, { muted: !track.muted });
}

export function toggleSolo(session: Session, trackId: string, exclusive = true): Session {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return session;

  const newSolo = !track.solo;

  // When turning solo ON exclusively, clear solo on all other tracks first
  if (newSolo && exclusive) {
    // Capture previous solo state for all affected tracks as a group snapshot
    const snapshots: TrackPropertySnapshot[] = [];
    // Snapshot the target track
    snapshots.push({ kind: 'track-property', trackId, prevProps: { solo: track.solo }, timestamp: Date.now(), description: `Toggle solo on ${track.name}` });
    // Snapshot any other tracks that will lose solo
    for (const t of session.tracks) {
      if (t.id !== trackId && t.solo) {
        snapshots.push({ kind: 'track-property', trackId: t.id, prevProps: { solo: true }, timestamp: Date.now(), description: `Clear solo on ${t.name}` });
      }
    }
    const group: ActionGroupSnapshot = { kind: 'group', snapshots, timestamp: Date.now(), description: `Exclusive solo on ${track.name}` };
    const tracks = session.tracks.map(t =>
      t.id === trackId
        ? { ...t, solo: true }
        : t.solo ? { ...t, solo: false } : t,
    );
    return { ...session, tracks, undoStack: [...session.undoStack, group] };
  }

  const withSnapshot = pushTrackPropertySnapshot(session, trackId, { solo: track.solo }, `Toggle solo on ${track.name}`);
  return updateTrack(withSnapshot, trackId, { solo: newSolo });
}

export function renameTrack(session: Session, trackId: string, name: string): Session {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return session;
  const withSnapshot = pushTrackPropertySnapshot(session, trackId, { name: track.name }, `Rename track to ${name}`);
  return updateTrack(withSnapshot, trackId, { name });
}

export function setTrackVolume(session: Session, trackId: string, volume: number): Session {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return session;
  const withSnapshot = pushTrackPropertySnapshot(session, trackId, { volume: track.volume }, `Set track volume to ${volume}`);
  return updateTrack(withSnapshot, trackId, { volume: Math.max(0, Math.min(1, volume)) });
}

/** Apply track volume without pushing an undo snapshot (for use during continuous gestures). */
export function setTrackVolumeNoUndo(session: Session, trackId: string, volume: number): Session {
  return updateTrack(session, trackId, { volume: Math.max(0, Math.min(1, volume)) });
}

export function setTrackPan(session: Session, trackId: string, pan: number): Session {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return session;
  const withSnapshot = pushTrackPropertySnapshot(session, trackId, { pan: track.pan }, `Set track pan to ${pan}`);
  return updateTrack(withSnapshot, trackId, { pan: Math.max(-1, Math.min(1, pan)) });
}

/** Apply track pan without pushing an undo snapshot (for use during continuous gestures). */
export function setTrackPanNoUndo(session: Session, trackId: string, pan: number): Session {
  return updateTrack(session, trackId, { pan: Math.max(-1, Math.min(1, pan)) });
}

function pushTransportSnapshot(session: Session, description: string): Session {
  const snapshot: TransportSnapshot = {
    kind: 'transport',
    prevTransport: { ...session.transport },
    timestamp: Date.now(),
    description,
  };
  return { ...session, undoStack: [...session.undoStack, snapshot] };
}

function pushTrackPropertySnapshot(session: Session, trackId: string, prevProps: Partial<Track>, description: string): Session {
  const snapshot: TrackPropertySnapshot = {
    kind: 'track-property',
    trackId,
    prevProps,
    timestamp: Date.now(),
    description,
  };
  return { ...session, undoStack: [...session.undoStack, snapshot] };
}

export function setTransportBpm(session: Session, bpm: number): Session {
  const withSnapshot = pushTransportSnapshot(session, `Set BPM to ${bpm}`);
  return {
    ...withSnapshot,
    transport: { ...withSnapshot.transport, bpm: Math.max(20, Math.min(300, bpm)) },
  };
}

/** Apply BPM change without pushing an undo snapshot (for use during continuous gestures). */
export function setTransportBpmNoUndo(session: Session, bpm: number): Session {
  return {
    ...session,
    transport: { ...session.transport, bpm: Math.max(20, Math.min(300, bpm)) },
  };
}

export function toggleMetronome(session: Session): Session {
  const prev = session.transport.metronome;
  const withSnapshot = pushTransportSnapshot(session, `Toggle metronome ${prev.enabled ? 'off' : 'on'}`);
  return {
    ...withSnapshot,
    transport: { ...withSnapshot.transport, metronome: { ...prev, enabled: !prev.enabled } },
  };
}

export function setMetronomeVolume(session: Session, volume: number): Session {
  const withSnapshot = pushTransportSnapshot(session, `Set metronome volume to ${volume}`);
  return {
    ...withSnapshot,
    transport: { ...withSnapshot.transport, metronome: { ...withSnapshot.transport.metronome, volume: Math.max(0, Math.min(1, volume)) } },
  };
}

export function setTransportSwing(session: Session, swing: number): Session {
  const withSnapshot = pushTransportSnapshot(session, `Set swing to ${swing}`);
  return {
    ...withSnapshot,
    transport: { ...withSnapshot.transport, swing: Math.max(0, Math.min(1, swing)) },
  };
}

/** Apply swing change without pushing an undo snapshot (for use during continuous gestures). */
export function setTransportSwingNoUndo(session: Session, swing: number): Session {
  return {
    ...session,
    transport: { ...session.transport, swing: Math.max(0, Math.min(1, swing)) },
  };
}

export function setTimeSignature(session: Session, numerator: number, denominator: number): Session {
  const clampedNum = Math.max(1, Math.min(16, Math.round(numerator)));
  const validDenominators = [2, 4, 8, 16];
  const clampedDen = validDenominators.includes(denominator) ? denominator : 4;
  const withSnapshot = pushTransportSnapshot(session, `Set time signature to ${clampedNum}/${clampedDen}`);
  return {
    ...withSnapshot,
    transport: {
      ...withSnapshot.transport,
      timeSignature: { numerator: clampedNum, denominator: clampedDen },
    },
  };
}

export function playTransport(session: Session, fromStep?: number): Session {
  return {
    ...session,
    transport: {
      ...session.transport,
      status: 'playing',
    },
    transportCommand: fromStep !== undefined ? createPlayFromStepCommand(fromStep) : undefined,
  };
}

export function pauseTransport(session: Session): Session {
  return {
    ...session,
    transport: { ...session.transport, status: 'paused' },
    transportCommand: undefined,
  };
}

export function stopTransport(session: Session): Session {
  return {
    ...session,
    transport: { ...session.transport, status: 'stopped' },
    transportCommand: undefined,
  };
}

// --- Transport mode ---

export function setTransportMode(session: Session, mode: TransportMode): Session {
  const withSnapshot = pushTransportSnapshot(session, `Set transport mode to ${mode}`);
  return {
    ...withSnapshot,
    transport: { ...withSnapshot.transport, mode },
  };
}

// --- Transport loop ---

export function setTransportLoop(session: Session, loop: boolean): Session {
  const withSnapshot = pushTransportSnapshot(session, `Set loop ${loop ? 'on' : 'off'}`);
  return {
    ...withSnapshot,
    transport: { ...withSnapshot.transport, loop },
  };
}

// --- Master channel helpers ---

export function setMasterVolume(session: Session, volume: number): Session {
  return setMaster(session, { volume });
}

export function setMasterPan(session: Session, pan: number): Session {
  return setMaster(session, { pan });
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

export function setTrackImportance(session: Session, trackId: string, importance?: number, musicalRole?: string): Session {
  return updateTrack(session, trackId, {
    ...(importance !== undefined ? { importance: Math.max(0, Math.min(1, importance)) } : {}),
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

/** Apply master channel update without pushing an undo snapshot (for use during continuous gestures). */
export function setMasterNoUndo(session: Session, update: Partial<MasterChannel>): Session {
  const prev = session.master;
  const next: MasterChannel = {
    volume: update.volume != null ? Math.max(0, Math.min(1, update.volume)) : prev.volume,
    pan: update.pan != null ? Math.max(-1, Math.min(1, update.pan)) : prev.pan,
  };
  return { ...session, master: next };
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

// --- Pattern CRUD helpers ---

/** Maximum patterns per track. */
export const MAX_PATTERNS_PER_TRACK = 16;

/**
 * Derive a unique pattern ID within a track.
 */
function nextPatternId(track: Track): string {
  const existing = new Set(track.patterns.map(p => p.id));
  for (let i = 0; i < MAX_PATTERNS_PER_TRACK + 1; i++) {
    const id = `${track.id}-pattern-${i}`;
    if (!existing.has(id)) return id;
  }
  return `${track.id}-pattern-${Date.now()}`;
}

/**
 * Add a new empty pattern to a track. Returns null if at MAX_PATTERNS_PER_TRACK.
 * Sets the new pattern as active, adds a PatternRef to the sequence, and pushes an undo snapshot.
 */
export function addPattern(session: Session, trackId: string): Session | null {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return null;
  if (track.patterns.length >= MAX_PATTERNS_PER_TRACK) return null;

  const activePattern = getActivePattern(track);
  const newId = nextPatternId(track);
  const duration = activePattern?.duration ?? 16;

  const newPattern: Pattern = {
    id: newId,
    kind: 'pattern',
    duration,
    events: [],
  };

  const newPatterns = [...track.patterns, newPattern];
  const newSequence = [...track.sequence, { patternId: newId }];

  const snapshot: PatternCrudSnapshot = {
    kind: 'pattern-crud',
    trackId,
    action: 'add',
    addedPatternId: newId,
    prevActivePatternId: track.activePatternId,
    prevSequence: [...track.sequence],
    timestamp: Date.now(),
    description: `Add pattern to ${trackId}`,
  };

  const result = updateTrack(session, trackId, {
    patterns: newPatterns,
    sequence: newSequence,
    activePatternId: newId,
    _patternDirty: true,
  });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/** @deprecated Use addPattern instead. */
export const addRegion = (session: Session, trackId: string) => addPattern(session, trackId);

/**
 * Remove a pattern from a track. Returns null if only one pattern remains.
 * Also removes sequence refs to the removed pattern. Pushes an undo snapshot.
 */
export function removePattern(session: Session, trackId: string, patternId: string): Session | null {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return null;
  if (track.patterns.length <= 1) return null;

  const index = track.patterns.findIndex(p => p.id === patternId);
  if (index === -1) return null;

  const removedPattern = track.patterns[index];
  const newPatterns = track.patterns.filter(p => p.id !== patternId);
  const newSequence = track.sequence.filter(ref => ref.patternId !== patternId);

  // If the removed pattern was active, select an adjacent one
  let newActivePatternId = track.activePatternId;
  if (track.activePatternId === patternId || !track.activePatternId) {
    const newIdx = Math.min(index, newPatterns.length - 1);
    newActivePatternId = newPatterns[newIdx].id;
  }

  const snapshot: PatternCrudSnapshot = {
    kind: 'pattern-crud',
    trackId,
    action: 'remove',
    removedPattern,
    removedIndex: index,
    prevActivePatternId: track.activePatternId,
    prevSequence: [...track.sequence],
    timestamp: Date.now(),
    description: `Remove pattern ${patternId} from ${trackId}`,
  };

  const result = updateTrack(session, trackId, {
    patterns: newPatterns,
    sequence: newSequence,
    activePatternId: newActivePatternId,
    _patternDirty: true,
  });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/** @deprecated Use removePattern instead. */
export const removeRegion = removePattern;

/**
 * Duplicate a pattern on a track. The copy is inserted after the source.
 * Also adds a PatternRef to the sequence. Returns null if at MAX_PATTERNS_PER_TRACK.
 */
export function duplicatePattern(session: Session, trackId: string, patternId: string): Session | null {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return null;
  if (track.patterns.length >= MAX_PATTERNS_PER_TRACK) return null;

  const sourcePattern = track.patterns.find(p => p.id === patternId);
  if (!sourcePattern) return null;

  const newId = nextPatternId(track);
  const copy: Pattern = {
    ...sourcePattern,
    id: newId,
    name: sourcePattern.name ? `${sourcePattern.name} (copy)` : undefined,
    events: sourcePattern.events.map(e => ({ ...e })),
  };

  const newPatterns = [...track.patterns];
  const sourceIdx = newPatterns.findIndex(p => p.id === patternId);
  newPatterns.splice(sourceIdx + 1, 0, copy);

  const newSequence = [...track.sequence, { patternId: newId }];

  const snapshot: PatternCrudSnapshot = {
    kind: 'pattern-crud',
    trackId,
    action: 'duplicate',
    addedPatternId: newId,
    prevActivePatternId: track.activePatternId,
    prevSequence: [...track.sequence],
    timestamp: Date.now(),
    description: `Duplicate pattern ${patternId} on ${trackId}`,
  };

  const result = updateTrack(session, trackId, {
    patterns: newPatterns,
    sequence: newSequence,
    activePatternId: newId,
    _patternDirty: true,
  });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/** @deprecated Use duplicatePattern instead. */
export const duplicateRegion = duplicatePattern;

/** Rename a pattern. */
export function renamePattern(session: Session, trackId: string, patternId: string, name: string): Session {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return session;
  const pattern = track.patterns.find(p => p.id === patternId);
  if (!pattern) return session;

  const snapshot: PatternCrudSnapshot = {
    kind: 'pattern-crud',
    trackId,
    action: 'rename',
    patternId,
    previousName: pattern.name,
    timestamp: Date.now(),
    description: `Rename pattern ${patternId} on ${trackId}`,
  };

  const result = updateTrack(session, trackId, {
    patterns: track.patterns.map(p => p.id === patternId ? { ...p, name } : p),
  });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/** @deprecated Use renamePattern instead. */
export const renameRegion = renamePattern;

/** Set the active pattern on a track. */
export function setActivePatternOnTrack(session: Session, trackId: string, patternId: string): Session {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return session;
  if (!track.patterns.some(p => p.id === patternId)) return session;
  return updateTrack(session, trackId, { activePatternId: patternId });
}

/** @deprecated Use setActivePatternOnTrack instead. */
export const setActiveRegionOnTrack = setActivePatternOnTrack;


// --- Sequence (arrangement) editing helpers ---

/**
 * Append a PatternRef to the track's sequence.
 * Returns the session unchanged if the track or pattern doesn't exist.
 */
export function addPatternRef(session: Session, trackId: string, patternId: string): Session {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return session;
  if (!track.patterns.some(p => p.id === patternId)) return session;

  const snapshot: SequenceEditSnapshot = {
    kind: 'sequence-edit',
    trackId,
    prevSequence: [...track.sequence],
    timestamp: Date.now(),
    description: `Add pattern ref ${patternId} to sequence on ${trackId}`,
  };

  const newSequence = [...track.sequence, { patternId }];
  const result = updateTrack(session, trackId, { sequence: newSequence, _patternDirty: true });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/**
 * Remove a PatternRef from the track's sequence by index.
 * Prevents empty sequence — if only one ref remains, returns session unchanged.
 */
export function removePatternRef(session: Session, trackId: string, sequenceIndex: number): Session {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return session;
  if (track.sequence.length <= 1) return session; // prevent empty sequence
  if (sequenceIndex < 0 || sequenceIndex >= track.sequence.length) return session;

  const snapshot: SequenceEditSnapshot = {
    kind: 'sequence-edit',
    trackId,
    prevSequence: [...track.sequence],
    timestamp: Date.now(),
    description: `Remove sequence ref at index ${sequenceIndex} on ${trackId}`,
  };

  const newSequence = track.sequence.filter((_, i) => i !== sequenceIndex);
  const result = updateTrack(session, trackId, { sequence: newSequence, _patternDirty: true });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/**
 * Reorder a PatternRef within the track's sequence.
 * Moves the ref at fromIndex to toIndex.
 */
export function reorderPatternRef(session: Session, trackId: string, fromIndex: number, toIndex: number): Session {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return session;
  if (fromIndex === toIndex) return session;
  if (fromIndex < 0 || fromIndex >= track.sequence.length) return session;
  if (toIndex < 0 || toIndex >= track.sequence.length) return session;

  const snapshot: SequenceEditSnapshot = {
    kind: 'sequence-edit',
    trackId,
    prevSequence: [...track.sequence],
    timestamp: Date.now(),
    description: `Reorder sequence ref ${fromIndex} → ${toIndex} on ${trackId}`,
  };

  const newSequence = [...track.sequence];
  const [moved] = newSequence.splice(fromIndex, 1);
  newSequence.splice(toIndex, 0, moved);
  const result = updateTrack(session, trackId, { sequence: newSequence, _patternDirty: true });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

export function setSequenceAutomation(
  session: Session,
  trackId: string,
  controlId: string,
  points: SequenceAutomationPoint[],
): Session {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return session;
  if (track.sequence.length === 0) return session;

  const snapshot: SequenceEditSnapshot = {
    kind: 'sequence-edit',
    trackId,
    prevSequence: track.sequence.map(ref => ({
      ...ref,
      ...(ref.automation ? {
        automation: ref.automation.map(lane => ({
          ...lane,
          points: lane.points.map(point => ({ ...point })),
        })),
      } : {}),
    })),
    timestamp: Date.now(),
    description: `Set sequence automation ${controlId} on ${trackId}`,
  };

  const newSequence = splitSequenceAutomationAcrossRefs(track.sequence, track.patterns, controlId, points);
  const result = updateTrack(session, trackId, { sequence: newSequence, _patternDirty: true });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

export function clearSequenceAutomation(session: Session, trackId: string, controlId: string): Session {
  const track = session.tracks.find(t => t.id === trackId);
  if (!track) return session;
  const hasAutomation = track.sequence.some(ref => ref.automation?.some(lane => lane.controlId === controlId));
  if (!hasAutomation) return session;
  return setSequenceAutomation(session, trackId, controlId, []);
}


// --- A/B comparison helpers ---

/** Musical state snapshot for A/B comparison (excludes UI, undo, messages). */
export interface ABSnapshot {
  tracks: Track[];
  transport: import('./sequencer-types').Transport;
  master: MasterChannel;
  context: MusicalContext;
}

function deepCopyTrack(track: Track): Track {
  return {
    ...track,
    params: { ...track.params },
    stepGrid: { ...track.stepGrid, steps: track.stepGrid.steps.map(s => ({ ...s })) },
    patterns: track.patterns.map(p => ({ ...p, events: p.events.map(e => ({ ...e })) })),
    sequence: track.sequence.map(ref => ({
      ...ref,
      ...(ref.automation ? {
        automation: ref.automation.map(lane => ({
          ...lane,
          points: lane.points.map(point => ({ ...point })),
        })),
      } : {}),
    })),
    processors: track.processors?.map(p => ({ ...p, params: { ...p.params } })),
    modulators: track.modulators?.map(m => ({ ...m, params: { ...m.params } })),
    modulations: track.modulations?.map(r => ({ ...r, target: { ...r.target } })),
    sends: track.sends?.map(s => ({ ...s })),
    surface: {
      ...track.surface,
      modules: track.surface.modules.map(m => ({
        ...m,
        bindings: m.bindings.map(b => ({ ...b })),
        position: { ...m.position },
        config: structuredClone(m.config),
      })),
    },
    controlProvenance: track.controlProvenance ? { ...track.controlProvenance } : undefined,
    views: track.views?.map(v => ({ ...v })),
    _hiddenEvents: track._hiddenEvents?.map(e => ({ ...e })),
  };
}

/** Capture the musical state of a session for A/B comparison. */
export function captureABSnapshot(session: Session): ABSnapshot {
  return {
    tracks: session.tracks.map(deepCopyTrack),
    transport: { ...session.transport, metronome: { ...session.transport.metronome } },
    master: { ...session.master },
    context: { ...session.context },
  };
}

/** Restore an A/B snapshot into a session, preserving non-musical state.
 *  Playback state (playing, status, transportCommand) is preserved from the
 *  current session so that switching A/B does not interrupt the transport. */
export function restoreABSnapshot(session: Session, snapshot: ABSnapshot): Session {
  const abSnapshot: ABRestoreSnapshot = {
    kind: 'ab-restore',
    prevTracks: session.tracks.map(deepCopyTrack),
    prevTransport: { ...session.transport, metronome: { ...session.transport.metronome } },
    prevMaster: { ...session.master },
    prevContext: { ...session.context },
    prevActiveTrackId: session.activeTrackId,
    timestamp: Date.now(),
    description: 'Restore A/B snapshot',
  };

  return {
    ...session,
    tracks: snapshot.tracks.map(deepCopyTrack),
    transport: {
      ...snapshot.transport,
      metronome: { ...snapshot.transport.metronome },
      // Preserve playback state so A/B switching doesn't interrupt transport
      status: session.transport.status,
    },
    transportCommand: session.transport.status === 'playing' ? undefined : session.transportCommand,
    master: { ...snapshot.master },
    context: { ...snapshot.context },
    activeTrackId: snapshot.tracks.some(t => t.id === session.activeTrackId)
      ? session.activeTrackId
      : snapshot.tracks[0]?.id ?? session.activeTrackId,
    undoStack: [...session.undoStack, abSnapshot],
  };
}
