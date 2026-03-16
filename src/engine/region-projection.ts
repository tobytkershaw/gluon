// src/engine/region-projection.ts
import type { Pattern } from './canonical-types';
import type { StepGrid } from './sequencer-types';
import type { Track } from './types';
import { getActivePattern } from './types';
import { eventsToSteps, type InverseConversionOptions } from './event-conversion';

/**
 * Project a Pattern's events into a step-grid StepGrid.
 * The StepGrid is a derived cache — never an independent source of truth.
 */
export function projectPatternToStepGrid(
  pattern: Pattern,
  stepCount: number,
  options?: InverseConversionOptions,
): StepGrid {
  const steps = eventsToSteps(pattern.events, stepCount, options);
  return { steps, length: stepCount };
}

/**
 * Convenience: re-project a track's active pattern onto track.stepGrid.
 * Returns a new Track with updated stepGrid. No-op if track has no patterns.
 */
export function reprojectTrackStepGrid(
  track: Track,
  options?: InverseConversionOptions,
): Track {
  if (track.patterns.length === 0) return track;
  const pattern = getActivePattern(track);
  const stepGrid = projectPatternToStepGrid(pattern, pattern.duration, options);
  return { ...track, stepGrid };
}
