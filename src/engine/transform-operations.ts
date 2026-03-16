// src/engine/transform-operations.ts
// Session-level transform operations with undo support.
import type { Session, PatternEditSnapshot } from './types';
import { getTrack, getActivePattern, updateTrack } from './types';
import { normalizePatternEvents } from './region-helpers';
import { reprojectTrackStepGrid } from './region-projection';
import { controlIdToRuntimeParam } from '../audio/instrument-registry';
import type { InverseConversionOptions } from './event-conversion';
import type { MusicalEvent } from './canonical-types';
import { rotate, transpose, reverse, duplicate } from './transformations';

const defaultInverseOpts: InverseConversionOptions = {
  canonicalToRuntime: (id: string) => controlIdToRuntimeParam[id] ?? id,
};

/**
 * Apply a transformed event list to a track's region, normalize, re-project, and push undo.
 */
function applyTransform(
  session: Session,
  trackId: string,
  newEvents: MusicalEvent[],
  newDuration: number | undefined,
  description: string,
): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;

  const activeReg = getActivePattern(track);

  const snapshot: PatternEditSnapshot = {
    kind: 'pattern-edit',
    trackId,
    patternId: activeReg.id,
    prevEvents: [...activeReg.events],
    prevDuration: activeReg.duration,
    timestamp: Date.now(),
    description,
  };

  const region = normalizePatternEvents({
    ...activeReg,
    events: newEvents,
    ...(newDuration !== undefined ? { duration: newDuration } : {}),
  });
  const newRegions = track.patterns.map(r => r.id === activeReg.id ? region : r);
  const updatedTrack = reprojectTrackStepGrid({ ...track, patterns: newRegions }, defaultInverseOpts);
  const result = updateTrack(session, trackId, {
    patterns: updatedTrack.patterns,
    stepGrid: updatedTrack.stepGrid,
    _patternDirty: true,
  });

  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/** Rotate all events in the active track's active region by `steps`. */
export function rotateRegion(session: Session, trackId: string, steps: number): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;
  const activeReg = getActivePattern(track);
  const newEvents = rotate(activeReg.events, steps, activeReg.duration);
  return applyTransform(session, trackId, newEvents, undefined, `Rotate events by ${steps} steps`);
}

/** Transpose all note events in the active track's active region by `semitones`. */
export function transposeRegion(session: Session, trackId: string, semitones: number): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;
  const activeReg = getActivePattern(track);
  const newEvents = transpose(activeReg.events, semitones);
  return applyTransform(session, trackId, newEvents, undefined, `Transpose events by ${semitones} semitones`);
}

/** Reverse all events in the active track's active region. */
export function reverseRegion(session: Session, trackId: string): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;
  const activeReg = getActivePattern(track);
  const newEvents = reverse(activeReg.events, activeReg.duration);
  return applyTransform(session, trackId, newEvents, undefined, 'Reverse events');
}

/** Duplicate all events in the active track's active region, doubling the duration. */
export function duplicateRegionEvents(session: Session, trackId: string): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;
  const activeReg = getActivePattern(track);
  const result = duplicate(activeReg.events, activeReg.duration);
  return applyTransform(session, trackId, result.events, result.duration, 'Duplicate region');
}
