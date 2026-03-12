// src/engine/region-projection.ts
import type { Region } from './canonical-types';
import type { Pattern } from './sequencer-types';
import type { Voice } from './types';
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
 * Convenience: re-project a voice's first region onto voice.pattern.
 * Returns a new Voice with updated pattern. No-op if voice has no regions.
 */
export function reprojectVoicePattern(
  voice: Voice,
  options?: InverseConversionOptions,
): Voice {
  if (voice.regions.length === 0) return voice;
  const region = voice.regions[0];
  const pattern = projectRegionToPattern(region, region.duration, options);
  return { ...voice, pattern };
}
