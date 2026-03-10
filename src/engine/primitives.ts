// src/engine/primitives.ts

import type { Session, Snapshot, PendingAction, SynthParamValues } from './types';

let nextPendingId = 1;

function clampParam(_name: string, value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function applyMove(
  session: Session,
  param: string,
  target: { absolute: number } | { relative: number },
): Session {
  const currentValue = session.voice.params[param] ?? 0;
  const newValue = 'absolute' in target ? target.absolute : currentValue + target.relative;
  const clamped = clampParam(param, newValue);

  const snapshot: Snapshot = {
    prevValues: { [param]: currentValue },
    aiTargetValues: { [param]: clamped },
    timestamp: Date.now(),
    description: `AI move: ${param} ${currentValue.toFixed(2)} -> ${clamped.toFixed(2)}`,
  };

  return {
    ...session,
    voice: {
      ...session.voice,
      params: { ...session.voice.params, [param]: clamped },
    },
    undoStack: [...session.undoStack, snapshot],
  };
}

export function applyMoveGroup(
  session: Session,
  moves: { param: string; target: { absolute: number } | { relative: number } }[],
): Session {
  const prevValues: Partial<SynthParamValues> = {};
  const aiTargetValues: Partial<SynthParamValues> = {};
  const descriptions: string[] = [];

  for (const move of moves) {
    const cur = session.voice.params[move.param] ?? 0;
    prevValues[move.param] = cur;
    const nv = clampParam(move.param, 'absolute' in move.target ? move.target.absolute : cur + move.target.relative);
    aiTargetValues[move.param] = nv;
    descriptions.push(`${move.param} ${cur.toFixed(2)} -> ${nv.toFixed(2)}`);
  }

  const snapshot: Snapshot = {
    prevValues,
    aiTargetValues,
    timestamp: Date.now(),
    description: `AI group: ${descriptions.join(', ')}`,
  };

  const newParams = { ...session.voice.params };
  for (const move of moves) {
    const currentValue = newParams[move.param] ?? 0;
    const newValue = 'absolute' in move.target ? move.target.absolute : currentValue + move.target.relative;
    newParams[move.param] = clampParam(move.param, newValue);
  }

  return {
    ...session,
    voice: { ...session.voice, params: newParams },
    undoStack: [...session.undoStack, snapshot],
  };
}

export function applyParamDirect(
  session: Session,
  param: string,
  value: number,
): Session {
  return {
    ...session,
    voice: {
      ...session.voice,
      params: { ...session.voice.params, [param]: clampParam(param, value) },
    },
  };
}

export function applySuggest(
  session: Session,
  changes: Partial<SynthParamValues>,
  reason?: string,
): Session {
  const pending: PendingAction = {
    id: `pending-${nextPendingId++}`,
    type: 'suggestion',
    voiceId: session.voice.id,
    changes,
    reason,
    expiresAt: Date.now() + 15000,
    previousValues: {},
  };

  return {
    ...session,
    pending: [...session.pending, pending],
  };
}

export function applyAudition(
  session: Session,
  changes: Partial<SynthParamValues>,
  durationMs = 3000,
): Session {
  let currentParams = { ...session.voice.params };
  const existingAudition = session.pending.find(
    (p) => p.type === 'audition' && p.voiceId === session.voice.id,
  );
  if (existingAudition) {
    currentParams = { ...currentParams, ...existingAudition.previousValues } as SynthParamValues;
  }
  const pendingWithoutOldAudition = session.pending.filter(
    (p) => !(p.type === 'audition' && p.voiceId === session.voice.id),
  );

  const previousValues: Partial<SynthParamValues> = {};
  for (const key of Object.keys(changes)) {
    previousValues[key] = currentParams[key];
  }

  const pending: PendingAction = {
    id: `pending-${nextPendingId++}`,
    type: 'audition',
    voiceId: session.voice.id,
    changes,
    expiresAt: Date.now() + durationMs,
    previousValues,
  };

  return {
    ...session,
    voice: {
      ...session.voice,
      params: { ...currentParams, ...changes } as SynthParamValues,
    },
    pending: [...pendingWithoutOldAudition, pending],
  };
}

export function cancelAuditionParam(session: Session, param: string): Session {
  const audition = session.pending.find(
    (p) => p.type === 'audition' && p.voiceId === session.voice.id,
  );
  if (!audition || !(param in audition.previousValues)) return session;

  const newPreviousValues = { ...audition.previousValues };
  delete newPreviousValues[param];
  const newChanges = { ...audition.changes };
  delete newChanges[param];

  if (Object.keys(newPreviousValues).length === 0) {
    return {
      ...session,
      pending: session.pending.filter((p) => p.id !== audition.id),
    };
  }

  return {
    ...session,
    pending: session.pending.map((p) =>
      p.id === audition.id
        ? { ...p, previousValues: newPreviousValues, changes: newChanges }
        : p,
    ),
  };
}

export function commitPending(session: Session, pendingId: string): Session {
  const action = session.pending.find((p) => p.id === pendingId);
  if (!action) return session;

  let newParams = session.voice.params;
  if (action.type === 'suggestion') {
    newParams = { ...newParams, ...action.changes } as SynthParamValues;
  }

  return {
    ...session,
    voice: { ...session.voice, params: newParams },
    pending: session.pending.filter((p) => p.id !== pendingId),
  };
}

export function dismissPending(session: Session, pendingId: string): Session {
  const action = session.pending.find((p) => p.id === pendingId);
  if (!action) return session;

  let newParams = session.voice.params;
  if (action.type === 'audition') {
    newParams = { ...newParams, ...action.previousValues } as SynthParamValues;
  }

  return {
    ...session,
    voice: { ...session.voice, params: newParams },
    pending: session.pending.filter((p) => p.id !== pendingId),
  };
}

export function applyUndo(session: Session): Session {
  if (session.undoStack.length === 0) return session;

  const newStack = [...session.undoStack];
  const snapshot = newStack.pop()!;

  const newParams = { ...session.voice.params };
  for (const [param, prevValue] of Object.entries(snapshot.prevValues)) {
    const aiTarget = snapshot.aiTargetValues[param];
    const currentValue = newParams[param];
    if (aiTarget !== undefined && Math.abs(currentValue - aiTarget) < 0.001) {
      newParams[param] = prevValue as number;
    }
  }

  return {
    ...session,
    voice: { ...session.voice, params: newParams },
    undoStack: newStack,
  };
}
