import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler, MAX_CATCHUP_STEPS } from './scheduler';
import type { Session } from './types';
import type { ScheduledNote } from './sequencer-types';
import type { TriggerEvent } from './canonical-types';

function makeSession(overrides?: Partial<Session>): Session {
  const triggerEvent: TriggerEvent = {
    kind: 'trigger',
    at: 0,
    velocity: 0.8,
  };
  return {
    tracks: [{
      id: 'v1',
      engine: 'plaits',
      model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON',
      muted: false,
      solo: false,
      pattern: { steps: [], length: 16 },
      regions: [{
        id: 'r1',
        kind: 'pattern' as const,
        start: 0,
        duration: 16,
        loop: true,
        events: [triggerEvent],
      }],
      surface: {
        semanticControls: [],
        pinnedControls: [],
        xyAxes: { x: 'timbre', y: 'morph' },
        thumbprint: { type: 'static-color' },
      },
    }],
    activeTrackId: 'v1',
    transport: { status: 'playing', bpm: 120, swing: 0, playing: true },
    undoStack: [],
    context: { key: null, scale: null, tempo: null, energy: 0.5, density: 0.5 },
    messages: [],
    recentHumanActions: [],
    ...overrides,
  };
}

describe('Scheduler — AudioContext suspend handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips tick when audio state is suspended', () => {
    const session = makeSession();
    let audioTime = 0;
    const onNote = vi.fn();
    const onPosition = vi.fn();

    const scheduler = new Scheduler(
      () => session,
      () => audioTime,
      () => 'suspended' as AudioContextState,
      onNote,
      onPosition,
      () => ({}),
    );

    scheduler.start(0);
    // The initial tick in start() should have been skipped
    expect(onNote).not.toHaveBeenCalled();
    expect(onPosition).not.toHaveBeenCalled();

    // Advance time and trigger interval ticks
    audioTime = 1.0;
    vi.advanceTimersByTime(50);

    // Still nothing scheduled because state is suspended
    expect(onNote).not.toHaveBeenCalled();
    expect(onPosition).not.toHaveBeenCalled();

    scheduler.stop();
  });

  it('caps catch-up to MAX_CATCHUP_STEPS after resume', () => {
    // At 120 BPM, stepDuration = 0.125s
    // Place events at every even step so we can count which get scheduled
    const events: TriggerEvent[] = Array.from({ length: 8 }, (_, i) =>
      ({ kind: 'trigger', at: i * 2, velocity: 0.8 }) as TriggerEvent
    );
    const session = makeSession();
    session.tracks[0].regions[0].events = events;
    session.tracks[0].regions[0].duration = 16;

    let audioTime = 0;
    let audioState: AudioContextState = 'running';
    const onNote = vi.fn();
    const onPosition = vi.fn();

    const scheduler = new Scheduler(
      () => session,
      () => audioTime,
      () => audioState,
      onNote,
      onPosition,
      () => ({}),
    );

    // Start normally — first tick at time 0 schedules events in lookahead
    scheduler.start(0);
    const notesAfterStart = onNote.mock.calls.length;
    expect(notesAfterStart).toBeGreaterThan(0); // sanity: some events scheduled

    // Simulate suspend: ticks are skipped, cursor stays where it was
    audioState = 'suspended';
    audioTime = 0.1; // small advance before suspend
    vi.advanceTimersByTime(30);
    const notesAfterSuspend = onNote.mock.calls.length;
    expect(notesAfterSuspend).toBe(notesAfterStart); // no new notes during suspend

    // Simulate resume after a long gap: audio time jumps far ahead
    // 5 seconds = 40 steps at 120 BPM. The cursor is still near ~1 step,
    // so gap = ~39 steps >> MAX_CATCHUP_STEPS (8).
    audioState = 'running';
    audioTime = 5.0;
    onNote.mockClear();
    vi.advanceTimersByTime(30); // single tick fires

    // With catch-up cap of 8 steps, only events in the last ~8 steps
    // (plus lookahead) should be scheduled — NOT all 40 steps worth.
    // Without the cap, we'd get ~20 events (8 events/cycle * 2.5 cycles).
    // With the cap, we should get significantly fewer.
    const catchupNotes = onNote.mock.calls.length;
    expect(catchupNotes).toBeGreaterThan(0); // some events scheduled
    expect(catchupNotes).toBeLessThanOrEqual(MAX_CATCHUP_STEPS); // bounded by cap

    scheduler.stop();
  });

  it('does not emit duplicate notes when the same window is rescanned', () => {
    const session = makeSession();
    let audioTime = 0;
    const onNote = vi.fn();

    const scheduler = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      onNote,
      () => {},
      () => ({}),
    );

    scheduler.start(0, 0, 7);
    expect(onNote).toHaveBeenCalledTimes(1);

    // Force an overlapping rescan of the same window.
    (scheduler as unknown as { cursor: number }).cursor = 0;
    (scheduler as unknown as { tick: () => void }).tick();

    expect(onNote).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('uses configurable gate length for trigger events', () => {
    const session = makeSession();
    session.tracks[0].regions[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8, gate: 2 },
    ];
    let audioTime = 0;
    const onNote = vi.fn();

    const scheduler = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      onNote,
      () => {},
      () => ({}),
    );

    // At 120 BPM, stepDuration = 60 / (120 * 4) = 0.125s
    scheduler.start(0, 0, 0);
    expect(onNote).toHaveBeenCalledTimes(1);
    const note: ScheduledNote = onNote.mock.calls[0][0];
    // gate=2 steps → gateOffTime should be 2 * 0.125 = 0.25s after noteTime
    expect(note.gateOffTime - note.time).toBeCloseTo(0.25, 5);

    scheduler.stop();
  });

  it('defaults trigger gate length to 1 step when gate is absent', () => {
    const session = makeSession();
    session.tracks[0].regions[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
    ];
    let audioTime = 0;
    const onNote = vi.fn();

    const scheduler = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      onNote,
      () => {},
      () => ({}),
    );

    scheduler.start(0, 0, 0);
    expect(onNote).toHaveBeenCalledTimes(1);
    const note: ScheduledNote = onNote.mock.calls[0][0];
    // default gate=1 step → gateOffTime should be 1 * 0.125 = 0.125s after noteTime
    expect(note.gateOffTime - note.time).toBeCloseTo(0.125, 5);

    scheduler.stop();
  });

  it('re-emits a future track event after that track is invalidated', () => {
    const session = makeSession();
    session.tracks[0].regions[0].events = [
      { kind: 'trigger', at: 7.5, velocity: 0.8 },
    ];
    let audioTime = 0.9; // global step ~7.2 at 120 BPM
    const onNote = vi.fn();

    const scheduler = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      onNote,
      () => {},
      () => ({}),
    );

    scheduler.start(0, 7, 4);
    expect(onNote).toHaveBeenCalledTimes(1);

    scheduler.invalidateTrack('v1', 7);
    (scheduler as unknown as { cursor: number }).cursor = 7;
    (scheduler as unknown as { tick: () => void }).tick();

    expect(onNote).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });
});
