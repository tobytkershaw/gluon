// src/engine/drum-grid.ts
// Grid string serialiser/parser for drum rack patterns.
// Converts between canonical TriggerEvent[] and grid notation strings
// like "x...o...|x..o...." where each character encodes position + velocity.

import type { TriggerEvent } from './canonical-types';

/** Grid character → velocity mapping. */
export interface GridLegend {
  [char: string]: { velocity: number; label: string };
}

/** Default legend used for drum rack grid notation. */
export const DEFAULT_LEGEND: GridLegend = {
  'x': { velocity: 0.95, label: 'accent' },
  'o': { velocity: 0.75, label: 'hit' },
  'g': { velocity: 0.30, label: 'ghost' },
  'h': { velocity: 0.50, label: 'soft' },
  'H': { velocity: 0.88, label: 'loud' },
  'O': { velocity: 0.80, label: 'open' },
};

/** Velocity → grid character thresholds (evaluated top-down, first match wins). */
const VELOCITY_THRESHOLDS: Array<{ min: number; char: string }> = [
  { min: 0.90, char: 'x' },
  { min: 0.60, char: 'o' },
  { min: 0.40, char: 'h' },
  { min: 0.01, char: 'g' },
];

/**
 * Convert a velocity value to the appropriate grid character.
 */
export function velocityToGridChar(velocity: number): string {
  for (const { min, char } of VELOCITY_THRESHOLDS) {
    if (velocity >= min) return char;
  }
  return '.';
}

/**
 * Serialise trigger events for a single pad into a grid string.
 *
 * @param events - TriggerEvent[] filtered to a single padId
 * @param patternLength - total steps in the pattern
 * @param stepsPerBar - steps per bar (default 16 for 4/4 at 16th resolution)
 * @returns grid string with bar lines, e.g. "x...o...|x..o...."
 */
export function eventsToGrid(
  events: TriggerEvent[],
  patternLength: number,
  stepsPerBar = 16,
): string {
  const grid: string[] = new Array(patternLength).fill('.');

  for (const event of events) {
    const step = Math.round(event.at);
    if (step < 0 || step >= patternLength) continue;
    const vel = event.velocity ?? 0.75;
    // velocity=0 sentinel means disabled trigger — render as rest
    if (vel === 0) continue;
    grid[step] = velocityToGridChar(vel);
  }

  // Insert bar lines
  const parts: string[] = [];
  for (let i = 0; i < patternLength; i += stepsPerBar) {
    parts.push(grid.slice(i, Math.min(i + stepsPerBar, patternLength)).join(''));
  }
  return parts.join('|');
}

/**
 * Parse a grid string into TriggerEvent[] for a single pad.
 *
 * @param grid - grid string, e.g. "x...o...|x..o...."
 * @param padId - the pad these triggers belong to
 * @param legend - character → velocity mapping (defaults to DEFAULT_LEGEND)
 * @returns TriggerEvent[] with padId set
 */
export function gridToEvents(
  grid: string,
  padId: string,
  legend: GridLegend = DEFAULT_LEGEND,
): TriggerEvent[] {
  const events: TriggerEvent[] = [];
  let step = 0;

  for (const char of grid) {
    if (char === '|') continue; // bar line — skip
    if (char === '.') {
      step++;
      continue;
    }
    const mapping = legend[char];
    if (mapping) {
      events.push({
        kind: 'trigger',
        at: step,
        velocity: mapping.velocity,
        padId,
      });
    }
    step++;
  }

  return events;
}

/**
 * Serialise a full drum rack kit (multiple pads) into a record of grid strings.
 *
 * @param events - all TriggerEvents in the pattern (mixed pads)
 * @param padIds - ordered list of pad IDs to serialise
 * @param patternLength - total steps in the pattern
 * @param stepsPerBar - steps per bar (default 16)
 * @returns Record mapping padId → grid string
 */
export function eventsToKit(
  events: TriggerEvent[],
  padIds: string[],
  patternLength: number,
  stepsPerBar = 16,
): Record<string, string> {
  const grouped = new Map<string, TriggerEvent[]>();
  for (const id of padIds) grouped.set(id, []);

  for (const event of events) {
    if (event.padId && grouped.has(event.padId)) {
      grouped.get(event.padId)!.push(event);
    }
  }

  const kit: Record<string, string> = {};
  for (const id of padIds) {
    kit[id] = eventsToGrid(grouped.get(id) ?? [], patternLength, stepsPerBar);
  }
  return kit;
}

/**
 * Parse a full kit (record of grid strings) into TriggerEvent[].
 *
 * @param kit - Record mapping padId → grid string
 * @param legend - character → velocity mapping
 * @returns TriggerEvent[] with padId set, sorted by `at`
 */
export function kitToEvents(
  kit: Record<string, string>,
  legend: GridLegend = DEFAULT_LEGEND,
): TriggerEvent[] {
  const events: TriggerEvent[] = [];
  for (const [padId, grid] of Object.entries(kit)) {
    events.push(...gridToEvents(grid, padId, legend));
  }
  events.sort((a, b) => a.at - b.at);
  return events;
}

/**
 * Count the number of steps in a grid string (excluding bar lines).
 */
export function gridLength(grid: string): number {
  let count = 0;
  for (const char of grid) {
    if (char !== '|') count++;
  }
  return count;
}

/**
 * Format the default legend as a human-readable string for AI state compression.
 */
export function formatLegend(legend: GridLegend = DEFAULT_LEGEND): string {
  return Object.entries(legend)
    .map(([char, { label }]) => `${char}=${label}`)
    .join(' ');
}
