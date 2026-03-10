// src/engine/session.ts
import type { Session, Voice, Agency, MusicalContext, SynthParamValues } from './types';
import { updateVoice } from './types';
import { PLAITS_MODELS } from '../audio/synth-interface';
import { createDefaultPattern } from './sequencer-helpers';

const VOICE_DEFAULTS: { model: number; engine: string }[] = [
  { model: 13, engine: 'plaits:analog_bass_drum' },
  { model: 0, engine: 'plaits:virtual_analog' },
  { model: 2, engine: 'plaits:fm' },
  { model: 4, engine: 'plaits:harmonic' },
];

function createVoice(index: number): Voice {
  const defaults = VOICE_DEFAULTS[index] ?? VOICE_DEFAULTS[0];
  return {
    id: `v${index}`,
    engine: defaults.engine,
    model: defaults.model,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    agency: 'OFF',
    pattern: createDefaultPattern(16),
    muted: false,
    solo: false,
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
    leash: 0.5,
    undoStack: [],
    pending: [],
    context,
    messages: [],
    recentHumanActions: [],
  };
}

export function setLeash(session: Session, value: number): Session {
  return { ...session, leash: Math.max(0, Math.min(1, value)) };
}

export function setAgency(session: Session, voiceId: string, agency: Agency): Session {
  return updateVoice(session, voiceId, { agency });
}

export function updateVoiceParams(
  session: Session,
  voiceId: string,
  params: Partial<SynthParamValues>,
  trackAsHuman = false,
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

  return {
    ...updateVoice(session, voiceId, {
      params: { ...voice.params, ...params } as SynthParamValues,
    }),
    recentHumanActions: newActions,
  };
}

export function setModel(session: Session, voiceId: string, model: number): Session {
  const modelInfo = PLAITS_MODELS[model];
  const engineName = modelInfo
    ? `plaits:${modelInfo.name.toLowerCase().replace(/[\s/]+/g, '_')}`
    : `plaits:unknown_${model}`;
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
