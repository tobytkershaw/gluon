// src/engine/session.ts
import type { Session, Track, Agency, ApprovalLevel, MusicalContext, SynthParamValues, ModelSnapshot, MasterChannel, MasterSnapshot, ApprovalSnapshot, Reaction, OpenDecision } from './types';
import type { SourceAdapter, ControlState } from './canonical-types';
import { updateTrack, DEFAULT_MASTER } from './types';
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
      xyAxes: { x: 'brightness', y: 'texture' },
      thumbprint: { type: 'static-color' },
    },
    approval: 'exploratory',
  };
}

export function createSession(): Session {
  const tracks = Array.from({ length: 4 }, (_, i) => createTrack(i));
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
    transport: { status: 'stopped', playing: false, bpm: 120, swing: 0 },
    master: { ...DEFAULT_MASTER },
    undoStack: [],
    context,
    messages: [],
    recentHumanActions: [],
  };
}

export function setAgency(session: Session, trackId: string, agency: Agency): Session {
  return updateTrack(session, trackId, { agency });
}

export function setApproval(session: Session, trackId: string, level: ApprovalLevel): Session {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return session;
  const prev = track.approval ?? 'exploratory';
  if (prev === level) return session;
  const snapshot: ApprovalSnapshot = {
    kind: 'approval',
    trackId,
    prevApproval: prev,
    timestamp: Date.now(),
    description: `Set approval: ${prev} → ${level}`,
  };
  const updated = updateTrack(session, trackId, { approval: level });
  return { ...updated, undoStack: [...updated.undoStack, snapshot] };
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

export function setTransportBpm(session: Session, bpm: number): Session {
  return {
    ...session,
    transport: { ...session.transport, bpm: Math.max(60, Math.min(200, bpm)) },
  };
}

export function setTransportSwing(session: Session, swing: number): Session {
  return {
    ...session,
    transport: { ...session.transport, swing: Math.max(0, Math.min(1, swing)) },
  };
}

export function playTransport(session: Session): Session {
  return {
    ...session,
    transport: { ...session.transport, status: 'playing', playing: true },
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
