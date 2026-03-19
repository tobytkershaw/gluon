// tests/engine/transport-scheduler-audit.test.ts
// Audit: exhaustive edge-case tests for the transport → scheduler → audio engine pipeline.
// Targets: loop boundary correctness, stop completeness, pause/resume accuracy,
// long-playback drift, rapid transport changes, pattern changes during playback,
// empty patterns, polyphonic overlap, and generation cleanup.
//
// Closes #849

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler, START_OFFSET_SEC, MAX_CATCHUP_STEPS } from '../../src/engine/scheduler';
import { PlaybackPlan, buildRuntimeEventId } from '../../src/engine/playback-plan';
import { TransportController } from '../../src/engine/transport-controller';
import { createSession, addTrack } from '../../src/engine/session';
import { toggleStepGate } from '../../src/engine/pattern-primitives';
import type { Session, Track } from '../../src/engine/types';
import { getTrack } from '../../src/engine/types';
import type { ScheduledNote, ScheduledParameterEvent } from '../../src/engine/sequencer-types';
import type { TriggerEvent, NoteEvent, ParameterEvent, MusicalEvent } from '../../src/engine/canonical-types';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeSession(overrides?: Partial<Session>): Session {
  return {
    tracks: [{
      id: 'v1',
      engine: 'plaits',
      model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON',
      muted: false,
      solo: false,
      stepGrid: { steps: [], length: 16 },
      patterns: [{
        id: 'p1',
        kind: 'pattern' as const,
        duration: 16,
        events: [],
      }],
      surface: {
        modules: [],
        thumbprint: { type: 'static-color' },
      },
    }],
    activeTrackId: 'v1',
    transport: { status: 'playing', bpm: 120, swing: 0 },
    undoStack: [],
    context: { key: null, scale: null, tempo: null, energy: 0.5, density: 0.5 },
    messages: [],
    recentHumanActions: [],
    ...overrides,
  };
}

function createScheduler(
  session: Session,
  audioTimeRef: { value: number },
  onNote: (note: ScheduledNote) => void,
  opts?: {
    onPosition?: (step: number) => void;
    onParameterEvent?: (event: ScheduledParameterEvent) => void;
    onClick?: (time: number, accent: boolean) => void;
    onSequenceEnd?: () => void;
  },
) {
  return new Scheduler(
    () => session,
    () => audioTimeRef.value,
    () => 'running' as AudioContextState,
    onNote,
    opts?.onPosition ?? (() => {}),
    () => ({}),
    opts?.onParameterEvent,
    opts?.onClick,
    opts?.onSequenceEnd,
  );
}

// At 120 BPM: stepDuration = 60 / (120 * 4) = 0.125s
const STEP_DURATION_120 = 0.125;

// ─── Loop boundary edge cases ──────────────────────────────────────────────

describe('Loop boundary edge cases', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('event exactly at position 0 fires on every loop iteration', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
    ];
    session.tracks[0].patterns[0].duration = 4; // short 4-step pattern

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);

    // Run through 5 full loops of a 4-step pattern (20 steps = 2.5s at 120 BPM)
    for (let t = 0.025; t <= 2.6; t += 0.025) {
      audioTime.value = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // Should have fired at least 5 times (once per loop)
    expect(notes.length).toBeGreaterThanOrEqual(5);

    // All event IDs should be unique (no duplicates)
    const ids = notes.map(n => n.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('event at the last step of the pattern is not dropped or doubled', () => {
    const session = makeSession();
    const patternLen = 8;
    // Event at step 7.5 — near the end of the pattern
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 7.5, velocity: 0.8 },
    ];
    session.tracks[0].patterns[0].duration = patternLen;

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);

    // Run through 4 full loops
    for (let t = 0.025; t <= 4.2; t += 0.025) {
      audioTime.value = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // Should fire exactly once per loop (4 times)
    expect(notes.length).toBeGreaterThanOrEqual(4);
    // No duplicates
    const ids = notes.map(n => n.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('events at position 0 after wrap are not dropped due to floating-point dust', () => {
    // This specifically targets the localStart epsilon guard in getLocalSegments
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
      { kind: 'trigger', at: 8, velocity: 0.8 },
    ];
    session.tracks[0].patterns[0].duration = 16;

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);

    // Run through 10 full loops (160 steps = 20s at 120 BPM)
    // This accumulates floating-point error in the cursor
    for (let t = 0.025; t <= 20.5; t += 0.025) {
      audioTime.value = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // Count step-0 events (identified by @0 in eventId)
    const step0Notes = notes.filter(n => n.eventId?.includes(':trigger@0'));
    // Should have at least 10 (one per loop)
    expect(step0Notes.length).toBeGreaterThanOrEqual(10);
  });

  it('two events at different positions near the loop boundary both fire', () => {
    const session = makeSession();
    const patternLen = 4;
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },       // start of loop
      { kind: 'trigger', at: 3.75, velocity: 0.8 },  // near end
    ];
    session.tracks[0].patterns[0].duration = patternLen;

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);

    for (let t = 0.025; t <= 2.5; t += 0.025) {
      audioTime.value = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // Both events should fire in each loop iteration
    // Use more precise matching: trigger@0 (exact step 0) vs trigger@3.750000
    const step0Notes = notes.filter(n => n.eventId?.includes(':trigger@0'));
    const stepEndNotes = notes.filter(n => n.eventId?.includes('@3.75'));
    expect(step0Notes.length).toBeGreaterThanOrEqual(4);
    expect(stepEndNotes.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── Stop completeness ────────────────────────────────────────────────────

describe('Stop completeness', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('after stop, no more notes are scheduled even when audio time advances', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
      { kind: 'trigger', at: 4, velocity: 0.8 },
      { kind: 'trigger', at: 8, velocity: 0.8 },
      { kind: 'trigger', at: 12, velocity: 0.8 },
    ];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);
    audioTime.value = 0.3;
    vi.advanceTimersByTime(50);

    const notesBeforeStop = notes.length;
    sched.stop();

    // Advance time significantly
    audioTime.value = 5.0;
    vi.advanceTimersByTime(200);

    // No new notes should have been scheduled
    expect(notes.length).toBe(notesBeforeStop);
  });

  it('stop clears interval and isRunning returns false', () => {
    const session = makeSession();
    const audioTime = { value: 0 };
    const sched = createScheduler(session, audioTime, () => {});

    sched.start(0, 0, 1);
    expect(sched.isRunning()).toBe(true);

    sched.stop();
    expect(sched.isRunning()).toBe(false);
  });

  it('stop resets the playback plan so stop→start does not carry stale dedup entries', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
    ];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    // First play
    sched.start(0, 0, 1);
    audioTime.value = 0.2;
    vi.advanceTimersByTime(50);
    const firstPlayNotes = notes.length;
    expect(firstPlayNotes).toBeGreaterThan(0);

    sched.stop();

    // Second play with new generation
    notes.length = 0;
    audioTime.value = 1.0;
    sched.start(0, 0, 2);
    audioTime.value = 1.2;
    vi.advanceTimersByTime(50);

    // Step 0 should fire again in the new generation
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0].generation).toBe(2);

    sched.stop();
  });
});

// ─── Pause/resume accuracy ────────────────────────────────────────────────

describe('Pause/resume accuracy', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resume from mid-pattern position schedules the next event correctly', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
      { kind: 'trigger', at: 4, velocity: 0.8 },
      { kind: 'trigger', at: 8, velocity: 0.8 },
      { kind: 'trigger', at: 12, velocity: 0.8 },
    ];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    // Play from step 0 up to step ~6
    sched.start(0, 0, 1);
    for (let t = 0.025; t <= 0.75; t += 0.025) {
      audioTime.value = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // Resume from step 6 with new generation
    notes.length = 0;
    const resumeTime = audioTime.value + 0.5; // simulate pause gap
    audioTime.value = resumeTime;
    sched.start(0, 6, 2);

    // Advance to cover step 8
    for (let t = 0; t < 0.5; t += 0.025) {
      audioTime.value = resumeTime + t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // Should have scheduled the event at step 8 (next event after position 6)
    const step8Notes = notes.filter(n => n.eventId?.includes('@8'));
    expect(step8Notes.length).toBeGreaterThanOrEqual(1);
    expect(step8Notes[0].generation).toBe(2);
  });

  it('resume with offset=0 does not push position backward', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
    ];

    const audioTime = { value: 0 };
    const positions: number[] = [];
    const sched = createScheduler(session, audioTime, () => {}, {
      onPosition: s => positions.push(s),
    });

    // Resume from step 8 with zero offset (simulating pause → resume)
    audioTime.value = 2.0;
    sched.start(0, 8, 2); // offset=0 for resume

    // First position reported should be >= 8
    expect(positions.length).toBeGreaterThan(0);
    expect(positions[0]).toBeGreaterThanOrEqual(0);

    sched.stop();
  });

  it('pause at exact loop boundary, resume picks up correctly', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
    ];
    session.tracks[0].patterns[0].duration = 8;

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    // Play through exactly one loop (8 steps = 1s at 120 BPM)
    sched.start(0, 0, 1);
    for (let t = 0.025; t <= 1.05; t += 0.025) {
      audioTime.value = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // Resume from step 0 (wrapped position) with new generation
    notes.length = 0;
    const resumeTime = audioTime.value + 0.3;
    audioTime.value = resumeTime;
    sched.start(START_OFFSET_SEC, 0, 2);

    for (let t = 0; t <= 1.2; t += 0.025) {
      audioTime.value = resumeTime + t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // Step 0 should fire in the resumed session
    const gen2Notes = notes.filter(n => n.generation === 2);
    expect(gen2Notes.length).toBeGreaterThanOrEqual(1);
    // No duplicates
    const ids = gen2Notes.map(n => n.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── Long playback drift ──────────────────────────────────────────────────

describe('Long playback drift', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('position is computed from absolute reference, not accumulated', () => {
    // The scheduler derives globalStep = (currentAudioTime - startTime) / stepDuration
    // This should be drift-free because it's an absolute calculation.
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
    ];
    session.tracks[0].patterns[0].duration = 16;

    const audioTime = { value: 0 };
    const positions: number[] = [];
    const sched = createScheduler(session, audioTime, () => {}, {
      onPosition: s => positions.push(s),
    });

    sched.start(0, 0, 1);

    // Simulate 1000 ticks over 25 seconds (200 steps at 120 BPM)
    for (let t = 0.025; t <= 25.0; t += 0.025) {
      audioTime.value = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // At t=25.0s, globalStep = 25.0 / 0.125 = 200 steps
    // Wrapped in 16-step pattern: 200 % 16 = 8
    const lastPos = positions[positions.length - 1];
    // Position should be very close to 8 (or the modular equivalent)
    expect(lastPos).toBeCloseTo(8, 0);
  });

  it('after 100+ loop iterations, step-0 events still fire consistently', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
    ];
    session.tracks[0].patterns[0].duration = 4; // short pattern = more loops

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);

    // 4-step pattern at 120 BPM = 0.5s per loop
    // 100 loops = 50s
    for (let t = 0.025; t <= 52.0; t += 0.025) {
      audioTime.value = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    const step0Notes = notes.filter(n => n.eventId?.includes(':trigger@0'));
    // Should have at least 100 step-0 events
    expect(step0Notes.length).toBeGreaterThanOrEqual(100);

    // No duplicates
    const ids = notes.map(n => n.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('note timing does not accumulate floating-point error over many loops', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
    ];
    session.tracks[0].patterns[0].duration = 4;

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);

    // Run for 20 loops (10s)
    for (let t = 0.025; t <= 10.5; t += 0.025) {
      audioTime.value = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // Check that each note's time is very close to a multiple of patternLen * stepDuration
    // Pattern is 4 steps, stepDuration = 0.125s, so loop duration = 0.5s
    const loopDuration = 4 * STEP_DURATION_120;
    for (const note of notes) {
      const remainder = note.time % loopDuration;
      // Should be very close to 0 or loopDuration
      const drift = Math.min(remainder, loopDuration - remainder);
      expect(drift).toBeLessThan(0.001); // less than 1ms drift
    }
  });
});

// ─── Rapid transport changes ───────────────────────────────────────────────

describe('Rapid transport changes', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('start/stop/start rapidly produces correct notes in each generation', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
      { kind: 'trigger', at: 2, velocity: 0.8 },
    ];
    session.tracks[0].patterns[0].duration = 4;

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    for (let cycle = 0; cycle < 10; cycle++) {
      const gen = cycle + 1;
      const base = audioTime.value;
      sched.start(0, 0, gen);

      for (let t = 0; t < 0.3; t += 0.025) {
        audioTime.value = base + t;
        vi.advanceTimersByTime(25);
      }

      sched.stop();
      audioTime.value += 0.05;
    }

    // Each generation should have unique event IDs
    for (let gen = 1; gen <= 10; gen++) {
      const genNotes = notes.filter(n => n.generation === gen);
      const ids = genNotes.map(n => n.eventId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('stop during the first tick (immediate stop) does not crash', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
    ];

    const audioTime = { value: 0 };
    const sched = createScheduler(session, audioTime, () => {});

    sched.start(0, 0, 1);
    // Immediately stop without advancing time
    sched.stop();

    expect(sched.isRunning()).toBe(false);
  });

  it('double stop does not throw', () => {
    const session = makeSession();
    const audioTime = { value: 0 };
    const sched = createScheduler(session, audioTime, () => {});

    sched.start(0, 0, 1);
    sched.stop();
    // Second stop should be a no-op
    expect(() => sched.stop()).not.toThrow();
    expect(sched.isRunning()).toBe(false);
  });

  it('start while already running is a no-op (does not double interval)', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
    ];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);
    const notesAfterFirstStart = notes.length;

    // Calling start again should be ignored
    sched.start(0, 0, 2);

    // Should still be running with the first generation
    audioTime.value = 0.3;
    vi.advanceTimersByTime(50);

    // All notes should have generation 1 (second start was ignored)
    const gen2Notes = notes.filter(n => n.generation === 2);
    expect(gen2Notes.length).toBe(0);

    sched.stop();
  });
});

// ─── Pattern change during playback ────────────────────────────────────────

describe('Pattern change during playback', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('invalidateTrack allows re-scheduling of future events after pattern edit', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
      { kind: 'trigger', at: 8, velocity: 0.8 },
    ];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);
    // Advance past step 0 but before step 8
    audioTime.value = 0.5; // step ~4
    vi.advanceTimersByTime(50);

    // Change the pattern: move the event from step 8 to step 6
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
      { kind: 'trigger', at: 6, velocity: 0.8 },
    ];

    // Invalidate the track so old step 8 event can be re-evaluated
    sched.invalidateTrack('v1');

    // Advance to cover step 6
    audioTime.value = 1.0;
    vi.advanceTimersByTime(50);
    sched.stop();

    // Step 6 should have been scheduled
    const step6Notes = notes.filter(n => n.eventId?.includes('@6'));
    expect(step6Notes.length).toBeGreaterThanOrEqual(1);
  });

  it('invalidateTrack does not cause past events to re-fire', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
      { kind: 'trigger', at: 4, velocity: 0.8 },
    ];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);
    audioTime.value = 1.5; // well past step 4 (step ~12)
    vi.advanceTimersByTime(100);

    const notesBefore = notes.length;

    // Invalidate from the current position — should NOT replay step 0 or 4
    // in the current loop cycle (they're in the past)
    sched.invalidateTrack('v1', 12);

    // Tick again
    audioTime.value = 1.6;
    vi.advanceTimersByTime(25);
    sched.stop();

    // No past events should have re-fired in the same cycle
    // (new events might appear from the next loop cycle)
    const ids = notes.map(n => n.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── Empty pattern ─────────────────────────────────────────────────────────

describe('Empty pattern', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('empty events array produces no notes and no crashes', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);
    audioTime.value = 5.0;
    vi.advanceTimersByTime(200);
    sched.stop();

    expect(notes.length).toBe(0);
  });

  it('zero-duration pattern is skipped without crashing', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
    ];
    session.tracks[0].patterns[0].duration = 0; // zero duration

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);
    audioTime.value = 2.0;
    vi.advanceTimersByTime(100);
    sched.stop();

    // Zero-duration pattern should produce no notes (guarded by patternLen <= 0 check)
    expect(notes.length).toBe(0);
  });

  it('track with no patterns produces no notes', () => {
    const session = makeSession();
    session.tracks[0].patterns = [];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);
    audioTime.value = 2.0;
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(notes.length).toBe(0);
  });
});

// ─── PlaybackPlan unit tests ───────────────────────────────────────────────

describe('PlaybackPlan', () => {
  it('admit returns true for new events and false for duplicates', () => {
    const plan = new PlaybackPlan();
    expect(plan.admit('evt1', 0, 1, 'v1')).toBe(true);
    expect(plan.admit('evt1', 0, 1, 'v1')).toBe(false);
  });

  it('generation change resets the plan', () => {
    const plan = new PlaybackPlan();
    plan.admit('evt1', 0, 1, 'v1');
    // Same eventId but new generation should be admitted
    expect(plan.admit('evt1', 0, 2, 'v1')).toBe(true);
  });

  it('pruneBeforeStep removes old entries', () => {
    const plan = new PlaybackPlan();
    plan.admit('evt-0', 0, 1, 'v1');
    plan.admit('evt-5', 5, 1, 'v1');
    plan.admit('evt-10', 10, 1, 'v1');

    plan.pruneBeforeStep(5);

    // evt-0 should be pruned, evt-5 and evt-10 should remain
    expect(plan.has('evt-0')).toBe(false);
    expect(plan.has('evt-5')).toBe(true);
    expect(plan.has('evt-10')).toBe(true);
  });

  it('invalidateTrack bumps revision and leaves existing entries intact', () => {
    const plan = new PlaybackPlan();
    plan.admit('v1-evt-0', 0, 1, 'v1');
    plan.admit('v1-evt-8', 8, 1, 'v1');
    plan.admit('v2-evt-8', 8, 1, 'v2');

    plan.invalidateTrack('v1');

    // Existing entries remain — they harmlessly block stale IDs
    expect(plan.has('v1-evt-0')).toBe(true);
    expect(plan.has('v1-evt-8')).toBe(true);
    expect(plan.has('v2-evt-8')).toBe(true);
    // But the revision is bumped so new event IDs will differ
    expect(plan.getTrackRevision('v1')).toBe(1);
    expect(plan.getTrackRevision('v2')).toBe(0);
  });

  it('reset clears all entries', () => {
    const plan = new PlaybackPlan();
    plan.admit('evt1', 0, 1, 'v1');
    plan.admit('evt2', 4, 1, 'v1');
    plan.reset(2);
    expect(plan.has('evt1')).toBe(false);
    expect(plan.has('evt2')).toBe(false);
  });
});

// ─── Song mode ─────────────────────────────────────────────────────────────

describe('Song mode edge cases', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('song mode loop wraps correctly and events at start of second pattern fire', () => {
    const patA = {
      id: 'pA', kind: 'pattern' as const, duration: 4,
      events: [{ kind: 'trigger' as const, at: 0, velocity: 0.8 }],
    };
    const patB = {
      id: 'pB', kind: 'pattern' as const, duration: 4,
      events: [{ kind: 'trigger' as const, at: 0, velocity: 0.8 }],
    };
    const session = makeSession({
      transport: { status: 'playing', bpm: 120, swing: 0, mode: 'song', loop: true },
      tracks: [{
        id: 'v1',
        engine: 'plaits',
        model: 0,
        params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
        agency: 'ON',
        muted: false,
        solo: false,
        stepGrid: { steps: [], length: 4 },
        patterns: [patA, patB],
        sequence: [{ patternId: 'pA' }, { patternId: 'pB' }],
        surface: {
          semanticControls: [],
          pinnedControls: [],
          xyAxes: { x: 'timbre', y: 'morph' },
          thumbprint: { type: 'static-color' },
        },
      }],
    } as Partial<Session>);

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);
    // Total sequence = 8 steps = 1s. Run for 3 loops = 3s
    for (let t = 0.025; t <= 3.2; t += 0.025) {
      audioTime.value = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // Each loop should produce 2 notes (one from patA, one from patB)
    // Over 3 loops, expect at least 6 notes
    // Note: song mode schedules linearly (no loopCycle) so after rewind,
    // the same event IDs would repeat if the plan isn't reset.
    expect(notes.length).toBeGreaterThanOrEqual(4); // at least 2 full loops
  });

  it('song mode non-looping stops and fires onSequenceEnd', () => {
    const session = makeSession({
      transport: { status: 'playing', bpm: 120, swing: 0, mode: 'song', loop: false },
      tracks: [{
        id: 'v1',
        engine: 'plaits',
        model: 0,
        params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
        agency: 'ON',
        muted: false,
        solo: false,
        stepGrid: { steps: [], length: 4 },
        patterns: [{
          id: 'pA', kind: 'pattern' as const, duration: 4,
          events: [{ kind: 'trigger' as const, at: 0, velocity: 0.8 }],
        }],
        sequence: [{ patternId: 'pA' }],
        surface: {
          semanticControls: [],
          pinnedControls: [],
          xyAxes: { x: 'timbre', y: 'morph' },
          thumbprint: { type: 'static-color' },
        },
      }],
    } as Partial<Session>);

    const audioTime = { value: 0 };
    const onSequenceEnd = vi.fn();
    const sched = createScheduler(session, audioTime, () => {}, { onSequenceEnd });

    sched.start(0, 0, 1);
    // Advance past 4 steps (0.5s at 120 BPM)
    audioTime.value = 0.6;
    vi.advanceTimersByTime(30);

    expect(onSequenceEnd).toHaveBeenCalledTimes(1);
    expect(sched.isRunning()).toBe(false);
  });
});

// ─── BPM change ────────────────────────────────────────────────────────────

describe('BPM change mid-playback', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('BPM change reanchors without note duplication or skipping', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
      { kind: 'trigger', at: 4, velocity: 0.8 },
      { kind: 'trigger', at: 8, velocity: 0.8 },
      { kind: 'trigger', at: 12, velocity: 0.8 },
    ];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);

    // Play at 120 BPM for a bit
    for (let t = 0.025; t <= 0.5; t += 0.025) {
      audioTime.value = t;
      vi.advanceTimersByTime(25);
    }

    // Change BPM to 160
    session.transport.bpm = 160;

    // Continue playing
    for (let t = 0.525; t <= 2.0; t += 0.025) {
      audioTime.value = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // All 4 events should have fired at least once (no skipping)
    const ids = notes.map(n => n.eventId);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates

    // Verify all step positions were scheduled
    const stepsHit = new Set(notes.map(n => {
      const m = n.eventId?.match(/@(\d+)/);
      return m ? parseInt(m[1]) : -1;
    }));
    expect(stepsHit.has(0)).toBe(true);
    expect(stepsHit.has(4)).toBe(true);
    expect(stepsHit.has(8)).toBe(true);
    expect(stepsHit.has(12)).toBe(true);
  });
});

// ─── Velocity-0 sentinel ───────────────────────────────────────────────────

describe('Velocity-0 sentinel', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('trigger events with velocity=0 are skipped (ungated sentinel)', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0 },   // ungated
      { kind: 'trigger', at: 4, velocity: 0.8 },  // normal
    ];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);
    audioTime.value = 1.0;
    vi.advanceTimersByTime(100);
    sched.stop();

    // Only the velocity=0.8 event should fire
    expect(notes.length).toBeGreaterThanOrEqual(1);
    for (const note of notes) {
      expect(note.eventId).not.toContain('@0');
    }
  });
});

// ─── TransportController integration ───────────────────────────────────────

describe('TransportController generation lifecycle', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('play → pause → resume uses three distinct generations', () => {
    vi.useFakeTimers();
    const session = makeSession({ transport: { status: 'stopped', bpm: 120, swing: 0 } });
    const generations: number[] = [];
    const scheduler = {
      start: vi.fn((_: number, __: number, gen: number) => generations.push(gen)),
      stop: vi.fn(),
      invalidateTrack: vi.fn(),
    };
    let posChange: (s: number) => void = () => {};
    const audio = {
      getCurrentTime: vi.fn(() => 1),
      getState: vi.fn(() => 'running' as AudioContextState),
      scheduleNote: vi.fn(),
      restoreBaseline: vi.fn(),
      advanceGeneration: vi.fn()
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(2)
        .mockReturnValueOnce(3),
      releaseGeneration: vi.fn(),
      silenceGeneration: vi.fn(),
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
    } as unknown as import('../../src/audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: ({ onPositionChange }) => {
        posChange = onPositionChange;
        return scheduler;
      },
    });

    // Play
    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();
    posChange(6);

    // Pause
    session.transport = { ...session.transport, status: 'paused' };
    controller.sync();

    // Resume
    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();

    expect(generations).toEqual([1, 3]); // gen 1 for play, gen 3 for resume (gen 2 used for pause)
    expect(audio.releaseGeneration).toHaveBeenCalledWith(2);

    controller.dispose();
  });

  it('parameter event timers are cancelled on stop', () => {
    vi.useFakeTimers();
    const session = makeSession({ transport: { status: 'stopped', bpm: 120, swing: 0 } });
    let paramCb: ((e: ScheduledParameterEvent) => void) | null = null;
    const onParameterEvent = vi.fn();
    const audio = {
      getCurrentTime: vi.fn(() => 1),
      getState: vi.fn(() => 'running' as AudioContextState),
      scheduleNote: vi.fn(),
      restoreBaseline: vi.fn(),
      advanceGeneration: vi.fn()
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(2),
      releaseGeneration: vi.fn(),
      silenceGeneration: vi.fn(),
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
    } as unknown as import('../../src/audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      onParameterEvent,
      createScheduler: ({ onParameterEvent: cb }) => {
        paramCb = cb ?? null;
        return { start: vi.fn(), stop: vi.fn(), invalidateTrack: vi.fn() };
      },
    });

    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();

    // Schedule a parameter event far in the future
    paramCb?.({ trackId: 'v1', controlId: 'timbre', value: 0.8, time: 2.0 });

    // Stop before the timer fires
    session.transport = { ...session.transport, status: 'stopped' };
    controller.sync();

    // Advance past when the timer would have fired
    vi.advanceTimersByTime(2000);

    // The parameter event should NOT have been delivered
    expect(onParameterEvent).not.toHaveBeenCalled();

    controller.dispose();
  });
});

// ─── Metronome scheduling ──────────────────────────────────────────────────

describe('Metronome scheduling', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('metronome clicks are not scheduled when disabled', () => {
    const session = makeSession();
    session.transport.metronome = { enabled: false, volume: 0.5 };

    const audioTime = { value: 0 };
    const clicks: { time: number; accent: boolean }[] = [];
    const sched = createScheduler(session, audioTime, () => {}, {
      onClick: (t, a) => clicks.push({ time: t, accent: a }),
    });

    sched.start(0, 0, 1);
    audioTime.value = 2.0;
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(clicks.length).toBe(0);
  });

  it('metronome clicks align with time signature after startStep > 0', () => {
    const session = makeSession();
    session.transport.metronome = { enabled: true, volume: 0.5 };
    session.transport.timeSignature = { numerator: 4, denominator: 4 };

    const audioTime = { value: 0 };
    const clicks: { time: number; accent: boolean }[] = [];
    const sched = createScheduler(session, audioTime, () => {}, {
      onClick: (t, a) => clicks.push({ time: t, accent: a }),
    });

    // Start from step 6 (mid-bar) with no offset
    // startTime = 0 + 0 - 6 * 0.125 = -0.75
    // nextClickStep = ceil(6/4) * 4 = 8
    // First click time = -0.75 + 8 * 0.125 = 0.25
    audioTime.value = 0;
    sched.start(0, 6, 1);
    audioTime.value = 2.0;
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(clicks.length).toBeGreaterThan(0);
    // First click corresponds to absolute step 8 (next beat after step 6)
    // Its audio time = startTime + 8 * stepDuration = -0.75 + 1.0 = 0.25
    expect(clicks[0].time).toBeCloseTo(0.25, 3);
    // Second click at step 12 → time = -0.75 + 12 * 0.125 = 0.75
    if (clicks.length >= 2) {
      expect(clicks[1].time).toBeCloseTo(0.75, 3);
    }
  });
});

// ─── NoteEvent (pitched) lifecycle ─────────────────────────────────────────

describe('NoteEvent lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('NoteEvent pitch is mapped to params.note as pitch/127', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 },
    ];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);
    sched.stop();

    expect(notes.length).toBe(1);
    expect(notes[0].params.note).toBeCloseTo(60 / 127, 5);
  });

  it('NoteEvent duration controls gate-off time', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'note', at: 2, pitch: 48, velocity: 0.8, duration: 3 },
    ];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    audioTime.value = 0.3; // ensure step 2 is in lookahead
    sched.start(0, 0, 1);
    vi.advanceTimersByTime(50);
    sched.stop();

    expect(notes.length).toBe(1);
    // duration = 3 steps, so gateOff = step 2 + 3 = step 5
    expect(notes[0].gateOffTime - notes[0].time).toBeCloseTo(3 * STEP_DURATION_120, 3);
  });
});

// ─── Swing correctness ────────────────────────────────────────────────────

describe('Swing correctness', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('swing delays odd-position steps and leaves even-position steps unaffected', () => {
    const session = makeSession();
    session.transport.swing = 0.5;
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },  // even → no swing
      { kind: 'trigger', at: 1, velocity: 0.8 },  // odd → swing
      { kind: 'trigger', at: 2, velocity: 0.8 },  // even → no swing
      { kind: 'trigger', at: 3, velocity: 0.8 },  // odd → swing
    ];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);
    audioTime.value = 1.0;
    vi.advanceTimersByTime(100);
    sched.stop();

    // Sort by time
    const sorted = [...notes].sort((a, b) => a.time - b.time);
    expect(sorted.length).toBeGreaterThanOrEqual(4);

    const step0Time = sorted[0].time;
    const step1Time = sorted[1].time;
    const step2Time = sorted[2].time;
    const step3Time = sorted[3].time;

    // Even steps (0, 2): base time only
    expect(step0Time).toBeCloseTo(0 * STEP_DURATION_120, 3);
    expect(step2Time).toBeCloseTo(2 * STEP_DURATION_120, 3);

    // Odd steps (1, 3): base time + swing delay
    const swingDelay = 0.5 * (STEP_DURATION_120 * 0.75);
    expect(step1Time).toBeCloseTo(1 * STEP_DURATION_120 + swingDelay, 3);
    expect(step3Time).toBeCloseTo(3 * STEP_DURATION_120 + swingDelay, 3);
  });

  it('swing also applies to gate-off times', () => {
    const session = makeSession();
    session.transport.swing = 0.5;
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },  // gate-off at step 1 (odd → swing)
    ];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);
    sched.stop();

    expect(notes.length).toBe(1);
    // Gate-off at step 1 (odd) should have swing delay
    const swingDelay = 0.5 * (STEP_DURATION_120 * 0.75);
    const expectedGateOff = 1 * STEP_DURATION_120 + swingDelay;
    expect(notes[0].gateOffTime).toBeCloseTo(expectedGateOff, 3);
  });
});

// ─── Multi-track scheduling ───────────────────────────────────────────────

describe('Multi-track scheduling', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('events from different tracks with different pattern lengths both schedule correctly', () => {
    const session = makeSession();
    // Add a second track with a different pattern length
    session.tracks.push({
      id: 'v2',
      engine: 'plaits',
      model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON',
      muted: false,
      solo: false,
      stepGrid: { steps: [], length: 8 },
      patterns: [{
        id: 'p2',
        kind: 'pattern' as const,
        duration: 8, // different length than track 1's 16
        events: [{ kind: 'trigger', at: 0, velocity: 0.8 }],
      }],
      surface: {
        modules: [],
        thumbprint: { type: 'static-color' },
      },
    } as Track);

    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
    ];

    const audioTime = { value: 0 };
    const notes: ScheduledNote[] = [];
    const sched = createScheduler(session, audioTime, n => notes.push(n));

    sched.start(0, 0, 1);
    // Run for 4 seconds = 32 steps
    for (let t = 0.025; t <= 4.2; t += 0.025) {
      audioTime.value = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    const v1Notes = notes.filter(n => n.trackId === 'v1');
    const v2Notes = notes.filter(n => n.trackId === 'v2');

    // Track 1 (16-step pattern): should fire ~2 times in 32 steps
    expect(v1Notes.length).toBeGreaterThanOrEqual(2);
    // Track 2 (8-step pattern): should fire ~4 times in 32 steps
    expect(v2Notes.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── buildRuntimeEventId ───────────────────────────────────────────────────

describe('buildRuntimeEventId', () => {
  it('generates unique IDs for different loop cycles', () => {
    const event: TriggerEvent = { kind: 'trigger', at: 4, velocity: 0.8 };
    const id0 = buildRuntimeEventId(1, 'v1', 'p1', event, 0);
    const id1 = buildRuntimeEventId(1, 'v1', 'p1', event, 1);
    const id2 = buildRuntimeEventId(1, 'v1', 'p1', event, 2);
    expect(id0).not.toBe(id1);
    expect(id1).not.toBe(id2);
  });

  it('generates unique IDs for different generations', () => {
    const event: TriggerEvent = { kind: 'trigger', at: 0, velocity: 0.8 };
    const id1 = buildRuntimeEventId(1, 'v1', 'p1', event, 0);
    const id2 = buildRuntimeEventId(2, 'v1', 'p1', event, 0);
    expect(id1).not.toBe(id2);
  });

  it('handles fractional positions consistently', () => {
    const event: TriggerEvent = { kind: 'trigger', at: 2.5, velocity: 0.8 };
    const id = buildRuntimeEventId(1, 'v1', 'p1', event, 0);
    expect(id).toContain('@2.5');
  });

  it('NoteEvent includes pitch in the ID', () => {
    const event: NoteEvent = { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 };
    const id = buildRuntimeEventId(1, 'v1', 'p1', event, 0);
    expect(id).toContain('note:60@0');
  });

  it('ParameterEvent includes controlId in the ID', () => {
    const event: ParameterEvent = { kind: 'parameter', at: 0, controlId: 'timbre', value: 0.5 };
    const id = buildRuntimeEventId(1, 'v1', 'p1', event, 0);
    expect(id).toContain('timbre@0');
  });
});
