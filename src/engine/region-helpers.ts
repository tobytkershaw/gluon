// src/engine/region-helpers.ts
import type {
  Pattern,
  MusicalEvent,
  NoteEvent,
  TriggerEvent,
  ParameterEvent,
} from './canonical-types';

/** Tolerance for detecting duplicate events at the same position. */
const AT_TOLERANCE = 0.001;

function sameAt(a: number, b: number): boolean {
  return Math.abs(a - b) < AT_TOLERANCE;
}

// ---------------------------------------------------------------------------
// Single-event validation
// ---------------------------------------------------------------------------

/**
 * Validate a single event against its pattern context.
 * Returns an error string, or null if valid.
 */
export function validateEvent(event: MusicalEvent, pattern: Pattern): string | null {
  // Invariant 2: event.at in [0, duration)
  if (event.at < 0 || event.at >= pattern.duration) {
    return `Event at=${event.at} out of range [0, ${pattern.duration})`;
  }

  switch (event.kind) {
    case 'trigger': {
      const t = event as TriggerEvent;
      // Invariant 5: velocity 0-1 when present
      if (t.velocity !== undefined && (t.velocity < 0 || t.velocity > 1)) {
        return `TriggerEvent velocity=${t.velocity} out of range [0, 1]`;
      }
      break;
    }
    case 'note': {
      const n = event as NoteEvent;
      // Invariant 6: pitch 0-127
      if (n.pitch < 0 || n.pitch > 127) {
        return `NoteEvent pitch=${n.pitch} out of range [0, 127]`;
      }
      // Invariant 6: velocity 0-1
      if (n.velocity < 0 || n.velocity > 1) {
        return `NoteEvent velocity=${n.velocity} out of range [0, 1]`;
      }
      // Invariant 6: duration > 0
      if (n.duration <= 0) {
        return `NoteEvent duration=${n.duration} must be > 0`;
      }
      break;
    }
    case 'parameter': {
      const p = event as ParameterEvent;
      // Invariant 7: controlId non-empty
      if (!p.controlId || p.controlId.length === 0) {
        return 'ParameterEvent controlId must be non-empty';
      }
      break;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pattern validation
// ---------------------------------------------------------------------------

/**
 * Validate all invariants on a Pattern.
 * Returns `{ valid, errors }` — errors is empty when valid.
 */
export function validatePattern(pattern: Pattern): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Invariant 1: duration > 0
  if (pattern.duration <= 0) {
    errors.push(`Pattern duration=${pattern.duration} must be > 0`);
  }

  // Per-event validation (invariants 2, 5, 6, 7)
  for (let i = 0; i < pattern.events.length; i++) {
    const err = validateEvent(pattern.events[i], pattern);
    if (err) errors.push(`events[${i}]: ${err}`);
  }

  // Invariant 3: sorted by at
  for (let i = 1; i < pattern.events.length; i++) {
    if (pattern.events[i].at < pattern.events[i - 1].at) {
      errors.push(
        `events[${i}] at=${pattern.events[i].at} is before events[${i - 1}] at=${pattern.events[i - 1].at} — not sorted`,
      );
    }
  }

  // Collision rules
  for (let i = 0; i < pattern.events.length; i++) {
    for (let j = i + 1; j < pattern.events.length; j++) {
      const a = pattern.events[i];
      const b = pattern.events[j];
      if (!sameAt(a.at, b.at)) continue;

      // Invariant 8: no duplicate triggers at same position
      if (a.kind === 'trigger' && b.kind === 'trigger') {
        errors.push(`Duplicate TriggerEvents at at≈${a.at}`);
      }

      // Invariant 9: no duplicate parameter events for same controlId at same position
      if (
        a.kind === 'parameter' &&
        b.kind === 'parameter' &&
        (a as ParameterEvent).controlId === (b as ParameterEvent).controlId
      ) {
        errors.push(
          `Duplicate ParameterEvents for controlId="${(a as ParameterEvent).controlId}" at at≈${a.at}`,
        );
      }

      // Invariant 10: no duplicate notes at same pitch (polyphonic, max 4)
      if (
        a.kind === 'note' &&
        b.kind === 'note' &&
        (a as NoteEvent).pitch === (b as NoteEvent).pitch
      ) {
        errors.push(
          `Duplicate NoteEvents at pitch=${(a as NoteEvent).pitch} at at≈${a.at}`,
        );
      }
    }
  }

  // Invariant 10b: max 4 notes at the same position (polyphonic column limit)
  const noteCountByBucket = new Map<number, number>();
  for (const event of pattern.events) {
    if (event.kind !== 'note') continue;
    const bucket = Math.floor(event.at / AT_TOLERANCE);
    const count = (noteCountByBucket.get(bucket) ?? 0) + 1;
    noteCountByBucket.set(bucket, count);
    if (count > 4) {
      errors.push(`More than 4 NoteEvents at at≈${event.at} (found ${count})`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** @deprecated Use validatePattern instead. */
export const validateRegion = validatePattern;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Sort events by `at` and deduplicate (same kind at same position within tolerance).
 * For parameter events, deduplication is per controlId.
 * When duplicates exist the last one wins (latest in original order).
 */
export function normalizePatternEvents(pattern: Pattern): Pattern {
  // Stable-sort by at
  const sorted = [...pattern.events].sort((a, b) => a.at - b.at);

  // Deduplicate: walk backwards so later entries win
  const seen = new Set<string>();
  const deduped: MusicalEvent[] = [];

  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    const key = deduplicationKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }

  // Reverse to restore ascending order
  deduped.reverse();

  // Enforce max 4 notes per step (polyphonic column limit).
  // Notes are already sorted by `at`; within the same bucket keep the first 4
  // (lowest pitches after dedup, since sort is stable and pitch order is preserved).
  const MAX_NOTES_PER_STEP = 4;
  const noteCountByBucket = new Map<number, number>();
  const capped = deduped.filter(e => {
    if (e.kind !== 'note') return true;
    const bucket = Math.floor(e.at / AT_TOLERANCE);
    const count = (noteCountByBucket.get(bucket) ?? 0) + 1;
    noteCountByBucket.set(bucket, count);
    return count <= MAX_NOTES_PER_STEP;
  });

  return { ...pattern, events: capped };
}

/** @deprecated Use normalizePatternEvents instead. */
export const normalizeRegionEvents = normalizePatternEvents;

/**
 * Build a dedup key using Math.floor bucketing (aligned with AT_TOLERANCE).
 * Math.floor ensures that values within the same bucket are always within
 * tolerance, consistent with sameAt() used by validatePattern().
 */
function deduplicationKey(event: MusicalEvent): string {
  const bucket = Math.floor(event.at / AT_TOLERANCE);
  switch (event.kind) {
    case 'trigger':
      return `trigger@${bucket}`;
    case 'note':
      // Polyphonic: dedup by (position, pitch) — different pitches coexist
      return `note:${(event as NoteEvent).pitch}@${bucket}`;
    case 'parameter':
      return `parameter:${(event as ParameterEvent).controlId}@${bucket}`;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a valid empty pattern for a given track.
 * Duration is set to `stepCount` (integer step grid).
 */
export function createDefaultPattern(trackId: string, stepCount: number): Pattern {
  return {
    id: `${trackId}-pattern-0`,
    kind: 'pattern',
    duration: stepCount,
    events: [],
  };
}

/** @deprecated Use createDefaultPattern instead. */
export const createDefaultRegion = createDefaultPattern;
