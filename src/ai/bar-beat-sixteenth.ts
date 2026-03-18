// src/ai/bar-beat-sixteenth.ts — Parse bar.beat.sixteenth position strings into absolute step indices.
//
// Accepts either a numeric step (pass-through) or a string "bar.beat.sixteenth" where:
//   bar = 1-based bar number
//   beat = 1-based beat within bar (1-4 in 4/4)
//   sixteenth = 1-based sixteenth within beat (1-4)
//
// Formula: step = (bar - 1) * 16 + (beat - 1) * 4 + (sixteenth - 1)
// (Assumes 4/4 time, 16 steps per bar, 4 sixteenths per beat)

/**
 * Parse a position value that may be either a numeric step index or a
 * "bar.beat.sixteenth" string (e.g. "3.2.1" = step 36).
 *
 * Returns the absolute 0-based step index as a number.
 * Throws if the string format is invalid.
 */
export function parsePosition(at: number | string): number {
  if (typeof at === 'number') return at;
  if (typeof at !== 'string') {
    throw new Error(`Invalid position: expected number or "bar.beat.sixteenth" string, got ${typeof at}`);
  }

  const parts = at.split('.');
  if (parts.length !== 3) {
    throw new Error(
      `Invalid position "${at}": expected "bar.beat.sixteenth" format (e.g. "1.1.1", "3.2.1")`
    );
  }

  const [barStr, beatStr, sixteenthStr] = parts;
  const bar = Number(barStr);
  const beat = Number(beatStr);
  const sixteenth = Number(sixteenthStr);

  if (!Number.isInteger(bar) || bar < 1) {
    throw new Error(`Invalid bar "${barStr}" in position "${at}": must be a positive integer`);
  }
  if (!Number.isInteger(beat) || beat < 1 || beat > 4) {
    throw new Error(`Invalid beat "${beatStr}" in position "${at}": must be 1-4`);
  }
  if (!Number.isFinite(sixteenth) || sixteenth < 1 || sixteenth > 4) {
    throw new Error(`Invalid sixteenth "${sixteenthStr}" in position "${at}": must be 1-4`);
  }

  return (bar - 1) * 16 + (beat - 1) * 4 + (sixteenth - 1);
}

/**
 * Resolve `at` fields in sketch event arrays — converts any bar.beat.sixteenth
 * strings to absolute step numbers in-place, returning the mutated array.
 */
export function resolveSketchPositions<T extends { at: number | string }>(
  events: T[],
): (T & { at: number })[] {
  for (const event of events) {
    event.at = parsePosition(event.at);
  }
  return events as (T & { at: number })[];
}

/**
 * Resolve `step` fields in edit_pattern operation arrays — converts any
 * bar.beat.sixteenth strings to absolute step numbers in-place.
 */
export function resolveEditPatternPositions<T extends { step: number | string }>(
  operations: T[],
): (T & { step: number })[] {
  for (const op of operations) {
    op.step = parsePosition(op.step);
  }
  return operations as (T & { step: number })[];
}
