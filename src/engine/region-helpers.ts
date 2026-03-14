// src/engine/region-helpers.ts
import type {
  Region,
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
 * Validate a single event against its region context.
 * Returns an error string, or null if valid.
 */
export function validateEvent(event: MusicalEvent, region: Region): string | null {
  // Invariant 3: event.at in [0, duration)
  if (event.at < 0 || event.at >= region.duration) {
    return `Event at=${event.at} out of range [0, ${region.duration})`;
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
// Region validation
// ---------------------------------------------------------------------------

/**
 * Validate all invariants on a Region.
 * Returns `{ valid, errors }` — errors is empty when valid.
 */
export function validateRegion(region: Region): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Invariant 1: duration > 0
  if (region.duration <= 0) {
    errors.push(`Region duration=${region.duration} must be > 0`);
  }

  // Invariant 2: start >= 0
  if (region.start < 0) {
    errors.push(`Region start=${region.start} must be >= 0`);
  }

  // Per-event validation (invariants 3, 5, 6, 7)
  for (let i = 0; i < region.events.length; i++) {
    const err = validateEvent(region.events[i], region);
    if (err) errors.push(`events[${i}]: ${err}`);
  }

  // Invariant 4: sorted by at
  for (let i = 1; i < region.events.length; i++) {
    if (region.events[i].at < region.events[i - 1].at) {
      errors.push(
        `events[${i}] at=${region.events[i].at} is before events[${i - 1}] at=${region.events[i - 1].at} — not sorted`,
      );
    }
  }

  // Collision rules
  for (let i = 0; i < region.events.length; i++) {
    for (let j = i + 1; j < region.events.length; j++) {
      const a = region.events[i];
      const b = region.events[j];
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

      // Invariant 10: no simultaneous notes (monophonic)
      if (a.kind === 'note' && b.kind === 'note') {
        errors.push(`Simultaneous NoteEvents at at≈${a.at} (monophonic in M1)`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Sort events by `at` and deduplicate (same kind at same position within tolerance).
 * For parameter events, deduplication is per controlId.
 * When duplicates exist the last one wins (latest in original order).
 */
export function normalizeRegionEvents(region: Region): Region {
  // Stable-sort by at
  const sorted = [...region.events].sort((a, b) => a.at - b.at);

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

  return { ...region, events: deduped };
}

function deduplicationKey(event: MusicalEvent): string {
  const bucket = Math.round(event.at / AT_TOLERANCE);
  switch (event.kind) {
    case 'trigger':
      return `trigger@${bucket}`;
    case 'note':
      return `note@${bucket}`;
    case 'parameter':
      return `parameter:${(event as ParameterEvent).controlId}@${bucket}`;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a valid empty region for a given track.
 * Duration is set to `stepCount` (integer step grid).
 */
export function createDefaultRegion(trackId: string, stepCount: number): Region {
  return {
    id: `${trackId}-region-0`,
    kind: 'pattern',
    start: 0,
    duration: stepCount,
    loop: true,
    events: [],
  };
}
