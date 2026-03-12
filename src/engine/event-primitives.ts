// src/engine/event-primitives.ts
import type { Session } from './types';
import { getVoice } from './types';
import type { MusicalEvent, EventKind, ParameterEvent } from './canonical-types';
import { normalizeRegionEvents } from './region-helpers';
import { reprojectVoicePattern } from './region-projection';
import { updateVoice } from './types';
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
 * Apply a new event list to the voice's region, normalize, and re-project pattern.
 * Human edits do NOT push undo snapshots (AI-only undo contract).
 */
function applyEventEdit(
  session: Session,
  voiceId: string,
  newEvents: MusicalEvent[],
): Session {
  const voice = getVoice(session, voiceId);
  if (voice.regions.length === 0) return session;

  const region = normalizeRegionEvents({
    ...voice.regions[0],
    events: newEvents,
  });
  const newRegions = [region, ...voice.regions.slice(1)];
  const updatedVoice = reprojectVoicePattern({ ...voice, regions: newRegions }, defaultInverseOpts);
  return updateVoice(session, voiceId, {
    regions: updatedVoice.regions,
    pattern: updatedVoice.pattern,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Add an event to a voice's region. */
export function addEvent(session: Session, voiceId: string, event: MusicalEvent): Session {
  const voice = getVoice(session, voiceId);
  if (voice.regions.length === 0) return session;

  const events = [...voice.regions[0].events, event];
  return applyEventEdit(session, voiceId, events);
}

/** Remove the event matching the given selector. */
export function removeEvent(session: Session, voiceId: string, selector: EventSelector): Session {
  const voice = getVoice(session, voiceId);
  if (voice.regions.length === 0) return session;

  const events = voice.regions[0].events.filter(e => !matchesSelector(e, selector));
  if (events.length === voice.regions[0].events.length) return session; // nothing matched
  return applyEventEdit(session, voiceId, events);
}

/** Update fields on the event matching the given selector. */
export function updateEvent(
  session: Session,
  voiceId: string,
  selector: EventSelector,
  updates: Partial<MusicalEvent>,
): Session {
  const voice = getVoice(session, voiceId);
  if (voice.regions.length === 0) return session;

  const events = voice.regions[0].events.map(e => {
    if (matchesSelector(e, selector)) {
      return { ...e, ...updates } as MusicalEvent;
    }
    return e;
  });
  return applyEventEdit(session, voiceId, events);
}
