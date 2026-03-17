import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler, MAX_CATCHUP_STEPS, START_OFFSET_SEC } from './scheduler';
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
      stepGrid: { steps: [], length: 16 },
      patterns: [{
        id: 'r1',
        kind: 'pattern' as const,
                duration: 16,
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
    transport: { status: 'playing', bpm: 120, swing: 0 },
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
    session.tracks[0].patterns[0].events = events;
    session.tracks[0].patterns[0].duration = 16;

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
    session.tracks[0].patterns[0].events = [
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
    session.tracks[0].patterns[0].events = [
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

  it('applies micro-timing offset from fractional event.at', () => {
    // Micro-timing is encoded in the fractional part of event.at.
    // at=2.3 means step 2 + 0.3 steps offset. The scheduler must produce
    // a noteTime that is 0.3 * stepDuration later than the on-grid step 2.
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },   // on grid
      { kind: 'trigger', at: 2.3, velocity: 0.8 },  // micro-timed
    ];
    // At 120 BPM, stepDuration = 0.125s, lookahead = 0.1s / 0.125 = 0.8 steps
    // Start at step 0 to catch the on-grid event, then advance to catch 2.3
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

    const stepDuration = 0.125;
    scheduler.start(0, 0, 0);
    // First tick catches step 0 (within lookahead ~0.8 steps)
    expect(onNote).toHaveBeenCalledTimes(1);

    // Advance audio time so step 2.3 falls within the lookahead window
    audioTime = 2.3 * stepDuration;
    vi.advanceTimersByTime(30);
    expect(onNote).toHaveBeenCalledTimes(2);

    const onGridNote: ScheduledNote = onNote.mock.calls[0][0];
    const microNote: ScheduledNote = onNote.mock.calls[1][0];

    // Difference should be exactly 2.3 steps worth of time
    expect(microNote.time - onGridNote.time).toBeCloseTo(2.3 * stepDuration, 5);

    scheduler.stop();
  });

  it('applies micro-timing offset for note events', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'note', at: 1.5, pitch: 60, velocity: 0.8, duration: 1 },
    ];
    // Advance audio time so step 1.5 is within lookahead
    let audioTime = 1.5 * 0.125;
    const onNote = vi.fn();

    const scheduler = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      onNote,
      () => {},
      () => ({}),
    );

    const stepDuration = 0.125; // 120 BPM
    // Start at step 1 so 1.5 is in the first lookahead window
    scheduler.start(0, 1, 0);
    expect(onNote).toHaveBeenCalledTimes(1);

    const note: ScheduledNote = onNote.mock.calls[0][0];
    // Note at step 1.5: time offset from startTime should be 1.5 * stepDuration
    // startTime = audioTime - startStep * stepDuration = 1.5*0.125 - 1*0.125 = 0.0625
    const expectedStartTime = audioTime - 1 * stepDuration;
    expect(note.time).toBeCloseTo(expectedStartTime + 1.5 * stepDuration, 5);
    // Gate-off at step 1.5 + 1 = 2.5
    expect(note.gateOffTime).toBeCloseTo(expectedStartTime + 2.5 * stepDuration, 5);

    scheduler.stop();
  });

  it('fires onSequenceEnd and stops when song mode reaches end of sequence', () => {
    // Song mode: sequence = [pattern A (4 steps), pattern B (4 steps)]
    // Total sequence = 8 steps. At 120 BPM, stepDuration = 0.125s, so 8 steps = 1.0s.
    const patternA = {
      id: 'pA',
      kind: 'pattern' as const,
      duration: 4,
      events: [{ kind: 'trigger' as const, at: 0, velocity: 0.8 }],
    };
    const patternB = {
      id: 'pB',
      kind: 'pattern' as const,
      duration: 4,
      events: [{ kind: 'trigger' as const, at: 0, velocity: 0.8 }],
    };
    const session = makeSession({
      transport: { status: 'playing', bpm: 120, swing: 0, mode: 'song' },
      tracks: [{
        id: 'v1',
        engine: 'plaits',
        model: 0,
        params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
        agency: 'ON',
        muted: false,
        solo: false,
        stepGrid: { steps: [], length: 4 },
        patterns: [patternA, patternB],
        sequence: [{ patternId: 'pA' }, { patternId: 'pB' }],
        surface: {
          semanticControls: [],
          pinnedControls: [],
          xyAxes: { x: 'timbre', y: 'morph' },
          thumbprint: { type: 'static-color' },
        },
      }],
    });

    let audioTime = 0;
    const onNote = vi.fn();
    const onPosition = vi.fn();
    const onSequenceEnd = vi.fn();

    const scheduler = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      onNote,
      onPosition,
      () => ({}),
      undefined, // onParameterEvent
      undefined, // onClick
      onSequenceEnd,
    );

    scheduler.start(0, 0, 0);
    expect(onSequenceEnd).not.toHaveBeenCalled();
    expect(scheduler.isRunning()).toBe(true);

    // Advance past the end of the sequence (8 steps = 1.0s at 120 BPM)
    audioTime = 1.1;
    vi.advanceTimersByTime(30);

    expect(onSequenceEnd).toHaveBeenCalledTimes(1);
    expect(scheduler.isRunning()).toBe(false);
  });

  it('does not fire onSequenceEnd in pattern mode', () => {
    // Pattern mode should loop forever, never trigger onSequenceEnd.
    const session = makeSession({
      transport: { status: 'playing', bpm: 120, swing: 0, mode: 'pattern' },
    });
    session.tracks[0].patterns[0].duration = 4; // short pattern

    let audioTime = 0;
    const onSequenceEnd = vi.fn();

    const scheduler = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      vi.fn(),
      vi.fn(),
      () => ({}),
      undefined,
      undefined,
      onSequenceEnd,
    );

    scheduler.start(0, 0, 0);

    // Advance well past the pattern length
    audioTime = 2.0; // 16 steps at 120 BPM, well past the 4-step pattern
    vi.advanceTimersByTime(30);

    expect(onSequenceEnd).not.toHaveBeenCalled();
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
  });

  it('re-emits a future track event after that track is invalidated', () => {
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
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

  // ---------------------------------------------------------------------------
  // Stop → Start duplicate detection (#529)
  // ---------------------------------------------------------------------------

  it('stop → start with new generation does not duplicate notes', () => {
    // Pattern: triggers at steps 0, 4, 8, 12 (4-on-the-floor in a 16-step pattern)
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
      { kind: 'trigger', at: 4, velocity: 0.8 },
      { kind: 'trigger', at: 8, velocity: 0.8 },
      { kind: 'trigger', at: 12, velocity: 0.8 },
    ];

    let audioTime = 0;
    const notes: ScheduledNote[] = [];
    const onNote = vi.fn((note: ScheduledNote) => notes.push(note));

    const scheduler = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      onNote,
      () => {},
      () => ({}),
    );

    // --- First play: generation 1, advance through first few steps ---
    scheduler.start(0, 0, 1);
    audioTime = 0.5; // ~4 steps at 120 BPM
    vi.advanceTimersByTime(100); // several ticks

    const notesBeforeStop = notes.length;
    expect(notesBeforeStop).toBeGreaterThan(0);

    // --- Stop ---
    scheduler.stop();

    // --- Second play: generation 2, from step 0 ---
    notes.length = 0;
    onNote.mockClear();
    audioTime = 1.0; // time has advanced while stopped

    scheduler.start(0, 0, 2);
    audioTime = 1.5;
    vi.advanceTimersByTime(100);

    // Check: every note from the second play should have generation 2
    for (const note of notes) {
      expect(note.generation).toBe(2);
    }

    // Check: no duplicate eventIds within the second play
    const eventIds = notes.map(n => n.eventId);
    const unique = new Set(eventIds);
    expect(unique.size).toBe(eventIds.length);

    scheduler.stop();
  });

  it('stop → start: all pattern events are scheduled in new generation (no drops)', () => {
    // 4 triggers at steps 0, 4, 8, 12 in a 16-step pattern.
    // Play through the full pattern and verify all 4 fire.
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
      { kind: 'trigger', at: 4, velocity: 0.8 },
      { kind: 'trigger', at: 8, velocity: 0.8 },
      { kind: 'trigger', at: 12, velocity: 0.8 },
    ];

    let audioTime = 0;
    const notes: ScheduledNote[] = [];
    const onNote = vi.fn((note: ScheduledNote) => notes.push(note));
    const stepDuration = 0.125; // 120 BPM

    const scheduler = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      onNote,
      () => {},
      () => ({}),
    );

    // First play + stop (prime the scheduler with a previous generation)
    scheduler.start(0, 0, 1);
    audioTime = 0.3;
    vi.advanceTimersByTime(50);
    scheduler.stop();

    // Second play: advance through the full pattern
    notes.length = 0;
    onNote.mockClear();
    audioTime = 1.0;
    scheduler.start(0, 0, 2);

    // Step through the entire 16-step pattern
    for (let step = 0; step <= 16; step++) {
      audioTime = 1.0 + step * stepDuration;
      vi.advanceTimersByTime(30);
    }

    // All 4 events should have been scheduled exactly once each
    const stepsScheduled = notes.map(n => {
      // Extract the step from the eventId (format: gen:trackId:patternId:cycle:kind@step)
      const match = n.eventId?.match(/@(\d+(?:\.\d+)?)/);
      return match ? parseFloat(match[1]) : -1;
    });

    expect(stepsScheduled).toContain(0);
    expect(stepsScheduled).toContain(4);
    expect(stepsScheduled).toContain(8);
    expect(stepsScheduled).toContain(12);

    // Strict: no duplicate eventIds at all. Each note in the pattern should
    // be scheduled exactly once per loop cycle, with unique cycle-qualified IDs.
    const eventIds = notes.map(n => n.eventId);
    const unique = new Set(eventIds);
    expect(unique.size).toBe(notes.length);

    scheduler.stop();
  });

  it('note added mid-playback is picked up on the next loop pass', () => {
    // Start with an empty pattern, add a note at step 2 while playing,
    // then advance through a full loop — the note should be scheduled.
    const session = makeSession();
    session.tracks[0].patterns[0].events = []; // start empty
    session.tracks[0].patterns[0].duration = 8;

    let audioTime = 0;
    const notes: ScheduledNote[] = [];
    const onNote = vi.fn((note: ScheduledNote) => notes.push(note));
    const stepDuration = 0.125; // 120 BPM

    const scheduler = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      onNote,
      () => {},
      () => ({}),
    );

    scheduler.start(0, 0, 1);

    // Advance past step 2 — nothing should be scheduled (empty pattern)
    audioTime = 4 * stepDuration;
    vi.advanceTimersByTime(50);
    expect(notes.length).toBe(0);

    // Add a note at step 2 (simulating user adding a note while playing)
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 2, velocity: 0.8 },
    ];
    // Invalidate the track so the scheduler re-scans
    scheduler.invalidateTrack('v1');

    // Advance through the loop wrap and full next cycle
    // Pattern length is 8, so we need to get past step 8 and then past step 2 again
    for (let i = 0; i < 16; i++) {
      audioTime += stepDuration;
      vi.advanceTimersByTime(30);
    }

    // The note at step 2 should have been scheduled at least once
    const step2Notes = notes.filter(n => n.eventId?.includes('@2'));
    expect(step2Notes.length).toBeGreaterThanOrEqual(1);

    scheduler.stop();
  });

  it('pause → resume does not produce duplicate notes across loop cycles', () => {
    // 4-on-the-floor kick in a 16-step pattern.
    // Play → pause mid-pattern → resume from paused step → run 3 full loops.
    // Every note in the resumed session must have a unique eventId.
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
      { kind: 'trigger', at: 4, velocity: 0.8 },
      { kind: 'trigger', at: 8, velocity: 0.8 },
      { kind: 'trigger', at: 12, velocity: 0.8 },
    ];

    const stepDuration = 0.125; // 120 BPM
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

    // --- Play: generation 1, advance to step ~6 ---
    scheduler.start(0, 0, 1);
    for (let i = 0; i < 6; i++) {
      audioTime += stepDuration;
      vi.advanceTimersByTime(30);
    }

    // --- Pause ---
    scheduler.stop();

    // Audio time keeps ticking while paused (AudioContext still running)
    audioTime += 0.5;

    // --- Resume: generation 2, from the paused position (step 6) ---
    const resumeNotes: ScheduledNote[] = [];
    onNote.mockClear();
    onNote.mockImplementation((note: ScheduledNote) => resumeNotes.push(note));

    const pauseStep = 6;
    const resumeAudioTime = audioTime;
    scheduler.start(START_OFFSET_SEC, pauseStep, 2);

    // Tick through 3 full loop cycles at realistic 25ms intervals
    const totalSteps = 48; // 3 × 16-step pattern
    const totalDuration = totalSteps * stepDuration;
    for (let t = 0; t < totalDuration; t += 0.025) {
      audioTime = resumeAudioTime + t;
      vi.advanceTimersByTime(25);
    }

    // --- Assertions ---

    // 1. All notes from the resumed session must have generation 2
    for (const note of resumeNotes) {
      expect(note.generation).toBe(2);
    }

    // 2. No duplicate eventIds — the core invariant
    const eventIds = resumeNotes.map(n => n.eventId);
    const uniqueIds = new Set(eventIds);
    expect(uniqueIds.size).toBe(eventIds.length);

    // 3. Verify correct count: first partial cycle (steps 8,12) = 2 notes,
    //    then full cycles have 4 notes each. Over ~48 steps from step 6
    //    we expect at least 10 notes (2 + 4 + 4 + partial).
    expect(resumeNotes.length).toBeGreaterThanOrEqual(10);

    scheduler.stop();
  });

  it('pause at loop boundary → resume does not double-fire step 0', () => {
    // Pause exactly at the loop boundary (step 16 = start of cycle 1),
    // resume, and verify step 0 events don't fire twice.
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
      { kind: 'trigger', at: 8, velocity: 0.8 },
    ];

    const stepDuration = 0.125;
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

    // Play through one full loop (16 steps)
    scheduler.start(0, 0, 1);
    for (let i = 0; i <= 16; i++) {
      audioTime = i * stepDuration;
      vi.advanceTimersByTime(25);
    }

    // Pause exactly at step 16 (loop boundary)
    scheduler.stop();
    audioTime += 0.3;

    // Resume from step 0 (wrapped position) with new generation
    const resumeNotes: ScheduledNote[] = [];
    onNote.mockClear();
    onNote.mockImplementation((note: ScheduledNote) => resumeNotes.push(note));

    const resumeAudioTime = audioTime;
    scheduler.start(START_OFFSET_SEC, 0, 2);

    // Play through 2 full loops
    for (let t = 0; t < 32 * stepDuration; t += 0.025) {
      audioTime = resumeAudioTime + t;
      vi.advanceTimersByTime(25);
    }

    // Count how many times step 0 fires in cycle 0
    const step0Cycle0 = resumeNotes.filter(n =>
      n.eventId?.includes(':0:trigger@0')
    );
    expect(step0Cycle0.length).toBe(1);

    // No duplicate eventIds overall
    const eventIds = resumeNotes.map(n => n.eventId);
    expect(new Set(eventIds).size).toBe(eventIds.length);

    scheduler.stop();
  });

  it('multiple rapid pause/resume cycles produce no duplicates', () => {
    // Simulate the user hitting pause/play repeatedly.
    const session = makeSession();
    session.tracks[0].patterns[0].events = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
      { kind: 'trigger', at: 4, velocity: 0.8 },
      { kind: 'trigger', at: 8, velocity: 0.8 },
      { kind: 'trigger', at: 12, velocity: 0.8 },
    ];

    const stepDuration = 0.125;
    let audioTime = 0;
    const allNotes: ScheduledNote[] = [];
    const onNote = vi.fn((note: ScheduledNote) => allNotes.push(note));

    const scheduler = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      onNote,
      () => {},
      () => ({}),
    );

    let generation = 0;

    for (let cycle = 0; cycle < 4; cycle++) {
      generation++;
      const startStep = cycle * 4; // resume from different positions
      const startAudioTime = audioTime;
      scheduler.start(START_OFFSET_SEC, startStep % 16, generation);

      // Play for 8 steps then pause
      for (let t = 0; t < 8 * stepDuration; t += 0.025) {
        audioTime = startAudioTime + t;
        vi.advanceTimersByTime(25);
      }

      scheduler.stop();
      audioTime += 0.1; // brief pause
    }

    // Each generation's notes should have unique eventIds
    for (let gen = 1; gen <= 4; gen++) {
      const genNotes = allNotes.filter(n => n.generation === gen);
      const genIds = genNotes.map(n => n.eventId);
      const uniqueGenIds = new Set(genIds);
      expect(uniqueGenIds.size).toBe(genIds.length);
    }

    scheduler.stop();
  });

  it('globalStep is never negative (no position flicker)', () => {
    const session = makeSession();
    let audioTime = 0;
    const positions: number[] = [];
    const onPosition = vi.fn((step: number) => positions.push(step));

    const scheduler = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      vi.fn(),
      onPosition,
      () => ({}),
    );

    // Start with default START_OFFSET — first tick should not report negative
    scheduler.start();
    expect(positions.length).toBeGreaterThan(0);
    for (const pos of positions) {
      expect(pos).toBeGreaterThanOrEqual(0);
    }

    scheduler.stop();
  });
});
