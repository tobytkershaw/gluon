// src/engine/event-primitives.ts
import type { Session, RegionSnapshot } from './types';
import { getTrack } from './types';
import type { MusicalEvent, ParameterEvent } from './canonical-types';
import { normalizeRegionEvents } from './region-helpers';
import { reprojectTrackPattern } from './region-projection';
import { updateTrack } from './types';
import { controlIdToRuntimeParam } from '../audio/instrument-registry';
import type { InverseConversionOptions } from './event-conversion';

// ---------------------------------------------------------------------------
// Event identity
// ---------------------------------------------------------------------------

/**
 * Uniquely identifies an event within a region, mirroring the dedup invariants
 * in normalizeRegionEvents():
 * - triggers: one per position (invariant #8)
 * - notes: one per position, monophonic (invariant #10)
 * - parameters: one per (position, controlId) (invariant #9)
 */
export type EventSelector =
  | { at: number; kind: 'trigger' }
  | { at: number; kind: 'note' }
  | { at: number; kind: 'parameter'; controlId: string };

const POSITION_TOLERANCE = 0.001;

/** Check if an event matches a selector. */
function matchesSelector(event: MusicalEvent, selector: EventSelector): boolean {
  if (Math.abs(event.at - selector.at) > POSITION_TOLERANCE) return false;
  if (event.kind !== selector.kind) return false;
  if (selector.kind === 'parameter') {
    return (event as ParameterEvent).controlId === selector.controlId;
  }
  return true;
}

/** Build an EventSelector from a MusicalEvent. */
export function selectorFromEvent(event: MusicalEvent): EventSelector {
  if (event.kind === 'parameter') {
    return { at: event.at, kind: 'parameter', controlId: (event as ParameterEvent).controlId };
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
 * Pushes a RegionSnapshot for undo when a description is provided.
 */
function applyEventEdit(
  session: Session,
  trackId: string,
  newEvents: MusicalEvent[],
  description?: string,
): Session {
  const track = getTrack(session, trackId);
  if (track.regions.length === 0) return session;

  const snapshot: RegionSnapshot | undefined = description
    ? {
        kind: 'region',
        trackId,
        prevEvents: [...track.regions[0].events],
        timestamp: Date.now(),
        description,
      }
    : undefined;

  const region = normalizeRegionEvents({
    ...track.regions[0],
    events: newEvents,
  });
  const newRegions = [region, ...track.regions.slice(1)];
  const updatedTrack = reprojectTrackPattern({ ...track, regions: newRegions }, defaultInverseOpts);
  const result = updateTrack(session, trackId, {
    regions: updatedTrack.regions,
    pattern: updatedTrack.pattern,
    _regionDirty: true,
  });

  if (snapshot) {
    return { ...result, undoStack: [...result.undoStack, snapshot] };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Add an event to a track's region. */
export function addEvent(session: Session, trackId: string, event: MusicalEvent): Session {
  const track = getTrack(session, trackId);
  if (track.regions.length === 0) return session;

  const events = [...track.regions[0].events, event];
  return applyEventEdit(session, trackId, events, `Add ${event.kind} event at ${event.at}`);
}

/** Remove the event matching the given selector. */
export function removeEvent(session: Session, trackId: string, selector: EventSelector): Session {
  const track = getTrack(session, trackId);
  if (track.regions.length === 0) return session;

  const events = track.regions[0].events.filter(e => !matchesSelector(e, selector));
  if (events.length === track.regions[0].events.length) return session; // nothing matched
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
  if (track.regions.length === 0) return session;

  const events = track.regions[0].events.map(e => {
    if (matchesSelector(e, selector)) {
      return { ...e, ...updates } as MusicalEvent;
    }
    return e;
  });
  return applyEventEdit(session, trackId, events, `Update ${selector.kind} event at ${selector.at}`);
}

/** Remove events by their indices in the region's event array. */
export function removeEventsByIndices(
  session: Session,
  trackId: string,
  indices: number[],
): Session {
  const track = getTrack(session, trackId);
  if (track.regions.length === 0) return session;

  const indexSet = new Set(indices);
  const events = track.regions[0].events.filter((_, i) => !indexSet.has(i));
  if (events.length === track.regions[0].events.length) return session;
  return applyEventEdit(session, trackId, events, `Delete ${indices.length} event(s)`);
}

/** Insert multiple events into a track's region. */
export function addEvents(
  session: Session,
  trackId: string,
  newEvents: MusicalEvent[],
): Session {
  const track = getTrack(session, trackId);
  if (track.regions.length === 0) return session;
  if (newEvents.length === 0) return session;

  const events = [...track.regions[0].events, ...newEvents];
  return applyEventEdit(session, trackId, events, `Paste ${newEvents.length} event(s)`);
}
