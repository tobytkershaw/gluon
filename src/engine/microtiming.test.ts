// src/engine/microtiming.test.ts
// Tests verifying that fractional `at` values (microtiming) flow correctly
// through the event model, pattern editing, validation, and render timing.

import { describe, it, expect } from 'vitest';
import { editPatternEvents, validatePatternEditOps } from './pattern-primitives';
import { validatePattern, normalizePatternEvents } from './region-helpers';
import { splitBlockAtEvents } from '../audio/render-timing';
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
      agency: 'OFF',
      stepGrid: { steps: [], length: duration },
      patterns: [pattern],
      sequence: [{ patternId: pattern.id }],
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
    transport: { status: 'stopped', bpm: 120, swing: 0, metronome: { enabled: false, volume: 0.5 }, timeSignature: { numerator: 4, denominator: 4 } },
    master: { volume: 0.8, pan: 0 },
    undoStack: [],
    redoStack: [],
    context: { key: null, scale: null, tempo: null, energy: 0.5, density: 0.5 },
    messages: [],
    recentHumanActions: [],
  } as Session;
}

function makePattern(events: (TriggerEvent | NoteEvent | ParameterEvent)[], duration = 16): Pattern {
  return {
    id: 'test-pattern',
    kind: 'pattern',
    duration,
    events: [...events],
  };
}

// --- Validation ---

describe('microtiming: pattern validation', () => {
  it('accepts fractional at values within range', () => {
    const pattern = makePattern([
      { kind: 'trigger', at: 4.1, velocity: 0.8 },
      { kind: 'trigger', at: 8.15, velocity: 0.7 },
    ]);
    const result = validatePattern(pattern);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts negative microtiming (e.g. 3.95 for slightly early step 4)', () => {
    const pattern = makePattern([
      { kind: 'trigger', at: 3.95, velocity: 0.8 },
    ]);
    const result = validatePattern(pattern);
    expect(result.valid).toBe(true);
  });

  it('accepts fractional at on note events', () => {
    const pattern = makePattern([
      { kind: 'note', at: 0.1, pitch: 60, velocity: 0.8, duration: 1 },
      { kind: 'note', at: 4.05, pitch: 64, velocity: 0.7, duration: 0.5 },
    ]);
    const result = validatePattern(pattern);
    expect(result.valid).toBe(true);
  });

  it('accepts fractional at on parameter events', () => {
    const pattern = makePattern([
      { kind: 'parameter', at: 2.5, controlId: 'timbre', value: 0.6 },
    ]);
    const result = validatePattern(pattern);
    expect(result.valid).toBe(true);
  });

  it('rejects events with fractional at >= duration', () => {
    const pattern = makePattern([
      { kind: 'trigger', at: 15.99, velocity: 0.8 },
    ]);
    const result = validatePattern(pattern);
    expect(result.valid).toBe(true); // 15.99 < 16, so valid

    const badPattern = makePattern([
      { kind: 'trigger', at: 16.0, velocity: 0.8 },
    ]);
    const badResult = validatePattern(badPattern);
    expect(badResult.valid).toBe(false);
  });
});

// --- Normalization ---

describe('microtiming: normalization', () => {
  it('preserves fractional at values after normalization', () => {
    const pattern = makePattern([
      { kind: 'trigger', at: 8.1, velocity: 0.8 },
      { kind: 'trigger', at: 4.05, velocity: 0.7 },
    ]);
    const normalized = normalizePatternEvents(pattern);
    // Should be sorted by at
    expect(normalized.events[0].at).toBeCloseTo(4.05);
    expect(normalized.events[1].at).toBeCloseTo(8.1);
  });

  it('deduplicates triggers at same fractional position (within tolerance)', () => {
    const pattern = makePattern([
      { kind: 'trigger', at: 4.1, velocity: 0.8 },
      { kind: 'trigger', at: 4.1005, velocity: 0.9 }, // within 0.001 tolerance
    ]);
    const normalized = normalizePatternEvents(pattern);
    const triggers = normalized.events.filter(e => e.kind === 'trigger');
    expect(triggers).toHaveLength(1);
  });

  it('keeps triggers at distinct fractional positions', () => {
    const pattern = makePattern([
      { kind: 'trigger', at: 4.05, velocity: 0.8 },
      { kind: 'trigger', at: 4.15, velocity: 0.9 },
    ]);
    const normalized = normalizePatternEvents(pattern);
    const triggers = normalized.events.filter(e => e.kind === 'trigger');
    expect(triggers).toHaveLength(2);
  });
});

// --- editPatternEvents with fractional steps ---

describe('microtiming: editPatternEvents', () => {
  it('adds a trigger at a fractional step position', () => {
    const session = makeSession([]);
    const result = editPatternEvents(session, 'track-1', undefined, [
      { action: 'add', step: 4.1, event: { type: 'trigger', velocity: 0.8 } },
    ], 'add microtimed trigger');

    const events = result.tracks[0].patterns[0].events;
    const triggers = events.filter(e => e.kind === 'trigger');
    expect(triggers).toHaveLength(1);
    expect(triggers[0].at).toBeCloseTo(4.1);
  });

  it('adds a note at a fractional step position', () => {
    const session = makeSession([]);
    const result = editPatternEvents(session, 'track-1', undefined, [
      { action: 'add', step: 2.15, event: { type: 'note', pitch: 60, velocity: 0.7, duration: 1 } },
    ], 'add microtimed note');

    const events = result.tracks[0].patterns[0].events;
    const notes = events.filter(e => e.kind === 'note');
    expect(notes).toHaveLength(1);
    expect(notes[0].at).toBeCloseTo(2.15);
  });

  it('removes an event at a fractional step position', () => {
    const session = makeSession([
      { kind: 'trigger', at: 4.1, velocity: 0.8 },
    ]);
    const result = editPatternEvents(session, 'track-1', undefined, [
      { action: 'remove', step: 4.1, event: { type: 'trigger' } },
    ], 'remove microtimed trigger');

    const events = result.tracks[0].patterns[0].events;
    expect(events.filter(e => e.kind === 'trigger')).toHaveLength(0);
  });

  it('modifies velocity of an event at a fractional step position', () => {
    const session = makeSession([
      { kind: 'trigger', at: 8.05, velocity: 0.8 },
    ]);
    const result = editPatternEvents(session, 'track-1', undefined, [
      { action: 'modify', step: 8.05, event: { type: 'trigger', velocity: 0.5 } },
    ], 'modify microtimed trigger velocity');

    const events = result.tracks[0].patterns[0].events;
    const triggers = events.filter(e => e.kind === 'trigger') as TriggerEvent[];
    expect(triggers).toHaveLength(1);
    expect(triggers[0].velocity).toBe(0.5);
    expect(triggers[0].at).toBeCloseTo(8.05);
  });
});

// --- validatePatternEditOps with fractional steps ---

describe('microtiming: validatePatternEditOps', () => {
  it('accepts add operations with fractional step values', () => {
    const pattern = makePattern([]);
    const errors = validatePatternEditOps(pattern, [
      { action: 'add', step: 4.1, event: { type: 'trigger', velocity: 0.8 } },
    ]);
    expect(errors).toHaveLength(0);
  });

  it('rejects negative fractional step values', () => {
    const pattern = makePattern([]);
    const errors = validatePatternEditOps(pattern, [
      { action: 'add', step: -0.1, event: { type: 'trigger', velocity: 0.8 } },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects step values >= pattern duration', () => {
    const pattern = makePattern([], 16);
    const errors = validatePatternEditOps(pattern, [
      { action: 'add', step: 16.0, event: { type: 'trigger', velocity: 0.8 } },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// --- Render timing with fractional beat positions ---

describe('microtiming: render timing', () => {
  it('positions fractional-step events at sub-frame offsets', () => {
    const framesPerStep = 1000; // 1000 frames per step for easy math
    const blockFrame = 4000; // block starts at step 4

    // Event at step 4.1 → frame 4100, offset 100 within block
    const segments = splitBlockAtEvents(
      [{ beatTime: 4.1, index: 0 }],
      blockFrame,
      1000, // block size
      framesPerStep,
    );

    // Should split the block at frame offset 100
    expect(segments.length).toBe(2);
    expect(segments[0].startOffset).toBe(0);
    expect(segments[0].length).toBe(100);
    expect(segments[0].eventsToApply).toHaveLength(0);
    expect(segments[1].startOffset).toBe(100);
    expect(segments[1].eventsToApply).toContain(0);
  });

  it('distinguishes events at 4.0 and 4.1 as different frame offsets', () => {
    const framesPerStep = 1000;
    const blockFrame = 4000;

    const segments = splitBlockAtEvents(
      [
        { beatTime: 4.0, index: 0 },
        { beatTime: 4.1, index: 1 },
      ],
      blockFrame,
      1000,
      framesPerStep,
    );

    // Event at 4.0 → offset 0, event at 4.1 → offset 100
    expect(segments.length).toBe(2);
    expect(segments[0].startOffset).toBe(0);
    expect(segments[0].eventsToApply).toContain(0);
    expect(segments[1].startOffset).toBe(100);
    expect(segments[1].eventsToApply).toContain(1);
  });

  it('handles negative microtiming (early event before grid line)', () => {
    const framesPerStep = 1000;
    const blockFrame = 3000; // block starts at step 3

    // Event at 3.95 → frame 3950, offset 950 within block
    const segments = splitBlockAtEvents(
      [{ beatTime: 3.95, index: 0 }],
      blockFrame,
      1000,
      framesPerStep,
    );

    expect(segments.length).toBe(2);
    expect(segments[0].startOffset).toBe(0);
    expect(segments[0].length).toBe(950);
    expect(segments[1].startOffset).toBe(950);
    expect(segments[1].eventsToApply).toContain(0);
  });
});
