// tests/engine/primitives.test.ts
import { describe, it, expect } from 'vitest';
import {
  applyMove, applyMoveGroup, applyParamDirect, applySuggest,
  applyAudition, cancelAuditionParam, applyUndo, commitPending,
  dismissPending, applySketchPending,
} from '../../src/engine/primitives';
import { createSession, updateVoiceParams } from '../../src/engine/session';
import { getActiveVoice, getVoice } from '../../src/engine/types';
import type { PatternSnapshot, SketchPendingAction, ParamSnapshot } from '../../src/engine/types';
import type { PatternSketch } from '../../src/engine/sequencer-types';

describe('Protocol Primitives (Phase 2)', () => {
  describe('applyMove', () => {
    it('applies absolute move to active voice', () => {
      const s = createSession();
      const vid = s.activeVoiceId;
      const result = applyMove(s, vid, 'timbre', { absolute: 0.8 });
      expect(getVoice(result, vid).params.timbre).toBe(0.8);
      expect(result.undoStack.length).toBe(1);
      expect(result.undoStack[0].kind).toBe('param');
    });

    it('applies relative move', () => {
      let s = createSession();
      const vid = s.activeVoiceId;
      s = updateVoiceParams(s, vid, { timbre: 0.5 });
      const result = applyMove(s, vid, 'timbre', { relative: 0.2 });
      expect(getVoice(result, vid).params.timbre).toBeCloseTo(0.7);
    });

    it('clamps values to 0-1', () => {
      let s = createSession();
      const vid = s.activeVoiceId;
      s = updateVoiceParams(s, vid, { timbre: 0.9 });
      const result = applyMove(s, vid, 'timbre', { relative: 0.3 });
      expect(getVoice(result, vid).params.timbre).toBe(1.0);
    });
  });

  describe('applyMoveGroup', () => {
    it('applies multiple moves as a single undo entry', () => {
      const s = createSession();
      const vid = s.activeVoiceId;
      const result = applyMoveGroup(s, vid, [
        { param: 'timbre', target: { absolute: 0.8 } },
        { param: 'morph', target: { absolute: 0.3 } },
      ]);
      expect(getVoice(result, vid).params.timbre).toBe(0.8);
      expect(getVoice(result, vid).params.morph).toBe(0.3);
      expect(result.undoStack.length).toBe(1);
    });
  });

  describe('applySuggest', () => {
    it('adds suggestion to pending list', () => {
      const s = createSession();
      const vid = s.activeVoiceId;
      const result = applySuggest(s, vid, { timbre: 0.8 }, 'try this');
      expect(result.pending.length).toBe(1);
      expect(result.pending[0].kind).toBe('suggestion');
    });
  });

  describe('applyAudition', () => {
    it('applies changes and adds to pending', () => {
      const s = createSession();
      const vid = s.activeVoiceId;
      const result = applyAudition(s, vid, { timbre: 0.8 }, 3000);
      expect(getVoice(result, vid).params.timbre).toBe(0.8);
      expect(result.pending.length).toBe(1);
      expect(result.pending[0].kind).toBe('audition');
    });
  });

  describe('applyUndo', () => {
    it('undoes a param snapshot', () => {
      const s = createSession();
      const vid = s.activeVoiceId;
      const moved = applyMove(s, vid, 'timbre', { absolute: 0.8 });
      const undone = applyUndo(moved);
      expect(getVoice(undone, vid).params.timbre).toBe(0.5);
      expect(undone.undoStack.length).toBe(0);
    });

    it('undoes a pattern snapshot', () => {
      const s = createSession();
      const vid = s.activeVoiceId;
      // Simulate a pattern edit by pushing a PatternSnapshot
      const snapshot: PatternSnapshot = {
        kind: 'pattern',
        voiceId: vid,
        prevSteps: [{ index: 0, step: { gate: false, accent: false, micro: 0 } }],
        timestamp: Date.now(),
        description: 'toggle step 0',
      };
      // Manually toggle step 0 gate on
      const voice = getVoice(s, vid);
      const newSteps = [...voice.pattern.steps];
      newSteps[0] = { ...newSteps[0], gate: true };
      let modified = {
        ...s,
        voices: s.voices.map(v => v.id === vid ? { ...v, pattern: { ...v.pattern, steps: newSteps } } : v),
        undoStack: [...s.undoStack, snapshot],
      };
      expect(getVoice(modified, vid).pattern.steps[0].gate).toBe(true);

      const undone = applyUndo(modified);
      expect(getVoice(undone, vid).pattern.steps[0].gate).toBe(false);
      expect(undone.undoStack.length).toBe(0);
    });
  });

  describe('applySketchPending', () => {
    it('adds a sketch to pending queue', () => {
      const s = createSession();
      const sketch: PatternSketch = {
        steps: [
          { index: 0, gate: true },
          { index: 4, gate: true },
          { index: 8, gate: true },
          { index: 12, gate: true },
        ],
      };
      const result = applySketchPending(s, 'v0', 'four on the floor', sketch);
      expect(result.pending.length).toBe(1);
      expect(result.pending[0].kind).toBe('sketch');
    });
  });

  describe('commitPending sketch', () => {
    it('applies sketch pattern to voice and pushes PatternSnapshot', () => {
      const s = createSession();
      const sketch: PatternSketch = {
        steps: [
          { index: 0, gate: true, accent: true },
          { index: 4, gate: true },
        ],
      };
      const withPending = applySketchPending(s, 'v0', 'kick', sketch);
      const pendingId = withPending.pending[0].id;
      const committed = commitPending(withPending, pendingId);

      const voice = getVoice(committed, 'v0');
      expect(voice.pattern.steps[0].gate).toBe(true);
      expect(voice.pattern.steps[0].accent).toBe(true);
      expect(voice.pattern.steps[4].gate).toBe(true);
      expect(voice.pattern.steps[1].gate).toBe(false); // untouched
      expect(committed.pending.length).toBe(0);
      expect(committed.undoStack.length).toBe(1);
      expect(committed.undoStack[0].kind).toBe('pattern');
    });
  });

  describe('commitPending suggestion', () => {
    it('applies suggestion and pushes ParamSnapshot for undo', () => {
      const s = createSession();
      const vid = s.activeVoiceId;
      const withPending = applySuggest(s, vid, { timbre: 0.9 }, 'brighter');
      const pendingId = withPending.pending[0].id;
      const committed = commitPending(withPending, pendingId);

      expect(getVoice(committed, vid).params.timbre).toBe(0.9);
      expect(committed.pending.length).toBe(0);
      expect(committed.undoStack.length).toBe(1);
      expect(committed.undoStack[0].kind).toBe('param');

      // Undo should revert
      const undone = applyUndo(committed);
      expect(getVoice(undone, vid).params.timbre).toBe(0.5);
    });
  });

  describe('dismissPending sketch', () => {
    it('removes sketch from pending without applying', () => {
      const s = createSession();
      const sketch: PatternSketch = {
        steps: [{ index: 0, gate: true }],
      };
      const withPending = applySketchPending(s, 'v0', 'test', sketch);
      const pendingId = withPending.pending[0].id;
      const dismissed = dismissPending(withPending, pendingId);

      const voice = getVoice(dismissed, 'v0');
      expect(voice.pattern.steps[0].gate).toBe(false); // unchanged
      expect(dismissed.pending.length).toBe(0);
    });
  });
});
