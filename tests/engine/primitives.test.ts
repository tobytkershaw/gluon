// tests/engine/primitives.test.ts

import { describe, it, expect, vi } from 'vitest';
import { applyMove, applyMoveGroup, applyParamDirect, applySuggest, applyAudition, cancelAuditionParam, applyUndo, commitPending, dismissPending } from '../../src/engine/primitives';
import { createSession, updateVoiceParams, setAgency } from '../../src/engine/session';
import { Session } from '../../src/engine/types';

describe('Protocol Primitives', () => {
  describe('applyMove', () => {
    it('applies absolute move and pushes delta to undo stack', () => {
      const s = createSession();
      const result = applyMove(s, 'timbre', { absolute: 0.8 });
      expect(result.voice.params.timbre).toBe(0.8);
      expect(result.undoStack.length).toBe(1);
      expect(result.undoStack[0].prevValues.timbre).toBe(0.5);
      expect(result.undoStack[0].aiTargetValues.timbre).toBe(0.8);
    });

    it('applies relative move', () => {
      const s = updateVoiceParams(createSession(), { timbre: 0.5 });
      const result = applyMove(s, 'timbre', { relative: 0.2 });
      expect(result.voice.params.timbre).toBeCloseTo(0.7);
    });

    it('clamps values to 0-1 for normalised params', () => {
      const s = updateVoiceParams(createSession(), { timbre: 0.9 });
      const result = applyMove(s, 'timbre', { relative: 0.3 });
      expect(result.voice.params.timbre).toBe(1.0);
    });

    it('clamps values at 0 for negative relative moves', () => {
      const s = updateVoiceParams(createSession(), { timbre: 0.1 });
      const result = applyMove(s, 'timbre', { relative: -0.5 });
      expect(result.voice.params.timbre).toBe(0.0);
    });
  });

  describe('applyMoveGroup (action groups)', () => {
    it('applies multiple moves as a single undo entry', () => {
      const s = createSession();
      const result = applyMoveGroup(s, [
        { param: 'timbre', target: { absolute: 0.8 } },
        { param: 'morph', target: { absolute: 0.3 } },
      ]);
      expect(result.voice.params.timbre).toBe(0.8);
      expect(result.voice.params.morph).toBe(0.3);
      expect(result.undoStack.length).toBe(1);
    });

    it('undo reverses entire group at once', () => {
      let s = createSession();
      s = applyMoveGroup(s, [
        { param: 'timbre', target: { absolute: 0.8 } },
        { param: 'morph', target: { absolute: 0.3 } },
      ]);
      const result = applyUndo(s);
      expect(result.voice.params.timbre).toBe(0.5);
      expect(result.voice.params.morph).toBe(0.5);
    });
  });

  describe('applySuggest', () => {
    it('adds suggestion to pending list', () => {
      const s = createSession();
      const result = applySuggest(s, { timbre: 0.8 }, 'try this');
      expect(result.pending.length).toBe(1);
      expect(result.pending[0].type).toBe('suggestion');
      expect(result.pending[0].changes.timbre).toBe(0.8);
      expect(result.pending[0].reason).toBe('try this');
      expect(result.voice.params.timbre).toBe(0.5);
    });
  });

  describe('applyAudition', () => {
    it('applies changes and adds to pending with previous values', () => {
      const s = createSession();
      const result = applyAudition(s, { timbre: 0.8, morph: 0.3 }, 3000);
      expect(result.voice.params.timbre).toBe(0.8);
      expect(result.voice.params.morph).toBe(0.3);
      expect(result.pending.length).toBe(1);
      expect(result.pending[0].type).toBe('audition');
      expect(result.pending[0].previousValues.timbre).toBe(0.5);
      expect(result.pending[0].previousValues.morph).toBe(0.5);
    });

    it('replaces existing audition (one per voice)', () => {
      let s = createSession();
      s = applyAudition(s, { timbre: 0.8 }, 3000);
      s = applyAudition(s, { morph: 0.2 }, 3000);
      const auditions = s.pending.filter((p) => p.type === 'audition');
      expect(auditions.length).toBe(1);
      expect(auditions[0].changes.morph).toBe(0.2);
      expect(s.voice.params.timbre).toBe(0.5);
    });
  });

  describe('commitPending', () => {
    it('removes pending action and keeps current params', () => {
      let s = createSession();
      s = applySuggest(s, { timbre: 0.8 });
      const pendingId = s.pending[0].id;
      const result = commitPending(s, pendingId);
      expect(result.pending.length).toBe(0);
      expect(result.voice.params.timbre).toBe(0.8);
    });
  });

  describe('dismissPending', () => {
    it('removes suggestion without applying', () => {
      let s = createSession();
      s = applySuggest(s, { timbre: 0.8 });
      const pendingId = s.pending[0].id;
      const result = dismissPending(s, pendingId);
      expect(result.pending.length).toBe(0);
      expect(result.voice.params.timbre).toBe(0.5);
    });

    it('reverts audition to previous values', () => {
      let s = createSession();
      s = applyAudition(s, { timbre: 0.8 }, 3000);
      const pendingId = s.pending[0].id;
      const result = dismissPending(s, pendingId);
      expect(result.pending.length).toBe(0);
      expect(result.voice.params.timbre).toBe(0.5);
    });

    it('only reverts untouched params after human cancels one audition param', () => {
      let s = createSession();
      s = applyAudition(s, { timbre: 0.8, morph: 0.9 }, 3000);
      s = cancelAuditionParam(s, 'timbre');
      const pendingId = s.pending[0].id;
      const result = dismissPending(s, pendingId);
      expect(result.pending.length).toBe(0);
      expect(result.voice.params.timbre).toBe(0.8);
      expect(result.voice.params.morph).toBe(0.5);
    });

    it('removes audition entirely if human cancels all params', () => {
      let s = createSession();
      s = applyAudition(s, { timbre: 0.8 }, 3000);
      s = cancelAuditionParam(s, 'timbre');
      expect(s.pending.length).toBe(0);
    });
  });

  describe('applyUndo', () => {
    it('restores previous state from undo stack', () => {
      let s = createSession();
      s = applyMove(s, 'timbre', { absolute: 0.8 });
      expect(s.voice.params.timbre).toBe(0.8);
      const result = applyUndo(s);
      expect(result.voice.params.timbre).toBe(0.5);
      expect(result.undoStack.length).toBe(0);
    });

    it('walks back through multiple undo entries', () => {
      let s = createSession();
      s = applyMove(s, 'timbre', { absolute: 0.6 });
      s = applyMove(s, 'timbre', { absolute: 0.8 });
      expect(s.undoStack.length).toBe(2);
      s = applyUndo(s);
      expect(s.voice.params.timbre).toBe(0.6);
      s = applyUndo(s);
      expect(s.voice.params.timbre).toBe(0.5);
    });

    it('returns session unchanged if undo stack is empty', () => {
      const s = createSession();
      const result = applyUndo(s);
      expect(result).toEqual(s);
    });

    it('does NOT wipe human edits on a different param made after AI action', () => {
      let s = createSession();
      s = applyMove(s, 'timbre', { absolute: 0.8 });
      s = updateVoiceParams(s, { morph: 0.9 });
      const result = applyUndo(s);
      expect(result.voice.params.timbre).toBe(0.5);
      expect(result.voice.params.morph).toBe(0.9);
    });

    it('skips undo on a param the human has since overridden (same param)', () => {
      let s = createSession();
      s = applyMove(s, 'timbre', { absolute: 0.8 });
      s = updateVoiceParams(s, { timbre: 0.3 });
      const result = applyUndo(s);
      expect(result.voice.params.timbre).toBe(0.3);
      expect(result.undoStack.length).toBe(0);
    });
  });

  describe('applyParamDirect', () => {
    it('changes param without pushing to undo stack', () => {
      const s = createSession();
      const result = applyParamDirect(s, 'timbre', 0.7);
      expect(result.voice.params.timbre).toBe(0.7);
      expect(result.undoStack.length).toBe(0);
    });
  });
});
