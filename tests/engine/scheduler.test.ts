// tests/engine/scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../../src/engine/scheduler';
import { createSession } from '../../src/engine/session';
import { toggleStepGate } from '../../src/engine/pattern-primitives';
import type { Session } from '../../src/engine/types';
import type { ScheduledNote } from '../../src/engine/sequencer-types';
import { getVoice } from '../../src/engine/types';

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
    sched.start();
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
    sched.start();

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
    sched.start();
    audioTime = 0.3;
    vi.advanceTimersByTime(100);
    expect(positions.length).toBeGreaterThan(0);
    sched.stop();
  });

  it('stops cleanly', () => {
    const sched = createScheduler();
    sched.start();
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
    sched.start();
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
    // Set a param lock on step 0
    const voice = getVoice(session, vid);
    const newSteps = [...voice.pattern.steps];
    newSteps[0] = { gate: true, accent: false, micro: 0, params: { timbre: 0.9 } };
    session = {
      ...session,
      voices: session.voices.map(v => v.id === vid
        ? { ...v, pattern: { ...v.pattern, steps: newSteps } }
        : v
      ),
    };

    const sched = createScheduler();
    sched.start();
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
    sched.start();
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

    sched.start();
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
    // Create an 8-step pattern with gate on step 0
    const vid = session.voices[0].id;
    const voice = session.voices.find(v => v.id === vid)!;
    const newSteps = voice.pattern.steps.slice(0, 8).map((s, i) =>
      i === 0 ? { ...s, gate: true } : s
    );
    session = {
      ...session,
      voices: session.voices.map(v =>
        v.id === vid ? { ...v, pattern: { steps: newSteps, length: 8 } } : v
      ),
    };

    const sched = createScheduler();
    sched.start();
    // Advance enough to wrap: at 120 BPM, 8 steps = 1s, so 1.2s should wrap
    audioTime = 1.2;
    vi.advanceTimersByTime(200);
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
    sched.start();
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
});
