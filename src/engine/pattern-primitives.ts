// src/engine/pattern-primitives.ts
import type { Session, SynthParamValues, PatternEditSnapshot, PatternEditOp } from './types';
import { getTrack, getActivePattern, updateTrack } from './types';
import type { Pattern } from './canonical-types';
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

function findMatchingGateEventAt(
  events: MusicalEvent[],
  stepIndex: number,
  match?: PatternEditOp['match'],
  fallbackType?: 'trigger' | 'note',
): number {
  const targetType = match?.type ?? fallbackType;

  if (targetType === 'trigger') {
    return findTriggerAt(events, stepIndex);
  }

  if (targetType === 'note') {
    if (match?.pitch !== undefined) {
      return events.findIndex(
        e =>
          e.kind === 'note' &&
          sameStep(e.at, stepIndex) &&
          (e as NoteEvent).pitch === match.pitch,
      );
    }
    return findNoteAt(events, stepIndex);
  }

  return findGateEventAt(events, stepIndex);
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
  patternId?: string,
): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;

  const activeReg = patternId
    ? (track.patterns.find(p => p.id === patternId) ?? getActivePattern(track))
    : getActivePattern(track);

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

/** Find the first gate event at a step index matching a specific padId (or undefined for non-drum events). */
function findGateEventAtForPad(events: MusicalEvent[], stepIndex: number, padId?: string): number {
  return events.findIndex(
    e => (e.kind === 'trigger' || e.kind === 'note') &&
         Math.abs(e.at - stepIndex) < 0.001 &&
         (padId === undefined || (e.kind === 'trigger' && (e as TriggerEvent).padId === padId)),
  );
}

export function toggleStepGate(session: Session, trackId: string, stepIndex: number, patternId?: string, options?: { pushUndo?: boolean; padId?: string }): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;

  const targetPattern = patternId
    ? (track.patterns.find(p => p.id === patternId) ?? getActivePattern(track))
    : getActivePattern(track);
  if (stepIndex < 0 || stepIndex >= targetPattern.duration) return session;

  const padId = options?.padId;
  const pitched = !isPercussionByIndex(track.model);
  const activeReg = targetPattern;
  const events = [...activeReg.events];
  // When padId is specified, find an event matching that padId; otherwise use the generic finder
  const idx = padId !== undefined
    ? findGateEventAtForPad(events, stepIndex, padId)
    : findGateEventAt(events, stepIndex);

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
      const trigger: TriggerEvent = {
        kind: 'trigger',
        at: stepIndex,
        velocity: 0.8,
      };
      // Attach padId when creating a new trigger for a specific drum pad
      if (padId !== undefined) trigger.padId = padId;
      newEvent = trigger;
    }
    const insertAt = events.findIndex(e => e.at > stepIndex);
    if (insertAt === -1) events.push(newEvent);
    else events.splice(insertAt, 0, newEvent);
  }
  const desc = (options?.pushUndo ?? true) ? `Toggle gate at step ${stepIndex}` : undefined;
  return applyRegionEdit(session, trackId, events, undefined, desc, patternId);
}

export function toggleStepAccent(session: Session, trackId: string, stepIndex: number, patternId?: string, padId?: string): Session {
  const track = getTrack(session, trackId);

  // All tracks must have regions — return unchanged if invariant is violated
  if (track.patterns.length === 0) return session;

  const activeReg = patternId
    ? (track.patterns.find(p => p.id === patternId) ?? getActivePattern(track))
    : getActivePattern(track);
  if (stepIndex < 0 || stepIndex >= activeReg.duration) return session;

  const events = [...activeReg.events];
  // When padId is specified, find an event matching that padId; otherwise use the generic finder
  const idx = padId !== undefined
    ? findGateEventAtForPad(events, stepIndex, padId)
    : findGateEventAt(events, stepIndex);
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
  return applyRegionEdit(session, trackId, events, undefined, `Toggle accent at step ${stepIndex}`, patternId);
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

// ---------------------------------------------------------------------------
// Non-destructive pattern editing — add/remove/modify individual events
// ---------------------------------------------------------------------------

/** Tolerance for matching events at the same step position. */
const STEP_TOLERANCE = 0.001;

function sameStep(a: number, b: number): boolean {
  return Math.abs(a - b) < STEP_TOLERANCE;
}

/** Count note events at a given step position. */
function countNotesAt(events: MusicalEvent[], step: number): number {
  return events.filter(e => e.kind === 'note' && sameStep(e.at, step)).length;
}

/**
 * Validate a batch of PatternEditOp against a pattern.
 * Returns an array of error strings (empty = valid).
 */
export function validatePatternEditOps(
  pattern: Pattern,
  operations: PatternEditOp[],
): string[] {
  const errors: string[] = [];
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const prefix = `ops[${i}]`;

    if (op.step < 0 || op.step >= pattern.duration) {
      errors.push(`${prefix}: step ${op.step} out of range [0, ${pattern.duration})`);
      continue;
    }

    if (op.action === 'modify' || op.action === 'remove') {
      // Must have an existing event at this step to modify/remove
      const hasGateEvent = findMatchingGateEventAt(pattern.events, op.step, op.match, op.event?.type) >= 0;
      const hasParamEvent = op.params?.length
        ? op.params.some(p =>
            pattern.events.some(
              e => e.kind === 'parameter' && sameStep(e.at, op.step) && (e as ParameterEvent).controlId === p.controlId,
            ),
          )
        : false;
      if (op.action === 'remove' && !hasGateEvent && !hasParamEvent) {
        errors.push(`${prefix}: no event at step ${op.step} to remove`);
      }
      if (op.action === 'modify' && !hasGateEvent && !hasParamEvent) {
        errors.push(`${prefix}: no event at step ${op.step} to modify`);
      }
    }

    if (op.event) {
      if (op.event.velocity !== undefined && (op.event.velocity < 0 || op.event.velocity > 1)) {
        errors.push(`${prefix}: velocity ${op.event.velocity} out of range [0, 1]`);
      }
      if (op.event.type === 'note') {
        if (op.event.pitch !== undefined && (op.event.pitch < 0 || op.event.pitch > 127)) {
          errors.push(`${prefix}: pitch ${op.event.pitch} out of range [0, 127]`);
        }
        if (op.event.duration !== undefined && op.event.duration <= 0) {
          errors.push(`${prefix}: duration must be > 0`);
        }
      }
    }
  }
  return errors;
}

/**
 * Apply a batch of non-destructive edit operations to a pattern.
 * All operations are applied as a single undo group.
 *
 * - `add`: insert event at step (error if trigger already occupied; notes allow stacking up to 4)
 * - `remove`: remove event at step (by type if specified, otherwise all gate events)
 * - `modify`: change velocity/accent/pitch on existing event at step
 *
 * Parameter locks (via `params`) are added/modified on add/modify, or removed on remove.
 */
export function editPatternEvents(
  session: Session,
  trackId: string,
  patternId: string | undefined,
  operations: PatternEditOp[],
  description: string,
): Session {
  const track = getTrack(session, trackId);
  if (track.patterns.length === 0) return session;

  // Resolve pattern: by ID or active
  const pattern = patternId
    ? track.patterns.find(p => p.id === patternId)
    : getActivePattern(track);
  if (!pattern) return session;

  const events = [...pattern.events];

  for (const op of operations) {
    switch (op.action) {
      case 'add': {
        // Add gate event if specified
        if (op.event) {
          if (op.event.type === 'trigger') {
            // Check for existing trigger at this step
            const existingIdx = events.findIndex(
              e => e.kind === 'trigger' && sameStep(e.at, op.step),
            );
            if (existingIdx >= 0) {
              // Overwrite existing trigger rather than error — more useful behavior
              events[existingIdx] = {
                ...events[existingIdx],
                velocity: op.event.velocity ?? 0.8,
                accent: op.event.accent ?? false,
              } as TriggerEvent;
            } else {
              const newTrigger: TriggerEvent = {
                kind: 'trigger',
                at: op.step,
                velocity: op.event.velocity ?? 0.8,
                accent: op.event.accent ?? false,
              };
              const insertAt = events.findIndex(e => e.at > op.step);
              if (insertAt === -1) events.push(newTrigger);
              else events.splice(insertAt, 0, newTrigger);
            }
          } else if (op.event.type === 'note') {
            // Notes allow stacking up to 4
            if (countNotesAt(events, op.step) >= 4) {
              // Skip — max polyphony reached
              continue;
            }
            const newNote: NoteEvent = {
              kind: 'note',
              at: op.step,
              pitch: op.event.pitch ?? 60,
              velocity: op.event.velocity ?? 0.8,
              duration: op.event.duration ?? 1,
            };
            const insertAt = events.findIndex(e => e.at > op.step);
            if (insertAt === -1) events.push(newNote);
            else events.splice(insertAt, 0, newNote);
          }
        }

        // Add parameter locks
        if (op.params) {
          for (const p of op.params) {
            const existingIdx = events.findIndex(
              e => e.kind === 'parameter' && sameStep(e.at, op.step) && (e as ParameterEvent).controlId === p.controlId,
            );
            if (existingIdx >= 0) {
              events[existingIdx] = { ...events[existingIdx], value: p.value } as ParameterEvent;
            } else {
              const newParam: ParameterEvent = {
                kind: 'parameter',
                at: op.step,
                controlId: p.controlId,
                value: p.value,
              };
              const insertAt = events.findIndex(e => e.at > op.step);
              if (insertAt === -1) events.push(newParam);
              else events.splice(insertAt, 0, newParam);
            }
          }
        }
        break;
      }

      case 'remove': {
        if (op.event?.type) {
          const idx = findMatchingGateEventAt(events, op.step, op.match, op.event.type);
          if (idx >= 0) events.splice(idx, 1);
        } else if (op.match) {
          const idx = findMatchingGateEventAt(events, op.step, op.match);
          if (idx >= 0) events.splice(idx, 1);
        } else {
          // Remove all gate events (triggers + notes) at this step
          for (let i = events.length - 1; i >= 0; i--) {
            if ((events[i].kind === 'trigger' || events[i].kind === 'note') && sameStep(events[i].at, op.step)) {
              events.splice(i, 1);
            }
          }
        }

        // Remove parameter locks
        if (op.params) {
          for (const p of op.params) {
            const idx = events.findIndex(
              e => e.kind === 'parameter' && sameStep(e.at, op.step) && (e as ParameterEvent).controlId === p.controlId,
            );
            if (idx >= 0) events.splice(idx, 1);
          }
        }
        break;
      }

      case 'modify': {
        // Modify gate event
        if (op.event) {
          const idx = findMatchingGateEventAt(events, op.step, op.match, op.event.type);
          if (idx >= 0) {
            const existing = events[idx];
            if (existing.kind === 'trigger') {
              events[idx] = {
                ...existing,
                ...(op.event.velocity !== undefined ? { velocity: op.event.velocity } : {}),
                ...(op.event.accent !== undefined ? { accent: op.event.accent } : {}),
              } as TriggerEvent;
            } else if (existing.kind === 'note') {
              events[idx] = {
                ...existing,
                ...(op.event.velocity !== undefined ? { velocity: op.event.velocity } : {}),
                ...(op.event.pitch !== undefined ? { pitch: op.event.pitch } : {}),
                ...(op.event.duration !== undefined ? { duration: op.event.duration } : {}),
              } as NoteEvent;
            }
          }
        }

        // Modify or add parameter locks
        if (op.params) {
          for (const p of op.params) {
            const existingIdx = events.findIndex(
              e => e.kind === 'parameter' && sameStep(e.at, op.step) && (e as ParameterEvent).controlId === p.controlId,
            );
            if (existingIdx >= 0) {
              events[existingIdx] = { ...events[existingIdx], value: p.value } as ParameterEvent;
            } else {
              // For modify, also add param locks if they don't exist yet
              const newParam: ParameterEvent = {
                kind: 'parameter',
                at: op.step,
                controlId: p.controlId,
                value: p.value,
              };
              const insertAt = events.findIndex(e => e.at > op.step);
              if (insertAt === -1) events.push(newParam);
              else events.splice(insertAt, 0, newParam);
            }
          }
        }
        break;
      }
    }
  }

  // Use the pattern-specific applyRegionEdit variant that targets a specific pattern
  return applyRegionEditForPattern(session, trackId, pattern.id, events, description);
}

/**
 * Like applyRegionEdit but targets a specific pattern by ID (not just active).
 */
function applyRegionEditForPattern(
  session: Session,
  trackId: string,
  patternId: string,
  newEvents: MusicalEvent[],
  description: string,
): Session {
  const track = getTrack(session, trackId);
  const pattern = track.patterns.find(p => p.id === patternId);
  if (!pattern) return session;

  const snapshot: PatternEditSnapshot = {
    kind: 'pattern-edit',
    trackId,
    patternId: pattern.id,
    prevEvents: [...pattern.events],
    prevHiddenEvents: track._hiddenEvents ? [...track._hiddenEvents] : undefined,
    timestamp: Date.now(),
    description,
  };

  const region = normalizePatternEvents({
    ...pattern,
    events: newEvents,
  });
  const newRegions = track.patterns.map(r => r.id === pattern.id ? region : r);
  const updatedTrack = reprojectTrackStepGrid({ ...track, patterns: newRegions }, defaultInverseOpts);
  const result = updateTrack(session, trackId, {
    patterns: updatedTrack.patterns,
    stepGrid: updatedTrack.stepGrid,
    _patternDirty: true,
  });

  return { ...result, undoStack: [...result.undoStack, snapshot] };
}
