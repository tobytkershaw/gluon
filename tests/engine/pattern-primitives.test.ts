// tests/engine/pattern-primitives.test.ts
import { describe, it, expect } from 'vitest';
import {
  toggleStepGate, toggleStepAccent, setStepParamLock, clearStepParamLock,
  setPatternLength, clearPattern,
} from '../../src/engine/pattern-primitives';
import { createSession } from '../../src/engine/session';
import { getVoice, updateVoice } from '../../src/engine/types';
import { validateRegion } from '../../src/engine/region-helpers';

describe('Pattern Primitives', () => {
  describe('toggleStepGate', () => {
    it('toggles gate on', () => {
      const s = createSession();
      const vid = s.voices[0].id;
      const result = toggleStepGate(s, vid, 0);
      expect(getVoice(result, vid).pattern.steps[0].gate).toBe(true);
      expect(result.undoStack.length).toBe(1);
      expect(result.undoStack[0].kind).toBe('region');
    });

    it('toggles gate off', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      s = toggleStepGate(s, vid, 0);
      const result = toggleStepGate(s, vid, 0);
      expect(getVoice(result, vid).pattern.steps[0].gate).toBe(false);
    });

    it('preserves accent when toggling gate off and back on', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      s = toggleStepGate(s, vid, 0);       // gate on
      s = toggleStepAccent(s, vid, 0);      // accent on
      expect(getVoice(s, vid).pattern.steps[0].accent).toBe(true);

      s = toggleStepGate(s, vid, 0);        // gate off
      expect(getVoice(s, vid).pattern.steps[0].gate).toBe(false);

      s = toggleStepGate(s, vid, 0);        // gate back on
      expect(getVoice(s, vid).pattern.steps[0].gate).toBe(true);
      expect(getVoice(s, vid).pattern.steps[0].accent).toBe(true);
    });

    it('ignores out-of-range step index', () => {
      const s = createSession();
      const result = toggleStepGate(s, s.voices[0].id, 99);
      expect(result).toBe(s);
    });

    it('updates canonical region events', () => {
      const s = createSession();
      const vid = s.voices[0].id;
      const result = toggleStepGate(s, vid, 0);
      const region = getVoice(result, vid).regions[0];
      expect(region.events.some(e => e.kind === 'trigger' && Math.abs(e.at) < 0.01)).toBe(true);
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

    it('updates canonical region events', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      s = toggleStepGate(s, vid, 0);
      const result = toggleStepAccent(s, vid, 0);
      const region = getVoice(result, vid).regions[0];
      const trigger = region.events.find(e => e.kind === 'trigger' && Math.abs(e.at) < 0.01);
      expect(trigger).toBeDefined();
      expect((trigger as any).accent).toBe(true);
    });

    it('does not re-enable a disabled (gated-off) step', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      s = toggleStepGate(s, vid, 0);        // gate on
      s = toggleStepGate(s, vid, 0);        // gate off (disabled sentinel)
      expect(getVoice(s, vid).pattern.steps[0].gate).toBe(false);

      s = toggleStepAccent(s, vid, 0);      // accent toggle on disabled step
      // Gate must remain off — accent on a disabled step is a no-op
      expect(getVoice(s, vid).pattern.steps[0].gate).toBe(false);
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

    it('updates canonical region duration', () => {
      const s = createSession();
      const vid = s.voices[0].id;
      const result = setPatternLength(s, vid, 32);
      expect(getVoice(result, vid).regions[0].duration).toBe(32);
    });

    it('shortening then expanding restores hidden content', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      s = toggleStepGate(s, vid, 12);       // gate at step 12
      expect(getVoice(s, vid).pattern.steps[12].gate).toBe(true);

      s = setPatternLength(s, vid, 8);       // shorten to 8 — step 12 hidden
      expect(getVoice(s, vid).pattern.length).toBe(8);

      s = setPatternLength(s, vid, 16);      // expand back to 16
      expect(getVoice(s, vid).pattern.steps[12].gate).toBe(true);
    });

    it('shortened region still passes validation (no out-of-range events)', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      s = toggleStepGate(s, vid, 12);
      s = setPatternLength(s, vid, 8);

      const region = getVoice(s, vid).regions[0];
      const { valid, errors } = validateRegion(region);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      // Out-of-range events are stashed, not in the region
      expect(region.events.every(e => e.at < region.duration)).toBe(true);
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
      // clearPattern pushes its own snapshot; prior toggleStepGate snapshots also present
      expect(result.undoStack.length).toBeGreaterThan(0);
      expect(result.undoStack[result.undoStack.length - 1].kind).toBe('region');
    });

    it('clears canonical region events', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      s = toggleStepGate(s, vid, 0);
      const result = clearPattern(s, vid);
      expect(getVoice(result, vid).regions[0].events).toHaveLength(0);
    });

    it('clears hidden events so expand after clear does not resurrect old notes', () => {
      let s = createSession();
      const vid = s.voices[0].id;
      s = toggleStepGate(s, vid, 12);          // gate at step 12
      s = setPatternLength(s, vid, 8);          // shorten — step 12 stashed in _hiddenEvents
      expect(getVoice(s, vid)._hiddenEvents?.length).toBeGreaterThan(0);

      s = clearPattern(s, vid);                 // clear everything
      expect(getVoice(s, vid)._hiddenEvents).toBeUndefined();

      s = setPatternLength(s, vid, 16);         // expand back
      expect(getVoice(s, vid).pattern.steps[12].gate).toBe(false);
      expect(getVoice(s, vid).regions[0].events).toHaveLength(0);
    });
  });
});
