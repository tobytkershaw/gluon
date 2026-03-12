// src/engine/session.ts
import type { Session, Voice, Agency, MusicalContext, SynthParamValues } from './types';
import type { SourceAdapter, ControlState } from './canonical-types';
import { updateVoice } from './types';
import { getModelName, getEngineByIndex } from '../audio/instrument-registry';
import { createDefaultPattern } from './sequencer-helpers';
import { createDefaultRegion } from './region-helpers';

const VOICE_DEFAULTS: { model: number; engine: string }[] = [
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

function createVoice(index: number): Voice {
  const defaults = VOICE_DEFAULTS[index] ?? VOICE_DEFAULTS[0];
  const voiceId = `v${index}`;
  return {
    id: voiceId,
    engine: defaults.engine,
    model: defaults.model,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    agency: 'ON',
    pattern: createDefaultPattern(16),
    regions: [createDefaultRegion(voiceId, 16)],
    muted: false,
    solo: false,
    controlProvenance: buildDefaultProvenance(defaults.model),
  };
}

export function createSession(): Session {
  const voices = Array.from({ length: 4 }, (_, i) => createVoice(i));
  const context: MusicalContext = {
    key: null,
    scale: null,
    tempo: null,
    energy: 0.3,
    density: 0.2,
  };

  return {
    voices,
    activeVoiceId: voices[0].id,
    transport: { playing: false, bpm: 120, swing: 0 },
    undoStack: [],
    context,
    messages: [],
    recentHumanActions: [],
  };
}

export function setAgency(session: Session, voiceId: string, agency: Agency): Session {
  return updateVoice(session, voiceId, { agency });
}

export function updateVoiceParams(
  session: Session,
  voiceId: string,
  params: Partial<SynthParamValues>,
  trackAsHuman = false,
  adapter?: Pick<SourceAdapter, 'mapRuntimeParamKey'>,
): Session {
  const voice = session.voices.find(v => v.id === voiceId);
  if (!voice) return session;

  const newActions = trackAsHuman
    ? [
        ...session.recentHumanActions,
        ...Object.entries(params).map(([param, to]) => ({
          voiceId,
          param,
          from: voice.params[param] ?? 0,
          to: to as number,
          timestamp: Date.now(),
        })),
      ].slice(-20)
    : session.recentHumanActions;

  let newProvenance = voice.controlProvenance;
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
    ...updateVoice(session, voiceId, {
      params: { ...voice.params, ...params } as SynthParamValues,
      ...(newProvenance !== voice.controlProvenance ? { controlProvenance: newProvenance } : {}),
    }),
    recentHumanActions: newActions,
  };
}

export function setModel(session: Session, voiceId: string, model: number): Session {
  const name = getModelName(model);
  const engineName = name.startsWith('Unknown')
    ? `plaits:unknown_${model}`
    : `plaits:${name.toLowerCase().replace(/[\s/]+/g, '_')}`;
  return updateVoice(session, voiceId, { model, engine: engineName });
}

export function setActiveVoice(session: Session, voiceId: string): Session {
  if (!session.voices.find(v => v.id === voiceId)) return session;
  return { ...session, activeVoiceId: voiceId };
}

export function toggleMute(session: Session, voiceId: string): Session {
  const voice = session.voices.find(v => v.id === voiceId);
  if (!voice) return session;
  return updateVoice(session, voiceId, { muted: !voice.muted });
}

export function toggleSolo(session: Session, voiceId: string): Session {
  const voice = session.voices.find(v => v.id === voiceId);
  if (!voice) return session;
  return updateVoice(session, voiceId, { solo: !voice.solo });
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
