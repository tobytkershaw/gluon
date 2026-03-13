// tests/engine/undo.test.ts
import { describe, it, expect } from 'vitest';
import { applyMove, applyMoveGroup, applySketch, applyUndo } from '../../src/engine/primitives';
import { createSession, updateVoiceParams } from '../../src/engine/session';
import { toggleStepGate } from '../../src/engine/pattern-primitives';
import { getVoice } from '../../src/engine/types';

describe('Undo (Phase 2)', () => {
  it('undoes a single param move', () => {
    const s = createSession();
    const vid = s.activeVoiceId;
    const moved = applyMove(s, vid, 'timbre', { absolute: 0.8 });
    const undone = applyUndo(moved);
    expect(getVoice(undone, vid).params.timbre).toBe(0.5);
  });

  it('undoes move group in one step', () => {
    const s = createSession();
    const vid = s.activeVoiceId;
    const moved = applyMoveGroup(s, vid, [
      { param: 'timbre', target: { absolute: 0.8 } },
      { param: 'morph', target: { absolute: 0.3 } },
    ]);
    const undone = applyUndo(moved);
    expect(getVoice(undone, vid).params.timbre).toBe(0.5);
    expect(getVoice(undone, vid).params.morph).toBe(0.5);
  });

  it('does not undo if human has moved param since AI', () => {
    const s = createSession();
    const vid = s.activeVoiceId;
    let state = applyMove(s, vid, 'timbre', { absolute: 0.8 });
    state = updateVoiceParams(state, vid, { timbre: 0.6 });
    const undone = applyUndo(state);
    expect(getVoice(undone, vid).params.timbre).toBe(0.6);
  });

  it('undoes AI pattern sketch unconditionally', () => {
    const s = createSession();
    const vid = s.activeVoiceId;
    // AI sketch (pushes PatternSnapshot)
    const sketched = applySketch(s, vid, 'test', {
      steps: [{ index: 0, gate: true }],
    });
    expect(getVoice(sketched, vid).pattern.steps[0].gate).toBe(true);
    const undone = applyUndo(sketched);
    expect(getVoice(undone, vid).pattern.steps[0].gate).toBe(false);
  });

  it('human step-grid edits create undo entries', () => {
    const s = createSession();
    const vid = s.activeVoiceId;
    const toggled = toggleStepGate(s, vid, 0);
    expect(getVoice(toggled, vid).pattern.steps[0].gate).toBe(true);
    expect(toggled.undoStack.length).toBe(1);
    expect(toggled.undoStack[0].kind).toBe('region');
  });

  it('undoes human step-grid edit', () => {
    const s = createSession();
    const vid = s.activeVoiceId;
    const toggled = toggleStepGate(s, vid, 0);
    expect(getVoice(toggled, vid).pattern.steps[0].gate).toBe(true);
    const undone = applyUndo(toggled);
    expect(getVoice(undone, vid).pattern.steps[0].gate).toBe(false);
  });

  it('undoes in LIFO order across human and AI entries', () => {
    const s = createSession();
    const vid = s.activeVoiceId;
    let state = applyMove(s, vid, 'timbre', { absolute: 0.8 });
    state = toggleStepGate(state, vid, 0);
    expect(state.undoStack.length).toBe(2); // param move + region edit
    // Undo the human step-grid edit first (LIFO)
    state = applyUndo(state);
    expect(getVoice(state, vid).pattern.steps[0].gate).toBe(false);
    expect(getVoice(state, vid).params.timbre).toBe(0.8); // AI move still applied
    // Undo the AI param move
    state = applyUndo(state);
    expect(getVoice(state, vid).params.timbre).toBe(0.5);
  });
});
