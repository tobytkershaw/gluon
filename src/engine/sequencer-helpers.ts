// src/engine/sequencer-helpers.ts
import type { Step, StepGrid } from './sequencer-types';
import type { Session, Track, SynthParamValues } from './types';
import { getTrackKind } from './types';
import type { MusicalEvent, ParameterEvent } from './canonical-types';

export function createDefaultStep(): Step {
  return { gate: false, accent: false, micro: 0 };
}

export function createDefaultStepGrid(length = 16): StepGrid {
  const clamped = Math.max(1, Math.min(64, length));
  return {
    steps: Array.from({ length: clamped }, createDefaultStep),
    length: clamped,
  };
}

/**
 * Return tracks eligible for note scheduling.
 * Bus tracks are excluded (they receive audio via sends, not note events).
 */
export function getAudibleTracks(session: Session): Track[] {
  const audioTracks = session.tracks.filter(v => getTrackKind(v) === 'audio');
  const anySoloed = audioTracks.some(v => v.solo);
  if (anySoloed) {
    return audioTracks.filter(v => v.solo);
  }
  return audioTracks.filter(v => !v.muted);
}

const AT_TOLERANCE = 0.001;

/**
 * Collect ParameterEvents at the same position as `targetAt` (within tolerance),
 * and merge them with track base params and held params.
 */
export function resolveEventParams(
  events: MusicalEvent[],
  targetAt: number,
  trackParams: SynthParamValues,
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
    ...trackParams,
    ...paramLocks,
    ...heldParams,
  } as SynthParamValues;
}
