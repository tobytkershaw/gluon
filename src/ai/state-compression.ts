// src/ai/state-compression.ts
import type { Session, Voice } from '../engine/types';

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

export interface CompressedState {
  voices: CompressedVoice[];
  transport: { bpm: number; swing: number };
  leash: number;
  context: { energy: number; density: number };
  pending_count: number;
  undo_depth: number;
  recent_human_actions: string[];
  human_message?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function modelName(model: number): string {
  const names = [
    'virtual_analog', 'waveshaping', 'fm', 'grain_formant', 'harmonic',
    'wavetable', 'chords', 'vowel_speech', 'swarm', 'filtered_noise',
    'particle_dust', 'inharmonic_string', 'modal_resonator',
    'analog_bass_drum', 'analog_snare', 'analog_hi_hat',
  ];
  return names[model] ?? `unknown_${model}`;
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
        rounded[k] = round2(v);
      }
      if (Object.keys(rounded).length > 0) {
        locks[String(i)] = rounded;
      }
    }
  }

  return { length: voice.pattern.length, active_steps, accents, locks };
}

export function compressState(session: Session, humanMessage?: string): CompressedState {
  const result: CompressedState = {
    voices: session.voices.map(voice => ({
      id: voice.id,
      model: modelName(voice.model),
      params: {
        harmonics: round2(voice.params.harmonics),
        timbre: round2(voice.params.timbre),
        morph: round2(voice.params.morph),
        note: round2(voice.params.note),
      },
      agency: voice.agency,
      muted: voice.muted,
      solo: voice.solo,
      pattern: compressPattern(voice),
    })),
    transport: {
      bpm: session.transport.bpm,
      swing: round2(session.transport.swing),
    },
    leash: round2(session.leash),
    context: {
      energy: round2(session.context.energy),
      density: round2(session.context.density),
    },
    pending_count: session.pending.length,
    undo_depth: session.undoStack.length,
    recent_human_actions: session.recentHumanActions.slice(-5).map(
      (a) => `${a.param}: ${a.from.toFixed(2)} -> ${a.to.toFixed(2)}`
    ),
  };

  if (humanMessage) {
    result.human_message = humanMessage;
  }

  return result;
}
