// src/engine/pattern-primitives.ts
import type { Session, PatternSnapshot, SynthParamValues } from './types';
import { getVoice, updateVoice } from './types';
import type { Step } from './sequencer-types';
import { createDefaultStep } from './sequencer-helpers';

function pushPatternSnapshot(
  session: Session,
  voiceId: string,
  prevSteps: { index: number; step: Step }[],
  description: string,
  prevLength?: number,
): Session {
  const snapshot: PatternSnapshot = {
    kind: 'pattern',
    voiceId,
    prevSteps,
    prevLength,
    timestamp: Date.now(),
    description,
  };
  return { ...session, undoStack: [...session.undoStack, snapshot] };
}

export function toggleStepGate(session: Session, voiceId: string, stepIndex: number): Session {
  const voice = getVoice(session, voiceId);
  if (stepIndex < 0 || stepIndex >= voice.pattern.steps.length) return session;

  const oldStep = voice.pattern.steps[stepIndex];
  const newSteps = [...voice.pattern.steps];
  newSteps[stepIndex] = { ...oldStep, gate: !oldStep.gate };

  let result = updateVoice(session, voiceId, {
    pattern: { ...voice.pattern, steps: newSteps },
  });
  return pushPatternSnapshot(result, voiceId,
    [{ index: stepIndex, step: { ...oldStep } }],
    `toggle step ${stepIndex} gate`,
  );
}

export function toggleStepAccent(session: Session, voiceId: string, stepIndex: number): Session {
  const voice = getVoice(session, voiceId);
  if (stepIndex < 0 || stepIndex >= voice.pattern.steps.length) return session;

  const oldStep = voice.pattern.steps[stepIndex];
  const newSteps = [...voice.pattern.steps];
  newSteps[stepIndex] = { ...oldStep, accent: !oldStep.accent };

  let result = updateVoice(session, voiceId, {
    pattern: { ...voice.pattern, steps: newSteps },
  });
  return pushPatternSnapshot(result, voiceId,
    [{ index: stepIndex, step: { ...oldStep } }],
    `toggle step ${stepIndex} accent`,
  );
}

export function setStepParamLock(
  session: Session,
  voiceId: string,
  stepIndex: number,
  params: Partial<SynthParamValues>,
): Session {
  const voice = getVoice(session, voiceId);
  if (stepIndex < 0 || stepIndex >= voice.pattern.steps.length) return session;

  const oldStep = voice.pattern.steps[stepIndex];
  const newSteps = [...voice.pattern.steps];
  newSteps[stepIndex] = {
    ...oldStep,
    params: { ...oldStep.params, ...params },
  };

  let result = updateVoice(session, voiceId, {
    pattern: { ...voice.pattern, steps: newSteps },
  });
  return pushPatternSnapshot(result, voiceId,
    [{ index: stepIndex, step: { ...oldStep } }],
    `set param lock on step ${stepIndex}`,
  );
}

export function clearStepParamLock(
  session: Session,
  voiceId: string,
  stepIndex: number,
  param: string,
): Session {
  const voice = getVoice(session, voiceId);
  if (stepIndex < 0 || stepIndex >= voice.pattern.steps.length) return session;

  const oldStep = voice.pattern.steps[stepIndex];
  if (!oldStep.params || !(param in oldStep.params)) return session;

  const newParams = { ...oldStep.params };
  delete newParams[param];
  const newSteps = [...voice.pattern.steps];
  newSteps[stepIndex] = {
    ...oldStep,
    params: Object.keys(newParams).length > 0 ? newParams : undefined,
  };

  let result = updateVoice(session, voiceId, {
    pattern: { ...voice.pattern, steps: newSteps },
  });
  return pushPatternSnapshot(result, voiceId,
    [{ index: stepIndex, step: { ...oldStep } }],
    `clear ${param} lock on step ${stepIndex}`,
  );
}

export function setPatternLength(session: Session, voiceId: string, length: number): Session {
  const voice = getVoice(session, voiceId);
  const clamped = Math.max(1, Math.min(64, length));
  if (clamped === voice.pattern.length) return session;

  const newSteps = [...voice.pattern.steps];
  while (newSteps.length < clamped) {
    newSteps.push(createDefaultStep());
  }

  let result = updateVoice(session, voiceId, {
    pattern: { steps: newSteps, length: clamped },
  });
  return pushPatternSnapshot(result, voiceId, [],
    `change pattern length ${voice.pattern.length} -> ${clamped}`,
    voice.pattern.length,
  );
}

export function clearPattern(session: Session, voiceId: string): Session {
  const voice = getVoice(session, voiceId);
  const prevSteps = voice.pattern.steps
    .map((step, index) => ({ index, step: { ...step } }))
    .filter(({ step }) => step.gate || step.accent || step.params !== undefined || step.micro !== 0);

  if (prevSteps.length === 0) return session;

  const newSteps = voice.pattern.steps.map(() => createDefaultStep());
  let result = updateVoice(session, voiceId, {
    pattern: { ...voice.pattern, steps: newSteps },
  });
  return pushPatternSnapshot(result, voiceId, prevSteps, 'clear pattern');
}
