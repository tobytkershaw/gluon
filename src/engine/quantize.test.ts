import { describe, it, expect } from 'vitest';
import { quantizeRegion } from './pattern-primitives';
import { microTimingOffset } from './micro-timing';
import type { Session } from './types';
import type { TriggerEvent, NoteEvent, ParameterEvent, Pattern } from './canonical-types';

// --- Minimal session factory ---

function makeSession(events: (TriggerEvent | NoteEvent | ParameterEvent)[], duration = 16): Session {
  const pattern: Pattern = {
    id: 'track-1-pattern-0',
    kind: 'pattern',
    duration,
    events: [...events],
  };
  return {
    tracks: [{
      id: 'track-1',
      engine: 'plaits',
      model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      stepGrid: { steps: [], length: duration },
      patterns: [pattern],
      sequence: [{ patternId: pattern.id }],
      muted: false,
      solo: false,
      surface: {
        modules: [],
        thumbprint: { type: 'static-color' },
      },
    }],
    activeTrackId: 'track-1',
    transport: { status: 'stopped', bpm: 120, swing: 0, metronome: { enabled: false, volume: 0.5 }, timeSignature: { numerator: 4, denominator: 4 } },
    master: { volume: 0.8, pan: 0 },
    undoStack: [],
    redoStack: [],
    context: { key: null, scale: null, tempo: null, energy: 0.5, density: 0.5 },
    messages: [],
    recentHumanActions: [],
  } as Session;
}

// --- quantizeRegion ---

describe('quantizeRegion', () => {
  it('snaps off-grid events to nearest sixteenth-note grid position', () => {
    const events = [
      { kind: 'trigger' as const, at: 0.3, velocity: 0.8 },
      { kind: 'trigger' as const, at: 3.7, velocity: 0.8 },
    ];
    const result = quantizeRegion(makeSession(events), 'track-1');
    const track = result.tracks[0];
    expect(track.patterns[0].events.map(e => e.at)).toEqual([0.25, 3.75]);
  });

  it('preserves on-grid events exactly', () => {
    const events = [
      { kind: 'trigger' as const, at: 4, velocity: 0.8 },
      { kind: 'trigger' as const, at: 8, velocity: 0.8 },
    ];
    const result = quantizeRegion(makeSession(events), 'track-1');
    const track = result.tracks[0];
    expect(track.patterns[0].events.map(e => e.at)).toEqual([4, 8]);
  });

  it('clamps events that would snap to >= region duration', () => {
    const events = [
      { kind: 'trigger' as const, at: 15.9, velocity: 0.8 },
    ];
    const result = quantizeRegion(makeSession(events), 'track-1');
    const track = result.tracks[0];
    // Should snap to 15.75 (nearest grid) not 16.0 (out of range)
    expect(track.patterns[0].events[0].at).toBeLessThan(16);
    expect(track.patterns[0].events[0].at).toBe(15.75);
  });

  it('pushes an undo snapshot (PatternEditSnapshot)', () => {
    const events = [{ kind: 'trigger' as const, at: 0.1, velocity: 0.8 }];
    const session = makeSession(events);
    const result = quantizeRegion(session, 'track-1');
    expect(result.undoStack).toHaveLength(1);
    expect(result.undoStack[0].kind).toBe('pattern-edit');
  });

  it('returns session unchanged when no regions exist', () => {
    const session = makeSession([]);
    // Remove all patterns
    const noPatterns = {
      ...session,
      tracks: session.tracks.map(t => ({ ...t, patterns: [] })),
    };
    const result = quantizeRegion(noPatterns as Session, 'track-1');
    expect(result).toBe(noPatterns);
  });

  it('returns session unchanged when region has no events', () => {
    const session = makeSession([]);
    const result = quantizeRegion(session, 'track-1');
    expect(result).toBe(session);
  });

  it('works with a custom grid size (eighth notes)', () => {
    const events = [{ kind: 'trigger' as const, at: 1.3, velocity: 0.8 }];
    const result = quantizeRegion(makeSession(events), 'track-1', 0.5);
    const track = result.tracks[0];
    expect(track.patterns[0].events[0].at).toBe(1.5);
  });

  it('quantizes note and parameter events too', () => {
    const events = [
      { kind: 'note' as const, at: 2.1, pitch: 60, velocity: 0.8, duration: 1 },
      { kind: 'parameter' as const, at: 6.4, controlId: 'timbre', value: 0.7 },
    ];
    const result = quantizeRegion(makeSession(events), 'track-1');
    const track = result.tracks[0];
    expect(track.patterns[0].events[0].at).toBe(2.0);
    expect(track.patterns[0].events[1].at).toBe(6.5);
  });
});

// --- microTimingOffset ---

describe('microTimingOffset', () => {
  it('returns null for on-grid events', () => {
    expect(microTimingOffset(4.0, 0.25)).toBeNull();
    expect(microTimingOffset(0.0, 0.25)).toBeNull();
  });

  it('returns positive offset for events ahead of grid', () => {
    const offset = microTimingOffset(4.1, 0.25);
    expect(offset).not.toBeNull();
    expect(offset!).toBeCloseTo(0.1, 5);
  });

  it('returns negative offset for events behind grid', () => {
    const offset = microTimingOffset(3.9, 0.25);
    expect(offset).not.toBeNull();
    expect(offset!).toBeCloseTo(-0.1, 5);
  });

  it('works with custom grid size', () => {
    const offset = microTimingOffset(1.3, 0.5);
    expect(offset).not.toBeNull();
    expect(offset!).toBeCloseTo(-0.2);
  });
});
