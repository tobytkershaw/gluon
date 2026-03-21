import { describe, it, expect } from 'vitest';
import { toggleStepGate, toggleStepAccent } from './pattern-primitives';
import { getActivePattern, getTrack } from './types';
import type { Session } from './types';
import type { TriggerEvent, Pattern } from './canonical-types';

// --- Minimal session factory ---

function makeSession(events: TriggerEvent[], duration = 16): Session {
  const pattern: Pattern = {
    id: 'pat-1',
    kind: 'pattern',
    duration,
    events: [...events],
  };
  return {
    tracks: [{
      id: 'track-1',
      engine: 'plaits',
      model: 13,
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

describe('toggleStepGate with padId filter', () => {
  it('creates a trigger with padId when padId is specified', () => {
    const session = makeSession([]);
    const result = toggleStepGate(session, 'track-1', 0, undefined, { padId: 'kick' });
    const events = getActivePattern(getTrack(result, 'track-1')).events;

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('trigger');
    expect((events[0] as TriggerEvent).padId).toBe('kick');
    expect((events[0] as TriggerEvent).velocity).toBe(0.8);
  });

  it('creates a trigger without padId when padId is not specified', () => {
    const session = makeSession([]);
    const result = toggleStepGate(session, 'track-1', 0);
    const events = getActivePattern(getTrack(result, 'track-1')).events;

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('trigger');
    expect((events[0] as TriggerEvent).padId).toBeUndefined();
  });

  it('toggles off only the event matching the padId at a given step', () => {
    // Pattern has both a kick and hihat at step 0
    const session = makeSession([
      { kind: 'trigger', at: 0, velocity: 0.8, padId: 'kick' },
      { kind: 'trigger', at: 0, velocity: 0.8, padId: 'hihat' },
    ]);

    // Toggle off the kick at step 0
    const result = toggleStepGate(session, 'track-1', 0, undefined, { padId: 'kick' });
    const events = getActivePattern(getTrack(result, 'track-1')).events;

    // Kick should be disabled (velocity=0), hihat untouched
    const kick = events.find(e => e.kind === 'trigger' && (e as TriggerEvent).padId === 'kick') as TriggerEvent;
    const hihat = events.find(e => e.kind === 'trigger' && (e as TriggerEvent).padId === 'hihat') as TriggerEvent;

    expect(kick).toBeDefined();
    expect(kick.velocity).toBe(0);
    expect(hihat).toBeDefined();
    expect(hihat.velocity).toBe(0.8);
  });

  it('toggles off any event at the step when no padId is specified (backward compat)', () => {
    const session = makeSession([
      { kind: 'trigger', at: 0, velocity: 0.8, padId: 'kick' },
      { kind: 'trigger', at: 0, velocity: 0.8, padId: 'hihat' },
    ]);

    // Toggle without padId should disable the first event found at step 0
    const result = toggleStepGate(session, 'track-1', 0);
    const events = getActivePattern(getTrack(result, 'track-1')).events;
    const disabledCount = events.filter(e => e.kind === 'trigger' && (e as TriggerEvent).velocity === 0).length;

    // At least one should be toggled off
    expect(disabledCount).toBeGreaterThanOrEqual(1);
  });
});

describe('toggleStepAccent with padId filter', () => {
  it('toggles accent only on the event matching padId', () => {
    const session = makeSession([
      { kind: 'trigger', at: 0, velocity: 0.8, padId: 'kick' },
      { kind: 'trigger', at: 0, velocity: 0.8, padId: 'hihat' },
    ]);

    const result = toggleStepAccent(session, 'track-1', 0, undefined, 'kick');
    const events = getActivePattern(getTrack(result, 'track-1')).events;

    const kick = events.find(e => e.kind === 'trigger' && (e as TriggerEvent).padId === 'kick') as TriggerEvent;
    const hihat = events.find(e => e.kind === 'trigger' && (e as TriggerEvent).padId === 'hihat') as TriggerEvent;

    expect(kick.accent).toBe(true);
    expect(kick.velocity).toBe(1.0);
    // Hihat should be untouched
    expect(hihat.velocity).toBe(0.8);
    expect(hihat.accent).toBeFalsy();
  });
});
