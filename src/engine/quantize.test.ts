import { describe, it, expect } from 'vitest';
import { quantizeRegion } from './pattern-primitives';
import { microTimingOffset } from './micro-timing';
import type { Session } from './types';
import type { TriggerEvent, NoteEvent, ParameterEvent, Region } from './canonical-types';

// --- Minimal session factory ---

function makeSession(events: (TriggerEvent | NoteEvent | ParameterEvent)[], duration = 16): Session {
  const region: Region = {
    id: 'track-1-region-0',
    kind: 'pattern',
    start: 0,
    duration,
    loop: true,
    events: [...events],
  };
  return {
    tracks: [{
      id: 'track-1',
      engine: 'plaits',
      model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'OFF',
      pattern: { steps: [], length: duration },
      regions: [region],
      muted: false,
      solo: false,
      surface: {
        semanticControls: [],
        pinnedControls: [],
        xyAxes: { x: 'timbre', y: 'morph' },
        thumbprint: { type: 'static-color' },
      },
    }],
    activeTrackId: 'track-1',
    transport: { bpm: 120, swing: 0, playing: false },
    master: { volume: 0.8, pan: 0 },
    undoStack: [],
    context: { key: null, scale: null, tempo: null, energy: 0.5, density: 0.5 },
    messages: [],
    recentHumanActions: [],
  } as Session;
}

// --- quantizeRegion tests ---

describe('quantizeRegion', () => {
  it('snaps off-grid events to nearest sixteenth-note grid position', () => {
    const events: TriggerEvent[] = [
      { kind: 'trigger', at: 0.12, velocity: 0.8 },
      { kind: 'trigger', at: 2.37, velocity: 0.8 },
    ];
    const session = makeSession(events);
    const result = quantizeRegion(session, 'track-1');
    const resultEvents = result.tracks[0].regions[0].events;

    expect(resultEvents[0].at).toBeCloseTo(0.0);
    expect(resultEvents[1].at).toBeCloseTo(2.25);
  });

  it('preserves on-grid events exactly', () => {
    const events: TriggerEvent[] = [
      { kind: 'trigger', at: 0.0, velocity: 0.8 },
      { kind: 'trigger', at: 4.0, velocity: 0.8 },
      { kind: 'trigger', at: 8.25, velocity: 0.8 },
    ];
    const session = makeSession(events);
    const result = quantizeRegion(session, 'track-1');
    const resultEvents = result.tracks[0].regions[0].events;

    expect(resultEvents[0].at).toBeCloseTo(0.0);
    expect(resultEvents[1].at).toBeCloseTo(4.0);
    expect(resultEvents[2].at).toBeCloseTo(8.25);
  });

  it('clamps events that would snap to >= region duration', () => {
    const events: TriggerEvent[] = [
      { kind: 'trigger', at: 15.9, velocity: 0.8 },
    ];
    const session = makeSession(events, 16);
    const result = quantizeRegion(session, 'track-1');
    const resultEvents = result.tracks[0].regions[0].events;

    // 15.9 rounds to 16.0 which is >= duration, so should clamp to 15.75
    expect(resultEvents[0].at).toBeCloseTo(15.75);
  });

  it('pushes an undo snapshot (RegionSnapshot)', () => {
    const events: TriggerEvent[] = [
      { kind: 'trigger', at: 0.12, velocity: 0.8 },
    ];
    const session = makeSession(events);
    expect(session.undoStack.length).toBe(0);

    const result = quantizeRegion(session, 'track-1');
    expect(result.undoStack.length).toBe(1);
    expect(result.undoStack[0].kind).toBe('region');
  });

  it('returns session unchanged when no regions exist', () => {
    const session = makeSession([]);
    session.tracks[0].regions = [];
    const result = quantizeRegion(session, 'track-1');
    expect(result).toBe(session);
  });

  it('returns session unchanged when region has no events', () => {
    const session = makeSession([]);
    const result = quantizeRegion(session, 'track-1');
    expect(result).toBe(session);
  });

  it('works with a custom grid size (eighth notes)', () => {
    const events: TriggerEvent[] = [
      { kind: 'trigger', at: 0.3, velocity: 0.8 },
      { kind: 'trigger', at: 1.8, velocity: 0.8 },
    ];
    const session = makeSession(events);
    const result = quantizeRegion(session, 'track-1', 0.5);
    const resultEvents = result.tracks[0].regions[0].events;

    expect(resultEvents[0].at).toBeCloseTo(0.5);
    expect(resultEvents[1].at).toBeCloseTo(2.0);
  });

  it('quantizes note and parameter events too', () => {
    const events: (NoteEvent | ParameterEvent)[] = [
      { kind: 'note', at: 1.13, pitch: 60, velocity: 0.8, duration: 0.5 },
      { kind: 'parameter', at: 3.87, controlId: 'brightness', value: 0.7 },
    ];
    const session = makeSession(events);
    const result = quantizeRegion(session, 'track-1');
    const resultEvents = result.tracks[0].regions[0].events;

    expect(resultEvents[0].at).toBeCloseTo(1.25); // 1.13 / 0.25 = 4.52, rounds to 5 -> 1.25
    expect(resultEvents[1].at).toBeCloseTo(3.75); // 3.87 / 0.25 = 15.48, rounds to 15 -> 3.75
  });
});

// --- microTimingOffset tests ---

describe('microTimingOffset', () => {
  it('returns null for on-grid events', () => {
    expect(microTimingOffset(0.0)).toBeNull();
    expect(microTimingOffset(0.25)).toBeNull();
    expect(microTimingOffset(4.0)).toBeNull();
    expect(microTimingOffset(8.75)).toBeNull();
  });

  it('returns positive offset for events ahead of grid', () => {
    const offset = microTimingOffset(2.37);
    expect(offset).not.toBeNull();
    expect(offset!).toBeCloseTo(0.12);
  });

  it('returns negative offset for events behind grid', () => {
    const offset = microTimingOffset(2.13);
    expect(offset).not.toBeNull();
    expect(offset!).toBeCloseTo(-0.12);
  });

  it('works with custom grid size', () => {
    const offset = microTimingOffset(1.3, 0.5);
    expect(offset).not.toBeNull();
    expect(offset!).toBeCloseTo(-0.2);
  });
});
