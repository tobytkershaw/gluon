// src/engine/pattern-primitives.ts
import type { Session, SynthParamValues, RegionSnapshot, PatternSnapshot } from './types';
import { getVoice, updateVoice } from './types';
import type { TriggerEvent, ParameterEvent, MusicalEvent } from './canonical-types';
import { createDefaultStep } from './sequencer-helpers';
import { reprojectVoicePattern } from './region-projection';
import { normalizeRegionEvents } from './region-helpers';
import { runtimeParamToControlId, controlIdToRuntimeParam } from '../audio/instrument-registry';
import type { InverseConversionOptions } from './event-conversion';

// ---------------------------------------------------------------------------
// Helpers for canonical event manipulation
// ---------------------------------------------------------------------------

/** Find the first event of a given kind at a step index (integer position). */
function findTriggerAt(events: MusicalEvent[], stepIndex: number): number {
  return events.findIndex(
    e => e.kind === 'trigger' && Math.abs(e.at - stepIndex) < 0.001,
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
 * Update voice regions and re-project pattern. Returns updated session.
 * Pushes a RegionSnapshot for undo when a description is provided.
 */
function applyRegionEdit(
  session: Session,
  voiceId: string,
  newEvents: MusicalEvent[],
  regionUpdates?: { duration?: number },
  description?: string,
): Session {
  const voice = getVoice(session, voiceId);
  if (voice.regions.length === 0) return session;

  const snapshot: RegionSnapshot | undefined = description
    ? {
        kind: 'region',
        voiceId,
        prevEvents: [...voice.regions[0].events],
        prevDuration: regionUpdates?.duration !== undefined ? voice.regions[0].duration : undefined,
        prevHiddenEvents: voice._hiddenEvents ? [...voice._hiddenEvents] : undefined,
        timestamp: Date.now(),
        description,
      }
    : undefined;

  const region = normalizeRegionEvents({
    ...voice.regions[0],
    events: newEvents,
    ...(regionUpdates ?? {}),
  });
  const newRegions = [region, ...voice.regions.slice(1)];
  const updatedVoice = reprojectVoicePattern({ ...voice, regions: newRegions }, defaultInverseOpts);
  const result = updateVoice(session, voiceId, {
    regions: updatedVoice.regions,
    pattern: updatedVoice.pattern,
  });

  if (snapshot) {
    return { ...result, undoStack: [...result.undoStack, snapshot] };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API — human edit functions (all push undo snapshots)
// ---------------------------------------------------------------------------

export function toggleStepGate(session: Session, voiceId: string, stepIndex: number): Session {
  const voice = getVoice(session, voiceId);
  if (stepIndex < 0 || stepIndex >= voice.pattern.length) return session;

  // Canonical path: toggle trigger event at this step
  if (voice.regions.length > 0) {
    const events = [...voice.regions[0].events];
    const idx = findTriggerAt(events, stepIndex);
    if (idx >= 0) {
      const existing = events[idx] as TriggerEvent;
      if (existing.velocity === 0) {
        // Re-enable disabled trigger: restore accent state
        events[idx] = {
          ...existing,
          velocity: existing.accent ? 1.0 : 0.8,
        };
      } else {
        // Disable trigger: set velocity=0 to preserve accent state.
        // The projection treats velocity=0 as ungated.
        events[idx] = { ...existing, velocity: 0 };
      }
    } else {
      // Insert new trigger, keep sorted
      const newTrigger: TriggerEvent = { kind: 'trigger', at: stepIndex, velocity: 0.8 };
      const insertAt = events.findIndex(e => e.at > stepIndex);
      if (insertAt === -1) events.push(newTrigger);
      else events.splice(insertAt, 0, newTrigger);
    }
    return applyRegionEdit(session, voiceId, events, undefined, `Toggle gate at step ${stepIndex}`);
  }

  // Fallback: direct pattern edit (no regions)
  const oldStep = voice.pattern.steps[stepIndex];
  const newSteps = [...voice.pattern.steps];
  newSteps[stepIndex] = { ...oldStep, gate: !oldStep.gate };
  return updateVoice(session, voiceId, { pattern: { ...voice.pattern, steps: newSteps } });
}

export function toggleStepAccent(session: Session, voiceId: string, stepIndex: number): Session {
  const voice = getVoice(session, voiceId);
  if (stepIndex < 0 || stepIndex >= voice.pattern.length) return session;

  // Canonical path: toggle accent on trigger event
  if (voice.regions.length > 0) {
    const events = [...voice.regions[0].events];
    const idx = findTriggerAt(events, stepIndex);
    if (idx >= 0) {
      const trigger = events[idx] as TriggerEvent;
      // Skip disabled triggers (velocity=0) — accent on an ungated step is a no-op
      if (trigger.velocity !== 0) {
        events[idx] = {
          ...trigger,
          accent: !trigger.accent,
          velocity: trigger.accent ? 0.8 : 1.0,
        };
      }
    }
    // If no trigger at this step (or disabled), accent toggle is a no-op
    return applyRegionEdit(session, voiceId, events, undefined, `Toggle accent at step ${stepIndex}`);
  }

  // Fallback
  const oldStep = voice.pattern.steps[stepIndex];
  const newSteps = [...voice.pattern.steps];
  newSteps[stepIndex] = { ...oldStep, accent: !oldStep.accent };
  return updateVoice(session, voiceId, { pattern: { ...voice.pattern, steps: newSteps } });
}

export function setStepParamLock(
  session: Session,
  voiceId: string,
  stepIndex: number,
  params: Partial<SynthParamValues>,
  options?: { pushUndo?: boolean },
): Session {
  const voice = getVoice(session, voiceId);
  if (stepIndex < 0 || stepIndex >= voice.pattern.length) return session;

  // Canonical path: insert/update ParameterEvent
  if (voice.regions.length > 0) {
    const events = [...voice.regions[0].events];
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
    return applyRegionEdit(session, voiceId, events, undefined, desc);
  }

  // Fallback
  const oldStep = voice.pattern.steps[stepIndex];
  const newSteps = [...voice.pattern.steps];
  newSteps[stepIndex] = { ...oldStep, params: { ...oldStep.params, ...params } };
  return updateVoice(session, voiceId, { pattern: { ...voice.pattern, steps: newSteps } });
}

export function clearStepParamLock(
  session: Session,
  voiceId: string,
  stepIndex: number,
  param: string,
): Session {
  const voice = getVoice(session, voiceId);
  if (stepIndex < 0 || stepIndex >= voice.pattern.length) return session;

  // Canonical path: remove ParameterEvent
  if (voice.regions.length > 0) {
    const controlId = runtimeParamToControlId[param] ?? param;
    const events = [...voice.regions[0].events];
    const idx = findParamAt(events, stepIndex, controlId);
    if (idx < 0) return session;
    events.splice(idx, 1);
    return applyRegionEdit(session, voiceId, events, undefined, `Clear param lock at step ${stepIndex}`);
  }

  // Fallback
  const oldStep = voice.pattern.steps[stepIndex];
  if (!oldStep.params || !(param in oldStep.params)) return session;
  const newParams = { ...oldStep.params };
  delete newParams[param];
  const newSteps = [...voice.pattern.steps];
  newSteps[stepIndex] = {
    ...oldStep,
    params: Object.keys(newParams).length > 0 ? newParams : undefined,
  };
  return updateVoice(session, voiceId, { pattern: { ...voice.pattern, steps: newSteps } });
}

export function setPatternLength(session: Session, voiceId: string, length: number): Session {
  const voice = getVoice(session, voiceId);
  const clamped = Math.max(1, Math.min(64, length));
  if (clamped === voice.pattern.length) return session;

  // Canonical path: update region duration, re-project.
  // Events beyond the new duration are stashed in voice._hiddenEvents
  // so expanding later restores them. The region invariant (event.at < duration)
  // is preserved at all times.
  if (voice.regions.length > 0) {
    const currentEvents = voice.regions[0].events;
    const prevHidden = voice._hiddenEvents ?? [];

    // Merge current events + previously hidden events, then split by new duration
    const allEvents = [...currentEvents, ...prevHidden];
    const inRange = allEvents.filter(e => e.at < clamped);
    const outOfRange = allEvents.filter(e => e.at >= clamped);

    let result = applyRegionEdit(session, voiceId, inRange, { duration: clamped }, `Set pattern length to ${clamped}`);
    result = updateVoice(result, voiceId, {
      _hiddenEvents: outOfRange.length > 0 ? outOfRange : undefined,
    });
    return result;
  }

  // Fallback: push undo snapshot so length changes are undoable (#210)
  const snapshot: PatternSnapshot = {
    kind: 'pattern',
    voiceId,
    prevSteps: [],
    prevLength: voice.pattern.length,
    prevHiddenEvents: voice._hiddenEvents ? [...voice._hiddenEvents] : undefined,
    timestamp: Date.now(),
    description: `Set pattern length to ${clamped}`,
  };
  const newSteps = [...voice.pattern.steps];
  while (newSteps.length < clamped) newSteps.push(createDefaultStep());
  const result = updateVoice(session, voiceId, { pattern: { steps: newSteps, length: clamped } });
  return { ...result, undoStack: [...result.undoStack, snapshot] };
}

export function clearPattern(session: Session, voiceId: string): Session {
  const voice = getVoice(session, voiceId);

  // Canonical path: clear all events (including hidden stash)
  if (voice.regions.length > 0) {
    if (voice.regions[0].events.length === 0 && !voice._hiddenEvents?.length) return session;
    let result = applyRegionEdit(session, voiceId, [], undefined, 'Clear pattern');
    result = updateVoice(result, voiceId, { _hiddenEvents: undefined });
    return result;
  }

  // Fallback
  const hasContent = voice.pattern.steps.some(
    s => s.gate || s.accent || s.params !== undefined || s.micro !== 0,
  );
  if (!hasContent) return session;
  const newSteps = voice.pattern.steps.map(() => createDefaultStep());
  return updateVoice(session, voiceId, { pattern: { ...voice.pattern, steps: newSteps } });
}
