// tests/engine/edit-pattern-events.test.ts
import { describe, it, expect } from 'vitest';
import { editPatternEvents, validatePatternEditOps } from '../../src/engine/pattern-primitives';
import { toggleStepGate } from '../../src/engine/pattern-primitives';
import { createSession, addTrack } from '../../src/engine/session';
import type { Session, PatternEditOp } from '../../src/engine/types';
import type { TriggerEvent, NoteEvent, ParameterEvent, MusicalEvent } from '../../src/engine/canonical-types';
import { getTrack, getActivePattern, updateTrack } from '../../src/engine/types';
import { validatePattern } from '../../src/engine/region-helpers';

function createTestSession(): Session {
  let s = createSession();
  // v0: percussion (analog bass drum)
  s = updateTrack(s, 'v0', { model: 13, engine: 'plaits:analog_bass_drum' });
  // Add a second track for pitched tests
  s = addTrack(s)!;
  // v1: pitched (virtual analog)
  s = updateTrack(s, 'v1', { model: 0, engine: 'plaits:virtual_analog' });
  return s;
}

/** Seed a pattern with some trigger events on steps 0, 4, 8, 12. */
function seedKickPattern(s: Session): Session {
  const vid = 'v0';
  s = toggleStepGate(s, vid, 0);
  s = toggleStepGate(s, vid, 4);
  s = toggleStepGate(s, vid, 8);
  s = toggleStepGate(s, vid, 12);
  return s;
}

function findEventsAt(events: MusicalEvent[], step: number): MusicalEvent[] {
  return events.filter(e => Math.abs(e.at - step) < 0.001);
}

describe('editPatternEvents', () => {
  describe('add operations', () => {
    it('adds a trigger at an empty step', () => {
      let s = createTestSession();
      s = seedKickPattern(s);
      const undoBefore = s.undoStack.length;

      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'add', step: 2, event: { type: 'trigger', velocity: 0.5 } },
      ], 'add ghost hit at step 2');

      const pattern = getActivePattern(getTrack(s, 'v0'));
      const eventsAt2 = findEventsAt(pattern.events, 2);
      expect(eventsAt2.length).toBe(1);
      expect(eventsAt2[0].kind).toBe('trigger');
      expect((eventsAt2[0] as TriggerEvent).velocity).toBe(0.5);

      // Should push exactly one undo entry
      expect(s.undoStack.length).toBe(undoBefore + 1);
      expect(s.undoStack[s.undoStack.length - 1].kind).toBe('pattern-edit');
    });

    it('adds a note event at an empty step', () => {
      let s = createTestSession();

      s = editPatternEvents(s, 'v1', undefined, [
        { action: 'add', step: 0, event: { type: 'note', pitch: 60, velocity: 0.8, duration: 1 } },
      ], 'add C4 note');

      const pattern = getActivePattern(getTrack(s, 'v1'));
      const eventsAt0 = findEventsAt(pattern.events, 0);
      expect(eventsAt0.length).toBe(1);
      expect(eventsAt0[0].kind).toBe('note');
      expect((eventsAt0[0] as NoteEvent).pitch).toBe(60);
    });

    it('stacks note events up to 4 at the same step', () => {
      let s = createTestSession();

      s = editPatternEvents(s, 'v1', undefined, [
        { action: 'add', step: 0, event: { type: 'note', pitch: 60, velocity: 0.8, duration: 1 } },
        { action: 'add', step: 0, event: { type: 'note', pitch: 64, velocity: 0.8, duration: 1 } },
        { action: 'add', step: 0, event: { type: 'note', pitch: 67, velocity: 0.8, duration: 1 } },
        { action: 'add', step: 0, event: { type: 'note', pitch: 72, velocity: 0.8, duration: 1 } },
        { action: 'add', step: 0, event: { type: 'note', pitch: 76, velocity: 0.8, duration: 1 } }, // 5th — should be skipped
      ], 'add chord with 5th note overflow');

      const pattern = getActivePattern(getTrack(s, 'v1'));
      const notesAt0 = findEventsAt(pattern.events, 0).filter(e => e.kind === 'note');
      expect(notesAt0.length).toBe(4); // max 4
    });

    it('overwrites existing trigger on same step', () => {
      let s = createTestSession();
      s = seedKickPattern(s);

      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'add', step: 0, event: { type: 'trigger', velocity: 0.3, accent: true } },
      ], 'overwrite kick on beat 1');

      const pattern = getActivePattern(getTrack(s, 'v0'));
      const triggersAt0 = findEventsAt(pattern.events, 0).filter(e => e.kind === 'trigger');
      expect(triggersAt0.length).toBe(1);
      expect((triggersAt0[0] as TriggerEvent).velocity).toBe(0.3);
      expect((triggersAt0[0] as TriggerEvent).accent).toBe(true);
    });

    it('adds parameter locks', () => {
      let s = createTestSession();
      s = seedKickPattern(s);

      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'add', step: 0, params: [{ controlId: 'timbre', value: 0.7 }] },
      ], 'add timbre lock on step 0');

      const pattern = getActivePattern(getTrack(s, 'v0'));
      const paramsAt0 = findEventsAt(pattern.events, 0).filter(e => e.kind === 'parameter') as ParameterEvent[];
      expect(paramsAt0.length).toBe(1);
      expect(paramsAt0[0].controlId).toBe('timbre');
      expect(paramsAt0[0].value).toBe(0.7);
    });
  });

  describe('remove operations', () => {
    it('removes a trigger by type', () => {
      let s = createTestSession();
      s = seedKickPattern(s);

      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'remove', step: 4, event: { type: 'trigger' } },
      ], 'remove kick on beat 2');

      const pattern = getActivePattern(getTrack(s, 'v0'));
      const triggersAt4 = findEventsAt(pattern.events, 4).filter(e => e.kind === 'trigger');
      expect(triggersAt4.length).toBe(0);
    });

    it('removes all gate events when no type specified', () => {
      let s = createTestSession();
      s = seedKickPattern(s);

      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'remove', step: 0 },
      ], 'remove all events on step 0');

      const pattern = getActivePattern(getTrack(s, 'v0'));
      const gatesAt0 = findEventsAt(pattern.events, 0).filter(e => e.kind === 'trigger' || e.kind === 'note');
      expect(gatesAt0.length).toBe(0);
    });

    it('removes parameter locks', () => {
      let s = createTestSession();
      s = seedKickPattern(s);
      // First add a param lock
      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'add', step: 0, params: [{ controlId: 'timbre', value: 0.7 }] },
      ], 'add lock');

      // Then remove it
      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'remove', step: 0, params: [{ controlId: 'timbre', value: 0 }] },
      ], 'remove lock');

      const pattern = getActivePattern(getTrack(s, 'v0'));
      const paramsAt0 = findEventsAt(pattern.events, 0).filter(e => e.kind === 'parameter');
      expect(paramsAt0.length).toBe(0);
    });

    it('removes a specific stacked note by match pitch', () => {
      let s = createTestSession();
      s = editPatternEvents(s, 'v1', undefined, [
        { action: 'add', step: 0, event: { type: 'note', pitch: 60, velocity: 0.5, duration: 1 } },
        { action: 'add', step: 0, event: { type: 'note', pitch: 67, velocity: 0.9, duration: 1 } },
      ], 'add dyad');

      s = editPatternEvents(s, 'v1', undefined, [
        { action: 'remove', step: 0, match: { type: 'note', pitch: 67 }, event: { type: 'note' } },
      ], 'remove top note');

      const pattern = getActivePattern(getTrack(s, 'v1'));
      const notesAt0 = findEventsAt(pattern.events, 0).filter(e => e.kind === 'note') as NoteEvent[];
      expect(notesAt0).toHaveLength(1);
      expect(notesAt0[0].pitch).toBe(60);
    });
  });

  describe('modify operations', () => {
    it('modifies trigger velocity', () => {
      let s = createTestSession();
      s = seedKickPattern(s);

      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'modify', step: 0, event: { type: 'trigger', velocity: 0.4 } },
      ], 'soften beat 1');

      const pattern = getActivePattern(getTrack(s, 'v0'));
      const triggersAt0 = findEventsAt(pattern.events, 0).filter(e => e.kind === 'trigger') as TriggerEvent[];
      expect(triggersAt0.length).toBe(1);
      expect(triggersAt0[0].velocity).toBe(0.4);
    });

    it('modifies trigger accent', () => {
      let s = createTestSession();
      s = seedKickPattern(s);

      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'modify', step: 0, event: { type: 'trigger', accent: true } },
      ], 'accent beat 1');

      const pattern = getActivePattern(getTrack(s, 'v0'));
      const triggersAt0 = findEventsAt(pattern.events, 0).filter(e => e.kind === 'trigger') as TriggerEvent[];
      expect(triggersAt0[0].accent).toBe(true);
    });

    it('modifies note pitch', () => {
      let s = createTestSession();
      s = editPatternEvents(s, 'v1', undefined, [
        { action: 'add', step: 0, event: { type: 'note', pitch: 60, velocity: 0.8, duration: 1 } },
      ], 'add note');

      s = editPatternEvents(s, 'v1', undefined, [
        { action: 'modify', step: 0, event: { type: 'note', pitch: 67 } },
      ], 'transpose up to G4');

      const pattern = getActivePattern(getTrack(s, 'v1'));
      const notesAt0 = findEventsAt(pattern.events, 0).filter(e => e.kind === 'note') as NoteEvent[];
      expect(notesAt0[0].pitch).toBe(67);
      expect(notesAt0[0].velocity).toBe(0.8); // unchanged
    });

    it('modifies parameter lock values', () => {
      let s = createTestSession();
      s = seedKickPattern(s);
      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'add', step: 0, params: [{ controlId: 'timbre', value: 0.3 }] },
      ], 'add lock');

      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'modify', step: 0, params: [{ controlId: 'timbre', value: 0.9 }] },
      ], 'brighten lock');

      const pattern = getActivePattern(getTrack(s, 'v0'));
      const paramsAt0 = findEventsAt(pattern.events, 0).filter(e => e.kind === 'parameter') as ParameterEvent[];
      expect(paramsAt0[0].value).toBe(0.9);
    });

    it('modifies a specific stacked note by match pitch', () => {
      let s = createTestSession();
      s = editPatternEvents(s, 'v1', undefined, [
        { action: 'add', step: 0, event: { type: 'note', pitch: 60, velocity: 0.5, duration: 1 } },
        { action: 'add', step: 0, event: { type: 'note', pitch: 67, velocity: 0.9, duration: 1 } },
      ], 'add dyad');

      s = editPatternEvents(s, 'v1', undefined, [
        { action: 'modify', step: 0, match: { type: 'note', pitch: 67 }, event: { type: 'note', velocity: 0.2, pitch: 69 } },
      ], 'retune top note');

      const pattern = getActivePattern(getTrack(s, 'v1'));
      const notesAt0 = findEventsAt(pattern.events, 0).filter(e => e.kind === 'note') as NoteEvent[];
      expect(notesAt0.some(note => note.pitch === 60 && note.velocity === 0.5)).toBe(true);
      expect(notesAt0.some(note => note.pitch === 69 && note.velocity === 0.2)).toBe(true);
    });
  });

  describe('batch operations', () => {
    it('applies multiple operations as one undo group', () => {
      let s = createTestSession();
      const undoBefore = s.undoStack.length;

      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'add', step: 0, event: { type: 'trigger', velocity: 1.0, accent: true } },
        { action: 'add', step: 4, event: { type: 'trigger', velocity: 0.8 } },
        { action: 'add', step: 8, event: { type: 'trigger', velocity: 1.0, accent: true } },
        { action: 'add', step: 12, event: { type: 'trigger', velocity: 0.6 } },
      ], 'four on the floor');

      // Single undo entry for the whole batch
      expect(s.undoStack.length).toBe(undoBefore + 1);

      const pattern = getActivePattern(getTrack(s, 'v0'));
      const triggers = pattern.events.filter(e => e.kind === 'trigger');
      expect(triggers.length).toBe(4);
    });

    it('does not touch other steps', () => {
      let s = createTestSession();
      s = seedKickPattern(s); // 0, 4, 8, 12

      // Add ghost hit on step 6 only
      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'add', step: 6, event: { type: 'trigger', velocity: 0.3 } },
      ], 'ghost hit');

      const pattern = getActivePattern(getTrack(s, 'v0'));
      const triggers = pattern.events.filter(e => e.kind === 'trigger');
      // Should have 5 triggers: 0, 4, 6, 8, 12
      expect(triggers.length).toBe(5);
      expect(triggers.map(t => t.at).sort((a, b) => a - b)).toEqual([0, 4, 6, 8, 12]);
    });
  });

  describe('pattern invariants', () => {
    it('produces valid patterns after all operations', () => {
      let s = createTestSession();
      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'add', step: 0, event: { type: 'trigger', velocity: 1.0, accent: true } },
        { action: 'add', step: 3, event: { type: 'trigger', velocity: 0.5 } },
        { action: 'add', step: 7, event: { type: 'trigger', velocity: 0.8 } },
        { action: 'add', step: 3, params: [{ controlId: 'timbre', value: 0.6 }] },
      ], 'pattern with param lock');

      const pattern = getActivePattern(getTrack(s, 'v0'));
      const validation = validatePattern(pattern);
      expect(validation.valid).toBe(true);
    });

    it('re-projects step grid after edits', () => {
      let s = createTestSession();
      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'add', step: 0, event: { type: 'trigger', velocity: 1.0 } },
      ], 'add kick');

      const track = getTrack(s, 'v0');
      expect(track.stepGrid.steps[0].gate).toBe(true);
    });
  });

  describe('validatePatternEditOps', () => {
    it('rejects step out of range', () => {
      let s = createTestSession();
      const pattern = getActivePattern(getTrack(s, 'v0'));
      const errors = validatePatternEditOps(pattern, [
        { action: 'add', step: 99, event: { type: 'trigger' } },
      ]);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('out of range');
    });

    it('rejects remove on empty step', () => {
      let s = createTestSession();
      const pattern = getActivePattern(getTrack(s, 'v0'));
      const errors = validatePatternEditOps(pattern, [
        { action: 'remove', step: 5 },
      ]);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('no event');
    });

    it('rejects invalid velocity', () => {
      let s = createTestSession();
      const pattern = getActivePattern(getTrack(s, 'v0'));
      const errors = validatePatternEditOps(pattern, [
        { action: 'add', step: 0, event: { type: 'trigger', velocity: 2.0 } },
      ]);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('velocity');
    });

    it('rejects invalid pitch', () => {
      let s = createTestSession();
      const pattern = getActivePattern(getTrack(s, 'v0'));
      const errors = validatePatternEditOps(pattern, [
        { action: 'add', step: 0, event: { type: 'note', pitch: 200 } },
      ]);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('pitch');
    });

    it('accepts valid operations', () => {
      let s = createTestSession();
      s = seedKickPattern(s);
      const pattern = getActivePattern(getTrack(s, 'v0'));
      const errors = validatePatternEditOps(pattern, [
        { action: 'add', step: 2, event: { type: 'trigger', velocity: 0.5 } },
        { action: 'modify', step: 0, event: { type: 'trigger', velocity: 0.3 } },
        { action: 'remove', step: 4 },
      ]);
      expect(errors).toEqual([]);
    });

    it('rejects targeted note removal when the matched pitch does not exist', () => {
      let s = createTestSession();
      s = editPatternEvents(s, 'v1', undefined, [
        { action: 'add', step: 0, event: { type: 'note', pitch: 60, velocity: 0.8, duration: 1 } },
      ], 'add note');

      const pattern = getActivePattern(getTrack(s, 'v1'));
      const errors = validatePatternEditOps(pattern, [
        { action: 'remove', step: 0, match: { type: 'note', pitch: 67 }, event: { type: 'note' } },
      ]);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('no event');
    });
  });

  describe('pattern ID targeting', () => {
    it('returns unchanged session for non-existent pattern ID', () => {
      let s = createTestSession();
      const result = editPatternEvents(s, 'v0', 'nonexistent', [
        { action: 'add', step: 0, event: { type: 'trigger' } },
      ], 'bad pattern');
      expect(result).toBe(s);
    });

    it('edits the active pattern when patternId is undefined', () => {
      let s = createTestSession();
      s = editPatternEvents(s, 'v0', undefined, [
        { action: 'add', step: 5, event: { type: 'trigger', velocity: 0.7 } },
      ], 'add to active pattern');

      const pattern = getActivePattern(getTrack(s, 'v0'));
      const eventsAt5 = findEventsAt(pattern.events, 5);
      expect(eventsAt5.length).toBe(1);
    });
  });
});
