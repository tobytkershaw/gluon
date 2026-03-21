import { describe, it, expect } from 'vitest';
import {
  addEvent,
  removeEvent,
  updateEvent,
  removeEventsByIndices,
  transposeEventsByIndices,
  addEvents,
  selectorFromEvent,
} from '../../src/engine/event-primitives';
import type { Session, Track, PatternEditSnapshot } from '../../src/engine/types';
import type {
  MusicalEvent,
  NoteEvent,
  TriggerEvent,
  ParameterEvent,
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

function param(at: number, controlId: string, value: number): ParameterEvent {
  return { kind: 'parameter', at, controlId, value };
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

function lastUndo(session: Session): PatternEditSnapshot {
  return session.undoStack[session.undoStack.length - 1] as PatternEditSnapshot;
}

// ---------------------------------------------------------------------------
// selectorFromEvent
// ---------------------------------------------------------------------------

describe('selectorFromEvent', () => {
  it('builds a trigger selector', () => {
    const sel = selectorFromEvent(trigger(2));
    expect(sel).toEqual({ at: 2, kind: 'trigger' });
  });

  it('builds a note selector with pitch', () => {
    const sel = selectorFromEvent(note(1, { pitch: 72 }));
    expect(sel).toEqual({ at: 1, kind: 'note', pitch: 72 });
  });

  it('builds a parameter selector with controlId', () => {
    const sel = selectorFromEvent(param(3, 'filter', 0.5));
    expect(sel).toEqual({ at: 3, kind: 'parameter', controlId: 'filter' });
  });
});

// ---------------------------------------------------------------------------
// addEvent
// ---------------------------------------------------------------------------

describe('addEvent', () => {
  it('adds an event to an empty pattern', () => {
    const session = makeSession();
    const result = addEvent(session, 'v1', trigger(0));
    expect(getEvents(result)).toHaveLength(1);
    expect(getEvents(result)[0].at).toBe(0);
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession();
    const result = addEvent(session, 'v1', trigger(4));
    expect(result.undoStack).toHaveLength(1);
    const snap = lastUndo(result);
    expect(snap.kind).toBe('pattern-edit');
    expect(snap.prevEvents).toEqual([]);
    expect(snap.description).toContain('Add');
  });

  it('preserves existing events', () => {
    const session = makeSession([trigger(0), trigger(4)]);
    const result = addEvent(session, 'v1', trigger(8));
    expect(getEvents(result)).toHaveLength(3);
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession();
    session.tracks[0].patterns = [];
    const result = addEvent(session, 'v1', trigger(0));
    expect(result).toBe(session);
  });

  it('normalizes events after adding (sorts by at)', () => {
    const session = makeSession([trigger(4), trigger(8)]);
    const result = addEvent(session, 'v1', trigger(2));
    const ats = getEvents(result).map(e => e.at);
    for (let i = 1; i < ats.length; i++) {
      expect(ats[i]).toBeGreaterThanOrEqual(ats[i - 1]);
    }
  });

  it('adds note events preserving polyphony', () => {
    const session = makeSession([note(0, { pitch: 60 })]);
    const result = addEvent(session, 'v1', note(0, { pitch: 64 }));
    const events = getEvents(result);
    // Both notes at position 0 with different pitches should coexist
    const notesAtZero = events.filter(e => e.at === 0 && e.kind === 'note');
    expect(notesAtZero.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// removeEvent
// ---------------------------------------------------------------------------

describe('removeEvent', () => {
  it('removes a trigger by selector', () => {
    const session = makeSession([trigger(0), trigger(4), trigger(8)]);
    const result = removeEvent(session, 'v1', { at: 4, kind: 'trigger' });
    expect(getEvents(result)).toHaveLength(2);
    expect(getEvents(result).some(e => e.at === 4)).toBe(false);
  });

  it('removes a note by (at, pitch) selector', () => {
    const session = makeSession([note(0, { pitch: 60 }), note(0, { pitch: 64 })]);
    const result = removeEvent(session, 'v1', { at: 0, kind: 'note', pitch: 60 });
    const events = getEvents(result);
    expect(events).toHaveLength(1);
    expect((events[0] as NoteEvent).pitch).toBe(64);
  });

  it('removes a parameter by (at, controlId) selector', () => {
    const session = makeSession([param(2, 'filter', 0.5), param(2, 'resonance', 0.3)]);
    const result = removeEvent(session, 'v1', { at: 2, kind: 'parameter', controlId: 'filter' });
    const events = getEvents(result);
    expect(events).toHaveLength(1);
    expect((events[0] as ParameterEvent).controlId).toBe('resonance');
  });

  it('pushes an undo snapshot on removal', () => {
    const session = makeSession([trigger(0)]);
    const result = removeEvent(session, 'v1', { at: 0, kind: 'trigger' });
    expect(result.undoStack).toHaveLength(1);
    expect(lastUndo(result).prevEvents).toHaveLength(1);
  });

  it('returns session unchanged when selector does not match', () => {
    const session = makeSession([trigger(0)]);
    const result = removeEvent(session, 'v1', { at: 5, kind: 'trigger' });
    expect(result).toBe(session);
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession([trigger(0)]);
    session.tracks[0].patterns = [];
    const result = removeEvent(session, 'v1', { at: 0, kind: 'trigger' });
    expect(result).toBe(session);
  });

  it('uses position tolerance for matching', () => {
    const session = makeSession([trigger(4.0005)]);
    // Selector at 4.0 should still match (within 0.001 tolerance)
    const result = removeEvent(session, 'v1', { at: 4.0, kind: 'trigger' });
    expect(getEvents(result)).toHaveLength(0);
  });

  it('does NOT match when outside position tolerance', () => {
    const session = makeSession([trigger(4.002)]);
    // Selector at 4.0 should NOT match (beyond 0.001 tolerance)
    const result = removeEvent(session, 'v1', { at: 4.0, kind: 'trigger' });
    expect(result).toBe(session);
  });
});

// ---------------------------------------------------------------------------
// updateEvent
// ---------------------------------------------------------------------------

describe('updateEvent', () => {
  it('updates fields on a matching note event', () => {
    const session = makeSession([note(2, { pitch: 60, velocity: 0.8 })]);
    const result = updateEvent(
      session,
      'v1',
      { at: 2, kind: 'note', pitch: 60 },
      { velocity: 0.5 },
    );
    const events = getEvents(result);
    expect((events[0] as NoteEvent).velocity).toBe(0.5);
    expect((events[0] as NoteEvent).pitch).toBe(60);
  });

  it('updates a trigger event velocity', () => {
    const session = makeSession([trigger(0, { velocity: 0.9 })]);
    const result = updateEvent(
      session,
      'v1',
      { at: 0, kind: 'trigger' },
      { velocity: 0.4 },
    );
    const events = getEvents(result);
    expect((events[0] as TriggerEvent).velocity).toBe(0.4);
  });

  it('updates a parameter event value', () => {
    const session = makeSession([param(1, 'filter', 0.5)]);
    const result = updateEvent(
      session,
      'v1',
      { at: 1, kind: 'parameter', controlId: 'filter' },
      { value: 0.9 },
    );
    const events = getEvents(result);
    expect((events[0] as ParameterEvent).value).toBe(0.9);
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession([trigger(0)]);
    const result = updateEvent(session, 'v1', { at: 0, kind: 'trigger' }, { velocity: 0.3 });
    expect(result.undoStack).toHaveLength(1);
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession([trigger(0)]);
    session.tracks[0].patterns = [];
    const result = updateEvent(session, 'v1', { at: 0, kind: 'trigger' }, { velocity: 0.3 });
    expect(result).toBe(session);
  });
});

// ---------------------------------------------------------------------------
// removeEventsByIndices
// ---------------------------------------------------------------------------

describe('removeEventsByIndices', () => {
  it('removes events at specified indices', () => {
    const session = makeSession([trigger(0), trigger(2), trigger(4), trigger(6)]);
    const result = removeEventsByIndices(session, 'v1', [1, 3]);
    const events = getEvents(result);
    expect(events).toHaveLength(2);
    expect(events.map(e => e.at)).toEqual([0, 4]);
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession([trigger(0), trigger(2)]);
    const result = removeEventsByIndices(session, 'v1', [0]);
    expect(result.undoStack).toHaveLength(1);
    expect(lastUndo(result).description).toContain('Delete');
  });

  it('returns session unchanged when no indices match', () => {
    const session = makeSession([trigger(0)]);
    const result = removeEventsByIndices(session, 'v1', [5, 10]);
    expect(result).toBe(session);
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession([trigger(0)]);
    session.tracks[0].patterns = [];
    const result = removeEventsByIndices(session, 'v1', [0]);
    expect(result).toBe(session);
  });

  it('handles empty indices array', () => {
    const session = makeSession([trigger(0), trigger(2)]);
    const result = removeEventsByIndices(session, 'v1', []);
    // Empty indices removes nothing, but applyEventEdit still runs (events.length unchanged → returns session)
    expect(result).toBe(session);
  });
});

// ---------------------------------------------------------------------------
// transposeEventsByIndices
// ---------------------------------------------------------------------------

describe('transposeEventsByIndices', () => {
  it('transposes note events by semitones', () => {
    const session = makeSession([note(0, { pitch: 60 }), note(2, { pitch: 64 })]);
    const result = transposeEventsByIndices(session, 'v1', [0, 1], 5);
    const events = getEvents(result);
    expect((events[0] as NoteEvent).pitch).toBe(65);
    expect((events[1] as NoteEvent).pitch).toBe(69);
  });

  it('clamps pitch at MIDI upper boundary 127', () => {
    const session = makeSession([note(0, { pitch: 120 })]);
    const result = transposeEventsByIndices(session, 'v1', [0], 20);
    expect((getEvents(result)[0] as NoteEvent).pitch).toBe(127);
  });

  it('clamps pitch at MIDI lower boundary 0', () => {
    const session = makeSession([note(0, { pitch: 5 })]);
    const result = transposeEventsByIndices(session, 'v1', [0], -10);
    expect((getEvents(result)[0] as NoteEvent).pitch).toBe(0);
  });

  it('skips non-note events at specified indices', () => {
    const session = makeSession([trigger(0), note(2, { pitch: 60 })]);
    const result = transposeEventsByIndices(session, 'v1', [0, 1], 5);
    const events = getEvents(result);
    expect(events[0].kind).toBe('trigger');
    expect((events[1] as NoteEvent).pitch).toBe(65);
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession([note(0, { pitch: 60 })]);
    const result = transposeEventsByIndices(session, 'v1', [0], 3);
    expect(result.undoStack).toHaveLength(1);
    expect(lastUndo(result).description).toContain('Transpose');
  });

  it('returns session unchanged when semitones is 0', () => {
    const session = makeSession([note(0, { pitch: 60 })]);
    const result = transposeEventsByIndices(session, 'v1', [0], 0);
    expect(result).toBe(session);
  });

  it('returns session unchanged when indices array is empty', () => {
    const session = makeSession([note(0, { pitch: 60 })]);
    const result = transposeEventsByIndices(session, 'v1', [], 5);
    expect(result).toBe(session);
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession([note(0, { pitch: 60 })]);
    session.tracks[0].patterns = [];
    const result = transposeEventsByIndices(session, 'v1', [0], 5);
    expect(result).toBe(session);
  });

  it('returns session unchanged when pitch does not actually change (already at boundary)', () => {
    const session = makeSession([note(0, { pitch: 127 })]);
    const result = transposeEventsByIndices(session, 'v1', [0], 10);
    // Pitch clamps to 127, which is the same as current — no change
    expect(result).toBe(session);
  });

  it('only transposes events at specified indices', () => {
    const session = makeSession([note(0, { pitch: 60 }), note(2, { pitch: 60 }), note(4, { pitch: 60 })]);
    const result = transposeEventsByIndices(session, 'v1', [0, 2], 7);
    const events = getEvents(result);
    expect((events[0] as NoteEvent).pitch).toBe(67);
    expect((events[1] as NoteEvent).pitch).toBe(60); // untouched
    expect((events[2] as NoteEvent).pitch).toBe(67);
  });
});

// ---------------------------------------------------------------------------
// addEvents (paste)
// ---------------------------------------------------------------------------

describe('addEvents', () => {
  it('adds multiple events at once', () => {
    const session = makeSession([trigger(0)]);
    const result = addEvents(session, 'v1', [trigger(4), trigger(8)]);
    expect(getEvents(result)).toHaveLength(3);
  });

  it('pushes an undo snapshot', () => {
    const session = makeSession();
    const result = addEvents(session, 'v1', [trigger(0), trigger(4)]);
    expect(result.undoStack).toHaveLength(1);
    expect(lastUndo(result).description).toContain('Paste');
  });

  it('returns session unchanged when newEvents is empty', () => {
    const session = makeSession([trigger(0)]);
    const result = addEvents(session, 'v1', []);
    expect(result).toBe(session);
  });

  it('returns session unchanged when track has no patterns', () => {
    const session = makeSession();
    session.tracks[0].patterns = [];
    const result = addEvents(session, 'v1', [trigger(0)]);
    expect(result).toBe(session);
  });

  it('normalizes after paste (events sorted by at)', () => {
    const session = makeSession([trigger(8)]);
    const result = addEvents(session, 'v1', [trigger(2), trigger(12)]);
    const ats = getEvents(result).map(e => e.at);
    for (let i = 1; i < ats.length; i++) {
      expect(ats[i]).toBeGreaterThanOrEqual(ats[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// Undo snapshot contracts
// ---------------------------------------------------------------------------

describe('undo snapshot contracts', () => {
  it('snapshot stores previous events, not new events', () => {
    const original = [trigger(0), trigger(4)];
    const session = makeSession(original);
    const result = addEvent(session, 'v1', trigger(8));
    const snap = lastUndo(result);
    expect(snap.prevEvents).toHaveLength(2);
    expect(snap.prevEvents.map(e => e.at)).toEqual([0, 4]);
  });

  it('snapshot includes trackId and patternId', () => {
    const session = makeSession([trigger(0)]);
    const result = removeEvent(session, 'v1', { at: 0, kind: 'trigger' });
    const snap = lastUndo(result);
    expect(snap.trackId).toBe('v1');
    expect(snap.patternId).toBe('p1');
  });

  it('snapshot includes a timestamp', () => {
    const before = Date.now();
    const session = makeSession();
    const result = addEvent(session, 'v1', trigger(0));
    const after = Date.now();
    const snap = lastUndo(result);
    expect(snap.timestamp).toBeGreaterThanOrEqual(before);
    expect(snap.timestamp).toBeLessThanOrEqual(after);
  });

  it('each operation pushes exactly one undo entry', () => {
    let session = makeSession();
    session = addEvent(session, 'v1', trigger(0));
    expect(session.undoStack).toHaveLength(1);
    session = addEvent(session, 'v1', trigger(4));
    expect(session.undoStack).toHaveLength(2);
    session = removeEvent(session, 'v1', { at: 0, kind: 'trigger' });
    expect(session.undoStack).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('empty pattern operations work correctly', () => {
    const session = makeSession([]);
    // Remove from empty pattern — nothing to remove
    const r1 = removeEvent(session, 'v1', { at: 0, kind: 'trigger' });
    expect(r1).toBe(session);

    // Add to empty pattern works
    const r2 = addEvent(session, 'v1', trigger(0));
    expect(getEvents(r2)).toHaveLength(1);
  });

  it('operations with floating-point positions near tolerance boundary', () => {
    // Event at 4.0005, selector at 4.0 — should match (within 0.001)
    const session = makeSession([note(4.0005, { pitch: 60 })]);
    const result = updateEvent(
      session,
      'v1',
      { at: 4.0, kind: 'note', pitch: 60 },
      { velocity: 0.3 },
    );
    expect(result.undoStack).toHaveLength(1);
    expect((getEvents(result)[0] as NoteEvent).velocity).toBe(0.3);
  });
});
