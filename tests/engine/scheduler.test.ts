// tests/engine/scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../../src/engine/scheduler';
import { createSession, addTrack } from '../../src/engine/session';
import { toggleStepGate } from '../../src/engine/pattern-primitives';
import type { Session } from '../../src/engine/types';
import type { ScheduledNote, ScheduledParameterEvent } from '../../src/engine/sequencer-types';
import { getTrack } from '../../src/engine/types';
import type { TriggerEvent, NoteEvent, ParameterEvent, MusicalEvent } from '../../src/engine/canonical-types';

describe('Scheduler', () => {
  let session: Session;
  let notes: ScheduledNote[];
  let positions: number[];
  let audioTime: number;

  beforeEach(() => {
    vi.useFakeTimers();
    session = createSession();
    notes = [];
    positions = [];
    audioTime = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createScheduler(getSession?: () => Session) {
    return new Scheduler(
      getSession ?? (() => session),
      () => audioTime,
      () => 'running' as AudioContextState,
      (note) => notes.push(note),
      (pos) => positions.push(pos),
      () => ({}), // no held params in tests by default
    );
  }

  it('does not emit notes when no steps are gated', () => {
    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.5;
    vi.advanceTimersByTime(200);
    sched.stop();
    expect(notes).toHaveLength(0);
  });

  it('emits notes for gated steps', () => {
    // Gate steps 0 and 4 on track 0
    const vid = session.tracks[0].id;
    session = toggleStepGate(session, vid, 0);
    session = toggleStepGate(session, vid, 4);

    const sched = createScheduler();
    sched.start(0);

    // BPM 120 = 0.125s per 16th note
    // Advance enough time for step 0 to be scheduled
    audioTime = 0.2;
    vi.advanceTimersByTime(100);

    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].trackId).toBe(vid);
    expect(notes[0].params).toBeDefined();
    sched.stop();
  });

  it('publishes position changes', () => {
    const vid = session.tracks[0].id;
    session = toggleStepGate(session, vid, 0);
    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.3;
    vi.advanceTimersByTime(100);
    expect(positions.length).toBeGreaterThan(0);
    sched.stop();
  });

  it('stops cleanly', () => {
    const sched = createScheduler();
    sched.start(0);
    expect(sched.isRunning()).toBe(true);
    sched.stop();
    expect(sched.isRunning()).toBe(false);
  });

  it('applies swing to odd-position steps in beat pairs', () => {
    // Set swing to 0.5
    session = { ...session, transport: { ...session.transport, swing: 0.5 } };
    const vid = session.tracks[0].id;
    // Gate steps 0 and 1 (a pair within a beat)
    session = toggleStepGate(session, vid, 0);
    session = toggleStepGate(session, vid, 1);

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.5;
    vi.advanceTimersByTime(200);
    sched.stop();

    // Step 0 should be at base time, step 1 should be delayed by swing
    const step0Notes = notes.filter(n => n.time < 0.13);
    const step1Notes = notes.filter(n => n.time >= 0.13);
    if (step0Notes.length > 0 && step1Notes.length > 0) {
      // Step 1 should be later than step 0 + base step duration
      expect(step1Notes[0].time).toBeGreaterThan(step0Notes[0].time + 0.1);
    }
  });

  it('resolves note params with track base + step locks', () => {
    const vid = session.tracks[0].id;
    // Set a param lock on step 0 via canonical events
    const track = getTrack(session, vid);
    // Add trigger + parameter event at step 0
    const newEvents: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      { kind: 'parameter', at: 0, controlId: 'timbre', value: 0.9 } as ParameterEvent,
    ];
    const newRegions = [{ ...track.patterns[0], events: newEvents }, ...track.patterns.slice(1)];
    // Also update pattern steps to stay in sync
    const newSteps = [...track.stepGrid.steps];
    newSteps[0] = { gate: true, accent: false, micro: 0, params: { timbre: 0.9 } };
    session = {
      ...session,
      tracks: session.tracks.map(v => v.id === vid
        ? { ...v, patterns: newRegions, stepGrid: { ...v.stepGrid, steps: newSteps } }
        : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.2;
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].params.timbre).toBe(0.9); // locked value
    expect(notes[0].params.morph).toBe(0.5); // track base
  });

  it('computes gateOffTime as next step time', () => {
    const vid = session.tracks[0].id;
    session = toggleStepGate(session, vid, 0);

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.2;
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(notes.length).toBeGreaterThanOrEqual(1);
    // At 120 BPM, step duration = 0.125s, so gateOffTime ≈ time + 0.125
    const note = notes[0];
    expect(note.gateOffTime).toBeCloseTo(note.time + 0.125, 2);
  });

  it('handles BPM change mid-play without glitching', () => {
    const vid = session.tracks[0].id;
    session = toggleStepGate(session, vid, 0);
    session = toggleStepGate(session, vid, 4);

    let currentSession = session;
    const sched = new Scheduler(
      () => currentSession,
      () => audioTime,
      () => 'running' as AudioContextState,
      (note) => notes.push(note),
      (pos) => positions.push(pos),
      () => ({}),
    );

    sched.start(0);
    audioTime = 0.3;
    vi.advanceTimersByTime(100);

    // Change BPM mid-play
    currentSession = {
      ...currentSession,
      transport: { ...currentSession.transport, bpm: 140 },
    };
    audioTime = 0.6;
    vi.advanceTimersByTime(200);
    sched.stop();

    // Should have emitted notes without errors
    expect(notes.length).toBeGreaterThan(0);
  });

  it('wraps pattern for short patterns', () => {
    // Create a track with 8-step region + pattern, gate on step 0
    const vid = session.tracks[0].id;
    const track = session.tracks.find(v => v.id === vid)!;
    const newSteps = track.stepGrid.steps.slice(0, 8).map((s, i) =>
      i === 0 ? { ...s, gate: true } : s
    );
    const newEvents: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
    ];
    const newRegion = { ...track.patterns[0], duration: 8, events: newEvents };
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, stepGrid: { steps: newSteps, length: 8 }, patterns: [newRegion] } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    // Simulate time progressing through multiple ticks so the cursor advances.
    // At 120 BPM, 8 steps = 1s. We need to get past 1.0s to wrap.
    // Each tick interval is 25ms; advance in increments to let the cursor catch up.
    for (let t = 0.1; t <= 1.2; t += 0.1) {
      audioTime = t;
      vi.advanceTimersByTime(50);
    }
    sched.stop();

    // Should have emitted notes for step 0 on first and second pattern cycles
    const step0Notes = notes.filter(n => n.trackId === vid);
    expect(step0Notes.length).toBeGreaterThanOrEqual(2);
  });

  it('only schedules audible tracks', () => {
    // Mute track 0, gate step 0 on both track 0 and track 1
    session = toggleStepGate(session, session.tracks[0].id, 0);
    session = toggleStepGate(session, session.tracks[1].id, 0);
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === session.tracks[0].id ? { ...v, muted: true } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.2;
    vi.advanceTimersByTime(100);
    sched.stop();

    // Only track 1 notes should appear
    const trackIds = [...new Set(notes.map(n => n.trackId))];
    expect(trackIds).not.toContain(session.tracks[0].id);
    if (notes.length > 0) {
      expect(trackIds).toContain(session.tracks[1].id);
    }
  });

  // --- New event-based scheduler tests ---

  it('schedules fractional position events with correct timing', () => {
    const vid = session.tracks[0].id;
    const track = getTrack(session, vid);
    // Place event at fractional position 4.3
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 4.3, velocity: 0.8 } as TriggerEvent,
    ];
    const newRegion = { ...track.patterns[0], events };
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, patterns: [newRegion] } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    audioTime = 1.0;
    vi.advanceTimersByTime(200);
    sched.stop();

    expect(notes.length).toBeGreaterThanOrEqual(1);
    const note = notes[0];
    // At 120 BPM, stepDuration = 0.125s
    // Step 4 time = 0.5s, step 5 time = 0.625s
    // Event at 4.3 should be at ~0.5375s (without swing on even position)
    const stepDuration = 0.125;
    const expectedBase = 4.3 * stepDuration;
    expect(note.time).toBeCloseTo(expectedBase, 3);
  });

  it('applies swing correctly on top of fractional positions', () => {
    const vid = session.tracks[0].id;
    const track = getTrack(session, vid);
    // Place event at step 1.2 (odd position — swing applies)
    session = { ...session, transport: { ...session.transport, swing: 0.5 } };
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 1.2, velocity: 0.8 } as TriggerEvent,
    ];
    const newRegion = { ...track.patterns[0], events };
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, patterns: [newRegion] } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.5;
    vi.advanceTimersByTime(200);
    sched.stop();

    expect(notes.length).toBeGreaterThanOrEqual(1);
    const note = notes[0];
    const stepDuration = 0.125;
    const baseTime = 1.2 * stepDuration;
    // floor(1.2) = 1, which is odd → swing applies
    const swingDelay = 0.5 * (stepDuration * 0.75);
    expect(note.time).toBeCloseTo(baseTime + swingDelay, 3);
  });

  it('uses NoteEvent duration for gate-off', () => {
    const vid = session.tracks[0].id;
    const track = getTrack(session, vid);
    const events: MusicalEvent[] = [
      { kind: 'note', at: 2, pitch: 60, velocity: 0.8, duration: 0.5 } as NoteEvent,
    ];
    const newRegion = { ...track.patterns[0], events };
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, patterns: [newRegion] } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.5;
    vi.advanceTimersByTime(200);
    sched.stop();

    expect(notes.length).toBeGreaterThanOrEqual(1);
    const note = notes[0];
    const stepDuration = 0.125;
    // gate-off at event.at + duration = 2 + 0.5 = 2.5 steps
    // gateOffTime = startTime + 2.5 * 0.125 = 0.3125
    expect(note.gateOffTime).toBeCloseTo(note.time + 0.5 * stepDuration, 3);
  });

  it('only schedules events within lookahead window', () => {
    const vid = session.tracks[0].id;
    const track = getTrack(session, vid);
    // Events at step 0 (in window) and step 12 (far beyond lookahead)
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      { kind: 'trigger', at: 12, velocity: 0.8 } as TriggerEvent,
    ];
    const newRegion = { ...track.patterns[0], events };
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, patterns: [newRegion] } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    // Don't advance audioTime — only the initial tick fires, cursor starts at 0
    // Lookahead = 0.1s = 0.8 steps at 120bpm, so only step 0 should be scheduled
    sched.stop();

    expect(notes.length).toBe(1);
    expect(notes[0].time).toBeCloseTo(0, 3); // step 0
  });

  // --- Scheduler hardening tests ---

  it('tempo change mid-pattern does not duplicate or skip notes', () => {
    const vid = session.tracks[0].id;
    const track = getTrack(session, vid);
    // Events at steps 0, 2, 4, 6
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      { kind: 'trigger', at: 2, velocity: 0.8 } as TriggerEvent,
      { kind: 'trigger', at: 4, velocity: 0.8 } as TriggerEvent,
      { kind: 'trigger', at: 6, velocity: 0.8 } as TriggerEvent,
    ];
    const newRegion = { ...track.patterns[0], duration: 8, events };
    let currentSession: Session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, patterns: [newRegion], stepGrid: { ...v.stepGrid, length: 8 } } : v
      ),
    };

    const sched = new Scheduler(
      () => currentSession,
      () => audioTime,
      () => 'running' as AudioContextState,
      (note) => notes.push(note),
      (pos) => positions.push(pos),
      () => ({}),
    );

    sched.start(0);
    // Advance to 0.3s (past step 2 at 120 BPM = 0.25s)
    audioTime = 0.3;
    vi.advanceTimersByTime(100);

    const notesBeforeChange = notes.length;
    expect(notesBeforeChange).toBeGreaterThanOrEqual(2); // steps 0 and 2

    // Change BPM to 90
    currentSession = {
      ...currentSession,
      transport: { ...currentSession.transport, bpm: 90 },
    };

    // Continue advancing — at 90 BPM, stepDuration = 60/(90*4) = ~0.167s
    for (let t = 0.35; t <= 1.5; t += 0.1) {
      audioTime = t;
      vi.advanceTimersByTime(30);
    }
    sched.stop();

    // All 4 events should fire exactly once per loop cycle
    const trackNotes = notes.filter(n => n.trackId === vid);
    // Count unique note times (within tolerance) to detect duplicates
    const uniqueTimes = trackNotes.reduce((acc, n) => {
      if (!acc.some(t => Math.abs(t - n.time) < 0.001)) acc.push(n.time);
      return acc;
    }, [] as number[]);
    expect(uniqueTimes.length).toBe(trackNotes.length); // no duplicates
    expect(trackNotes.length).toBeGreaterThanOrEqual(4); // all 4 events scheduled
  });

  it('background tab catch-up: large time jump caps to MAX_CATCHUP_STEPS', () => {
    const vid = session.tracks[0].id;
    const track = getTrack(session, vid);
    // 16-step region with triggers at every even step (0,2,4,6,8,10,12,14)
    const events: MusicalEvent[] = Array.from({ length: 8 }, (_, i) =>
      ({ kind: 'trigger', at: i * 2, velocity: 0.8 }) as TriggerEvent
    );
    const newRegion = { ...track.patterns[0], events };
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, patterns: [newRegion] } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    // Simulate browser throttling: jump audio time by 5 seconds in one tick
    // At 120 BPM, 16 steps = 2s, so 5s = 40 steps. Catch-up is capped to
    // MAX_CATCHUP_STEPS (8), so only events in the last ~8 steps get scheduled.
    audioTime = 5.0;
    vi.advanceTimersByTime(30); // single tick fires
    sched.stop();

    const trackNotes = notes.filter(n => n.trackId === vid);
    // With catch-up cap, we should get far fewer notes than the full 20+
    // that would be scheduled without the cap. The window covers ~8 steps
    // plus lookahead, so expect a bounded number.
    expect(trackNotes.length).toBeLessThan(16);
    expect(trackNotes.length).toBeGreaterThan(0);

    // Verify no duplicate times
    const uniqueTimes = trackNotes.reduce((acc, n) => {
      if (!acc.some(t => Math.abs(t - n.time) < 0.001)) acc.push(n.time);
      return acc;
    }, [] as number[]);
    expect(uniqueTimes.length).toBe(trackNotes.length);
  });

  it('empty region emits zero notes', () => {
    const vid = session.tracks[0].id;
    const track = getTrack(session, vid);
    // Pattern with empty events array
    const newRegion = { ...track.patterns[0], events: [] };
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, patterns: [newRegion] } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    audioTime = 2.0;
    vi.advanceTimersByTime(200);
    sched.stop();

    const trackNotes = notes.filter(n => n.trackId === vid);
    expect(trackNotes.length).toBe(0);
  });

  it('no region on track emits zero notes', () => {
    const vid = session.tracks[0].id;
    // Remove regions entirely
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, patterns: [] } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    audioTime = 1.0;
    vi.advanceTimersByTime(100);
    sched.stop();

    const trackNotes = notes.filter(n => n.trackId === vid);
    expect(trackNotes.length).toBe(0);
  });

  it('position is computed from absolute offset, not accumulated', () => {
    const vid = session.tracks[0].id;
    session = toggleStepGate(session, vid, 0);

    const sched = createScheduler();
    sched.start(0);

    // Advance through many ticks
    for (let t = 0.1; t <= 2.0; t += 0.1) {
      audioTime = t;
      vi.advanceTimersByTime(30);
    }
    // Final tick at exactly 2.0
    audioTime = 2.0;
    vi.advanceTimersByTime(30);

    // In pattern mode, position wraps at pattern duration (16 steps).
    // 2.0 / 0.125 = 16 steps exactly = wraps to 0.
    const lastPosition = positions[positions.length - 1];
    // Position should be near 0 after wrapping
    expect(lastPosition).toBeLessThan(2);

    sched.stop();
  });

  it('does not miss step-0 events on loop boundaries due to floating-point cursor drift', () => {
    const vid = session.tracks[0].id;
    const track = getTrack(session, vid);
    // Single kick on step 0, 16-step pattern
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
    ];
    const newRegion = { ...track.patterns[0], duration: 16, events };
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, patterns: [newRegion] } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    // Advance through 4 full loops (16 steps * 4 = 64 steps = 8 seconds at 120 BPM)
    // Tick every 25ms, advancing audioTime proportionally
    for (let t = 0.025; t <= 8.5; t += 0.025) {
      audioTime = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    const trackNotes = notes.filter(n => n.trackId === vid);
    // Should have at least 4 notes (one per loop): at steps 0, 16, 32, 48
    expect(trackNotes.length).toBeGreaterThanOrEqual(4);
  });

  // --- Pattern mode: wraps at active pattern duration ---

  it('pattern mode wraps playback at pattern duration', () => {
    const vid = session.tracks[0].id;
    const track = getTrack(session, vid);
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      { kind: 'trigger', at: 4, velocity: 0.8 } as TriggerEvent,
    ];
    const newRegion = { ...track.patterns[0], duration: 8, events };
    // Mute all other tracks so the max pattern duration is 8 (not 16).
    // Pattern-mode wrap uses the max active pattern duration across all
    // audible tracks.
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, patterns: [newRegion] } : { ...v, muted: true }
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    // Run long enough for multiple loops of an 8-step pattern (8 steps = 1s at 120 BPM)
    for (let t = 0.025; t <= 3.0; t += 0.025) {
      audioTime = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // In pattern mode, position wraps at pattern duration (8 steps)
    // All positions should be less than pattern duration + small tolerance
    for (const p of positions) {
      expect(p).toBeLessThan(8 + 1); // small tolerance for lookahead
    }

    // Step 0 should fire multiple times due to looping
    const step0Notes = notes.filter(n => n.trackId === vid);
    expect(step0Notes.length).toBeGreaterThan(2);
  });

  it('resolves ParameterEvents into scheduled note params', () => {
    const vid = session.tracks[0].id;
    const track = getTrack(session, vid);
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      { kind: 'parameter', at: 0, controlId: 'harmonics', value: 0.3 } as ParameterEvent,
      { kind: 'parameter', at: 0, controlId: 'morph', value: 0.7 } as ParameterEvent,
    ];
    const newRegion = { ...track.patterns[0], events };
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, patterns: [newRegion] } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.2;
    vi.advanceTimersByTime(100);
    sched.stop();

    expect(notes.length).toBeGreaterThanOrEqual(1);
    // Parameter events at same position should be merged
    expect(notes[0].params.harmonics).toBe(0.3);
    expect(notes[0].params.morph).toBe(0.7);
    // Track base params not overridden should remain
    expect(notes[0].params.timbre).toBe(0.5);
  });

  // --- Time signature tests ---

  it('metronome uses time signature for beat grouping (3/4)', () => {
    // Set 3/4 time: stepsPerBeat = 16/4 = 4, stepsPerBar = 4*3 = 12
    session = {
      ...session,
      transport: {
        ...session.transport,
        metronome: { enabled: true, volume: 0.5 },
        timeSignature: { numerator: 3, denominator: 4 },
      },
    };

    const clicks: { time: number; accent: boolean }[] = [];
    const sched = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      (note) => notes.push(note),
      (pos) => positions.push(pos),
      () => ({}),
      undefined,
      (time, accent) => clicks.push({ time, accent }),
    );

    sched.start(0);
    // At 120 BPM, step duration = 0.125s
    // 3/4 time: stepsPerBeat=4, stepsPerBar=12
    // Beat clicks at steps 0, 4, 8, 12, 16, 20, 24...
    // Downbeats at steps 0, 12, 24... (every 12 steps = 1.5s)
    audioTime = 3.5; // enough for ~28 steps
    vi.advanceTimersByTime(200);
    sched.stop();

    expect(clicks.length).toBeGreaterThan(0);
    // First click should be a downbeat (step 0)
    expect(clicks[0].accent).toBe(true);
    // In 3/4, downbeats happen every 3 beats (12 steps).
    // Clicks at steps 0,4,8,12,16,20,24 → downbeats at 0,12,24
    // clicks[0]=step 0 (accent), clicks[1]=step 4 (no accent), clicks[2]=step 8 (no accent), clicks[3]=step 12 (accent)
    if (clicks.length >= 4) {
      expect(clicks[1].accent).toBe(false); // beat 2
      expect(clicks[2].accent).toBe(false); // beat 3
      expect(clicks[3].accent).toBe(true);  // downbeat of bar 2
    }
  });

  it('metronome uses time signature for beat grouping (6/8)', () => {
    // 6/8 time: stepsPerBeat = 16/8 = 2, stepsPerBar = 2*6 = 12
    session = {
      ...session,
      transport: {
        ...session.transport,
        metronome: { enabled: true, volume: 0.5 },
        timeSignature: { numerator: 6, denominator: 8 },
      },
    };

    const clicks: { time: number; accent: boolean }[] = [];
    const sched = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      (note) => notes.push(note),
      (pos) => positions.push(pos),
      () => ({}),
      undefined,
      (time, accent) => clicks.push({ time, accent }),
    );

    sched.start(0);
    audioTime = 2.0;
    vi.advanceTimersByTime(200);
    sched.stop();

    expect(clicks.length).toBeGreaterThan(0);
    // In 6/8: stepsPerBeat=2, stepsPerBar=12
    // Clicks at steps 0,2,4,6,8,10,12...
    // Downbeats at 0, 12, 24 (every 12 steps)
    expect(clicks[0].accent).toBe(true);   // step 0 = downbeat
    if (clicks.length >= 7) {
      expect(clicks[1].accent).toBe(false); // step 2
      expect(clicks[6].accent).toBe(true);  // step 12 = downbeat of bar 2
    }
  });

  // --- Solo / mute scheduling tests (#769) ---

  it('schedules events on non-soloed tracks (solo is gain-only)', () => {
    // Add a second audio track
    session = addTrack(session)!;
    // Gate step 0 on both audio tracks
    const track0Id = session.tracks[0].id;
    const track1Id = session.tracks[1].id;  // second audio track (not master bus)
    session = toggleStepGate(session, track0Id, 0);
    session = toggleStepGate(session, track1Id, 0);

    // Solo track 0 — track 1 is NOT soloed
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === track0Id ? { ...v, solo: true } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.2;
    vi.advanceTimersByTime(100);
    sched.stop();

    // Both tracks should have scheduled notes — solo is a monitoring
    // concern handled by gain muting, not a scheduling concern.
    const scheduledTrackIds = [...new Set(notes.map(n => n.trackId))];
    expect(scheduledTrackIds).toContain(track0Id);
    expect(scheduledTrackIds).toContain(track1Id);
  });

  it('muted tracks are still excluded from scheduling', () => {
    session = addTrack(session)!;
    const track0Id = session.tracks[0].id;
    const track1Id = session.tracks[1].id;
    session = toggleStepGate(session, track0Id, 0);
    session = toggleStepGate(session, track1Id, 0);

    // Mute track 0
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === track0Id ? { ...v, muted: true } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.2;
    vi.advanceTimersByTime(100);
    sched.stop();

    const scheduledTrackIds = [...new Set(notes.map(n => n.trackId))];
    expect(scheduledTrackIds).not.toContain(track0Id);
    expect(scheduledTrackIds).toContain(track1Id);
  });

  it('default time signature (4/4) behaves like hardcoded 4', () => {
    // The default session has 4/4, which should have the same behavior as before
    session = {
      ...session,
      transport: {
        ...session.transport,
        metronome: { enabled: true, volume: 0.5 },
        timeSignature: { numerator: 4, denominator: 4 },
      },
    };

    const clicks: { time: number; accent: boolean }[] = [];
    const sched = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      (note) => notes.push(note),
      (pos) => positions.push(pos),
      () => ({}),
      undefined,
      (time, accent) => clicks.push({ time, accent }),
    );

    sched.start(0);
    audioTime = 2.5;
    vi.advanceTimersByTime(200);
    sched.stop();

    expect(clicks.length).toBeGreaterThan(0);
    // 4/4: stepsPerBeat=4, stepsPerBar=16
    // Clicks at 0,4,8,12,16... Downbeats at 0,16...
    expect(clicks[0].accent).toBe(true);  // step 0 = downbeat
    if (clicks.length >= 5) {
      expect(clicks[1].accent).toBe(false);
      expect(clicks[2].accent).toBe(false);
      expect(clicks[3].accent).toBe(false);
      expect(clicks[4].accent).toBe(true);  // step 16 = downbeat of bar 2
    }
  });

  // --- Per-track swing ---

  it('uses per-track swing when set, overriding global transport swing', () => {
    // Global swing = 0, per-track swing = 0.5
    session = { ...session, transport: { ...session.transport, swing: 0 } };
    const vid = session.tracks[0].id;
    session = {
      ...session,
      tracks: session.tracks.map(t =>
        t.id === vid ? { ...t, swing: 0.5 } : t,
      ),
    };
    // Gate steps 0 and 1
    session = toggleStepGate(session, vid, 0);
    session = toggleStepGate(session, vid, 1);

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.5;
    vi.advanceTimersByTime(200);
    sched.stop();

    // Step 0 = even, no swing delay. Step 1 = odd, per-track swing applies.
    const step0Notes = notes.filter(n => n.time < 0.13);
    const step1Notes = notes.filter(n => n.time >= 0.13);
    expect(step0Notes.length).toBeGreaterThanOrEqual(1);
    expect(step1Notes.length).toBeGreaterThanOrEqual(1);
    // Step 1 should be delayed by swing (0.5 * 0.125 * 0.75 = 0.046875)
    const stepDuration = 0.125;
    const expectedStep1 = stepDuration + 0.5 * (stepDuration * 0.75);
    expect(step1Notes[0].time).toBeCloseTo(expectedStep1, 3);
  });

  it('falls back to global transport swing when track swing is undefined', () => {
    // Global swing = 0.5, track swing = undefined (default)
    session = { ...session, transport: { ...session.transport, swing: 0.5 } };
    const vid = session.tracks[0].id;
    // Ensure track.swing is undefined (default)
    expect(session.tracks[0].swing).toBeUndefined();
    session = toggleStepGate(session, vid, 0);
    session = toggleStepGate(session, vid, 1);

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.5;
    vi.advanceTimersByTime(200);
    sched.stop();

    const step1Notes = notes.filter(n => n.time >= 0.13);
    expect(step1Notes.length).toBeGreaterThanOrEqual(1);
    const stepDuration = 0.125;
    const expectedStep1 = stepDuration + 0.5 * (stepDuration * 0.75);
    expect(step1Notes[0].time).toBeCloseTo(expectedStep1, 3);
  });

  it('falls back to global transport swing when track swing is null', () => {
    // Global swing = 0.5, track swing = null (explicit inherit)
    session = { ...session, transport: { ...session.transport, swing: 0.5 } };
    const vid = session.tracks[0].id;
    session = {
      ...session,
      tracks: session.tracks.map(t =>
        t.id === vid ? { ...t, swing: null } : t,
      ),
    };
    session = toggleStepGate(session, vid, 0);
    session = toggleStepGate(session, vid, 1);

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.5;
    vi.advanceTimersByTime(200);
    sched.stop();

    const step1Notes = notes.filter(n => n.time >= 0.13);
    expect(step1Notes.length).toBeGreaterThanOrEqual(1);
    const stepDuration = 0.125;
    const expectedStep1 = stepDuration + 0.5 * (stepDuration * 0.75);
    expect(step1Notes[0].time).toBeCloseTo(expectedStep1, 3);
  });

  it('allows straight kick with swung hats via per-track swing', () => {
    // Two tracks: track 1 (straight, swing=0), track 2 (swung, swing=0.5)
    // Global swing = 0.3 (should be overridden by per-track values)
    session = { ...session, transport: { ...session.transport, swing: 0.3 } };
    session = addTrack(session);
    const track1Id = session.tracks[0].id;
    const track2Id = session.tracks[1].id;
    session = {
      ...session,
      tracks: session.tracks.map(t => {
        if (t.id === track1Id) return { ...t, swing: 0 };
        if (t.id === track2Id) return { ...t, swing: 0.5 };
        return t;
      }),
    };
    // Gate step 1 on both tracks (odd position = swing target)
    session = toggleStepGate(session, track1Id, 1);
    session = toggleStepGate(session, track2Id, 1);

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.5;
    vi.advanceTimersByTime(200);
    sched.stop();

    const track1Notes = notes.filter(n => n.trackId === track1Id);
    const track2Notes = notes.filter(n => n.trackId === track2Id);
    expect(track1Notes.length).toBeGreaterThanOrEqual(1);
    expect(track2Notes.length).toBeGreaterThanOrEqual(1);

    const stepDuration = 0.125;
    // Track 1 (swing=0): step 1 at base time, no delay
    expect(track1Notes[0].time).toBeCloseTo(stepDuration, 3);
    // Track 2 (swing=0.5): step 1 delayed
    const expectedSwung = stepDuration + 0.5 * (stepDuration * 0.75);
    expect(track2Notes[0].time).toBeCloseTo(expectedSwung, 3);
    // Track 2 should be later than track 1
    expect(track2Notes[0].time).toBeGreaterThan(track1Notes[0].time);
  });

  // --- Time signature change during playback ---

  it('re-aligns metronome clicks when time signature changes mid-playback', () => {
    // Start in 4/4: stepsPerBeat = 4, clicks at steps 0, 4, 8, 12...
    session = {
      ...session,
      transport: {
        ...session.transport,
        metronome: { enabled: true, volume: 0.5 },
        timeSignature: { numerator: 4, denominator: 4 },
      },
    };

    const clicks: { time: number; accent: boolean }[] = [];
    const sched = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      (note) => notes.push(note),
      (pos) => positions.push(pos),
      () => ({}),
      undefined,
      (time, accent) => clicks.push({ time, accent }),
    );

    sched.start(0);
    // At 120 BPM, step duration = 0.125s
    // Advance to step ~10 (1.25s) — clicks at steps 0, 4, 8
    audioTime = 1.25;
    vi.advanceTimersByTime(100);

    const clicksBefore = clicks.length;
    expect(clicksBefore).toBeGreaterThanOrEqual(3); // steps 0, 4, 8

    // Switch to 3/8: stepsPerBeat = 16/8 = 2, stepsPerBar = 2*3 = 6
    session = {
      ...session,
      transport: {
        ...session.transport,
        timeSignature: { numerator: 3, denominator: 8 },
      },
    };

    // Advance further — next clicks should be on the new 8th-note grid (every 2 steps)
    audioTime = 2.5;
    vi.advanceTimersByTime(100);
    sched.stop();

    // Clicks after the change should be spaced by stepsPerBeat=2 (0.25s apart)
    const newClicks = clicks.slice(clicksBefore);
    expect(newClicks.length).toBeGreaterThanOrEqual(2);

    // Verify spacing: consecutive clicks should be ~0.25s apart (2 steps * 0.125s)
    for (let i = 1; i < newClicks.length; i++) {
      const gap = newClicks[i].time - newClicks[i - 1].time;
      expect(gap).toBeCloseTo(0.25, 2);
    }

    // Verify downbeat accenting uses new bar size (every 6 steps = 0.75s)
    // Find accented clicks in the new section
    const accentedNew = newClicks.filter(c => c.accent);
    const nonAccentedNew = newClicks.filter(c => !c.accent);
    // In 3/8 there should be non-accented beats between downbeats
    if (newClicks.length >= 4) {
      expect(nonAccentedNew.length).toBeGreaterThan(0);
    }
  });

  it('applies sequence automation in pattern mode when PatternRef has automation', () => {
    const vid = session.tracks[0].id;
    const track = getTrack(session, vid);
    const patternId = track.patterns[0].id;

    // Set up: trigger at step 0, sequence automation on timbre
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
    ];
    session = {
      ...session,
      transport: { ...session.transport, mode: 'pattern' as const },
      tracks: session.tracks.map(t => t.id === vid
        ? {
            ...t,
            patterns: [{ ...t.patterns[0], events, duration: 16 }],
            sequence: [{
              patternId,
              automation: [{
                controlId: 'timbre',
                points: [{ at: 0, value: 0.9 }],
              }],
            }],
          }
        : t
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.2;
    vi.advanceTimersByTime(100);
    sched.stop();

    // The note should have timbre=0.9 from sequence automation
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].params.timbre).toBeCloseTo(0.9, 2);
  });

  it('schedules automation-only patterns in pattern mode (no musical events)', () => {
    const vid = session.tracks[0].id;
    const track = getTrack(session, vid);
    const patternId = track.patterns[0].id;

    const paramEvents: ScheduledParameterEvent[] = [];

    // Pattern with no musical events, only sequence automation
    session = {
      ...session,
      transport: { ...session.transport, mode: 'pattern' as const },
      tracks: session.tracks.map(t => t.id === vid
        ? {
            ...t,
            patterns: [{ ...t.patterns[0], events: [], duration: 16 }],
            sequence: [{
              patternId,
              automation: [{
                controlId: 'timbre',
                points: [{ at: 0, value: 0.7 }],
              }],
            }],
          }
        : t
      ),
    };

    const sched = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      (note) => notes.push(note),
      (pos) => positions.push(pos),
      () => ({}),
      (pe) => paramEvents.push(pe),
    );
    sched.start(0);
    audioTime = 0.5;
    vi.advanceTimersByTime(200);
    sched.stop();

    // Should emit parameter events from the sequence automation even with no note events
    expect(paramEvents.length).toBeGreaterThanOrEqual(1);
    expect(paramEvents[0].controlId).toBe('timbre');
    expect(paramEvents[0].value).toBeCloseTo(0.7, 2);
  });
});
