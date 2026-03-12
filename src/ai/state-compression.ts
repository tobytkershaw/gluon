// src/ai/state-compression.ts
import type { Session, Voice } from '../engine/types';
import { getModelName, runtimeParamToControlId } from '../audio/instrument-registry';

interface CompressedPattern {
  length: number;
  active_steps: number[];
  accents: number[];
  locks: Record<string, Record<string, number>>;
}

interface CompressedVoice {
  id: string;
  model: string;
  params: Record<string, number>;
  agency: string;
  muted: boolean;
  solo: boolean;
  pattern: CompressedPattern;
}

interface CompressedHumanAction {
  voiceId: string;
  param: string;
  from: number;
  to: number;
  age_ms: number;
}

export interface CompressedState {
  voices: CompressedVoice[];
  activeVoiceId: string;
  transport: { bpm: number; swing: number; playing: boolean };
  context: { energy: number; density: number };
  undo_depth: number;
  recent_human_actions: CompressedHumanAction[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function modelName(model: number): string {
  const name = getModelName(model);
  return name.toLowerCase().replace(/[\s/]+/g, '_');
}

function compressPattern(voice: Voice): CompressedPattern {
  const active_steps: number[] = [];
  const accents: number[] = [];
  const locks: Record<string, Record<string, number>> = {};

  for (let i = 0; i < voice.pattern.length; i++) {
    const step = voice.pattern.steps[i];
    if (!step) continue;
    if (step.gate) active_steps.push(i);
    if (step.accent) accents.push(i);
    if (step.params) {
      const rounded: Record<string, number> = {};
      for (const [k, v] of Object.entries(step.params)) {
        if (v !== undefined) {
          const semanticKey = runtimeParamToControlId[k] ?? k;
          rounded[semanticKey] = round2(v);
        }
      }
      if (Object.keys(rounded).length > 0) {
        locks[String(i)] = rounded;
      }
    }
  }

  return { length: voice.pattern.length, active_steps, accents, locks };
}

export function compressState(session: Session): CompressedState {
  const now = Date.now();
  const result: CompressedState = {
    voices: session.voices.map(voice => ({
      id: voice.id,
      model: modelName(voice.model),
      params: {
        brightness: round2(voice.params.timbre),
        richness: round2(voice.params.harmonics),
        texture: round2(voice.params.morph),
        pitch: round2(voice.params.note),
      },
      agency: voice.agency,
      muted: voice.muted,
      solo: voice.solo,
      pattern: compressPattern(voice),
    })),
    activeVoiceId: session.activeVoiceId,
    transport: {
      bpm: session.transport.bpm,
      swing: round2(session.transport.swing),
      playing: session.transport.playing,
    },
    context: {
      energy: round2(session.context.energy),
      density: round2(session.context.density),
    },
    undo_depth: session.undoStack.length,
    recent_human_actions: session.recentHumanActions.slice(-5).map(a => ({
      voiceId: a.voiceId,
      param: runtimeParamToControlId[a.param] ?? a.param,
      from: round2(a.from),
      to: round2(a.to),
      age_ms: now - a.timestamp,
    })),
  };

  return result;
}
