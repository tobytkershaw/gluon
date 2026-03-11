// src/engine/sequencer-helpers.ts
import type { Step, Pattern } from './sequencer-types';
import type { Session, Voice, SynthParamValues } from './types';

export function createDefaultStep(): Step {
  return { gate: false, accent: false, micro: 0 };
}

export function createDefaultPattern(length = 16): Pattern {
  const clamped = Math.max(1, Math.min(64, length));
  return {
    steps: Array.from({ length: clamped }, createDefaultStep),
    length: clamped,
  };
}

export function getAudibleVoices(session: Session): Voice[] {
  const anySoloed = session.voices.some(v => v.solo);
  if (anySoloed) {
    return session.voices.filter(v => v.solo);
  }
  return session.voices.filter(v => !v.muted);
}

export function resolveNoteParams(
  voice: Voice,
  step: Step,
  heldParams: Partial<SynthParamValues>,
): SynthParamValues {
  return {
    ...voice.params,
    ...step.params,
    ...heldParams,
  } as SynthParamValues;
}
