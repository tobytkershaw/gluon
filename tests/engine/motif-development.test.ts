// tests/engine/motif-development.test.ts — Development operation tests
import { describe, it, expect } from 'vitest';
import type { Motif } from '../../src/engine/motif';
import type { NoteEvent, TriggerEvent } from '../../src/engine/canonical-types';
import {
  transpose,
  invert,
  retrograde,
  augment,
  diminish,
  fragment,
  permute,
  ornament,
  thin,
  layer,
  applyDevelopmentOps,
} from '../../src/engine/motif-development';

function makeNoteMotif(): Motif {
  return {
    id: 'test',
    name: 'Test',
    events: [
      { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 } as NoteEvent,
      { kind: 'note', at: 1, pitch: 64, velocity: 0.7, duration: 1 } as NoteEvent,
      { kind: 'note', at: 2, pitch: 67, velocity: 0.9, duration: 1 } as NoteEvent,
    ],
    rootPitch: 60,
    duration: 4,
  };
}

function makeTriggerMotif(): Motif {
  return {
    id: 'trig',
    name: 'Trigger',
    events: [
      { kind: 'trigger', at: 0, velocity: 1.0 } as TriggerEvent,
      { kind: 'trigger', at: 1, velocity: 0.5 } as TriggerEvent,
      { kind: 'trigger', at: 2, velocity: 0.8 } as TriggerEvent,
      { kind: 'trigger', at: 3, velocity: 0.6 } as TriggerEvent,
    ],
    duration: 4,
  };
}

describe('transpose', () => {
  it('shifts all note pitches by semitones', () => {
    const result = transpose(makeNoteMotif(), 5);
    const notes = result.events.filter(e => e.kind === 'note') as NoteEvent[];
    expect(notes.map(n => n.pitch)).toEqual([65, 69, 72]);
  });

  it('shifts rootPitch', () => {
    const result = transpose(makeNoteMotif(), -3);
    expect(result.rootPitch).toBe(57);
  });

  it('clamps to MIDI range', () => {
    const high = transpose(makeNoteMotif(), 100);
    const notes = high.events.filter(e => e.kind === 'note') as NoteEvent[];
    expect(notes.every(n => n.pitch <= 127)).toBe(true);

    const low = transpose(makeNoteMotif(), -100);
    const lowNotes = low.events.filter(e => e.kind === 'note') as NoteEvent[];
    expect(lowNotes.every(n => n.pitch >= 0)).toBe(true);
  });

  it('does not affect triggers', () => {
    const result = transpose(makeTriggerMotif(), 5);
    expect(result.events).toHaveLength(4);
    expect(result.events.every(e => e.kind === 'trigger')).toBe(true);
  });

  it('returns a new motif (does not mutate original)', () => {
    const original = makeNoteMotif();
    const result = transpose(original, 5);
    expect(result).not.toBe(original);
    expect((original.events[0] as NoteEvent).pitch).toBe(60);
  });
});

describe('invert', () => {
  it('mirrors intervals around rootPitch', () => {
    const result = invert(makeNoteMotif());
    const notes = result.events.filter(e => e.kind === 'note') as NoteEvent[];
    // C4(60), E4(64), G4(67) around C4(60) => C4(60), Ab3(56), F3(53)
    expect(notes.map(n => n.pitch)).toEqual([60, 56, 53]);
  });

  it('uses custom axis pitch', () => {
    const result = invert(makeNoteMotif(), 64);
    const notes = result.events.filter(e => e.kind === 'note') as NoteEvent[];
    // C4(60) reflected at E4(64) => Ab4(68)
    // E4(64) reflected at E4(64) => E4(64)
    // G4(67) reflected at E4(64) => C#4(61)
    expect(notes.map(n => n.pitch)).toEqual([68, 64, 61]);
  });
});

describe('retrograde', () => {
  it('reverses events in time', () => {
    const result = retrograde(makeNoteMotif());
    const notes = result.events.filter(e => e.kind === 'note') as NoteEvent[];
    // Original: at 0,1,2 with duration 1 each, total duration 4
    // Reversed: at=(4-at-dur) => 3,2,1 then sorted => 1,2,3
    expect(notes.map(n => n.at)).toEqual([1, 2, 3]);
    // Pitch order is reversed
    expect(notes.map(n => n.pitch)).toEqual([67, 64, 60]);
  });
});

describe('augment', () => {
  it('doubles durations by default', () => {
    const result = augment(makeNoteMotif());
    expect(result.duration).toBe(8);
    const notes = result.events.filter(e => e.kind === 'note') as NoteEvent[];
    expect(notes.map(n => n.at)).toEqual([0, 2, 4]);
    expect(notes.map(n => n.duration)).toEqual([2, 2, 2]);
  });

  it('accepts custom factor', () => {
    const result = augment(makeNoteMotif(), 3);
    expect(result.duration).toBe(12);
    const notes = result.events.filter(e => e.kind === 'note') as NoteEvent[];
    expect(notes.map(n => n.at)).toEqual([0, 3, 6]);
  });
});

describe('diminish', () => {
  it('halves durations by default', () => {
    const result = diminish(makeNoteMotif());
    expect(result.duration).toBe(2);
    const notes = result.events.filter(e => e.kind === 'note') as NoteEvent[];
    expect(notes.map(n => n.at)).toEqual([0, 0.5, 1]);
    expect(notes.map(n => n.duration)).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('fragment', () => {
  it('extracts first N events', () => {
    const result = fragment(makeNoteMotif(), { start: 0, end: 2 });
    expect(result.events).toHaveLength(2);
    expect(result.events[0].at).toBe(0);
  });

  it('extracts last N events', () => {
    const result = fragment(makeNoteMotif(), { start: 1, end: 3 });
    expect(result.events).toHaveLength(2);
    // Events shifted so first starts at 0
    expect(result.events[0].at).toBe(0);
  });

  it('handles empty fragment', () => {
    const result = fragment(makeNoteMotif(), { start: 5, end: 10 });
    expect(result.events).toHaveLength(0);
    expect(result.duration).toBe(0);
  });
});

describe('permute', () => {
  it('rearranges segments', () => {
    const motif = makeTriggerMotif(); // 4 events at 0,1,2,3, duration 4
    // Split into 2 segments [0-2), [2-4), swap them
    const result = permute(motif, [1, 0]);
    expect(result.events).toHaveLength(4);
    // Segment 1 (events at 2,3) moved to position 0
    // Segment 0 (events at 0,1) moved to position 1
    const ats = result.events.map(e => e.at);
    expect(ats[0]).toBe(0);  // was at 2, moved to 0
    expect(ats[1]).toBe(1);  // was at 3, moved to 1
    expect(ats[2]).toBe(2);  // was at 0, moved to 2
    expect(ats[3]).toBe(3);  // was at 1, moved to 3
  });
});

describe('ornament', () => {
  it('adds passing tones between notes with gaps', () => {
    const motif: Motif = {
      id: 'orn',
      name: 'Orn',
      events: [
        { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 0.5 } as NoteEvent,
        { kind: 'note', at: 2, pitch: 72, velocity: 0.8, duration: 0.5 } as NoteEvent,
      ],
      rootPitch: 60,
      duration: 4,
    };
    const result = ornament(motif);
    // Should have 3 events: original 2 + 1 passing tone
    expect(result.events.length).toBe(3);
    const passingTone = result.events[1] as NoteEvent;
    expect(passingTone.pitch).toBe(66); // midpoint of 60 and 72
    expect(passingTone.velocity).toBeCloseTo(0.48); // 0.8 * 0.6
  });

  it('does not add passing tone when gap is too small', () => {
    const motif: Motif = {
      id: 'tight',
      name: 'Tight',
      events: [
        { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 0.9 } as NoteEvent,
        { kind: 'note', at: 1, pitch: 64, velocity: 0.8, duration: 0.5 } as NoteEvent,
      ],
      rootPitch: 60,
      duration: 2,
    };
    const result = ornament(motif);
    // Gap is 1 - (0 + 0.9) = 0.1, too small
    expect(result.events.length).toBe(2);
  });
});

describe('thin', () => {
  it('removes events by probability', () => {
    let callCount = 0;
    const rng = () => {
      callCount++;
      return callCount % 2 === 0 ? 0.0 : 1.0; // alternate keep/remove
    };
    const result = thin(makeTriggerMotif(), 0.5, rng);
    // With alternating RNG, half should be kept (those where random >= 0.5)
    expect(result.events.length).toBeLessThan(4);
  });

  it('probability 0 keeps all events', () => {
    const result = thin(makeTriggerMotif(), 0, () => 0.5);
    expect(result.events).toHaveLength(4);
  });

  it('probability 1 removes all events', () => {
    const result = thin(makeTriggerMotif(), 1, () => 0.5);
    expect(result.events).toHaveLength(0);
  });
});

describe('layer', () => {
  it('stacks motif with transposed copy', () => {
    const result = layer(makeNoteMotif(), 7); // perfect fifth
    expect(result.events).toHaveLength(6); // 3 original + 3 transposed
    const notes = result.events.filter(e => e.kind === 'note') as NoteEvent[];
    const pitches = notes.map(n => n.pitch).sort((a, b) => a - b);
    expect(pitches).toEqual([60, 64, 67, 67, 71, 74]);
  });
});

describe('applyDevelopmentOps', () => {
  it('applies a chain of operations', () => {
    const result = applyDevelopmentOps(makeNoteMotif(), [
      { op: 'transpose', semitones: 5 },
      { op: 'thin', probability: 0 }, // keep all (probability 0 removes none)
    ]);
    const notes = result.events.filter(e => e.kind === 'note') as NoteEvent[];
    expect(notes.map(n => n.pitch)).toEqual([65, 69, 72]);
  });

  it('handles empty ops array', () => {
    const original = makeNoteMotif();
    const result = applyDevelopmentOps(original, []);
    expect(result.events).toEqual(original.events);
  });
});
