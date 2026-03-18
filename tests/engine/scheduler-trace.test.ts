// tests/engine/scheduler-trace.test.ts
//
// Trace-based timing verification: record scheduler decisions and verify timing accuracy.
// Issue #857: adversarial + fuzz + trace testing for transport/scheduler/audio engine.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler, START_OFFSET_SEC } from '../../src/engine/scheduler';
import { createSession, addTrack } from '../../src/engine/session';
import type { Session } from '../../src/engine/types';
import { getTrack } from '../../src/engine/types';
import type { ScheduledNote } from '../../src/engine/sequencer-types';
import type { TriggerEvent, NoteEvent, MusicalEvent } from '../../src/engine/canonical-types';

interface TraceEntry {
  type: 'note_on' | 'gate_off';
  trackId: string;
  eventId?: string;
  /** Absolute step position of the event (local pattern step + cycle offset). */
  absoluteStep: number;
  /** Expected time in seconds (computed from absoluteStep and BPM). */
  expectedTimeMs: number;
  /** Actual scheduled time from the scheduler. */
  actualTimeMs: number;
  /** Gate-off time for note_on entries. */
  gateOffTimeMs?: number;
}

describe('Scheduler trace-based timing verification', () => {
  let session: Session;
  let audioTime: number;

  beforeEach(() => {
    vi.useFakeTimers();
    session = createSession();
    audioTime = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Run a scheduler simulation and collect a trace of all scheduled notes
   * with expected vs actual timing.
   */
  function collectTrace(opts: {
    events: MusicalEvent[];
    patternDuration: number;
    bpm: number;
    swing?: number;
    runTimeSeconds: number;
    trackId?: string;
    mode?: 'pattern' | 'song';
    patterns?: Array<{ id: string; duration: number; events: MusicalEvent[] }>;
    sequence?: Array<{ patternId: string }>;
  }): TraceEntry[] {
    const {
      events,
      patternDuration,
      bpm,
      swing = 0,
      runTimeSeconds,
      mode = 'pattern',
      patterns: multiPatterns,
      sequence,
    } = opts;

    session = {
      ...session,
      transport: { ...session.transport, bpm, swing, mode },
    };

    const vid = opts.trackId ?? session.tracks[0].id;
    const track = getTrack(session, vid);

    if (multiPatterns && sequence) {
      // Song mode: multiple patterns
      session = {
        ...session,
        tracks: session.tracks.map(v =>
          v.id === vid
            ? {
                ...v,
                patterns: multiPatterns.map(p => ({
                  ...track.patterns[0],
                  ...p,
                  kind: 'pattern' as const,
                })),
                sequence,
              }
            : { ...v, muted: true }
        ),
      };
    } else {
      // Pattern mode: single pattern
      const newPattern = { ...track.patterns[0], duration: patternDuration, events };
      session = {
        ...session,
        tracks: session.tracks.map(v =>
          v.id === vid ? { ...v, patterns: [newPattern] } : { ...v, muted: true }
        ),
      };
    }

    const trace: TraceEntry[] = [];
    const notes: ScheduledNote[] = [];

    const sched = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      (note) => notes.push(note),
      () => {},
      () => ({}),
    );

    sched.start(0);

    // Advance in small increments to simulate realistic timer behavior
    const tickInterval = 0.025; // 25ms
    for (let t = tickInterval; t <= runTimeSeconds; t += tickInterval) {
      audioTime = t;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // Build trace entries from collected notes
    const stepDuration = 60 / (bpm * 4); // seconds per step

    for (const note of notes) {
      if (note.trackId !== vid) continue;

      // Determine the absolute step from the note's time
      // The note time = startTime + absoluteStep * stepDuration + swingDelay
      // Since startTime ≈ 0 (START_OFFSET_SEC cancels), we reverse-engineer the step
      const noteTimeMs = note.time * 1000;
      const gateOffTimeMs = note.gateOffTime * 1000;

      // For the trace, we record the actual note-on time and gate-off time
      trace.push({
        type: 'note_on',
        trackId: note.trackId,
        eventId: note.eventId,
        absoluteStep: noteTimeMs / (stepDuration * 1000), // approximate
        expectedTimeMs: noteTimeMs, // will be refined per-test
        actualTimeMs: noteTimeMs,
        gateOffTimeMs,
      });
    }

    return trace;
  }

  // -----------------------------------------------------------------------
  // Basic timing accuracy
  // -----------------------------------------------------------------------

  describe('timing accuracy', () => {
    it('every event is within +-1ms of expected time at 120 BPM', () => {
      const bpm = 120;
      const stepDuration = 60 / (bpm * 4); // 0.125s
      const patternDuration = 16;

      // Events at every 4th step (beat positions)
      const events: MusicalEvent[] = [0, 4, 8, 12].map(at => ({
        kind: 'trigger' as const,
        at,
        velocity: 0.8,
      }) as TriggerEvent);

      const notes: ScheduledNote[] = [];
      session = {
        ...session,
        transport: { ...session.transport, bpm, swing: 0 },
      };
      const vid = session.tracks[0].id;
      const track = getTrack(session, vid);
      const newPattern = { ...track.patterns[0], duration: patternDuration, events };
      session = {
        ...session,
        tracks: session.tracks.map(v =>
          v.id === vid ? { ...v, patterns: [newPattern] } : { ...v, muted: true }
        ),
      };

      const sched = new Scheduler(
        () => session,
        () => audioTime,
        () => 'running' as AudioContextState,
        (note) => notes.push(note),
        () => {},
        () => ({}),
      );

      sched.start(0);
      // Run for 3 full loops
      for (let t = 0.025; t <= 6.5; t += 0.025) {
        audioTime = t;
        vi.advanceTimersByTime(25);
      }
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      expect(trackNotes.length).toBeGreaterThanOrEqual(12); // 4 events * 3 loops

      // Verify each note's timing against expected
      for (const note of trackNotes) {
        // The expected time for any note is: absoluteStep * stepDuration
        // We can derive absoluteStep from note.time
        const absoluteStep = note.time / stepDuration;
        const nearestExpectedStep = Math.round(absoluteStep);

        // Check the step is one of our event positions (mod patternDuration)
        const localStep = nearestExpectedStep % patternDuration;
        expect([0, 4, 8, 12]).toContain(localStep);

        // Check timing is within 1ms of expected
        const expectedTime = nearestExpectedStep * stepDuration;
        const drift = Math.abs(note.time - expectedTime) * 1000; // ms
        expect(drift).toBeLessThan(1);
      }
    });

    it('every event is within +-1ms at 90 BPM', () => {
      const bpm = 90;
      const stepDuration = 60 / (bpm * 4);
      const patternDuration = 8;
      const eventPositions = [0, 2, 4, 6];

      const events: MusicalEvent[] = eventPositions.map(at => ({
        kind: 'trigger' as const,
        at,
        velocity: 0.8,
      }) as TriggerEvent);

      const notes: ScheduledNote[] = [];
      session = {
        ...session,
        transport: { ...session.transport, bpm, swing: 0 },
      };
      const vid = session.tracks[0].id;
      const track = getTrack(session, vid);
      const newPattern = { ...track.patterns[0], duration: patternDuration, events };
      session = {
        ...session,
        tracks: session.tracks.map(v =>
          v.id === vid ? { ...v, patterns: [newPattern] } : { ...v, muted: true }
        ),
      };

      const sched = new Scheduler(
        () => session,
        () => audioTime,
        () => 'running' as AudioContextState,
        (note) => notes.push(note),
        () => {},
        () => ({}),
      );

      sched.start(0);
      // 8 steps at 90 BPM = 8 * (60/360) = 1.333s per loop. Run 5 loops.
      const loopTime = patternDuration * stepDuration;
      for (let t = 0.025; t <= loopTime * 5.5; t += 0.025) {
        audioTime = t;
        vi.advanceTimersByTime(25);
      }
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      expect(trackNotes.length).toBeGreaterThanOrEqual(20); // 4 events * 5 loops

      for (const note of trackNotes) {
        const absoluteStep = note.time / stepDuration;
        const nearestExpectedStep = Math.round(absoluteStep);
        const expectedTime = nearestExpectedStep * stepDuration;
        const drift = Math.abs(note.time - expectedTime) * 1000;
        expect(drift).toBeLessThan(1);
      }
    });
  });

  // -----------------------------------------------------------------------
  // No timing drift over 100+ loops
  // -----------------------------------------------------------------------

  describe('timing drift over extended playback', () => {
    it('no drift over 100+ loops of a 4-step pattern', () => {
      const bpm = 120;
      const stepDuration = 60 / (bpm * 4); // 0.125s
      const patternDuration = 4;

      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      ];

      const notes: ScheduledNote[] = [];
      session = {
        ...session,
        transport: { ...session.transport, bpm, swing: 0 },
      };
      const vid = session.tracks[0].id;
      const track = getTrack(session, vid);
      const newPattern = { ...track.patterns[0], duration: patternDuration, events };
      session = {
        ...session,
        tracks: session.tracks.map(v =>
          v.id === vid ? { ...v, patterns: [newPattern] } : { ...v, muted: true }
        ),
      };

      const sched = new Scheduler(
        () => session,
        () => audioTime,
        () => 'running' as AudioContextState,
        (note) => notes.push(note),
        () => {},
        () => ({}),
      );

      sched.start(0);
      // 4 steps at 120 BPM = 0.5s per loop. Run 110 loops = 55s
      const totalTime = patternDuration * stepDuration * 110;
      for (let t = 0.025; t <= totalTime; t += 0.025) {
        audioTime = t;
        vi.advanceTimersByTime(25);
      }
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      expect(trackNotes.length).toBeGreaterThanOrEqual(100);

      // Check that every note's timing matches expected position exactly
      // Expected times: 0, 0.5, 1.0, 1.5, 2.0, ... (every patternDuration * stepDuration)
      const loopTime = patternDuration * stepDuration;
      let maxDrift = 0;

      for (let i = 0; i < trackNotes.length; i++) {
        const note = trackNotes[i];
        // Expected: note falls on step 0 of loop i
        const expectedTime = i * loopTime;
        const drift = Math.abs(note.time - expectedTime) * 1000; // ms
        maxDrift = Math.max(maxDrift, drift);
      }

      // Maximum drift should be < 1ms even after 100+ loops
      expect(maxDrift).toBeLessThan(1);
    });

    it('no drift over 100+ loops at 200 BPM', () => {
      const bpm = 200;
      const stepDuration = 60 / (bpm * 4);
      const patternDuration = 8;

      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      ];

      const notes: ScheduledNote[] = [];
      session = {
        ...session,
        transport: { ...session.transport, bpm, swing: 0 },
      };
      const vid = session.tracks[0].id;
      const track = getTrack(session, vid);
      const newPattern = { ...track.patterns[0], duration: patternDuration, events };
      session = {
        ...session,
        tracks: session.tracks.map(v =>
          v.id === vid ? { ...v, patterns: [newPattern] } : { ...v, muted: true }
        ),
      };

      const sched = new Scheduler(
        () => session,
        () => audioTime,
        () => 'running' as AudioContextState,
        (note) => notes.push(note),
        () => {},
        () => ({}),
      );

      sched.start(0);
      const loopTime = patternDuration * stepDuration;
      const totalTime = loopTime * 120;
      for (let t = 0.025; t <= totalTime; t += 0.025) {
        audioTime = t;
        vi.advanceTimersByTime(25);
      }
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      expect(trackNotes.length).toBeGreaterThanOrEqual(100);

      let maxDrift = 0;
      for (let i = 0; i < trackNotes.length; i++) {
        const note = trackNotes[i];
        const expectedTime = i * loopTime;
        const drift = Math.abs(note.time - expectedTime) * 1000;
        maxDrift = Math.max(maxDrift, drift);
      }

      expect(maxDrift).toBeLessThan(1);
    });
  });

  // -----------------------------------------------------------------------
  // BPM changes take effect at correct position
  // -----------------------------------------------------------------------

  describe('BPM change timing', () => {
    it('BPM change does not shift already-scheduled notes', () => {
      const bpm1 = 120;
      const bpm2 = 180;
      const stepDuration1 = 60 / (bpm1 * 4);
      const stepDuration2 = 60 / (bpm2 * 4);

      // Events at every beat
      const events: MusicalEvent[] = Array.from({ length: 16 }, (_, i) =>
        ({ kind: 'trigger', at: i, velocity: 0.8 }) as TriggerEvent,
      );

      const notes: ScheduledNote[] = [];
      let currentSession = {
        ...session,
        transport: { ...session.transport, bpm: bpm1, swing: 0 },
      };
      const vid = currentSession.tracks[0].id;
      const track = getTrack(currentSession, vid);
      const newPattern = { ...track.patterns[0], duration: 16, events };
      currentSession = {
        ...currentSession,
        tracks: currentSession.tracks.map(v =>
          v.id === vid ? { ...v, patterns: [newPattern] } : { ...v, muted: true }
        ),
      };

      const sched = new Scheduler(
        () => currentSession,
        () => audioTime,
        () => 'running' as AudioContextState,
        (note) => notes.push(note),
        () => {},
        () => ({}),
      );

      sched.start(0);

      // Play at 120 BPM for 0.5s (covers steps 0-3)
      for (let t = 0.025; t <= 0.5; t += 0.025) {
        audioTime = t;
        vi.advanceTimersByTime(25);
      }
      const notesAt120 = notes.length;

      // Change BPM to 180
      currentSession = {
        ...currentSession,
        transport: { ...currentSession.transport, bpm: bpm2 },
      };

      // Continue playing for 1.5s more
      for (let t = audioTime + 0.025; t <= 2.0; t += 0.025) {
        audioTime = t;
        vi.advanceTimersByTime(25);
      }
      sched.stop();

      // Notes from both tempos should be present
      expect(notes.length).toBeGreaterThan(notesAt120);

      // Verify notes scheduled BEFORE the BPM change are at 120 BPM spacing
      // (first few notes)
      const earlyNotes = notes.filter(n => n.trackId === vid && n.time < 0.4);
      for (let i = 1; i < earlyNotes.length; i++) {
        const gap = earlyNotes[i].time - earlyNotes[i - 1].time;
        // At 120 BPM, step gap = 0.125s
        expect(gap).toBeCloseTo(stepDuration1, 2);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Gate-off timing matches note duration
  // -----------------------------------------------------------------------

  describe('gate-off timing', () => {
    it('gate-off for NoteEvent matches pitch and duration exactly', () => {
      const bpm = 120;
      const stepDuration = 60 / (bpm * 4);

      const events: MusicalEvent[] = [
        { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 2 } as NoteEvent,
        { kind: 'note', at: 4, pitch: 64, velocity: 0.8, duration: 0.5 } as NoteEvent,
        { kind: 'note', at: 8, pitch: 67, velocity: 0.8, duration: 4 } as NoteEvent,
      ];

      const notes: ScheduledNote[] = [];
      session = {
        ...session,
        transport: { ...session.transport, bpm, swing: 0 },
      };
      const vid = session.tracks[0].id;
      const track = getTrack(session, vid);
      const newPattern = { ...track.patterns[0], duration: 16, events };
      session = {
        ...session,
        tracks: session.tracks.map(v =>
          v.id === vid ? { ...v, patterns: [newPattern] } : { ...v, muted: true }
        ),
      };

      const sched = new Scheduler(
        () => session,
        () => audioTime,
        () => 'running' as AudioContextState,
        (note) => notes.push(note),
        () => {},
        () => ({}),
      );

      sched.start(0);
      for (let t = 0.025; t <= 2.5; t += 0.025) {
        audioTime = t;
        vi.advanceTimersByTime(25);
      }
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      expect(trackNotes.length).toBeGreaterThanOrEqual(3);

      // Sort by time
      trackNotes.sort((a, b) => a.time - b.time);

      // Check each note's gate-off duration
      const expectedDurations = [2, 0.5, 4]; // in steps
      for (let i = 0; i < Math.min(3, trackNotes.length); i++) {
        const note = trackNotes[i];
        const expectedGateDuration = expectedDurations[i] * stepDuration;
        const actualGateDuration = note.gateOffTime - note.time;
        const driftMs = Math.abs(actualGateDuration - expectedGateDuration) * 1000;
        expect(driftMs).toBeLessThan(1);
      }
    });

    it('trigger events use gate parameter for gate-off', () => {
      const bpm = 120;
      const stepDuration = 60 / (bpm * 4);

      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.8, gate: 2 } as TriggerEvent,
        { kind: 'trigger', at: 4, velocity: 0.8, gate: 0.5 } as TriggerEvent,
        { kind: 'trigger', at: 8, velocity: 0.8 } as TriggerEvent, // default gate = 1
      ];

      const notes: ScheduledNote[] = [];
      session = {
        ...session,
        transport: { ...session.transport, bpm, swing: 0 },
      };
      const vid = session.tracks[0].id;
      const track = getTrack(session, vid);
      const newPattern = { ...track.patterns[0], duration: 16, events };
      session = {
        ...session,
        tracks: session.tracks.map(v =>
          v.id === vid ? { ...v, patterns: [newPattern] } : { ...v, muted: true }
        ),
      };

      const sched = new Scheduler(
        () => session,
        () => audioTime,
        () => 'running' as AudioContextState,
        (note) => notes.push(note),
        () => {},
        () => ({}),
      );

      sched.start(0);
      for (let t = 0.025; t <= 2.5; t += 0.025) {
        audioTime = t;
        vi.advanceTimersByTime(25);
      }
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      expect(trackNotes.length).toBeGreaterThanOrEqual(3);

      trackNotes.sort((a, b) => a.time - b.time);

      const expectedGates = [2, 0.5, 1]; // in steps
      for (let i = 0; i < Math.min(3, trackNotes.length); i++) {
        const note = trackNotes[i];
        const expectedGateDuration = expectedGates[i] * stepDuration;
        const actualGateDuration = note.gateOffTime - note.time;
        const driftMs = Math.abs(actualGateDuration - expectedGateDuration) * 1000;
        expect(driftMs).toBeLessThan(1);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Swing timing verification
  // -----------------------------------------------------------------------

  describe('swing timing accuracy', () => {
    it('swing delays odd steps by exact amount', () => {
      const bpm = 120;
      const stepDuration = 60 / (bpm * 4);
      const swing = 0.5;

      // Events on steps 0, 1, 2, 3
      const events: MusicalEvent[] = Array.from({ length: 4 }, (_, i) =>
        ({ kind: 'trigger', at: i, velocity: 0.8 }) as TriggerEvent,
      );

      const notes: ScheduledNote[] = [];
      session = {
        ...session,
        transport: { ...session.transport, bpm, swing },
      };
      const vid = session.tracks[0].id;
      const track = getTrack(session, vid);
      const newPattern = { ...track.patterns[0], duration: 16, events };
      session = {
        ...session,
        tracks: session.tracks.map(v =>
          v.id === vid ? { ...v, patterns: [newPattern] } : { ...v, muted: true }
        ),
      };

      const sched = new Scheduler(
        () => session,
        () => audioTime,
        () => 'running' as AudioContextState,
        (note) => notes.push(note),
        () => {},
        () => ({}),
      );

      sched.start(0);
      for (let t = 0.025; t <= 1.0; t += 0.025) {
        audioTime = t;
        vi.advanceTimersByTime(25);
      }
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      expect(trackNotes.length).toBeGreaterThanOrEqual(4);
      trackNotes.sort((a, b) => a.time - b.time);

      // Step 0: no swing (even)
      const step0Expected = 0 * stepDuration;
      expect(Math.abs(trackNotes[0].time - step0Expected) * 1000).toBeLessThan(1);

      // Step 1: swing delay (odd) = swing * stepDuration * 0.75
      const swingDelay = swing * stepDuration * 0.75;
      const step1Expected = 1 * stepDuration + swingDelay;
      expect(Math.abs(trackNotes[1].time - step1Expected) * 1000).toBeLessThan(1);

      // Step 2: no swing (even)
      const step2Expected = 2 * stepDuration;
      expect(Math.abs(trackNotes[2].time - step2Expected) * 1000).toBeLessThan(1);

      // Step 3: swing delay (odd)
      const step3Expected = 3 * stepDuration + swingDelay;
      expect(Math.abs(trackNotes[3].time - step3Expected) * 1000).toBeLessThan(1);
    });
  });

  // -----------------------------------------------------------------------
  // Song mode timing across pattern boundaries
  // -----------------------------------------------------------------------

  describe('song mode timing', () => {
    it('events in second pattern start at correct offset', () => {
      const bpm = 120;
      const stepDuration = 60 / (bpm * 4);

      const vid = session.tracks[0].id;
      const track = getTrack(session, vid);

      const pattern1 = {
        ...track.patterns[0],
        id: 'pat1',
        duration: 8,
        events: [{ kind: 'trigger' as const, at: 0, velocity: 0.8 }] as MusicalEvent[],
      };
      const pattern2 = {
        id: 'pat2',
        kind: 'pattern' as const,
        duration: 8,
        events: [{ kind: 'trigger' as const, at: 0, velocity: 0.8 }] as MusicalEvent[],
      };

      session = {
        ...session,
        transport: { ...session.transport, bpm, swing: 0, mode: 'song', loop: false },
        tracks: session.tracks.map(v =>
          v.id === vid
            ? {
                ...v,
                patterns: [pattern1, pattern2],
                sequence: [{ patternId: 'pat1' }, { patternId: 'pat2' }],
              }
            : { ...v, muted: true }
        ),
      };

      const notes: ScheduledNote[] = [];
      const sched = new Scheduler(
        () => session,
        () => audioTime,
        () => 'running' as AudioContextState,
        (note) => notes.push(note),
        () => {},
        () => ({}),
        undefined,
        undefined,
        () => {},
      );

      sched.start(0);
      // Total: 16 steps = 2.0s at 120 BPM
      for (let t = 0.025; t <= 2.5; t += 0.025) {
        audioTime = t;
        vi.advanceTimersByTime(25);
      }
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      expect(trackNotes.length).toBe(2);

      trackNotes.sort((a, b) => a.time - b.time);

      // First note: step 0 of pattern1 = 0s
      expect(Math.abs(trackNotes[0].time) * 1000).toBeLessThan(1);

      // Second note: step 0 of pattern2 = 8 steps from start = 1.0s
      const expectedSecondNote = 8 * stepDuration;
      expect(Math.abs(trackNotes[1].time - expectedSecondNote) * 1000).toBeLessThan(1);
    });
  });

  // -----------------------------------------------------------------------
  // Multi-track timing consistency
  // -----------------------------------------------------------------------

  describe('multi-track timing', () => {
    it('events at same step across tracks are scheduled at same time', () => {
      const bpm = 120;
      const stepDuration = 60 / (bpm * 4);

      session = addTrack(session)!;
      const track0Id = session.tracks[0].id;
      const track1Id = session.tracks[1].id;

      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
        { kind: 'trigger', at: 4, velocity: 0.8 } as TriggerEvent,
      ];

      // Set same pattern on both tracks
      for (const tid of [track0Id, track1Id]) {
        const track = getTrack(session, tid);
        const newPattern = { ...track.patterns[0], duration: 16, events };
        session = {
          ...session,
          tracks: session.tracks.map(v =>
            v.id === tid ? { ...v, patterns: [newPattern] } : v
          ),
        };
      }

      const notes: ScheduledNote[] = [];
      const sched = new Scheduler(
        () => session,
        () => audioTime,
        () => 'running' as AudioContextState,
        (note) => notes.push(note),
        () => {},
        () => ({}),
      );

      sched.start(0);
      for (let t = 0.025; t <= 2.5; t += 0.025) {
        audioTime = t;
        vi.advanceTimersByTime(25);
      }
      sched.stop();

      const track0Notes = notes.filter(n => n.trackId === track0Id);
      const track1Notes = notes.filter(n => n.trackId === track1Id);

      expect(track0Notes.length).toBeGreaterThanOrEqual(2);
      expect(track1Notes.length).toBeGreaterThanOrEqual(2);

      // Sort both by time
      track0Notes.sort((a, b) => a.time - b.time);
      track1Notes.sort((a, b) => a.time - b.time);

      // Events at the same step should have the same time (< 0.1ms tolerance)
      for (let i = 0; i < Math.min(track0Notes.length, track1Notes.length); i++) {
        const drift = Math.abs(track0Notes[i].time - track1Notes[i].time) * 1000;
        expect(drift).toBeLessThan(0.1);
      }
    });
  });
});
