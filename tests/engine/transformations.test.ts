import { describe, it, expect } from 'vitest';
import { rotate, transpose, reverse, duplicate } from '../../src/engine/transformations';
import { validateRegion } from '../../src/engine/region-helpers';
import type {
  Region,
  MusicalEvent,
  NoteEvent,
  TriggerEvent,
  ParameterEvent,
} from '../../src/engine/canonical-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegion(events: MusicalEvent[], duration: number): Region {
  return {
    id: 'r1',
    kind: 'pattern',
    start: 0,
    duration,
    loop: true,
    events,
  };
}

function note(at: number, extra: Partial<NoteEvent> = {}): NoteEvent {
  return { kind: 'note', at, pitch: 60, velocity: 0.8, duration: 0.25, ...extra };
}

function trigger(at: number, extra: Partial<TriggerEvent> = {}): TriggerEvent {
  return { kind: 'trigger', at, ...extra };
}

function param(at: number, controlId: string, value: number): ParameterEvent {
  return { kind: 'parameter', at, controlId, value };
}

// ---------------------------------------------------------------------------
// rotate
// ---------------------------------------------------------------------------

describe('rotate', () => {
  it('shifts positions forward', () => {
    const events = [note(0), note(2), note(4)];
    const result = rotate(events, 3, 8);
    expect(result.map((e) => e.at)).toEqual([3, 5, 7]);
  });

  it('wraps around at duration', () => {
    const events = [note(6), note(7)];
    const result = rotate(events, 3, 8);
    expect(result.map((e) => e.at)).toEqual([1, 2]);
  });

  it('handles negative rotation', () => {
    const events = [note(1), note(3)];
    const result = rotate(events, -2, 8);
    expect(result.map((e) => e.at)).toEqual([1, 7]);
  });

  it('round-trip restores original positions', () => {
    const events = [note(0), note(2.5), note(5)];
    const d = 8;
    const rotated = rotate(rotate(events, 3, d), -3, d);
    const originalAts = events.map((e) => e.at).sort((a, b) => a - b);
    const roundTripAts = rotated.map((e) => e.at).sort((a, b) => a - b);
    for (let i = 0; i < originalAts.length; i++) {
      expect(roundTripAts[i]).toBeCloseTo(originalAts[i], 10);
    }
  });

  it('works with fractional positions', () => {
    const events = [note(0.5), note(3.75)];
    const result = rotate(events, 1.25, 4);
    expect(result.map((e) => e.at)).toEqual([1, 1.75]);
  });

  it('sorts output by at', () => {
    const events = [note(7), note(1), note(4)];
    const result = rotate(events, 2, 8);
    expect(result.map((e) => e.at)).toEqual([1, 3, 6]);
  });

  it('does not mutate input', () => {
    const events = [note(0), note(2)];
    const copy = events.map((e) => ({ ...e }));
    rotate(events, 3, 8);
    expect(events).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// transpose
// ---------------------------------------------------------------------------

describe('transpose', () => {
  it('shifts note pitches by semitones', () => {
    const events = [note(0, { pitch: 60 }), note(1, { pitch: 64 })];
    const result = transpose(events, 5);
    expect((result[0] as NoteEvent).pitch).toBe(65);
    expect((result[1] as NoteEvent).pitch).toBe(69);
  });

  it('handles negative semitones', () => {
    const events = [note(0, { pitch: 60 })];
    const result = transpose(events, -12);
    expect((result[0] as NoteEvent).pitch).toBe(48);
  });

  it('clamps at MIDI upper boundary (127)', () => {
    const events = [note(0, { pitch: 120 })];
    const result = transpose(events, 20);
    expect((result[0] as NoteEvent).pitch).toBe(127);
  });

  it('clamps at MIDI lower boundary (0)', () => {
    const events = [note(0, { pitch: 5 })];
    const result = transpose(events, -10);
    expect((result[0] as NoteEvent).pitch).toBe(0);
  });

  it('is no-op on trigger events', () => {
    const events: MusicalEvent[] = [trigger(0, { velocity: 0.9 })];
    const result = transpose(events, 7);
    expect(result[0]).toEqual(trigger(0, { velocity: 0.9 }));
  });

  it('is no-op on parameter events', () => {
    const events: MusicalEvent[] = [param(0, 'filter', 0.5)];
    const result = transpose(events, 7);
    expect(result[0]).toEqual(param(0, 'filter', 0.5));
  });

  it('preserves other note fields', () => {
    const events = [note(2, { pitch: 60, velocity: 0.5, duration: 1.5 })];
    const result = transpose(events, 3) as NoteEvent[];
    expect(result[0].at).toBe(2);
    expect(result[0].velocity).toBe(0.5);
    expect(result[0].duration).toBe(1.5);
    expect(result[0].pitch).toBe(63);
  });

  it('does not mutate input', () => {
    const events = [note(0, { pitch: 60 })];
    const copy = events.map((e) => ({ ...e }));
    transpose(events, 5);
    expect(events).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// reverse
// ---------------------------------------------------------------------------

describe('reverse', () => {
  it('mirrors event positions', () => {
    const events = [note(0), note(2), note(6)];
    const result = reverse(events, 8);
    expect(result.map((e) => e.at)).toEqual([0, 2, 6]);
    // at=0 → 0, at=2 → 6, at=6 → 2
  });

  it('maps at=0 to at=0 (wrapping)', () => {
    const events = [note(0)];
    const result = reverse(events, 8);
    expect(result[0].at).toBe(0);
  });

  it('is an involution (double-reverse restores original)', () => {
    const events = [note(1), note(3), note(5.5)];
    const d = 8;
    const doubled = reverse(reverse(events, d), d);
    const originalAts = events.map((e) => e.at).sort((a, b) => a - b);
    const doubledAts = doubled.map((e) => e.at).sort((a, b) => a - b);
    for (let i = 0; i < originalAts.length; i++) {
      expect(doubledAts[i]).toBeCloseTo(originalAts[i], 10);
    }
  });

  it('preserves event content', () => {
    const events = [note(2, { pitch: 72, velocity: 0.6 })];
    const result = reverse(events, 8) as NoteEvent[];
    expect(result[0].kind).toBe('note');
    expect(result[0].pitch).toBe(72);
    expect(result[0].velocity).toBe(0.6);
  });

  it('sorts output by at', () => {
    const events = [note(1), note(5), note(7)];
    const result = reverse(events, 8);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].at).toBeGreaterThanOrEqual(result[i - 1].at);
    }
  });

  it('does not mutate input', () => {
    const events = [note(2), note(4)];
    const copy = events.map((e) => ({ ...e }));
    reverse(events, 8);
    expect(events).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// duplicate
// ---------------------------------------------------------------------------

describe('duplicate', () => {
  it('doubles event count', () => {
    const events = [note(0), note(2), note(4)];
    const result = duplicate(events, 8);
    expect(result.events.length).toBe(6);
  });

  it('doubles duration', () => {
    const result = duplicate([note(0)], 8);
    expect(result.duration).toBe(16);
  });

  it('original events unchanged, copies shifted by duration', () => {
    const events = [note(1), note(3)];
    const result = duplicate(events, 8);
    const ats = result.events.map((e) => e.at);
    expect(ats).toEqual([1, 3, 9, 11]);
  });

  it('works with empty events', () => {
    const result = duplicate([], 4);
    expect(result.events).toEqual([]);
    expect(result.duration).toBe(8);
  });

  it('does not mutate input', () => {
    const events = [note(0), note(2)];
    const copy = events.map((e) => ({ ...e }));
    duplicate(events, 8);
    expect(events).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// Validation property: outputs pass validateRegion
// ---------------------------------------------------------------------------

describe('validation property', () => {
  const baseEvents: MusicalEvent[] = [note(1), note(3), note(5)];
  const duration = 8;

  it('rotate output passes validateRegion', () => {
    const result = rotate(baseEvents, 2, duration);
    const region = makeRegion(result, duration);
    expect(validateRegion(region).valid).toBe(true);
  });

  it('transpose output passes validateRegion', () => {
    const result = transpose(baseEvents, 5);
    const region = makeRegion(result, duration);
    expect(validateRegion(region).valid).toBe(true);
  });

  it('reverse output passes validateRegion', () => {
    const result = reverse(baseEvents, duration);
    const region = makeRegion(result, duration);
    expect(validateRegion(region).valid).toBe(true);
  });

  it('duplicate output passes validateRegion', () => {
    const result = duplicate(baseEvents, duration);
    const region = makeRegion(result.events, result.duration);
    expect(validateRegion(region).valid).toBe(true);
  });
});
