// tests/engine/pattern-primitives.test.ts
import { describe, it, expect } from 'vitest';
import {
  toggleStepGate, toggleStepAccent, setStepParamLock, clearStepParamLock,
  setPatternLength, clearPattern,
} from '../../src/engine/pattern-primitives';
import { createSession } from '../../src/engine/session';
import type { TriggerEvent, NoteEvent } from '../../src/engine/canonical-types';
import { getTrack, updateTrack } from '../../src/engine/types';
import { validatePattern } from '../../src/engine/region-helpers';

describe('Pattern Primitives', () => {
  describe('toggleStepGate', () => {
    it('toggles gate on', () => {
      const s = createSession();
      const vid = s.tracks[0].id;
      const result = toggleStepGate(s, vid, 0);
      expect(getTrack(result, vid).stepGrid.steps[0].gate).toBe(true);
      expect(result.undoStack.length).toBe(1);
      expect(result.undoStack[0].kind).toBe('pattern-edit');
    });

    it('toggles gate off', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = toggleStepGate(s, vid, 0);
      const result = toggleStepGate(s, vid, 0);
      expect(getTrack(result, vid).stepGrid.steps[0].gate).toBe(false);
    });

    it('preserves accent when toggling gate off and back on', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = toggleStepGate(s, vid, 0);       // gate on
      s = toggleStepAccent(s, vid, 0);      // accent on
      expect(getTrack(s, vid).stepGrid.steps[0].accent).toBe(true);

      s = toggleStepGate(s, vid, 0);        // gate off
      expect(getTrack(s, vid).stepGrid.steps[0].gate).toBe(false);

      s = toggleStepGate(s, vid, 0);        // gate back on
      expect(getTrack(s, vid).stepGrid.steps[0].gate).toBe(true);
      expect(getTrack(s, vid).stepGrid.steps[0].accent).toBe(true);
    });

    it('ignores out-of-range step index', () => {
      const s = createSession();
      const result = toggleStepGate(s, s.tracks[0].id, 99);
      expect(result).toBe(s);
    });

    it('updates canonical region events', () => {
      const s = createSession();
      const vid = s.tracks[0].id;
      const result = toggleStepGate(s, vid, 0);
      const region = getTrack(result, vid).patterns[0];
      expect(region.events.some(e => e.kind === 'trigger' && Math.abs(e.at) < 0.01)).toBe(true);
    });

    it('creates NoteEvent for pitched instrument', () => {
      const s = createSession();
      // Track 1 (v1) is model 0 (virtual-analog) — pitched
      const vid = s.tracks[1].id;
      const result = toggleStepGate(s, vid, 0);
      const region = getTrack(result, vid).patterns[0];
      const noteEvent = region.events.find(e => e.kind === 'note' && Math.abs(e.at) < 0.01);
      expect(noteEvent).toBeDefined();
      const ne = noteEvent as NoteEvent;
      expect(ne.pitch).toBeGreaterThanOrEqual(0);
      expect(ne.pitch).toBeLessThanOrEqual(127);
      expect(ne.velocity).toBe(0.8);
      expect(ne.duration).toBe(1);
      // Should NOT have a trigger event
      expect(region.events.some(e => e.kind === 'trigger' && Math.abs(e.at) < 0.01)).toBe(false);
    });

    it('creates TriggerEvent for percussion instrument', () => {
      const s = createSession();
      // Track 0 (v0) is model 13 (analog-bass-drum) — percussion
      const vid = s.tracks[0].id;
      const result = toggleStepGate(s, vid, 0);
      const region = getTrack(result, vid).patterns[0];
      expect(region.events.some(e => e.kind === 'trigger' && Math.abs(e.at) < 0.01)).toBe(true);
      expect(region.events.some(e => e.kind === 'note' && Math.abs(e.at) < 0.01)).toBe(false);
    });

    it('derives MIDI pitch from track note param', () => {
      let s = createSession();
      // Use a pitched track and set a specific note param
      const vid = s.tracks[1].id;
      s = updateTrack(s, vid, {
        params: { ...getTrack(s, vid).params, note: 0.5 },
      });
      const result = toggleStepGate(s, vid, 0);
      const region = getTrack(result, vid).patterns[0];
      const noteEvent = region.events.find(e => e.kind === 'note') as NoteEvent;
      expect(noteEvent).toBeDefined();
      // 0.5 * 127 = 63.5, rounded = 64
      expect(noteEvent.pitch).toBe(64);
    });

    it('toggles NoteEvent off and back on for pitched instrument', () => {
      let s = createSession();
      const vid = s.tracks[1].id;
      s = toggleStepGate(s, vid, 0);       // gate on (NoteEvent)
      expect(getTrack(s, vid).stepGrid.steps[0].gate).toBe(true);

      s = toggleStepGate(s, vid, 0);       // gate off
      expect(getTrack(s, vid).stepGrid.steps[0].gate).toBe(false);

      s = toggleStepGate(s, vid, 0);       // gate back on
      expect(getTrack(s, vid).stepGrid.steps[0].gate).toBe(true);
    });

    it('handles legacy TriggerEvent on pitched track (toggle off)', () => {
      // Simulate a session with a TriggerEvent on a pitched track (from old saved data)
      let s = createSession();
      const vid = s.tracks[1].id;
      const track = getTrack(s, vid);
      // Manually inject a TriggerEvent into the region
      const events = [...track.patterns[0].events, { kind: 'trigger' as const, at: 3, velocity: 0.8 }];
      s = updateTrack(s, vid, {
        patterns: [{ ...track.patterns[0], events }],
      });
      // Toggle off should find and disable the TriggerEvent
      const result = toggleStepGate(s, vid, 3);
      const region = getTrack(result, vid).patterns[0];
      const trigger = region.events.find(e => e.kind === 'trigger' && Math.abs(e.at - 3) < 0.01) as TriggerEvent;
      expect(trigger).toBeDefined();
      expect(trigger.velocity).toBe(0);
    });
  });

  describe('toggleStepAccent', () => {
    it('toggles accent on a gated step', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = toggleStepGate(s, vid, 0);
      const result = toggleStepAccent(s, vid, 0);
      expect(getTrack(result, vid).stepGrid.steps[0].accent).toBe(true);
    });

    it('updates canonical region events', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = toggleStepGate(s, vid, 0);
      const result = toggleStepAccent(s, vid, 0);
      const region = getTrack(result, vid).patterns[0];
      const trigger = region.events.find(e => e.kind === 'trigger' && Math.abs(e.at) < 0.01);
      expect(trigger).toBeDefined();
      expect((trigger as TriggerEvent).accent).toBe(true);
    });

    it('does not re-enable a disabled (gated-off) step', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = toggleStepGate(s, vid, 0);        // gate on
      s = toggleStepGate(s, vid, 0);        // gate off (disabled sentinel)
      expect(getTrack(s, vid).stepGrid.steps[0].gate).toBe(false);

      s = toggleStepAccent(s, vid, 0);      // accent toggle on disabled step
      // Gate must remain off — accent on a disabled step is a no-op
      expect(getTrack(s, vid).stepGrid.steps[0].gate).toBe(false);
    });

    it('toggles accent on a pitched NoteEvent', () => {
      let s = createSession();
      const vid = s.tracks[1].id;  // pitched track
      s = toggleStepGate(s, vid, 0);
      const result = toggleStepAccent(s, vid, 0);
      expect(getTrack(result, vid).stepGrid.steps[0].accent).toBe(true);
      // Verify the NoteEvent velocity was set to 1.0
      const region = getTrack(result, vid).patterns[0];
      const noteEvent = region.events.find(e => e.kind === 'note' && Math.abs(e.at) < 0.01) as NoteEvent;
      expect(noteEvent).toBeDefined();
      expect(noteEvent.velocity).toBe(1.0);
    });

    it('does not re-enable a disabled NoteEvent step', () => {
      let s = createSession();
      const vid = s.tracks[1].id;  // pitched track
      s = toggleStepGate(s, vid, 0);        // gate on (NoteEvent)
      s = toggleStepGate(s, vid, 0);        // gate off (velocity=0)
      expect(getTrack(s, vid).stepGrid.steps[0].gate).toBe(false);

      s = toggleStepAccent(s, vid, 0);      // accent on disabled NoteEvent
      expect(getTrack(s, vid).stepGrid.steps[0].gate).toBe(false);
    });
  });

  describe('setStepParamLock', () => {
    it('sets a parameter lock on a step', () => {
      const s = createSession();
      const vid = s.tracks[0].id;
      const result = setStepParamLock(s, vid, 0, { timbre: 0.9 });
      expect(getTrack(result, vid).stepGrid.steps[0].params?.timbre).toBe(0.9);
      expect(result.undoStack.length).toBe(1);
    });

    it('merges with existing locks', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = setStepParamLock(s, vid, 0, { timbre: 0.9 });
      const result = setStepParamLock(s, vid, 0, { morph: 0.3 });
      const step = getTrack(result, vid).stepGrid.steps[0];
      expect(step.params?.timbre).toBe(0.9);
      expect(step.params?.morph).toBe(0.3);
    });
  });

  describe('clearStepParamLock', () => {
    it('removes a specific lock', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = setStepParamLock(s, vid, 0, { timbre: 0.9, morph: 0.3 });
      const result = clearStepParamLock(s, vid, 0, 'timbre');
      const step = getTrack(result, vid).stepGrid.steps[0];
      expect(step.params?.timbre).toBeUndefined();
      expect(step.params?.morph).toBe(0.3);
    });

    it('removes params entirely when last lock cleared', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = setStepParamLock(s, vid, 0, { timbre: 0.9 });
      const result = clearStepParamLock(s, vid, 0, 'timbre');
      expect(getTrack(result, vid).stepGrid.steps[0].params).toBeUndefined();
    });
  });

  describe('setPatternLength', () => {
    it('changes pattern length', () => {
      const s = createSession();
      const vid = s.tracks[0].id;
      const result = setPatternLength(s, vid, 8);
      expect(getTrack(result, vid).stepGrid.length).toBe(8);
      expect(result.undoStack.length).toBe(1);
    });

    it('extends steps array when length exceeds current steps', () => {
      const s = createSession();
      const vid = s.tracks[0].id;
      const result = setPatternLength(s, vid, 32);
      const pattern = getTrack(result, vid).stepGrid;
      expect(pattern.length).toBe(32);
      expect(pattern.steps.length).toBe(32);
    });

    it('clamps to 1-64', () => {
      const s = createSession();
      const vid = s.tracks[0].id;
      expect(getTrack(setPatternLength(s, vid, 0), vid).stepGrid.length).toBe(1);
      expect(getTrack(setPatternLength(s, vid, 100), vid).stepGrid.length).toBe(64);
    });

    it('updates canonical region duration', () => {
      const s = createSession();
      const vid = s.tracks[0].id;
      const result = setPatternLength(s, vid, 32);
      expect(getTrack(result, vid).patterns[0].duration).toBe(32);
    });

    it('shortening then expanding restores hidden content', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = toggleStepGate(s, vid, 12);       // gate at step 12
      expect(getTrack(s, vid).stepGrid.steps[12].gate).toBe(true);

      s = setPatternLength(s, vid, 8);       // shorten to 8 — step 12 hidden
      expect(getTrack(s, vid).stepGrid.length).toBe(8);

      s = setPatternLength(s, vid, 16);      // expand back to 16
      expect(getTrack(s, vid).stepGrid.steps[12].gate).toBe(true);
    });

    it('shortened region still passes validation (no out-of-range events)', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = toggleStepGate(s, vid, 12);
      s = setPatternLength(s, vid, 8);

      const region = getTrack(s, vid).patterns[0];
      const { valid, errors } = validatePattern(region);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      // Out-of-range events are stashed, not in the region
      expect(region.events.every(e => e.at < region.duration)).toBe(true);
    });
  });

  describe('clearPattern', () => {
    it('resets all steps to defaults', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = toggleStepGate(s, vid, 0);
      s = toggleStepGate(s, vid, 4);
      const result = clearPattern(s, vid);
      const pattern = getTrack(result, vid).stepGrid;
      expect(pattern.steps.every(step => !step.gate)).toBe(true);
      // clearPattern pushes its own snapshot; prior toggleStepGate snapshots also present
      expect(result.undoStack.length).toBeGreaterThan(0);
      expect(result.undoStack[result.undoStack.length - 1].kind).toBe('pattern-edit');
    });

    it('clears canonical region events', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = toggleStepGate(s, vid, 0);
      const result = clearPattern(s, vid);
      expect(getTrack(result, vid).patterns[0].events).toHaveLength(0);
    });

    it('clears hidden events so expand after clear does not resurrect old notes', () => {
      let s = createSession();
      const vid = s.tracks[0].id;
      s = toggleStepGate(s, vid, 12);          // gate at step 12
      s = setPatternLength(s, vid, 8);          // shorten — step 12 stashed in _hiddenEvents
      expect(getTrack(s, vid)._hiddenEvents?.length).toBeGreaterThan(0);

      s = clearPattern(s, vid);                 // clear everything
      expect(getTrack(s, vid)._hiddenEvents).toBeUndefined();

      s = setPatternLength(s, vid, 16);         // expand back
      expect(getTrack(s, vid).stepGrid.steps[12].gate).toBe(false);
      expect(getTrack(s, vid).patterns[0].events).toHaveLength(0);
    });
  });
});
