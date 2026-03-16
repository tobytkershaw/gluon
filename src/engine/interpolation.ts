// src/engine/interpolation.ts
// Interpolation utilities for parameter automation.

import type { MusicalEvent, ParameterEvent } from './canonical-types';

/**
 * Find the next ParameterEvent for the same controlId after position `at`
 * within the given sorted event array. Returns undefined if none found.
 */
export function findNextParameterEvent(
  events: MusicalEvent[],
  controlId: string,
  afterAt: number,
  beforeAt?: number,
): ParameterEvent | undefined {
  for (const e of events) {
    if (e.kind !== 'parameter') continue;
    const pe = e as ParameterEvent;
    if (pe.controlId !== controlId) continue;
    if (pe.at <= afterAt) continue;
    if (beforeAt !== undefined && pe.at >= beforeAt) return undefined;
    return pe;
  }
  return undefined;
}

/**
 * Apply curve tension to a linear t value (0..1).
 * tension=0 is linear, positive = fast start/slow end, negative = slow start/fast end.
 */
function applyCurveTension(t: number, tension: number): number {
  if (tension === 0) return t;
  // Attempt exact exponential curve: t^(2^(-tension))
  // tension > 0: exponent < 1, concave up (fast start, slow end)
  // tension < 0: exponent > 1, concave down (slow start, fast end)
  const exponent = Math.pow(2, -tension);
  return Math.pow(t, exponent);
}

/**
 * Compute the interpolated value between two parameter events at a given position.
 *
 * @param fromEvent The source event (defines interpolation mode and start value)
 * @param toEvent   The target event (defines end value)
 * @param at        The position to interpolate at (between fromEvent.at and toEvent.at)
 * @returns The interpolated value, or undefined if interpolation is 'step' or value is non-numeric
 */
export function interpolateParameterValue(
  fromEvent: ParameterEvent,
  toEvent: ParameterEvent,
  at: number,
): number | undefined {
  // Step mode or no interpolation: no intermediate values
  const mode = fromEvent.interpolation ?? 'step';
  if (mode === 'step') return undefined;

  // Only numeric values can be interpolated
  if (typeof fromEvent.value !== 'number' || typeof toEvent.value !== 'number') {
    return undefined;
  }

  const startVal = fromEvent.value;
  const endVal = toEvent.value;
  const duration = toEvent.at - fromEvent.at;
  if (duration <= 0) return undefined;

  // Linear parameter t in [0, 1]
  let t = (at - fromEvent.at) / duration;
  t = Math.max(0, Math.min(1, t));

  if (mode === 'curve') {
    const tension = Math.max(-1, Math.min(1, fromEvent.tension ?? 0));
    t = applyCurveTension(t, tension);
  }

  return startVal + (endVal - startVal) * t;
}

export interface InterpolatedParamChange {
  controlId: string;
  value: number;
}

/**
 * Generate interpolated parameter values for a given region-local position.
 * Scans all parameter events, finds pairs with linear/curve interpolation,
 * and computes intermediate values.
 *
 * @param events     Sorted event array from a region
 * @param at         Region-local position to evaluate
 * @param regionLen  Region duration (for loop wrap — next event may be in next cycle)
 * @returns Array of interpolated parameter changes (empty if none apply)
 */
export function getInterpolatedParams(
  events: MusicalEvent[],
  at: number,
  regionLen?: number,
): InterpolatedParamChange[] {
  const results: InterpolatedParamChange[] = [];
  const seen = new Set<string>();

  // Walk backwards through events to find the most recent parameter event
  // for each controlId that precedes `at` and has interpolation
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== 'parameter') continue;
    const pe = e as ParameterEvent;
    if (pe.at >= at) continue; // must be before current position
    if (seen.has(pe.controlId)) continue; // already handled this controlId

    const mode = pe.interpolation ?? 'step';
    if (mode === 'step') {
      seen.add(pe.controlId);
      continue;
    }

    // Find the next parameter event for the same controlId
    const next = findNextParameterEvent(events, pe.controlId, pe.at, regionLen);
    if (!next || next.at <= at) {
      // Past the interpolation range or no target
      seen.add(pe.controlId);
      continue;
    }

    const value = interpolateParameterValue(pe, next, at);
    if (value !== undefined) {
      results.push({ controlId: pe.controlId, value });
    }
    seen.add(pe.controlId);
  }

  return results;
}
