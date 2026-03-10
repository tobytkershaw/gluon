// tests/engine/pattern-primitives.test.ts
import { describe, it, expect } from 'vitest';
import {
  toggleStepGate, toggleStepAccent, setStepParamLock, clearStepParamLock,
  setPatternLength, clearPattern,
} from '../../src/engine/pattern-primitives';
import { createSession } from '../../src/engine/session';
import { getVoice, updateVoice } from '../../src/engine/types';
import type { PatternSnapshot } from '../../src/engine/types';

describe('Pattern Primitives', () => {
  describe('toggleStepGate', () => {
    it('toggles gate on', () => {
      const s = createSession();
      const vid = s.voices[0].id;
      const result = toggleStepGate(s, vid, 0);
      expect(getVoice(result, vid).pattern.steps[0].gate).toBe(true);
      expect(result.undoStack.length).toBe(1);
      expect(result.undoStack[0].kind).toBe('pattern');
    });

    it('toggles gate off', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      s = toggleStepGate(s, vid, 0);
      const result = toggleStepGate(s, vid, 0);
      expect(getVoice(result, vid).pattern.steps[0].gate).toBe(false);
    });

    it('ignores out-of-range step index', () => {
      const s = createSession();
      const result = toggleStepGate(s, s.voices[0].id, 99);
      expect(result).toBe(s);
    });
  });

  describe('toggleStepAccent', () => {
    it('toggles accent on a gated step', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      s = toggleStepGate(s, vid, 0);
      const result = toggleStepAccent(s, vid, 0);
      expect(getVoice(result, vid).pattern.steps[0].accent).toBe(true);
    });
  });

  describe('setStepParamLock', () => {
    it('sets a parameter lock on a step', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      const result = setStepParamLock(s, vid, 0, { timbre: 0.9 });
      expect(getVoice(result, vid).pattern.steps[0].params?.timbre).toBe(0.9);
      expect(result.undoStack.length).toBe(1);
    });

    it('merges with existing locks', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      s = setStepParamLock(s, vid, 0, { timbre: 0.9 });
      const result = setStepParamLock(s, vid, 0, { morph: 0.3 });
      const step = getVoice(result, vid).pattern.steps[0];
      expect(step.params?.timbre).toBe(0.9);
      expect(step.params?.morph).toBe(0.3);
    });
  });

  describe('clearStepParamLock', () => {
    it('removes a specific lock', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      s = setStepParamLock(s, vid, 0, { timbre: 0.9, morph: 0.3 });
      const result = clearStepParamLock(s, vid, 0, 'timbre');
      const step = getVoice(result, vid).pattern.steps[0];
      expect(step.params?.timbre).toBeUndefined();
      expect(step.params?.morph).toBe(0.3);
    });

    it('removes params entirely when last lock cleared', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      s = setStepParamLock(s, vid, 0, { timbre: 0.9 });
      const result = clearStepParamLock(s, vid, 0, 'timbre');
      expect(getVoice(result, vid).pattern.steps[0].params).toBeUndefined();
    });
  });

  describe('setPatternLength', () => {
    it('changes pattern length', () => {
      const s = createSession();
      const vid = s.voices[0].id;
      const result = setPatternLength(s, vid, 8);
      expect(getVoice(result, vid).pattern.length).toBe(8);
      expect(result.undoStack.length).toBe(1);
    });

    it('extends steps array when length exceeds current steps', () => {
      const s = createSession();
      const vid = s.voices[0].id;
      const result = setPatternLength(s, vid, 32);
      const pattern = getVoice(result, vid).pattern;
      expect(pattern.length).toBe(32);
      expect(pattern.steps.length).toBe(32);
    });

    it('clamps to 1-64', () => {
      const s = createSession();
      const vid = s.voices[0].id;
      expect(getVoice(setPatternLength(s, vid, 0), vid).pattern.length).toBe(1);
      expect(getVoice(setPatternLength(s, vid, 100), vid).pattern.length).toBe(64);
    });
  });

  describe('clearPattern', () => {
    it('resets all steps to defaults', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      s = toggleStepGate(s, vid, 0);
      s = toggleStepGate(s, vid, 4);
      const result = clearPattern(s, vid);
      const pattern = getVoice(result, vid).pattern;
      expect(pattern.steps.every(step => !step.gate)).toBe(true);
      expect(result.undoStack.length).toBe(3); // 2 toggles + 1 clear
    });

    it('preserves steps with micro-timing in undo snapshot', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      // Manually set micro on a step without gate/accent/params
      const voice = getVoice(s, vid);
      const steps = [...voice.pattern.steps];
      steps[3] = { ...steps[3], micro: 0.25 };
      s = updateVoice(s, vid, { pattern: { ...voice.pattern, steps } });
      const result = clearPattern(s, vid);
      // Should have an undo entry even though only micro was set
      expect(result.undoStack.length).toBe(1);
      const snapshot = result.undoStack[0] as PatternSnapshot;
      expect(snapshot.prevSteps.some(({ step }) => step.micro === 0.25)).toBe(true);
    });
  });
});
