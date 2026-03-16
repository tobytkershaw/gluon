// src/engine/pattern-primitives.ts
import type { Session, SynthParamValues, PatternEditSnapshot } from './types';
import { getTrack, getActivePattern, updateTrack } from './types';
import type { TriggerEvent, NoteEvent, ParameterEvent, MusicalEvent } from './canonical-types';
import { reprojectTrackStepGrid } from './region-projection';
import { normalizePatternEvents } from './region-helpers';
import { runtimeParamToControlId, controlIdToRuntimeParam, isPercussionByIndex } from '../audio/instrument-registry';
import type { InverseConversionOptions } from './event-conversion';

// ---------------------------------------------------------------------------
// Helpers for canonical event manipulation
// ---------------------------------------------------------------------------

/** Find the first trigger event at a step index (integer position). */
function findTriggerAt(events: MusicalEvent[], stepIndex: number): number {
  return events.findIndex(
    e => e.kind === 'trigger' && Math.abs(e.at - stepIndex) < 0.001,
  );
}

/** Find the first note event at a step index (integer position). */
function findNoteAt(events: MusicalEvent[], stepIndex: number): number {
  return events.findIndex(
    e => e.kind === 'note' && Math.abs(e.at - stepIndex) < 0.001,
  );
}

/** Find the first gate-bearing event (trigger or note) at a step index. */
function findGateEventAt(events: MusicalEvent[], stepIndex: number): number {
  return events.findIndex(
    e => (e.kind === 'trigger' || e.kind === 'note') && Math.abs(e.at - stepIndex) < 0.001,
  );
}

function findParamAt(events: MusicalEvent[], stepIndex: number, controlId: string): number {
  return events.findIndex(
    e =>
      e.kind === 'parameter' &&
      Math.abs(e.at - stepIndex) < 0.001 &&
      (e as ParameterEvent).controlId === controlId,
  );
}

/** Default inverse conversion options for projecting canonical events to step params. */
const defaultInverseOpts: InverseConversionOptions = {
  canonicalToRuntime: (id: string) => controlIdToRuntimeParam[id] ?? id,
};

/**
 * Update track regions and re-project pattern. Returns updated session.
 * Pushes a PatternEditSnapshot for undo when a description is provided.
 */
function applyRegionEdit(
  session: Session,
  trackId: string,
  newEvents: MusicalEvent[],
  regionUpdates?: { duration?: number },
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
        prevDuration: regionUpdates?.duration !== undefined ? activeReg.duration : undefined,
        prevHiddenEvents: track._hiddenEvents ? [...track._hiddenEvents] : undefined,
        timestamp: Date.now(),
        description,
      }
    : undefined;

  const region = normalizePatternEvents({
    ...activeReg,
    events: newEvents,
    ...(regionUpdates ?? {}),
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
// Public API — human edit functions (all push undo snapshots)
// ---------------------------------------------------------------------------

export function toggleStepGate(session: Session, trackId: string, stepIndex: number): Session {
  const track = getTrack(session, trackId);
  if (stepIndex < 0 || stepIndex >= getActivePattern(track).duration) return session;

  // All tracks must have regions — return unchanged if invariant is violated
  if (track.patterns.length === 0) return session;

  const pitched = !isPercussionByIndex(track.model);
  const activeReg = getActivePattern(track);
  const events = [...activeReg.events];
  const idx = findGateEventAt(events, stepIndex);

  if (idx >= 0) {
    const existing = events[idx];
    if (existing.kind === 'trigger') {
      const trigger = existing as TriggerEvent;
      if (trigger.velocity === 0) {
        // Re-enable disabled trigger: restore accent state
        events[idx] = { ...trigger, velocity: trigger.accent ? 1.0 : 0.8 };
      } else {
        // Disable trigger: set velocity=0 to preserve accent state.
        events[idx] = { ...trigger, velocity: 0 };
      }
    } else if (existing.kind === 'note') {
      const note = existing as NoteEvent;
      if (note.velocity === 0) {
        // Re-enable disabled note
        events[idx] = { ...note, velocity: 0.8 };
      } else {
        // Disable note: set velocity=0 to preserve pitch/duration state.
        events[idx] = { ...note, velocity: 0 };
      }
    }
  } else {
    // Insert new event, keep sorted
    let newEvent: MusicalEvent;
    if (pitched) {
      const midiPitch = Math.round(Math.max(0, Math.min(127, track.params.note * 127)));
      newEvent = {
        kind: 'note',
        at: stepIndex,
        pitch: midiPitch,
        velocity: 0.8,
        duration: 1,
      } as NoteEvent;
    } else {
      newEvent = {
        kind: 'trigger',
        at: stepIndex,
        velocity: 0.8,
      } as TriggerEvent;
    }
    const insertAt = events.findIndex(e => e.at > stepIndex);
    if (insertAt === -1) events.push(newEvent);
    else events.splice(insertAt, 0, newEvent);
  }
  return applyRegionEdit(session, trackId, events, undefined, `Toggle gate at step ${stepIndex}`);
}

export function toggleStepAccent(session: Session, trackId: string, stepIndex: number): Session {
  const track = getTrack(session, trackId);
  if (stepIndex < 0 || stepIndex >= getActivePattern(track).duration) return session;

  // All tracks must have regions — return unchanged if invariant is violated
  if (track.patterns.length === 0) return session;

  const activeReg = getActivePattern(track);
  const events = [...activeReg.events];
  const idx = findGateEventAt(events, stepIndex);
  if (idx >= 0) {
    const existing = events[idx];
    if (existing.kind === 'trigger') {
      const trigger = existing as TriggerEvent;
      // Skip disabled triggers (velocity=0) — accent on an ungated step is a no-op
      if (trigger.velocity !== 0) {
        events[idx] = {
          ...trigger,
          accent: !trigger.accent,
          velocity: trigger.accent ? 0.8 : 1.0,
        };
      }
    } else if (existing.kind === 'note') {
      const note = existing as NoteEvent;
      // Skip disabled notes (velocity=0) — accent on an ungated step is a no-op
      if (note.velocity !== 0) {
        const isCurrentlyAccented = note.velocity >= 0.95;
        events[idx] = {
          ...note,
          velocity: isCurrentlyAccented ? 0.8 : 1.0,
        };
      }
    }
  }
  // If no gate event at this step (or disabled), accent toggle is a no-op
  return applyRegionEdit(session, trackId, events, undefined, `Toggle accent at step ${stepIndex}`);
}

export function setStepParamLock(
  session: Session,
  trackId: string,
  stepIndex: number,
  params: Partial<SynthParamValues>,
  options?: { pushUndo?: boolean },
): Session {
  const track = getTrack(session, trackId);
  if (stepIndex < 0 || stepIndex >= getActivePattern(track).duration) return session;

  // All tracks must have regions — return unchanged if invariant is violated
  if (track.patterns.length === 0) return session;

  const activeReg = getActivePattern(track);
  const events = [...activeReg.events];
  for (const [runtimeKey, value] of Object.entries(params)) {
    const controlId = runtimeParamToControlId[runtimeKey] ?? runtimeKey;
    const idx = findParamAt(events, stepIndex, controlId);
    if (idx >= 0) {
      events[idx] = { ...events[idx], value } as ParameterEvent;
    } else {
      const newEvent: ParameterEvent = {
        kind: 'parameter',
        at: stepIndex,
        controlId,
        value: value as number,
      };
      const insertAt = events.findIndex(e => e.at > stepIndex);
      if (insertAt === -1) events.push(newEvent);
      else events.splice(insertAt, 0, newEvent);
    }
  }
  const desc = (options?.pushUndo ?? true) ? `Set param lock at step ${stepIndex}` : undefined;
  return applyRegionEdit(session, trackId, events, undefined, desc);
}

export function clearStepParamLock(
  session: Session,
  trackId: string,
  stepIndex: number,
  param: string,
): Session {
  const track = getTrack(session, trackId);
  if (stepIndex < 0 || stepIndex >= getActivePattern(track).duration) return session;

  // All tracks must have regions — return unchanged if invariant is violated
  if (track.patterns.length === 0) return session;

  const controlId = runtimeParamToControlId[param] ?? param;
  const activeReg = getActivePattern(track);
  const events = [...activeReg.events];
  const idx = findParamAt(events, stepIndex, controlId);
  if (idx < 0) return session;
  events.splice(idx, 1);
  return applyRegionEdit(session, trackId, events, undefined, `Clear param lock at step ${stepIndex}`);
}

export function setPatternLength(session: Session, trackId: string, length: number): Session {
  const track = getTrack(session, trackId);
  const clamped = Math.max(1, Math.min(64, length));
  if (clamped === getActivePattern(track).duration) return session;

  // All tracks must have regions — return unchanged if invariant is violated
  if (track.patterns.length === 0) return session;

  // Update region duration, re-project.
  // Events beyond the new duration are stashed in track._hiddenEvents
  // so expanding later restores them. The region invariant (event.at < duration)
  // is preserved at all times.
  const currentEvents = getActivePattern(track).events;
  const prevHidden = track._hiddenEvents ?? [];

  // Merge current events + previously hidden events, then split by new duration
  const allEvents = [...currentEvents, ...prevHidden];
  const inRange = allEvents.filter(e => e.at < clamped);
  const outOfRange = allEvents.filter(e => e.at >= clamped);

  let result = applyRegionEdit(session, trackId, inRange, { duration: clamped }, `Set pattern length to ${clamped}`);
  result = updateTrack(result, trackId, {
    _hiddenEvents: outOfRange.length > 0 ? outOfRange : undefined,
  });
  return result;
}

/**
 * Insert a ParameterEvent at a fractional beat position during live recording.
 * Deduplicates: if an event for the same controlId at the same position exists
 * (within tolerance), it is replaced. Does NOT push an undo snapshot — the
 * caller is responsible for the recording-session-level snapshot.
 */
export function insertAutomationEvent(
  session: Session,
  trackId: string,
  at: number,
  controlId: string,
  value: number,
): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;

  const activeReg = getActivePattern(track);
  // Wrap position into region (loop-aware)
  const wrappedAt = ((at % activeReg.duration) + activeReg.duration) % activeReg.duration;

  const events = [...activeReg.events];
  const idx = findParamAt(events, wrappedAt, controlId);

  if (idx >= 0) {
    // Replace existing event at same position for same control
    events[idx] = { ...events[idx], value } as ParameterEvent;
  } else {
    const newEvent: ParameterEvent = {
      kind: 'parameter',
      at: wrappedAt,
      controlId,
      value,
    };
    const insertIdx = events.findIndex(e => e.at > wrappedAt);
    if (insertIdx === -1) events.push(newEvent);
    else events.splice(insertIdx, 0, newEvent);
  }

  // No undo snapshot — covered by the recording session snapshot
  return applyRegionEdit(session, trackId, events);
}

export function clearPattern(session: Session, trackId: string): Session {
  const track = getTrack(session, trackId);

  // All tracks must have regions — return unchanged if invariant is violated
  if (track.patterns.length === 0) return session;

  // Clear all events (including hidden stash)
  if (getActivePattern(track).events.length === 0 && !track._hiddenEvents?.length) return session;
  let result = applyRegionEdit(session, trackId, [], undefined, 'Clear pattern');
  result = updateTrack(result, trackId, { _hiddenEvents: undefined });
  return result;
}

// ---------------------------------------------------------------------------
// Quantize — snap events to nearest grid position
// ---------------------------------------------------------------------------

/**
 * Snap all events in the active region to the nearest grid position.
 * Default grid is 0.25 (sixteenth note). Undoable via PatternEditSnapshot.
 *
 * After snapping, events are re-sorted and deduplicated via normalizePatternEvents
 * (called by applyRegionEdit). Events that would snap to >= region.duration are
 * clamped to duration - gridSize to preserve the region invariant (event.at < duration).
 */
export function quantizeRegion(
  session: Session,
  trackId: string,
  gridSize: number = 0.25,
): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;

  const activeReg = getActivePattern(track);
  if (activeReg.events.length === 0) return session;

  const quantized = activeReg.events.map(e => {
    let snapped = Math.round(e.at / gridSize) * gridSize;
    // Clamp to valid range [0, duration)
    if (snapped < 0) snapped = 0;
    if (snapped >= activeReg.duration) snapped = activeReg.duration - gridSize;
    // Round to avoid floating-point noise
    snapped = Math.round(snapped * 10000) / 10000;
    return { ...e, at: snapped };
  });

  return applyRegionEdit(session, trackId, quantized, undefined, `Quantize to grid ${gridSize}`);
}
