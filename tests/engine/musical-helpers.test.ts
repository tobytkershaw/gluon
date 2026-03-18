import { describe, it, expect } from 'vitest';
import {
  humanize,
  euclidean,
  ghostNotes,
  swing,
  thin,
  densify,
} from '../../src/engine/musical-helpers';
import { validatePattern } from '../../src/engine/region-helpers';
import type {
  Pattern,
  MusicalEvent,
  NoteEvent,
  TriggerEvent,
  ParameterEvent,
} from '../../src/engine/canonical-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePattern(events: MusicalEvent[], duration: number): Pattern {
  return { id: 'p1', kind: 'pattern', duration, events };
}

function note(at: number, extra: Partial<NoteEvent> = {}): NoteEvent {
  return { kind: 'note', at, pitch: 60, velocity: 0.8, duration: 0.25, ...extra };
}

function trigger(at: number, extra: Partial<TriggerEvent> = {}): TriggerEvent {
  return { kind: 'trigger', at, velocity: 0.8, ...extra };
}

function param(at: number, controlId: string, value: number): ParameterEvent {
  return { kind: 'parameter', at, controlId, value };
}

// ---------------------------------------------------------------------------
// humanize
// ---------------------------------------------------------------------------

describe('humanize', () => {
  const events: MusicalEvent[] = [trigger(0), trigger(4), trigger(8), trigger(12)];
  const duration = 16;

  it('returns same number of events', () => {
    const result = humanize(events, duration, { velocityAmount: 0.5, timingAmount: 0.5, seed: 42 });
    expect(result.length).toBe(events.length);
  });

  it('does not mutate input', () => {
    const copy = events.map(e => ({ ...e }));
    humanize(events, duration, { velocityAmount: 0.5, timingAmount: 0.5, seed: 42 });
    expect(events).toEqual(copy);
  });

  it('is deterministic with same seed', () => {
    const a = humanize(events, duration, { velocityAmount: 0.5, timingAmount: 0.5, seed: 42 });
    const b = humanize(events, duration, { velocityAmount: 0.5, timingAmount: 0.5, seed: 42 });
    expect(a).toEqual(b);
  });

  it('produces different results with different seeds', () => {
    const a = humanize(events, duration, { velocityAmount: 0.5, timingAmount: 0.5, seed: 42 });
    const b = humanize(events, duration, { velocityAmount: 0.5, timingAmount: 0.5, seed: 99 });
    const aAts = a.map(e => e.at);
    const bAts = b.map(e => e.at);
    expect(aAts).not.toEqual(bAts);
  });

  it('velocity stays in [0, 1]', () => {
    const loud = [trigger(0, { velocity: 1.0 }), trigger(4, { velocity: 0.0 })];
    const result = humanize(loud, duration, { velocityAmount: 1.0, timingAmount: 0, seed: 42 });
    for (const e of result) {
      const v = (e as TriggerEvent).velocity!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('timing stays in [0, duration)', () => {
    const result = humanize(events, duration, { velocityAmount: 0, timingAmount: 1.0, seed: 42 });
    for (const e of result) {
      expect(e.at).toBeGreaterThanOrEqual(0);
      expect(e.at).toBeLessThan(duration);
    }
  });

  it('no-op when amounts are 0', () => {
    const result = humanize(events, duration, { velocityAmount: 0, timingAmount: 0, seed: 42 });
    for (let i = 0; i < events.length; i++) {
      expect(result[i].at).toBe(events[i].at);
      expect((result[i] as TriggerEvent).velocity).toBe((events[i] as TriggerEvent).velocity);
    }
  });

  it('passes through parameter events unchanged', () => {
    const mixed: MusicalEvent[] = [trigger(0), param(4, 'cutoff', 0.5)];
    const result = humanize(mixed, duration, { velocityAmount: 0.5, timingAmount: 0.5, seed: 42 });
    const paramResult = result.find(e => e.kind === 'parameter') as ParameterEvent;
    expect(paramResult.at).toBe(4);
    expect(paramResult.controlId).toBe('cutoff');
    expect(paramResult.value).toBe(0.5);
  });

  it('works on note events', () => {
    const notes = [note(0), note(4), note(8)];
    const result = humanize(notes, duration, { velocityAmount: 0.5, timingAmount: 0.5, seed: 42 });
    expect(result.length).toBe(3);
    for (const e of result) {
      expect(e.kind).toBe('note');
      const n = e as NoteEvent;
      expect(n.velocity).toBeGreaterThanOrEqual(0);
      expect(n.velocity).toBeLessThanOrEqual(1);
    }
  });

  it('output is sorted by at', () => {
    const result = humanize(events, duration, { velocityAmount: 0.5, timingAmount: 0.5, seed: 42 });
    for (let i = 1; i < result.length; i++) {
      expect(result[i].at).toBeGreaterThanOrEqual(result[i - 1].at);
    }
  });

  it('output passes validatePattern', () => {
    const result = humanize(events, duration, { velocityAmount: 0.8, timingAmount: 0.8, seed: 42 });
    const pattern = makePattern(result, duration);
    expect(validatePattern(pattern).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// euclidean
// ---------------------------------------------------------------------------

describe('euclidean', () => {
  it('generates correct number of hits', () => {
    const result = euclidean({ hits: 3, steps: 8 });
    expect(result.length).toBe(3);
  });

  it('E(3,8) produces standard Bjorklund distribution', () => {
    const result = euclidean({ hits: 3, steps: 8 });
    const positions = result.map(e => e.at);
    // Standard Bjorklund E(3,8) = [1,0,0,1,0,0,1,0] → hits at 0, 3, 6
    expect(positions).toEqual([0, 3, 6]);
  });

  it('E(4,16) produces maximally even spacing', () => {
    const result = euclidean({ hits: 4, steps: 16 });
    const positions = result.map(e => e.at);
    // Standard Bjorklund E(4,16) = hits at 0, 4, 8, 12
    expect(positions).toEqual([0, 4, 8, 12]);
  });

  it('E(5,8) produces standard Bjorklund distribution', () => {
    const result = euclidean({ hits: 5, steps: 8 });
    const positions = result.map(e => e.at);
    // Standard Bjorklund E(5,8) = [1,0,1,1,0,1,1,0] → hits at 0, 2, 3, 5, 6
    // Wait — E(5,8) complement approach: [1,1,0,1,1,0,1,1] → 0,1,3,4,6 ...
    // Actually standard: [10110110] → 0, 2, 3, 5, 6
    expect(positions).toEqual([0, 2, 3, 5, 6]);
  });

  it('E(5,13) produces standard Bjorklund distribution', () => {
    const result = euclidean({ hits: 5, steps: 13 });
    const positions = result.map(e => e.at);
    // Standard Bjorklund E(5,13) = [1,0,0,1,0,1,0,0,1,0,1,0,0] → 0, 3, 5, 8, 10
    expect(positions).toEqual([0, 3, 5, 8, 10]);
  });

  it('applies rotation', () => {
    const base = euclidean({ hits: 3, steps: 8, rotation: 0 });
    const rotated = euclidean({ hits: 3, steps: 8, rotation: 1 });
    const basePositions = base.map(e => e.at);
    const rotatedPositions = rotated.map(e => e.at);
    expect(rotatedPositions).not.toEqual(basePositions);
  });

  it('uses specified velocity', () => {
    const result = euclidean({ hits: 4, steps: 8, velocity: 0.6 });
    for (const e of result) {
      expect((e as TriggerEvent).velocity).toBe(0.6);
    }
  });

  it('generates triggers by default', () => {
    const result = euclidean({ hits: 3, steps: 8 });
    for (const e of result) {
      expect(e.kind).toBe('trigger');
    }
  });

  it('can generate note events', () => {
    const result = euclidean({ hits: 3, steps: 8, eventKind: 'note', pitch: 48 });
    for (const e of result) {
      expect(e.kind).toBe('note');
      expect((e as NoteEvent).pitch).toBe(48);
    }
  });

  it('returns empty for hits=0', () => {
    expect(euclidean({ hits: 0, steps: 8 })).toEqual([]);
  });

  it('returns empty for hits > steps', () => {
    expect(euclidean({ hits: 10, steps: 8 })).toEqual([]);
  });

  it('hits == steps fills all steps', () => {
    const result = euclidean({ hits: 8, steps: 8 });
    expect(result.length).toBe(8);
    const positions = result.map(e => e.at);
    expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('single hit lands at step 0', () => {
    const result = euclidean({ hits: 1, steps: 8 });
    expect(result.length).toBe(1);
    expect(result[0].at).toBe(0);
  });

  it('output passes validatePattern', () => {
    const result = euclidean({ hits: 5, steps: 16 });
    const pattern = makePattern(result, 16);
    expect(validatePattern(pattern).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ghostNotes
// ---------------------------------------------------------------------------

describe('ghostNotes', () => {
  const events: MusicalEvent[] = [
    trigger(0, { velocity: 0.9 }),
    trigger(4, { velocity: 0.9 }),
    trigger(8, { velocity: 0.9 }),
    trigger(12, { velocity: 0.9 }),
  ];
  const duration = 16;

  it('adds events to output', () => {
    const result = ghostNotes(events, duration, { velocity: 0.3, probability: 1.0, seed: 42 });
    expect(result.length).toBeGreaterThan(events.length);
  });

  it('ghost note velocity is at the specified level', () => {
    const result = ghostNotes(events, duration, { velocity: 0.2, probability: 1.0, seed: 42 });
    const ghosts = result.filter(e => (e as TriggerEvent).velocity === 0.2);
    expect(ghosts.length).toBeGreaterThan(0);
  });

  it('preserves original events', () => {
    const result = ghostNotes(events, duration, { velocity: 0.3, probability: 1.0, seed: 42 });
    for (const original of events) {
      const match = result.find(e => e.at === original.at && (e as TriggerEvent).velocity === 0.9);
      expect(match).toBeDefined();
    }
  });

  it('does not place ghosts on occupied positions', () => {
    const result = ghostNotes(events, duration, { velocity: 0.3, probability: 1.0, seed: 42 });
    const positions = new Map<number, number>();
    for (const e of result) {
      if (e.kind !== 'parameter') {
        const pos = Math.round(e.at);
        positions.set(pos, (positions.get(pos) ?? 0) + 1);
      }
    }
    for (const count of positions.values()) {
      expect(count).toBe(1);
    }
  });

  it('does not mutate input', () => {
    const copy = events.map(e => ({ ...e }));
    ghostNotes(events, duration, { velocity: 0.3, probability: 1.0, seed: 42 });
    expect(events).toEqual(copy);
  });

  it('is deterministic with same seed', () => {
    const a = ghostNotes(events, duration, { velocity: 0.3, probability: 0.5, seed: 42 });
    const b = ghostNotes(events, duration, { velocity: 0.3, probability: 0.5, seed: 42 });
    expect(a).toEqual(b);
  });

  it('probability=0 adds no ghosts', () => {
    const result = ghostNotes(events, duration, { velocity: 0.3, probability: 0, seed: 42 });
    expect(result.length).toBe(events.length);
  });

  it('does not add ghosts around quiet events', () => {
    const quietEvents: MusicalEvent[] = [trigger(0, { velocity: 0.2 }), trigger(4, { velocity: 0.2 })];
    const result = ghostNotes(quietEvents, duration, { velocity: 0.3, probability: 1.0, seed: 42 });
    // Source velocity (0.2) <= ghost velocity (0.3), so no ghosts should be added
    expect(result.length).toBe(quietEvents.length);
  });

  it('works with note events', () => {
    const notes: MusicalEvent[] = [note(0, { velocity: 0.9 }), note(4, { velocity: 0.9 })];
    const result = ghostNotes(notes, 8, { velocity: 0.3, probability: 1.0, seed: 42 });
    const ghostCount = result.filter(e => e.kind === 'note' && (e as NoteEvent).velocity === 0.3).length;
    expect(ghostCount).toBeGreaterThan(0);
  });

  it('output is sorted', () => {
    const result = ghostNotes(events, duration, { velocity: 0.3, probability: 1.0, seed: 42 });
    for (let i = 1; i < result.length; i++) {
      expect(result[i].at).toBeGreaterThanOrEqual(result[i - 1].at);
    }
  });

  it('output passes validatePattern', () => {
    const result = ghostNotes(events, duration, { velocity: 0.3, probability: 0.8, seed: 42 });
    const pattern = makePattern(result, duration);
    expect(validatePattern(pattern).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// swing
// ---------------------------------------------------------------------------

describe('swing', () => {
  const events: MusicalEvent[] = [
    trigger(0), trigger(1), trigger(2), trigger(3),
    trigger(4), trigger(5), trigger(6), trigger(7),
  ];
  const duration = 8;

  it('shifts odd-numbered steps forward', () => {
    const result = swing(events, duration, { amount: 1.0 });
    // Odd steps (1, 3, 5, 7) should be shifted by 0.5 * 1.0 = 0.5
    const step1 = result.find(e => Math.abs(e.at - 1.5) < 0.001);
    expect(step1).toBeDefined();
  });

  it('does not shift even-numbered steps', () => {
    const result = swing(events, duration, { amount: 1.0 });
    const evenSteps = result.filter(e => {
      const step = Math.round(e.at);
      return step % 2 === 0 && Math.abs(e.at - step) < 0.001;
    });
    expect(evenSteps.length).toBe(4); // steps 0, 2, 4, 6
  });

  it('amount=0 is no-op', () => {
    const result = swing(events, duration, { amount: 0 });
    for (let i = 0; i < events.length; i++) {
      expect(result[i].at).toBe(events[i].at);
    }
  });

  it('amount=0.5 shifts odd steps by 0.25', () => {
    const result = swing(events, duration, { amount: 0.5 });
    const step1 = result.find(e => Math.abs(e.at - 1.25) < 0.001);
    expect(step1).toBeDefined();
  });

  it('does not mutate input', () => {
    const copy = events.map(e => ({ ...e }));
    swing(events, duration, { amount: 0.5 });
    expect(events).toEqual(copy);
  });

  it('output is sorted', () => {
    const result = swing(events, duration, { amount: 0.7 });
    for (let i = 1; i < result.length; i++) {
      expect(result[i].at).toBeGreaterThanOrEqual(result[i - 1].at);
    }
  });

  it('does not shift off-grid events', () => {
    const offGrid: MusicalEvent[] = [trigger(1.3)]; // not on integer grid
    const result = swing(offGrid, duration, { amount: 1.0 });
    expect(result[0].at).toBe(1.3); // left untouched
  });

  it('output passes validatePattern', () => {
    const result = swing(events, duration, { amount: 0.6 });
    const pattern = makePattern(result, duration);
    expect(validatePattern(pattern).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// thin
// ---------------------------------------------------------------------------

describe('thin', () => {
  const events: MusicalEvent[] = [
    trigger(0), trigger(2), trigger(4), trigger(6),
    trigger(8), trigger(10), trigger(12), trigger(14),
  ];

  it('removes some events', () => {
    const result = thin(events, { probability: 0.5, seed: 42 });
    expect(result.length).toBeLessThan(events.length);
    expect(result.length).toBeGreaterThan(0);
  });

  it('probability=0 keeps all events', () => {
    const result = thin(events, { probability: 0, seed: 42 });
    expect(result.length).toBe(events.length);
  });

  it('always preserves at least one gate event', () => {
    const result = thin(events, { probability: 1.0, seed: 42 });
    const gates = result.filter(e => e.kind !== 'parameter');
    expect(gates.length).toBeGreaterThanOrEqual(1);
  });

  it('preserves parameter events', () => {
    const mixed: MusicalEvent[] = [trigger(0), param(2, 'cutoff', 0.5), trigger(4)];
    const result = thin(mixed, { probability: 0.99, seed: 42 });
    const params = result.filter(e => e.kind === 'parameter');
    expect(params.length).toBe(1);
  });

  it('does not mutate input', () => {
    const copy = events.map(e => ({ ...e }));
    thin(events, { probability: 0.5, seed: 42 });
    expect(events).toEqual(copy);
  });

  it('is deterministic with same seed', () => {
    const a = thin(events, { probability: 0.5, seed: 42 });
    const b = thin(events, { probability: 0.5, seed: 42 });
    expect(a).toEqual(b);
  });

  it('output is sorted', () => {
    const result = thin(events, { probability: 0.5, seed: 42 });
    for (let i = 1; i < result.length; i++) {
      expect(result[i].at).toBeGreaterThanOrEqual(result[i - 1].at);
    }
  });

  it('works on note events', () => {
    const notes: MusicalEvent[] = [note(0), note(4), note(8), note(12)];
    const result = thin(notes, { probability: 0.5, seed: 42 });
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const e of result) {
      expect(e.kind).toBe('note');
    }
  });
});

// ---------------------------------------------------------------------------
// densify
// ---------------------------------------------------------------------------

describe('densify', () => {
  const events: MusicalEvent[] = [trigger(0), trigger(8)];
  const duration = 16;

  it('adds events at empty positions', () => {
    const result = densify(events, duration, { probability: 1.0, seed: 42 });
    expect(result.length).toBeGreaterThan(events.length);
  });

  it('does not overwrite existing events', () => {
    const result = densify(events, duration, { probability: 1.0, seed: 42 });
    const atZero = result.filter(e => Math.round(e.at) === 0);
    expect(atZero.length).toBe(1);
  });

  it('probability=0 adds nothing', () => {
    const result = densify(events, duration, { probability: 0, seed: 42 });
    expect(result.length).toBe(events.length);
  });

  it('uses specified velocity', () => {
    const result = densify(events, duration, { probability: 1.0, velocity: 0.4, seed: 42 });
    const added = result.filter(e => (e as TriggerEvent).velocity === 0.4);
    expect(added.length).toBeGreaterThan(0);
  });

  it('matches predominant event kind (trigger)', () => {
    const result = densify(events, duration, { probability: 1.0, seed: 42 });
    for (const e of result) {
      expect(e.kind).toBe('trigger');
    }
  });

  it('matches predominant event kind (note)', () => {
    const noteEvents: MusicalEvent[] = [note(0, { pitch: 48 }), note(8, { pitch: 48 })];
    const result = densify(noteEvents, duration, { probability: 1.0, seed: 42 });
    for (const e of result) {
      expect(e.kind).toBe('note');
    }
  });

  it('uses most common pitch for note densification', () => {
    const noteEvents: MusicalEvent[] = [
      note(0, { pitch: 48 }),
      note(4, { pitch: 48 }),
      note(8, { pitch: 60 }),
    ];
    const result = densify(noteEvents, duration, { probability: 1.0, seed: 42 });
    const added = result.filter(e => !noteEvents.some(orig => orig.at === e.at));
    for (const e of added) {
      expect((e as NoteEvent).pitch).toBe(48);
    }
  });

  it('does not mutate input', () => {
    const copy = events.map(e => ({ ...e }));
    densify(events, duration, { probability: 0.5, seed: 42 });
    expect(events).toEqual(copy);
  });

  it('is deterministic with same seed', () => {
    const a = densify(events, duration, { probability: 0.5, seed: 42 });
    const b = densify(events, duration, { probability: 0.5, seed: 42 });
    expect(a).toEqual(b);
  });

  it('output is sorted', () => {
    const result = densify(events, duration, { probability: 0.5, seed: 42 });
    for (let i = 1; i < result.length; i++) {
      expect(result[i].at).toBeGreaterThanOrEqual(result[i - 1].at);
    }
  });

  it('output passes validatePattern', () => {
    const result = densify(events, duration, { probability: 0.8, seed: 42 });
    const pattern = makePattern(result, duration);
    expect(validatePattern(pattern).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Composition: helpers are composable
// ---------------------------------------------------------------------------

describe('composition', () => {
  it('euclidean -> humanize -> ghost_notes', () => {
    // Generate a euclidean rhythm
    const base = euclidean({ hits: 4, steps: 16, velocity: 0.9 });
    expect(base.length).toBe(4);

    // Humanize it
    const humanized = humanize(base, 16, { velocityAmount: 0.3, timingAmount: 0.1, seed: 42 });
    expect(humanized.length).toBe(4);

    // Add ghost notes — note: humanize may shift events off-grid,
    // but ghostNotes operates on rounded positions
    const withGhosts = ghostNotes(humanized, 16, { velocity: 0.3, probability: 0.8, seed: 99 });
    expect(withGhosts.length).toBeGreaterThanOrEqual(4);

    // All outputs should be valid patterns
    const pattern = makePattern(withGhosts, 16);
    expect(validatePattern(pattern).valid).toBe(true);
  });

  it('euclidean -> swing', () => {
    const base = euclidean({ hits: 8, steps: 16 });
    const swung = swing(base, 16, { amount: 0.6 });
    expect(swung.length).toBe(8);
    const pattern = makePattern(swung, 16);
    expect(validatePattern(pattern).valid).toBe(true);
  });

  it('densify -> thin preserves at least one event', () => {
    const sparse: MusicalEvent[] = [trigger(0)];
    const dense = densify(sparse, 16, { probability: 0.8, seed: 42 });
    const thinned = thin(dense, { probability: 0.7, seed: 99 });
    expect(thinned.length).toBeGreaterThanOrEqual(1);
  });
});
