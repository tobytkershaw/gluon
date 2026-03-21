// src/engine/drum-grid.ts
// Grid string serialiser/parser for drum rack patterns.
// Converts between canonical NoteEvent[] (with padId) and grid notation strings
// like "x...o...|x..o...." where each character encodes position + velocity.
//
// Backward compatibility: eventsToGrid/eventsToKit also accept legacy TriggerEvents
// so existing patterns render correctly.

import type { NoteEvent, TriggerEvent } from './canonical-types';

/** Default pitch for drum rack NoteEvents (C-4). */
export const DRUM_NOTE_DEFAULT_PITCH = 60;

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

/**
 * Velocity → grid character thresholds (evaluated top-down, first match wins).
 * Boundaries are chosen so that each legend entry's velocity round-trips:
 *   x(0.95)→x, H(0.88)→H, O(0.80)→O, o(0.75)→o, h(0.50)→h, g(0.30)→g
 *
 * Note: H (loud) and O (open) are semantically distinct in the RFC but
 * serialisation can only distinguish them by velocity. The AI writes the
 * character it means; the thresholds ensure the legend velocities round-trip.
 */
const VELOCITY_THRESHOLDS: Array<{ min: number; char: string }> = [
  { min: 0.90, char: 'x' },  // accent: 0.90–1.0
  { min: 0.84, char: 'H' },  // loud:   0.84–0.89
  { min: 0.77, char: 'O' },  // open:   0.77–0.83
  { min: 0.60, char: 'o' },  // hit:    0.60–0.76
  { min: 0.40, char: 'h' },  // soft:   0.40–0.59
  { min: 0.20, char: 'g' },  // ghost:  0.20–0.39
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

/** Union type for events that can be serialised to grid strings. */
type DrumEvent = NoteEvent | TriggerEvent;

/**
 * Serialise drum events for a single pad into a grid string.
 * Accepts both NoteEvents (new) and TriggerEvents (legacy) for backward compatibility.
 *
 * @param events - DrumEvent[] filtered to a single padId
 * @param patternLength - total steps in the pattern
 * @param stepsPerBar - steps per bar (default 16 for 4/4 at 16th resolution)
 * @returns grid string with bar lines, e.g. "x...o...|x..o...."
 */
export function eventsToGrid(
  events: DrumEvent[],
  patternLength: number,
  stepsPerBar = 16,
): string {
  const grid: string[] = new Array(patternLength).fill('.');

  for (const event of events) {
    // Floor, not round: micro-timing offsets should snap back to their
    // originating step, not advance to the next one. Detail map handles offsets.
    const step = Math.floor(event.at);
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
 * Parse a grid string into NoteEvent[] for a single pad.
 *
 * @param grid - grid string, e.g. "x...o...|x..o...."
 * @param padId - the pad these notes belong to
 * @param legend - character → velocity mapping (defaults to DEFAULT_LEGEND)
 * @returns NoteEvent[] with padId set
 */
export function gridToEvents(
  grid: string,
  padId: string,
  legend: GridLegend = DEFAULT_LEGEND,
): NoteEvent[] {
  const events: NoteEvent[] = [];
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
        kind: 'note',
        at: step,
        pitch: DRUM_NOTE_DEFAULT_PITCH,
        velocity: mapping.velocity,
        duration: 1,
        padId,
      });
    }
    step++;
  }

  return events;
}

/**
 * Serialise a full drum rack kit (multiple pads) into a record of grid strings.
 * Accepts both NoteEvents (new) and TriggerEvents (legacy) for backward compatibility.
 *
 * @param events - all drum events in the pattern (mixed pads)
 * @param padIds - ordered list of pad IDs to serialise
 * @param patternLength - total steps in the pattern
 * @param stepsPerBar - steps per bar (default 16)
 * @returns Record mapping padId → grid string
 */
export function eventsToKit(
  events: DrumEvent[],
  padIds: string[],
  patternLength: number,
  stepsPerBar = 16,
): Record<string, string> {
  const grouped = new Map<string, DrumEvent[]>();
  for (const id of padIds) grouped.set(id, []);

  for (const event of events) {
    const ePadId = event.padId;
    if (ePadId && grouped.has(ePadId)) {
      grouped.get(ePadId)!.push(event);
    }
  }

  const kit: Record<string, string> = {};
  for (const id of padIds) {
    kit[id] = eventsToGrid(grouped.get(id) ?? [], patternLength, stepsPerBar);
  }
  return kit;
}

/**
 * Parse a full kit (record of grid strings) into NoteEvent[].
 *
 * @param kit - Record mapping padId → grid string
 * @param legend - character → velocity mapping
 * @returns NoteEvent[] with padId set, sorted by `at`
 */
export function kitToEvents(
  kit: Record<string, string>,
  legend: GridLegend = DEFAULT_LEGEND,
): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (const [padId, grid] of Object.entries(kit)) {
    events.push(...gridToEvents(grid, padId, legend));
  }
  // Sort by position, then by padId for deterministic ordering at same step
  events.sort((a, b) => a.at - b.at || (a.padId ?? '').localeCompare(b.padId ?? ''));
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
  const chars = Object.entries(legend)
    .map(([char, { label }]) => `${char}=${label}`)
    .join(' ');
  return `${chars} .=rest |=bar`;
}
