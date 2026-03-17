// src/engine/event-primitives.ts
import type { Session, PatternEditSnapshot } from './types';
import { getTrack, getActivePattern } from './types';
import type { MusicalEvent, NoteEvent, ParameterEvent } from './canonical-types';
import { normalizePatternEvents } from './region-helpers';
import { reprojectTrackStepGrid } from './region-projection';
import { updateTrack } from './types';
import { controlIdToRuntimeParam } from '../audio/instrument-registry';
import type { InverseConversionOptions } from './event-conversion';

// ---------------------------------------------------------------------------
// Event identity
// ---------------------------------------------------------------------------

/**
 * Uniquely identifies an event within a region, mirroring the dedup invariants
 * in normalizePatternEvents():
 * - triggers: one per position (invariant #8)
 * - notes: one per (position, pitch) — polyphonic (invariant #10)
 * - parameters: one per (position, controlId) (invariant #9)
 */
export type EventSelector =
  | { at: number; kind: 'trigger' }
  | { at: number; kind: 'note'; pitch: number }
  | { at: number; kind: 'parameter'; controlId: string };

const POSITION_TOLERANCE = 0.001;

/** Check if an event matches a selector. */
function matchesSelector(event: MusicalEvent, selector: EventSelector): boolean {
  if (Math.abs(event.at - selector.at) > POSITION_TOLERANCE) return false;
  if (event.kind !== selector.kind) return false;
  if (selector.kind === 'parameter') {
    return (event as ParameterEvent).controlId === selector.controlId;
  }
  if (selector.kind === 'note') {
    return (event as NoteEvent).pitch === selector.pitch;
  }
  return true;
}

/** Build an EventSelector from a MusicalEvent. */
export function selectorFromEvent(event: MusicalEvent): EventSelector {
  if (event.kind === 'parameter') {
    return { at: event.at, kind: 'parameter', controlId: (event as ParameterEvent).controlId };
  }
  if (event.kind === 'note') {
    return { at: event.at, kind: 'note', pitch: (event as NoteEvent).pitch };
  }
  return { at: event.at, kind: event.kind };
}

// ---------------------------------------------------------------------------
// Canonical write path (shared with pattern-primitives.ts)
// ---------------------------------------------------------------------------

const defaultInverseOpts: InverseConversionOptions = {
  canonicalToRuntime: (id: string) => controlIdToRuntimeParam[id] ?? id,
};

/**
 * Apply a new event list to the track's region, normalize, and re-project pattern.
 * Pushes a PatternEditSnapshot for undo when a description is provided.
 */
function applyEventEdit(
  session: Session,
  trackId: string,
  newEvents: MusicalEvent[],
  description?: string,
): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;

  const activeReg = getActivePattern(track);

  const snapshot: PatternEditSnapshot | undefined = description
    ? {
        kind: 'pattern-edit',
        trackId,
        patternId: activeReg.id,
        prevEvents: [...activeReg.events],
        timestamp: Date.now(),
        description,
      }
    : undefined;

  const region = normalizePatternEvents({
    ...activeReg,
    events: newEvents,
  });
  const newRegions = track.patterns.map(r => r.id === activeReg.id ? region : r);
  const updatedTrack = reprojectTrackStepGrid({ ...track, patterns: newRegions }, defaultInverseOpts);
  const result = updateTrack(session, trackId, {
    patterns: updatedTrack.patterns,
    stepGrid: updatedTrack.stepGrid,
    _patternDirty: true,
  });

  if (snapshot) {
    return { ...result, undoStack: [...result.undoStack, snapshot] };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Add an event to a track's active region. */
export function addEvent(session: Session, trackId: string, event: MusicalEvent): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;

  const activeReg = getActivePattern(track);
  const events = [...activeReg.events, event];
  return applyEventEdit(session, trackId, events, `Add ${event.kind} event at ${event.at}`);
}

/** Remove the event matching the given selector. */
export function removeEvent(session: Session, trackId: string, selector: EventSelector): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;

  const activeReg = getActivePattern(track);
  const events = activeReg.events.filter(e => !matchesSelector(e, selector));
  if (events.length === activeReg.events.length) return session; // nothing matched
  return applyEventEdit(session, trackId, events, `Remove ${selector.kind} event at ${selector.at}`);
}

/** Update fields on the event matching the given selector. */
export function updateEvent(
  session: Session,
  trackId: string,
  selector: EventSelector,
  updates: Partial<MusicalEvent>,
): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;

  const activeReg = getActivePattern(track);
  const events = activeReg.events.map(e => {
    if (matchesSelector(e, selector)) {
      return { ...e, ...updates } as MusicalEvent;
    }
    return e;
  });
  return applyEventEdit(session, trackId, events, `Update ${selector.kind} event at ${selector.at}`);
}

/** Remove events by their indices in the active region's event array. */
export function removeEventsByIndices(
  session: Session,
  trackId: string,
  indices: number[],
): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;

  const activeReg = getActivePattern(track);
  const indexSet = new Set(indices);
  const events = activeReg.events.filter((_, i) => !indexSet.has(i));
  if (events.length === activeReg.events.length) return session;
  return applyEventEdit(session, trackId, events, `Delete ${indices.length} event(s)`);
}

/** Transpose note events at the given indices by `semitones`, clamped 0-127. Single undo entry. */
export function transposeEventsByIndices(
  session: Session,
  trackId: string,
  indices: number[],
  semitones: number,
): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;
  if (indices.length === 0 || semitones === 0) return session;

  const activeReg = getActivePattern(track);
  const indexSet = new Set(indices);
  let changed = false;
  const events = activeReg.events.map((e, i) => {
    if (!indexSet.has(i) || e.kind !== 'note') return e;
    const note = e as NoteEvent;
    const pitch = Math.max(0, Math.min(127, note.pitch + semitones));
    if (pitch === note.pitch) return e;
    changed = true;
    return { ...note, pitch };
  });
  if (!changed) return session;
  return applyEventEdit(session, trackId, events, `Transpose ${indices.length} event(s) by ${semitones} semitones`);
}

/** Insert multiple events into a track's active region. */
export function addEvents(
  session: Session,
  trackId: string,
  newEvents: MusicalEvent[],
): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;
  if (newEvents.length === 0) return session;

  const activeReg = getActivePattern(track);
  const events = [...activeReg.events, ...newEvents];
  return applyEventEdit(session, trackId, events, `Paste ${newEvents.length} event(s)`);
}
