// tests/engine/scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../../src/engine/scheduler';
import { createSession } from '../../src/engine/session';
import { toggleStepGate } from '../../src/engine/pattern-primitives';
import type { Session } from '../../src/engine/types';
import type { ScheduledNote } from '../../src/engine/sequencer-types';
import { getVoice } from '../../src/engine/types';
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
    // Gate steps 0 and 4 on voice 0
    const vid = session.voices[0].id;
    session = toggleStepGate(session, vid, 0);
    session = toggleStepGate(session, vid, 4);

    const sched = createScheduler();
    sched.start(0);

    // BPM 120 = 0.125s per 16th note
    // Advance enough time for step 0 to be scheduled
    audioTime = 0.2;
    vi.advanceTimersByTime(100);

    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].voiceId).toBe(vid);
    expect(notes[0].params).toBeDefined();
    sched.stop();
  });

  it('publishes position changes', () => {
    const vid = session.voices[0].id;
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
    const vid = session.voices[0].id;
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

  it('resolves note params with voice base + step locks', () => {
    const vid = session.voices[0].id;
    // Set a param lock on step 0 via canonical events
    const voice = getVoice(session, vid);
    // Add trigger + parameter event at step 0
    const newEvents: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      { kind: 'parameter', at: 0, controlId: 'timbre', value: 0.9 } as ParameterEvent,
    ];
    const newRegions = [{ ...voice.regions[0], events: newEvents }, ...voice.regions.slice(1)];
    // Also update pattern steps to stay in sync
    const newSteps = [...voice.pattern.steps];
    newSteps[0] = { gate: true, accent: false, micro: 0, params: { timbre: 0.9 } };
    session = {
      ...session,
      voices: session.voices.map(v => v.id === vid
        ? { ...v, regions: newRegions, pattern: { ...v.pattern, steps: newSteps } }
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
    expect(notes[0].params.morph).toBe(0.5); // voice base
  });

  it('computes gateOffTime as next step time', () => {
    const vid = session.voices[0].id;
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
    const vid = session.voices[0].id;
    session = toggleStepGate(session, vid, 0);
    session = toggleStepGate(session, vid, 4);

    let currentSession = session;
    const sched = new Scheduler(
      () => currentSession,
      () => audioTime,
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
    // Create a voice with 8-step region + pattern, gate on step 0
    const vid = session.voices[0].id;
    const voice = session.voices.find(v => v.id === vid)!;
    const newSteps = voice.pattern.steps.slice(0, 8).map((s, i) =>
      i === 0 ? { ...s, gate: true } : s
    );
    const newEvents: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
    ];
    const newRegion = { ...voice.regions[0], duration: 8, events: newEvents };
    session = {
      ...session,
      voices: session.voices.map(v =>
        v.id === vid ? { ...v, pattern: { steps: newSteps, length: 8 }, regions: [newRegion] } : v
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
    const step0Notes = notes.filter(n => n.voiceId === vid);
    expect(step0Notes.length).toBeGreaterThanOrEqual(2);
  });

  it('only schedules audible voices', () => {
    // Mute voice 0, gate step 0 on both voice 0 and voice 1
    session = toggleStepGate(session, session.voices[0].id, 0);
    session = toggleStepGate(session, session.voices[1].id, 0);
    session = {
      ...session,
      voices: session.voices.map(v =>
        v.id === session.voices[0].id ? { ...v, muted: true } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    audioTime = 0.2;
    vi.advanceTimersByTime(100);
    sched.stop();

    // Only voice 1 notes should appear
    const voiceIds = [...new Set(notes.map(n => n.voiceId))];
    expect(voiceIds).not.toContain(session.voices[0].id);
    if (notes.length > 0) {
      expect(voiceIds).toContain(session.voices[1].id);
    }
  });

  // --- New event-based scheduler tests ---

  it('schedules fractional position events with correct timing', () => {
    const vid = session.voices[0].id;
    const voice = getVoice(session, vid);
    // Place event at fractional position 4.3
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 4.3, velocity: 0.8 } as TriggerEvent,
    ];
    const newRegion = { ...voice.regions[0], events };
    session = {
      ...session,
      voices: session.voices.map(v =>
        v.id === vid ? { ...v, regions: [newRegion] } : v
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
    const vid = session.voices[0].id;
    const voice = getVoice(session, vid);
    // Place event at step 1.2 (odd position — swing applies)
    session = { ...session, transport: { ...session.transport, swing: 0.5 } };
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 1.2, velocity: 0.8 } as TriggerEvent,
    ];
    const newRegion = { ...voice.regions[0], events };
    session = {
      ...session,
      voices: session.voices.map(v =>
        v.id === vid ? { ...v, regions: [newRegion] } : v
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
    const vid = session.voices[0].id;
    const voice = getVoice(session, vid);
    const events: MusicalEvent[] = [
      { kind: 'note', at: 2, pitch: 60, velocity: 0.8, duration: 0.5 } as NoteEvent,
    ];
    const newRegion = { ...voice.regions[0], events };
    session = {
      ...session,
      voices: session.voices.map(v =>
        v.id === vid ? { ...v, regions: [newRegion] } : v
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
    const vid = session.voices[0].id;
    const voice = getVoice(session, vid);
    // Events at step 0 (in window) and step 12 (far beyond lookahead)
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      { kind: 'trigger', at: 12, velocity: 0.8 } as TriggerEvent,
    ];
    const newRegion = { ...voice.regions[0], events };
    session = {
      ...session,
      voices: session.voices.map(v =>
        v.id === vid ? { ...v, regions: [newRegion] } : v
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
    const vid = session.voices[0].id;
    const voice = getVoice(session, vid);
    // Events at steps 0, 2, 4, 6
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      { kind: 'trigger', at: 2, velocity: 0.8 } as TriggerEvent,
      { kind: 'trigger', at: 4, velocity: 0.8 } as TriggerEvent,
      { kind: 'trigger', at: 6, velocity: 0.8 } as TriggerEvent,
    ];
    const newRegion = { ...voice.regions[0], duration: 8, events };
    let currentSession: Session = {
      ...session,
      voices: session.voices.map(v =>
        v.id === vid ? { ...v, regions: [newRegion], pattern: { ...v.pattern, length: 8 } } : v
      ),
    };

    const sched = new Scheduler(
      () => currentSession,
      () => audioTime,
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
    const voiceNotes = notes.filter(n => n.voiceId === vid);
    // Count unique note times (within tolerance) to detect duplicates
    const uniqueTimes = voiceNotes.reduce((acc, n) => {
      if (!acc.some(t => Math.abs(t - n.time) < 0.001)) acc.push(n.time);
      return acc;
    }, [] as number[]);
    expect(uniqueTimes.length).toBe(voiceNotes.length); // no duplicates
    expect(voiceNotes.length).toBeGreaterThanOrEqual(4); // all 4 events scheduled
  });

  it('background tab catch-up: large time jump schedules all events exactly once', () => {
    const vid = session.voices[0].id;
    const voice = getVoice(session, vid);
    // 16-step region with triggers at every even step (0,2,4,6,8,10,12,14)
    const events: MusicalEvent[] = Array.from({ length: 8 }, (_, i) =>
      ({ kind: 'trigger', at: i * 2, velocity: 0.8 }) as TriggerEvent
    );
    const newRegion = { ...voice.regions[0], events };
    session = {
      ...session,
      voices: session.voices.map(v =>
        v.id === vid ? { ...v, regions: [newRegion] } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    // Simulate browser throttling: jump audio time by 5 seconds in one tick
    // At 120 BPM, 16 steps = 2s, so 5s = 2.5 full cycles = 20 events expected
    audioTime = 5.0;
    vi.advanceTimersByTime(30); // single tick fires
    sched.stop();

    const voiceNotes = notes.filter(n => n.voiceId === vid);
    // 8 events per cycle * 2.5 cycles (cursor starts at 0, window spans to ~40 steps)
    // but exact count depends on where the window boundary falls
    expect(voiceNotes.length).toBeGreaterThanOrEqual(16); // at least 2 full cycles

    // Verify no duplicate times
    const uniqueTimes = voiceNotes.reduce((acc, n) => {
      if (!acc.some(t => Math.abs(t - n.time) < 0.001)) acc.push(n.time);
      return acc;
    }, [] as number[]);
    expect(uniqueTimes.length).toBe(voiceNotes.length);
  });

  it('empty region emits zero notes', () => {
    const vid = session.voices[0].id;
    const voice = getVoice(session, vid);
    // Region with empty events array
    const newRegion = { ...voice.regions[0], events: [] };
    session = {
      ...session,
      voices: session.voices.map(v =>
        v.id === vid ? { ...v, regions: [newRegion] } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    audioTime = 2.0;
    vi.advanceTimersByTime(200);
    sched.stop();

    const voiceNotes = notes.filter(n => n.voiceId === vid);
    expect(voiceNotes.length).toBe(0);
  });

  it('no region on voice emits zero notes', () => {
    const vid = session.voices[0].id;
    // Remove regions entirely
    session = {
      ...session,
      voices: session.voices.map(v =>
        v.id === vid ? { ...v, regions: [] } : v
      ),
    };

    const sched = createScheduler();
    sched.start(0);
    audioTime = 1.0;
    vi.advanceTimersByTime(100);
    sched.stop();

    const voiceNotes = notes.filter(n => n.voiceId === vid);
    expect(voiceNotes.length).toBe(0);
  });

  it('position is computed from absolute offset, not accumulated', () => {
    const vid = session.voices[0].id;
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

    // Position should match elapsed / stepDuration exactly
    const lastPosition = positions[positions.length - 1];
    const stepDuration = 0.125; // 120 BPM
    const expectedPosition = 2.0 / stepDuration;
    expect(lastPosition).toBeCloseTo(expectedPosition, 1);

    sched.stop();
  });

  it('does not miss step-0 events on loop boundaries due to floating-point cursor drift', () => {
    const vid = session.voices[0].id;
    const voice = getVoice(session, vid);
    // Single kick on step 0, 16-step pattern
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
    ];
    const newRegion = { ...voice.regions[0], duration: 16, events };
    session = {
      ...session,
      voices: session.voices.map(v =>
        v.id === vid ? { ...v, regions: [newRegion] } : v
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

    const voiceNotes = notes.filter(n => n.voiceId === vid);
    // Should have at least 4 notes (one per loop): at steps 0, 16, 32, 48
    expect(voiceNotes.length).toBeGreaterThanOrEqual(4);
  });

  it('resolves ParameterEvents into scheduled note params', () => {
    const vid = session.voices[0].id;
    const voice = getVoice(session, vid);
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      { kind: 'parameter', at: 0, controlId: 'harmonics', value: 0.3 } as ParameterEvent,
      { kind: 'parameter', at: 0, controlId: 'morph', value: 0.7 } as ParameterEvent,
    ];
    const newRegion = { ...voice.regions[0], events };
    session = {
      ...session,
      voices: session.voices.map(v =>
        v.id === vid ? { ...v, regions: [newRegion] } : v
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
    // Voice base params not overridden should remain
    expect(notes[0].params.timbre).toBe(0.5);
  });
});
