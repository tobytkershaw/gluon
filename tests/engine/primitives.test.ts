// tests/engine/primitives.test.ts
import { describe, it, expect } from 'vitest';
import {
  applyMove, applyMoveGroup, applySketch, applyUndo,
} from '../../src/engine/primitives';
import { createSession, updateTrackParams } from '../../src/engine/session';
import { getTrack } from '../../src/engine/types';
import type { PatternSnapshot, ActionGroupSnapshot } from '../../src/engine/types';
import type { PatternSketch } from '../../src/engine/sequencer-types';

describe('Protocol Primitives (Phase 2)', () => {
  describe('applyMove', () => {
    it('applies absolute move to active track', () => {
      const s = createSession();
      const vid = s.activeTrackId;
      const result = applyMove(s, vid, 'timbre', { absolute: 0.8 });
      expect(getTrack(result, vid).params.timbre).toBe(0.8);
      expect(result.undoStack.length).toBe(1);
      expect(result.undoStack[0].kind).toBe('param');
    });

    it('applies relative move', () => {
      let s = createSession();
      const vid = s.activeTrackId;
      s = updateTrackParams(s, vid, { timbre: 0.5 });
      const result = applyMove(s, vid, 'timbre', { relative: 0.2 });
      expect(getTrack(result, vid).params.timbre).toBeCloseTo(0.7);
    });

    it('clamps values to 0-1', () => {
      let s = createSession();
      const vid = s.activeTrackId;
      s = updateTrackParams(s, vid, { timbre: 0.9 });
      const result = applyMove(s, vid, 'timbre', { relative: 0.3 });
      expect(getTrack(result, vid).params.timbre).toBe(1.0);
    });
  });

  describe('applyMoveGroup', () => {
    it('applies multiple moves as a single undo entry', () => {
      const s = createSession();
      const vid = s.activeTrackId;
      const result = applyMoveGroup(s, vid, [
        { param: 'timbre', target: { absolute: 0.8 } },
        { param: 'morph', target: { absolute: 0.3 } },
      ]);
      expect(getTrack(result, vid).params.timbre).toBe(0.8);
      expect(getTrack(result, vid).params.morph).toBe(0.3);
      expect(result.undoStack.length).toBe(1);
    });
  });

  describe('applySketch', () => {
    it('applies sketch pattern to track and pushes PatternSnapshot', () => {
      const s = createSession();
      const sketch: PatternSketch = {
        steps: [
          { index: 0, gate: true, accent: true },
          { index: 4, gate: true },
        ],
      };
      const result = applySketch(s, 'v0', 'kick', sketch);

      const track = getTrack(result, 'v0');
      expect(track.stepGrid.steps[0].gate).toBe(true);
      expect(track.stepGrid.steps[0].accent).toBe(true);
      expect(track.stepGrid.steps[4].gate).toBe(true);
      expect(track.stepGrid.steps[1].gate).toBe(false); // untouched
      expect(result.undoStack.length).toBe(1);
      expect(result.undoStack[0].kind).toBe('pattern');
    });
  });

  describe('applyUndo', () => {
    it('undoes a param snapshot', () => {
      const s = createSession();
      const vid = s.activeTrackId;
      const moved = applyMove(s, vid, 'timbre', { absolute: 0.8 });
      const undone = applyUndo(moved);
      expect(getTrack(undone, vid).params.timbre).toBe(0.5);
      expect(undone.undoStack.length).toBe(0);
    });

    it('undoes a pattern snapshot', () => {
      const s = createSession();
      const vid = s.activeTrackId;
      // Simulate a pattern edit by pushing a PatternSnapshot
      const snapshot: PatternSnapshot = {
        kind: 'pattern',
        trackId: vid,
        prevSteps: [{ index: 0, step: { gate: false, accent: false, micro: 0 } }],
        timestamp: Date.now(),
        description: 'toggle step 0',
      };
      // Manually toggle step 0 gate on
      const track = getTrack(s, vid);
      const newSteps = [...track.stepGrid.steps];
      newSteps[0] = { ...newSteps[0], gate: true };
      const modified = {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? { ...v, stepGrid: { ...v.stepGrid, steps: newSteps } } : v),
        undoStack: [...s.undoStack, snapshot],
      };
      expect(getTrack(modified, vid).stepGrid.steps[0].gate).toBe(true);

      const undone = applyUndo(modified);
      expect(getTrack(undone, vid).stepGrid.steps[0].gate).toBe(false);
      expect(undone.undoStack.length).toBe(0);
    });

    it('undoes an action group in one step', () => {
      const s = createSession();
      // Apply moves to two different tracks
      let next = applyMove(s, 'v0', 'timbre', { absolute: 0.8 });
      next = applyMove(next, 'v1', 'morph', { absolute: 0.3 });

      // Collapse into a group (as dispatchAIActions would)
      const snapshots = next.undoStack.slice(0);
      const group: ActionGroupSnapshot = {
        kind: 'group',
        snapshots: snapshots.filter((e): e is Exclude<typeof e, ActionGroupSnapshot> => e.kind !== 'group'),
        timestamp: Date.now(),
        description: 'AI response (2 actions)',
      };
      const grouped = { ...next, undoStack: [group] };

      // Single undo should revert both tracks
      const undone = applyUndo(grouped);
      expect(getTrack(undone, 'v0').params.timbre).toBe(0.5);
      expect(getTrack(undone, 'v1').params.morph).toBe(0.5);
      expect(undone.undoStack.length).toBe(0);
    });
  });
});
