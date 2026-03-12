// src/engine/primitives.ts
import type {
  Session, ParamSnapshot, PatternSnapshot, TransportSnapshot, Snapshot,
  SynthParamValues, RegionSnapshot, ViewSnapshot,
} from './types';
import { getVoice, updateVoice } from './types';
import type { PatternSketch, Step } from './sequencer-types';
import { reprojectVoicePattern } from './region-projection';
import { stepsToEvents } from './event-conversion';
import { normalizeRegionEvents } from './region-helpers';
import { runtimeParamToControlId } from '../audio/instrument-registry';

function clampParam(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function applyMove(
  session: Session,
  voiceId: string,
  param: string,
  target: { absolute: number } | { relative: number },
): Session {
  const voice = getVoice(session, voiceId);
  const currentValue = voice.params[param] ?? 0;
  const newValue = 'absolute' in target ? target.absolute : currentValue + target.relative;
  const clamped = clampParam(newValue);

  const snapshot: ParamSnapshot = {
    kind: 'param',
    voiceId,
    prevValues: { [param]: currentValue },
    aiTargetValues: { [param]: clamped },
    timestamp: Date.now(),
    description: `AI move: ${param} ${currentValue.toFixed(2)} -> ${clamped.toFixed(2)}`,
  };

  return {
    ...updateVoice(session, voiceId, {
      params: { ...voice.params, [param]: clamped },
    }),
    undoStack: [...session.undoStack, snapshot],
  };
}

export function applyMoveGroup(
  session: Session,
  voiceId: string,
  moves: { param: string; target: { absolute: number } | { relative: number } }[],
): Session {
  const voice = getVoice(session, voiceId);
  const prevValues: Partial<SynthParamValues> = {};
  const aiTargetValues: Partial<SynthParamValues> = {};
  const descriptions: string[] = [];

  for (const move of moves) {
    const cur = voice.params[move.param] ?? 0;
    prevValues[move.param] = cur;
    const nv = clampParam('absolute' in move.target ? move.target.absolute : cur + move.target.relative);
    aiTargetValues[move.param] = nv;
    descriptions.push(`${move.param} ${cur.toFixed(2)} -> ${nv.toFixed(2)}`);
  }

  const snapshot: ParamSnapshot = {
    kind: 'param',
    voiceId,
    prevValues,
    aiTargetValues,
    timestamp: Date.now(),
    description: `AI group: ${descriptions.join(', ')}`,
  };

  const newParams = { ...voice.params };
  for (const move of moves) {
    const currentValue = newParams[move.param] ?? 0;
    const newValue = 'absolute' in move.target ? move.target.absolute : currentValue + move.target.relative;
    newParams[move.param] = clampParam(newValue);
  }

  return {
    ...updateVoice(session, voiceId, { params: newParams }),
    undoStack: [...session.undoStack, snapshot],
  };
}

export function applyParamDirect(
  session: Session,
  voiceId: string,
  param: string,
  value: number,
): Session {
  const voice = getVoice(session, voiceId);
  return updateVoice(session, voiceId, {
    params: { ...voice.params, [param]: clampParam(value) },
  });
}

export function applySketch(
  session: Session,
  voiceId: string,
  description: string,
  sketch: PatternSketch,
): Session {
  const voice = getVoice(session, voiceId);
  const prevSteps: { index: number; step: Step }[] = [];
  const newSteps = [...voice.pattern.steps];
  let newLength = voice.pattern.length;
  const prevLength = sketch.length !== undefined && sketch.length !== voice.pattern.length
    ? voice.pattern.length
    : undefined;

  if (sketch.length !== undefined) {
    const clamped = Math.max(1, Math.min(64, sketch.length));
    newLength = clamped;
    while (newSteps.length < clamped) {
      newSteps.push({ gate: false, accent: false, micro: 0 });
    }
  }

  for (const stepSketch of sketch.steps) {
    if (stepSketch.index < 0 || stepSketch.index >= newSteps.length) continue;
    prevSteps.push({ index: stepSketch.index, step: { ...newSteps[stepSketch.index] } });
    const existing = newSteps[stepSketch.index];
    newSteps[stepSketch.index] = {
      gate: stepSketch.gate ?? existing.gate,
      accent: stepSketch.accent ?? existing.accent,
      micro: stepSketch.micro ?? existing.micro,
      params: stepSketch.params !== undefined
        ? { ...existing.params, ...stepSketch.params }
        : existing.params,
    };
  }

  const snapshot: PatternSnapshot = {
    kind: 'pattern',
    voiceId,
    prevSteps,
    prevLength,
    timestamp: Date.now(),
    description,
  };

  const newPattern = { steps: newSteps, length: newLength };
  let updated = updateVoice(session, voiceId, { pattern: newPattern });

  // Project pattern steps to canonical events in the region
  const updatedVoice = getVoice(updated, voiceId);
  if (updatedVoice.regions.length > 0) {
    const events = stepsToEvents(newSteps.slice(0, newLength), {
      runtimeToCanonical: (k) => runtimeParamToControlId[k] ?? k,
    });
    const region = normalizeRegionEvents({
      ...updatedVoice.regions[0],
      events,
      duration: newLength,
    });
    updated = updateVoice(updated, voiceId, {
      regions: [region, ...updatedVoice.regions.slice(1)],
    });
  }

  return {
    ...updated,
    undoStack: [...updated.undoStack, snapshot],
  };
}

function revertSnapshot(session: Session, snapshot: Snapshot): Session {
  if (snapshot.kind === 'transport') {
    return { ...session, transport: snapshot.prevTransport };
  }

  if (snapshot.kind === 'model') {
    return updateVoice(session, snapshot.voiceId, { model: snapshot.prevModel, engine: snapshot.prevEngine });
  }

  if (snapshot.kind === 'view') {
    return updateVoice(session, snapshot.voiceId, { views: snapshot.prevViews });
  }

  if (snapshot.kind === 'region') {
    const voice = getVoice(session, snapshot.voiceId);
    if (voice.regions.length === 0) return session;
    const restoredRegion = {
      ...voice.regions[0],
      events: snapshot.prevEvents,
      ...(snapshot.prevDuration !== undefined ? { duration: snapshot.prevDuration } : {}),
    };
    const updatedVoice = reprojectVoicePattern({
      ...voice,
      regions: [restoredRegion, ...voice.regions.slice(1)],
    });
    return updateVoice(session, snapshot.voiceId, {
      regions: updatedVoice.regions,
      pattern: updatedVoice.pattern,
    });
  }

  if (snapshot.kind === 'pattern') {
    const voice = getVoice(session, snapshot.voiceId);
    const newSteps = [...voice.pattern.steps];
    for (const { index, step } of snapshot.prevSteps) {
      if (index < newSteps.length) {
        newSteps[index] = step;
      }
    }
    const newLength = snapshot.prevLength ?? voice.pattern.length;
    return updateVoice(session, snapshot.voiceId, {
      pattern: { steps: newSteps, length: newLength },
    });
  }

  // ParamSnapshot
  const voice = getVoice(session, snapshot.voiceId);
  const newParams = { ...voice.params };
  for (const [param, prevValue] of Object.entries(snapshot.prevValues)) {
    const aiTarget = snapshot.aiTargetValues[param];
    const currentValue = newParams[param];
    if (aiTarget !== undefined && Math.abs(currentValue - aiTarget) < 0.001) {
      newParams[param] = prevValue as number;
    }
  }

  const updates: Partial<import('./types').Voice> = { params: newParams };
  if (snapshot.prevProvenance && voice.controlProvenance) {
    updates.controlProvenance = {
      ...voice.controlProvenance,
      ...snapshot.prevProvenance,
    };
  }

  return updateVoice(session, snapshot.voiceId, updates);
}

export function applyUndo(session: Session): Session {
  if (session.undoStack.length === 0) return session;

  const newStack = [...session.undoStack];
  const entry = newStack.pop()!;

  if (entry.kind === 'group') {
    let result = session;
    // Revert in reverse order
    for (let i = entry.snapshots.length - 1; i >= 0; i--) {
      result = revertSnapshot(result, entry.snapshots[i]);
    }
    return { ...result, undoStack: newStack };
  }

  return { ...revertSnapshot(session, entry), undoStack: newStack };
}
