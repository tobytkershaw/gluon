// src/engine/micro-timing.ts
// Micro-timing utilities for displaying and computing event grid offsets.

/** Default grid size for micro-timing display (sixteenth note). */
const MICRO_GRID = 0.25;
/** Tolerance below which an event is considered on-grid. */
const MICRO_TOLERANCE = 0.001;

/**
 * Compute micro-timing offset from the nearest grid position.
 * Returns null when the event sits on the grid (within tolerance).
 */
export function microTimingOffset(at: number, gridSize: number = MICRO_GRID): number | null {
  const nearest = Math.round(at / gridSize) * gridSize;
  const offset = at - nearest;
  if (Math.abs(offset) < MICRO_TOLERANCE) return null;
  return offset;
}

/**
 * Format a micro-timing offset as a signed string, e.g. "+0.12" or "-0.03".
 */
export function formatMicroOffset(offset: number): string {
  const sign = offset >= 0 ? '+' : '';
  return `${sign}${offset.toFixed(2)}`;
}
