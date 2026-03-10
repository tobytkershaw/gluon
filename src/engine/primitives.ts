// src/engine/primitives.ts
import type {
  Session, Snapshot, ParamSnapshot, PatternSnapshot,
  PendingAction, ParamPendingAction, SketchPendingAction,
  SynthParamValues,
} from './types';
import { getVoice, updateVoice } from './types';
import type { PatternSketch, Step } from './sequencer-types';

let nextPendingId = 1;

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

export function applySuggest(
  session: Session,
  voiceId: string,
  changes: Partial<SynthParamValues>,
  reason?: string,
): Session {
  const pending: ParamPendingAction = {
    id: `pending-${nextPendingId++}`,
    kind: 'suggestion',
    voiceId,
    changes,
    reason,
    expiresAt: Date.now() + 15000,
    previousValues: {},
  };

  return { ...session, pending: [...session.pending, pending] };
}

export function applyAudition(
  session: Session,
  voiceId: string,
  changes: Partial<SynthParamValues>,
  durationMs = 3000,
): Session {
  const voice = getVoice(session, voiceId);
  let currentParams = { ...voice.params };

  const existingAudition = session.pending.find(
    (p): p is ParamPendingAction => p.kind === 'audition' && p.voiceId === voiceId,
  );
  if (existingAudition) {
    currentParams = { ...currentParams, ...existingAudition.previousValues } as SynthParamValues;
  }

  const pendingWithoutOld = session.pending.filter(
    p => !(p.kind === 'audition' && p.voiceId === voiceId),
  );

  const previousValues: Partial<SynthParamValues> = {};
  for (const key of Object.keys(changes)) {
    previousValues[key] = currentParams[key];
  }

  const pending: ParamPendingAction = {
    id: `pending-${nextPendingId++}`,
    kind: 'audition',
    voiceId,
    changes,
    expiresAt: Date.now() + durationMs,
    previousValues,
  };

  return {
    ...updateVoice(session, voiceId, {
      params: { ...currentParams, ...changes } as SynthParamValues,
    }),
    pending: [...pendingWithoutOld, pending],
  };
}

export function cancelAuditionParam(session: Session, voiceId: string, param: string): Session {
  const audition = session.pending.find(
    (p): p is ParamPendingAction => p.kind === 'audition' && p.voiceId === voiceId,
  );
  if (!audition || !(param in audition.previousValues)) return session;

  const newPreviousValues = { ...audition.previousValues };
  delete newPreviousValues[param];
  const newChanges = { ...audition.changes };
  delete newChanges[param];

  if (Object.keys(newPreviousValues).length === 0) {
    return { ...session, pending: session.pending.filter(p => p.id !== audition.id) };
  }

  return {
    ...session,
    pending: session.pending.map(p =>
      p.id === audition.id ? { ...p, previousValues: newPreviousValues, changes: newChanges } : p,
    ),
  };
}

export function applySketchPending(
  session: Session,
  voiceId: string,
  description: string,
  pattern: PatternSketch,
): Session {
  const pending: SketchPendingAction = {
    id: `pending-${nextPendingId++}`,
    kind: 'sketch',
    voiceId,
    description,
    pattern,
    expiresAt: Date.now() + 30000,
  };

  return { ...session, pending: [...session.pending, pending] };
}

function applyPatternSketch(
  session: Session,
  voiceId: string,
  sketch: PatternSketch,
): { session: Session; snapshot: PatternSnapshot } {
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
    // Extend steps array if needed
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
    description: `sketch applied`,
  };

  const updated = updateVoice(session, voiceId, {
    pattern: { steps: newSteps, length: newLength },
  });

  return { session: updated, snapshot };
}

export function commitPending(session: Session, pendingId: string): Session {
  const action = session.pending.find(p => p.id === pendingId);
  if (!action) return session;

  const remaining = session.pending.filter(p => p.id !== pendingId);

  if (action.kind === 'sketch') {
    const { session: updated, snapshot } = applyPatternSketch(session, action.voiceId, action.pattern);
    return {
      ...updated,
      pending: remaining,
      undoStack: [...updated.undoStack, snapshot],
    };
  }

  // ParamPendingAction (suggestion) — apply changes and push undo snapshot
  if (action.kind === 'suggestion') {
    const voice = getVoice(session, action.voiceId);
    const prevValues: Partial<SynthParamValues> = {};
    for (const key of Object.keys(action.changes)) {
      prevValues[key] = voice.params[key];
    }
    const snapshot: ParamSnapshot = {
      kind: 'param',
      voiceId: action.voiceId,
      prevValues,
      aiTargetValues: action.changes,
      timestamp: Date.now(),
      description: `AI suggest committed: ${Object.keys(action.changes).join(', ')}`,
    };
    return {
      ...updateVoice(session, action.voiceId, {
        params: { ...voice.params, ...action.changes } as SynthParamValues,
      }),
      pending: remaining,
      undoStack: [...session.undoStack, snapshot],
    };
  }

  // Audition — already applied, just remove from pending
  return { ...session, pending: remaining };
}

export function dismissPending(session: Session, pendingId: string): Session {
  const action = session.pending.find(p => p.id === pendingId);
  if (!action) return session;

  if (action.kind === 'audition') {
    const voice = getVoice(session, action.voiceId);
    return {
      ...updateVoice(session, action.voiceId, {
        params: { ...voice.params, ...action.previousValues } as SynthParamValues,
      }),
      pending: session.pending.filter(p => p.id !== pendingId),
    };
  }

  // Suggestion or sketch — just remove
  return { ...session, pending: session.pending.filter(p => p.id !== pendingId) };
}

export function applyUndo(session: Session): Session {
  if (session.undoStack.length === 0) return session;

  const newStack = [...session.undoStack];
  const snapshot = newStack.pop()!;

  if (snapshot.kind === 'pattern') {
    const voice = getVoice(session, snapshot.voiceId);
    const newSteps = [...voice.pattern.steps];
    for (const { index, step } of snapshot.prevSteps) {
      if (index < newSteps.length) {
        newSteps[index] = step;
      }
    }
    const newLength = snapshot.prevLength ?? voice.pattern.length;
    return {
      ...updateVoice(session, snapshot.voiceId, {
        pattern: { steps: newSteps, length: newLength },
      }),
      undoStack: newStack,
    };
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

  return {
    ...updateVoice(session, snapshot.voiceId, { params: newParams }),
    undoStack: newStack,
  };
}
