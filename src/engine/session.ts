// src/engine/session.ts
import type { Session, Track, Agency, MusicalContext, SynthParamValues, ModelSnapshot, MasterChannel, MasterSnapshot } from './types';
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
    controlProvenance: buildDefaultProvenance(defaults.model),
    surface: {
      semanticControls: [],
      pinnedControls: [],
      xyAxes: { x: 'brightness', y: 'texture' },
      thumbprint: { type: 'static-color' },
    },
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
    transport: { playing: false, bpm: 120, swing: 0 },
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

export function togglePlaying(session: Session): Session {
  return {
    ...session,
    transport: { ...session.transport, playing: !session.transport.playing },
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
