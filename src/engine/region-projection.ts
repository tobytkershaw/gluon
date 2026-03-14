// src/engine/region-projection.ts
import type { Region } from './canonical-types';
import type { Pattern } from './sequencer-types';
import type { Track } from './types';
import { eventsToSteps, type InverseConversionOptions } from './event-conversion';

/**
 * Project a Region's events into a step-grid Pattern.
 * The Pattern is a derived cache — never an independent source of truth.
 */
export function projectRegionToPattern(
  region: Region,
  stepCount: number,
  options?: InverseConversionOptions,
): Pattern {
  const steps = eventsToSteps(region.events, stepCount, options);
  return { steps, length: stepCount };
}

/**
 * Convenience: re-project a track's first region onto track.pattern.
 * Returns a new Track with updated pattern. No-op if track has no regions.
 */
export function reprojectTrackPattern(
  track: Track,
  options?: InverseConversionOptions,
): Track {
  if (track.regions.length === 0) return track;
  const region = track.regions[0];
  const pattern = projectRegionToPattern(region, region.duration, options);
  return { ...track, pattern };
}
