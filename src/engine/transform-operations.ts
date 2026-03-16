// src/engine/transform-operations.ts
// Session-level transform operations with undo support.
import type { Session, RegionSnapshot } from './types';
import { getTrack, updateTrack } from './types';
import { normalizeRegionEvents } from './region-helpers';
import { reprojectTrackPattern } from './region-projection';
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
  if (track.regions.length === 0) return session;

  const snapshot: RegionSnapshot = {
    kind: 'region',
    trackId,
    prevEvents: [...track.regions[0].events],
    prevDuration: track.regions[0].duration,
    timestamp: Date.now(),
    description,
  };

  const region = normalizeRegionEvents({
    ...track.regions[0],
    events: newEvents,
    ...(newDuration !== undefined ? { duration: newDuration } : {}),
  });
  const newRegions = [region, ...track.regions.slice(1)];
  const updatedTrack = reprojectTrackPattern({ ...track, regions: newRegions }, defaultInverseOpts);
  const result = updateTrack(session, trackId, {
    regions: updatedTrack.regions,
    pattern: updatedTrack.pattern,
    _regionDirty: true,
  });

  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

/** Rotate all events in the active track's first region by `steps`. */
export function rotateRegion(session: Session, trackId: string, steps: number): Session {
  const track = getTrack(session, trackId);
  if (track.regions.length === 0) return session;
  const region = track.regions[0];
  const newEvents = rotate(region.events, steps, region.duration);
  return applyTransform(session, trackId, newEvents, undefined, `Rotate events by ${steps} steps`);
}

/** Transpose all note events in the active track's first region by `semitones`. */
export function transposeRegion(session: Session, trackId: string, semitones: number): Session {
  const track = getTrack(session, trackId);
  if (track.regions.length === 0) return session;
  const region = track.regions[0];
  const newEvents = transpose(region.events, semitones);
  return applyTransform(session, trackId, newEvents, undefined, `Transpose events by ${semitones} semitones`);
}

/** Reverse all events in the active track's first region. */
export function reverseRegion(session: Session, trackId: string): Session {
  const track = getTrack(session, trackId);
  if (track.regions.length === 0) return session;
  const region = track.regions[0];
  const newEvents = reverse(region.events, region.duration);
  return applyTransform(session, trackId, newEvents, undefined, 'Reverse events');
}

/** Duplicate all events in the active track's first region, doubling the duration. */
export function duplicateRegion(session: Session, trackId: string): Session {
  const track = getTrack(session, trackId);
  if (track.regions.length === 0) return session;
  const region = track.regions[0];
  const result = duplicate(region.events, region.duration);
  return applyTransform(session, trackId, result.events, result.duration, 'Duplicate region');
}
