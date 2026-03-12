// src/engine/sequencer-helpers.ts
import type { Step, Pattern } from './sequencer-types';
import type { Session, Voice, SynthParamValues } from './types';
import type { MusicalEvent, ParameterEvent } from './canonical-types';

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

const AT_TOLERANCE = 0.001;

/**
 * Collect ParameterEvents at the same position as `targetAt` (within tolerance),
 * and merge them with voice base params and held params.
 */
export function resolveEventParams(
  events: MusicalEvent[],
  targetAt: number,
  voiceParams: SynthParamValues,
  heldParams: Partial<SynthParamValues>,
  canonicalToRuntime?: (controlId: string) => string,
): SynthParamValues {
  const paramLocks: Partial<SynthParamValues> = {};
  const toRuntime = canonicalToRuntime ?? ((k: string) => k);

  for (const e of events) {
    if (e.kind !== 'parameter') continue;
    if (Math.abs(e.at - targetAt) > AT_TOLERANCE) continue;
    const runtimeKey = toRuntime((e as ParameterEvent).controlId);
    (paramLocks as Record<string, unknown>)[runtimeKey] = (e as ParameterEvent).value;
  }

  return {
    ...voiceParams,
    ...paramLocks,
    ...heldParams,
  } as SynthParamValues;
}
