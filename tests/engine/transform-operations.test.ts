import { describe, it, expect } from 'vitest';
import {
  rotateRegion,
  transposeRegion,
  reverseRegion,
  duplicateRegionEvents,
  humanizeRegion,
  euclideanRegion,
  ghostNotesRegion,
  swingRegion,
  thinRegion,
  densifyRegion,
} from '../../src/engine/transform-operations';
import type { Session, Track, PatternEditSnapshot } from '../../src/engine/types';
import type {
  MusicalEvent,
  NoteEvent,
  TriggerEvent,
  Pattern,
} from '../../src/engine/canonical-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function note(at: number, extra: Partial<NoteEvent> = {}): NoteEvent {
  return { kind: 'note', at, pitch: 60, velocity: 0.8, duration: 0.25, ...extra };
}

function trigger(at: number, extra: Partial<TriggerEvent> = {}): TriggerEvent {
  return { kind: 'trigger', at, ...extra };
}

function makePattern(events: MusicalEvent[] = [], duration = 16): Pattern {
  return { id: 'p1', kind: 'pattern', duration, events };
}

function makeTrack(events: MusicalEvent[] = [], duration = 16): Track {
  return {
    id: 'v1',
    engine: 'plaits',
    model: 0,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
    muted: false,
    solo: false,
    stepGrid: { steps: [], length: 16 },
    patterns: [makePattern(events, duration)],
    surface: { modules: [], thumbprint: { type: 'static-color' } },
  } as Track;
}

function makeSession(events: MusicalEvent[] = [], duration = 16): Session {
  return {
    tracks: [makeTrack(events, duration)],
    activeTrackId: 'v1',
    transport: { status: 'stopped', bpm: 120, swing: 0 },
    master: { volume: 0.8, pan: 0.0 },
    undoStack: [],
    redoStack: [],
    context: { key: null, scale: null, tempo: null, energy: 0.5, density: 0.5 },
    messages: [],
    recentHumanActions: [],
    liveControls: [],
    turnCount: 0,
  } as Session;
}

function getEvents(session: Session): MusicalEvent[] {
  return session.tracks[0].patterns[0].events;
}

function getDuration(session: Session): number {
  return session.tracks[0].patterns[0].duration;
}

function lastUndo(session: Session): PatternEditSnapshot {
  return session.undoStack[session.undoStack.length - 1] as PatternEditSnapshot;
}

// ---------------------------------------------------------------------------
// rotateRegion
// ---------------------------------------------------------------------------

describe('rotateRegion', () => {
  it('shifts event positions forward', () => {
    const session = makeSession([trigger(0), trigger(4), trigger(8)]);
    const result = rotateRegion(session, 'v1', 3);
    const ats = getEvents(result).map(e => e.at);
    expect(ats).toContain(3);
    expect(ats).toContain(7);
    expect(ats).toContain(11);
  });

  it('wraps events around at duration boundary', () => {
    const session = makeSession([trigger(14)], 16);
    const result = rotateRegion(session, 'v1', 4);
    const ats = getEvents(result).map(e => e.at);
    expect(ats[0]).toBe(2);
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession([trigger(0)]);
    const result = rotateRegion(session, 'v1', 2);
    expect(result.undoStack).toHaveLength(1);
    const snap = lastUndo(result);
    expect(snap.kind).toBe('pattern-edit');
    expect(snap.description).toContain('Rotate');
  });

  it('undo snapshot stores previous events', () => {
    const session = makeSession([trigger(0), trigger(4)]);
    const result = rotateRegion(session, 'v1', 3);
    const snap = lastUndo(result);
    expect(snap.prevEvents.map(e => e.at)).toEqual([0, 4]);
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession([trigger(0)]);
    session.tracks[0].patterns = [];
    const result = rotateRegion(session, 'v1', 2);
    expect(result).toBe(session);
  });

  it('works with empty events', () => {
    const session = makeSession([]);
    const result = rotateRegion(session, 'v1', 3);
    expect(getEvents(result)).toHaveLength(0);
    expect(result.undoStack).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// transposeRegion
// ---------------------------------------------------------------------------

describe('transposeRegion', () => {
  it('transposes all note events by semitones', () => {
    const session = makeSession([note(0, { pitch: 60 }), note(4, { pitch: 64 })]);
    const result = transposeRegion(session, 'v1', 5);
    const events = getEvents(result);
    expect((events[0] as NoteEvent).pitch).toBe(65);
    expect((events[1] as NoteEvent).pitch).toBe(69);
  });

  it('clamps at MIDI boundaries', () => {
    const session = makeSession([note(0, { pitch: 120 }), note(4, { pitch: 5 })]);
    const upResult = transposeRegion(session, 'v1', 20);
    expect((getEvents(upResult)[0] as NoteEvent).pitch).toBe(127);

    const downResult = transposeRegion(session, 'v1', -10);
    expect((getEvents(downResult)[1] as NoteEvent).pitch).toBe(0);
  });

  it('does not affect trigger events', () => {
    const session = makeSession([trigger(0, { velocity: 0.9 }), note(4, { pitch: 60 })]);
    const result = transposeRegion(session, 'v1', 7);
    expect(getEvents(result)[0].kind).toBe('trigger');
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession([note(0, { pitch: 60 })]);
    const result = transposeRegion(session, 'v1', 3);
    expect(result.undoStack).toHaveLength(1);
    expect(lastUndo(result).description).toContain('Transpose');
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession([note(0, { pitch: 60 })]);
    session.tracks[0].patterns = [];
    const result = transposeRegion(session, 'v1', 5);
    expect(result).toBe(session);
  });
});

// ---------------------------------------------------------------------------
// reverseRegion
// ---------------------------------------------------------------------------

describe('reverseRegion', () => {
  it('mirrors event positions within the region', () => {
    const session = makeSession([trigger(0), trigger(4), trigger(12)], 16);
    const result = reverseRegion(session, 'v1');
    const ats = getEvents(result).map(e => e.at);
    // at=0 maps to 0 (wrap), at=4 maps to 12, at=12 maps to 4
    expect(ats).toContain(0);
    expect(ats).toContain(4);
    expect(ats).toContain(12);
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession([trigger(2)]);
    const result = reverseRegion(session, 'v1');
    expect(result.undoStack).toHaveLength(1);
    expect(lastUndo(result).description).toContain('Reverse');
  });

  it('double-reverse restores original (involution)', () => {
    const events = [note(1, { pitch: 60 }), note(3, { pitch: 64 }), note(5, { pitch: 67 })];
    const session = makeSession(events, 8);
    const once = reverseRegion(session, 'v1');
    const twice = reverseRegion(once, 'v1');
    const originalAts = events.map(e => e.at).sort((a, b) => a - b);
    const resultAts = getEvents(twice).map(e => e.at).sort((a, b) => a - b);
    for (let i = 0; i < originalAts.length; i++) {
      expect(resultAts[i]).toBeCloseTo(originalAts[i], 5);
    }
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession([trigger(0)]);
    session.tracks[0].patterns = [];
    const result = reverseRegion(session, 'v1');
    expect(result).toBe(session);
  });
});

// ---------------------------------------------------------------------------
// duplicateRegionEvents
// ---------------------------------------------------------------------------

describe('duplicateRegionEvents', () => {
  it('doubles event count', () => {
    const session = makeSession([trigger(0), trigger(4)], 8);
    const result = duplicateRegionEvents(session, 'v1');
    expect(getEvents(result).length).toBe(4);
  });

  it('doubles duration', () => {
    const session = makeSession([trigger(0)], 8);
    const result = duplicateRegionEvents(session, 'v1');
    expect(getDuration(result)).toBe(16);
  });

  it('undo snapshot stores previous duration', () => {
    const session = makeSession([trigger(0)], 8);
    const result = duplicateRegionEvents(session, 'v1');
    const snap = lastUndo(result);
    expect(snap.prevDuration).toBe(8);
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession([trigger(0)], 8);
    const result = duplicateRegionEvents(session, 'v1');
    expect(result.undoStack).toHaveLength(1);
    expect(lastUndo(result).description).toContain('Duplicate');
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession([trigger(0)]);
    session.tracks[0].patterns = [];
    const result = duplicateRegionEvents(session, 'v1');
    expect(result).toBe(session);
  });

  it('works with empty events (doubles duration only)', () => {
    const session = makeSession([], 8);
    const result = duplicateRegionEvents(session, 'v1');
    expect(getEvents(result)).toHaveLength(0);
    expect(getDuration(result)).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// humanizeRegion
// ---------------------------------------------------------------------------

describe('humanizeRegion', () => {
  it('applies velocity jitter to events', () => {
    const events = Array.from({ length: 8 }, (_, i) => trigger(i * 2, { velocity: 0.8 }));
    const session = makeSession(events);
    const result = humanizeRegion(session, 'v1', { velocityAmount: 1.0, timingAmount: 0, seed: 42 });
    const velocities = getEvents(result).map(e => (e as TriggerEvent).velocity ?? 0.8);
    // At least some velocity should differ from 0.8
    const allSame = velocities.every(v => v === 0.8);
    expect(allSame).toBe(false);
  });

  it('applies timing jitter to events', () => {
    const events = [trigger(0), trigger(4), trigger(8)];
    const session = makeSession(events);
    const result = humanizeRegion(session, 'v1', { velocityAmount: 0, timingAmount: 1.0, seed: 42 });
    const ats = getEvents(result).map(e => e.at);
    // At least one position should differ from original
    const changed = ats.some((at, i) => Math.abs(at - events[i].at) > 0.0001);
    expect(changed).toBe(true);
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession([trigger(0)]);
    const result = humanizeRegion(session, 'v1', { velocityAmount: 0.5, timingAmount: 0.5, seed: 1 });
    expect(result.undoStack).toHaveLength(1);
    expect(lastUndo(result).description).toContain('Humanize');
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession([trigger(0)]);
    session.tracks[0].patterns = [];
    const result = humanizeRegion(session, 'v1', { velocityAmount: 0.5, timingAmount: 0.5 });
    expect(result).toBe(session);
  });

  it('is deterministic with the same seed', () => {
    const events = [trigger(0, { velocity: 0.8 }), trigger(4, { velocity: 0.8 })];
    const session = makeSession(events);
    const params = { velocityAmount: 0.5, timingAmount: 0.5, seed: 123 };
    const r1 = humanizeRegion(session, 'v1', params);
    const r2 = humanizeRegion(session, 'v1', params);
    expect(getEvents(r1)).toEqual(getEvents(r2));
  });
});

// ---------------------------------------------------------------------------
// euclideanRegion
// ---------------------------------------------------------------------------

describe('euclideanRegion', () => {
  it('generates correct number of hits', () => {
    const session = makeSession([trigger(0)]);
    const result = euclideanRegion(session, 'v1', { hits: 5, steps: 8 });
    const events = getEvents(result);
    expect(events).toHaveLength(5);
  });

  it('replaces existing events', () => {
    const session = makeSession([trigger(0), trigger(2), trigger(4), trigger(6)]);
    const result = euclideanRegion(session, 'v1', { hits: 3, steps: 8 });
    expect(getEvents(result)).toHaveLength(3);
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession([trigger(0)]);
    const result = euclideanRegion(session, 'v1', { hits: 4, steps: 16 });
    expect(result.undoStack).toHaveLength(1);
    expect(lastUndo(result).description).toContain('Euclidean');
  });

  it('generates empty pattern when hits is 0', () => {
    const session = makeSession([trigger(0)]);
    const result = euclideanRegion(session, 'v1', { hits: 0, steps: 8 });
    expect(getEvents(result)).toHaveLength(0);
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession([trigger(0)]);
    session.tracks[0].patterns = [];
    const result = euclideanRegion(session, 'v1', { hits: 4, steps: 8 });
    expect(result).toBe(session);
  });

  it('respects rotation parameter', () => {
    const session = makeSession([]);
    const noRot = euclideanRegion(session, 'v1', { hits: 3, steps: 8, rotation: 0 });
    const withRot = euclideanRegion(session, 'v1', { hits: 3, steps: 8, rotation: 2 });
    const noRotAts = getEvents(noRot).map(e => e.at);
    const withRotAts = getEvents(withRot).map(e => e.at);
    expect(noRotAts).not.toEqual(withRotAts);
  });
});

// ---------------------------------------------------------------------------
// ghostNotesRegion
// ---------------------------------------------------------------------------

describe('ghostNotesRegion', () => {
  it('adds ghost notes around existing events', () => {
    const events = [trigger(0, { velocity: 0.9 }), trigger(4, { velocity: 0.9 })];
    const session = makeSession(events, 16);
    const result = ghostNotesRegion(session, 'v1', { velocity: 0.3, probability: 1.0, seed: 42 });
    // Should have more events than original
    expect(getEvents(result).length).toBeGreaterThan(2);
  });

  it('ghost notes have lower velocity', () => {
    const events = [trigger(4, { velocity: 0.9 })];
    const session = makeSession(events, 16);
    const result = ghostNotesRegion(session, 'v1', { velocity: 0.2, probability: 1.0, seed: 42 });
    const ghosts = getEvents(result).filter(e => (e as TriggerEvent).velocity === 0.2);
    expect(ghosts.length).toBeGreaterThan(0);
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession([trigger(0, { velocity: 0.9 })], 16);
    const result = ghostNotesRegion(session, 'v1', { velocity: 0.3, probability: 1.0, seed: 1 });
    expect(result.undoStack).toHaveLength(1);
    expect(lastUndo(result).description).toContain('Ghost');
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession([trigger(0)]);
    session.tracks[0].patterns = [];
    const result = ghostNotesRegion(session, 'v1', {});
    expect(result).toBe(session);
  });
});

// ---------------------------------------------------------------------------
// swingRegion
// ---------------------------------------------------------------------------

describe('swingRegion', () => {
  it('shifts odd-step events later', () => {
    const events = [trigger(0), trigger(1), trigger(2), trigger(3)];
    const session = makeSession(events, 8);
    const result = swingRegion(session, 'v1', { amount: 1.0 });
    const ats = getEvents(result).map(e => e.at);
    // Steps 1 and 3 (odd) should be shifted by 0.5
    expect(ats[0]).toBe(0);
    expect(ats[1]).toBeCloseTo(1.5, 5);
    expect(ats[2]).toBe(2);
    expect(ats[3]).toBeCloseTo(3.5, 5);
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession([trigger(1)], 8);
    const result = swingRegion(session, 'v1', { amount: 0.5 });
    expect(result.undoStack).toHaveLength(1);
    expect(lastUndo(result).description).toContain('Swing');
  });

  it('no-op with amount=0 still pushes undo', () => {
    const session = makeSession([trigger(1)], 8);
    const result = swingRegion(session, 'v1', { amount: 0 });
    // Even with amount=0, applyTransform is still called
    expect(result.undoStack).toHaveLength(1);
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession([trigger(0)]);
    session.tracks[0].patterns = [];
    const result = swingRegion(session, 'v1', { amount: 0.5 });
    expect(result).toBe(session);
  });
});

// ---------------------------------------------------------------------------
// thinRegion
// ---------------------------------------------------------------------------

describe('thinRegion', () => {
  it('removes some events probabilistically', () => {
    const events = Array.from({ length: 8 }, (_, i) => trigger(i * 2));
    const session = makeSession(events);
    const result = thinRegion(session, 'v1', { probability: 0.5, seed: 42 });
    const resultEvents = getEvents(result);
    expect(resultEvents.length).toBeLessThan(8);
    expect(resultEvents.length).toBeGreaterThan(0);
  });

  it('preserves at least one event', () => {
    const events = [trigger(0), trigger(4)];
    const session = makeSession(events);
    const result = thinRegion(session, 'v1', { probability: 0.99, seed: 42 });
    const gateEvents = getEvents(result).filter(e => e.kind !== 'parameter');
    expect(gateEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession([trigger(0), trigger(4)]);
    const result = thinRegion(session, 'v1', { probability: 0.5, seed: 1 });
    expect(result.undoStack).toHaveLength(1);
    expect(lastUndo(result).description).toContain('Thin');
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession([trigger(0)]);
    session.tracks[0].patterns = [];
    const result = thinRegion(session, 'v1', { probability: 0.5 });
    expect(result).toBe(session);
  });
});

// ---------------------------------------------------------------------------
// densifyRegion
// ---------------------------------------------------------------------------

describe('densifyRegion', () => {
  it('adds events at empty step positions', () => {
    const events = [trigger(0), trigger(4)];
    const session = makeSession(events, 8);
    const result = densifyRegion(session, 'v1', { probability: 1.0, seed: 42 });
    expect(getEvents(result).length).toBeGreaterThan(2);
  });

  it('does not add events at already-occupied positions', () => {
    const events = Array.from({ length: 8 }, (_, i) => trigger(i));
    const session = makeSession(events, 8);
    const result = densifyRegion(session, 'v1', { probability: 1.0, seed: 42 });
    // All 8 positions are occupied, nothing to add
    expect(getEvents(result)).toHaveLength(8);
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession([trigger(0)], 8);
    const result = densifyRegion(session, 'v1', { probability: 0.5, seed: 1 });
    expect(result.undoStack).toHaveLength(1);
    expect(lastUndo(result).description).toContain('Densify');
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession([trigger(0)]);
    session.tracks[0].patterns = [];
    const result = densifyRegion(session, 'v1', { probability: 1.0 });
    expect(result).toBe(session);
  });
});

// ---------------------------------------------------------------------------
// Combined transforms
// ---------------------------------------------------------------------------

describe('combined transforms', () => {
  it('rotate + transpose + humanize produces valid output', () => {
    const events = [note(0, { pitch: 60 }), note(4, { pitch: 64 }), note(8, { pitch: 67 })];
    let session = makeSession(events, 16);

    session = rotateRegion(session, 'v1', 4);
    session = transposeRegion(session, 'v1', 3);
    session = humanizeRegion(session, 'v1', { velocityAmount: 0.3, timingAmount: 0.2, seed: 99 });

    // Should have 3 undo entries
    expect(session.undoStack).toHaveLength(3);

    // Events should still be valid
    const resultEvents = getEvents(session);
    expect(resultEvents).toHaveLength(3);
    for (const e of resultEvents) {
      expect(e.at).toBeGreaterThanOrEqual(0);
      expect(e.at).toBeLessThan(16);
      if (e.kind === 'note') {
        expect((e as NoteEvent).pitch).toBeGreaterThanOrEqual(0);
        expect((e as NoteEvent).pitch).toBeLessThanOrEqual(127);
      }
    }
  });

  it('all transforms always push undo', () => {
    let session = makeSession([trigger(0, { velocity: 0.8 }), trigger(4, { velocity: 0.8 })], 8);
    session = rotateRegion(session, 'v1', 1);
    session = reverseRegion(session, 'v1');
    session = duplicateRegionEvents(session, 'v1');
    session = swingRegion(session, 'v1', { amount: 0.5 });
    session = thinRegion(session, 'v1', { probability: 0.3, seed: 1 });
    session = densifyRegion(session, 'v1', { probability: 0.3, seed: 1 });
    session = ghostNotesRegion(session, 'v1', { probability: 0.5, seed: 1 });
    session = humanizeRegion(session, 'v1', { velocityAmount: 0.2, timingAmount: 0.1, seed: 1 });

    expect(session.undoStack).toHaveLength(8);
  });
});
