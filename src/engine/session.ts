import type { Session, Voice, Agency, MusicalContext, SynthParamValues } from './types';
import { PLAITS_MODELS } from '../audio/synth-interface';

export function createSession(): Session {
  const voice: Voice = {
    id: 'voice-1',
    engine: 'plaits:virtual_analog',
    model: 0,
    params: {
      harmonics: 0.5,
      timbre: 0.5,
      morph: 0.5,
      note: 0.47,
    },
    agency: 'SUGGEST',
  };

  const context: MusicalContext = {
    key: null,
    scale: null,
    tempo: null,
    energy: 0.3,
    density: 0.2,
  };

  return {
    voice,
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

export function setAgency(session: Session, agency: Agency): Session {
  return {
    ...session,
    voice: { ...session.voice, agency },
  };
}

export function updateVoiceParams(session: Session, params: Partial<SynthParamValues>, trackAsHuman = false): Session {
  const newActions = trackAsHuman
    ? [
        ...session.recentHumanActions,
        ...Object.entries(params).map(([param, to]) => ({
          param,
          from: session.voice.params[param] ?? 0,
          to: to as number,
          timestamp: Date.now(),
        })),
      ].slice(-20)
    : session.recentHumanActions;

  return {
    ...session,
    voice: {
      ...session.voice,
      params: { ...session.voice.params, ...params } as SynthParamValues,
    },
    recentHumanActions: newActions,
  };
}

export function setModel(session: Session, model: number): Session {
  const modelInfo = PLAITS_MODELS[model];
  const engineName = modelInfo
    ? `plaits:${modelInfo.name.toLowerCase().replace(/[\s/]+/g, '_')}`
    : `plaits:unknown_${model}`;
  return {
    ...session,
    voice: { ...session.voice, model, engine: engineName },
  };
}
