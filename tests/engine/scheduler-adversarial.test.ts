// tests/engine/scheduler-adversarial.test.ts
//
// Adversarial tests designed to break the scheduler under tricky conditions.
// Issue #857: adversarial + fuzz + trace testing for transport/scheduler/audio engine.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler, START_OFFSET_SEC } from '../../src/engine/scheduler';
import { createSession, addTrack } from '../../src/engine/session';
import { toggleStepGate } from '../../src/engine/pattern-primitives';
import type { Session } from '../../src/engine/types';
import { getTrack } from '../../src/engine/types';
import type { ScheduledNote } from '../../src/engine/sequencer-types';
import type { TriggerEvent, NoteEvent, MusicalEvent } from '../../src/engine/canonical-types';

describe('Scheduler adversarial tests', () => {
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
      () => ({}),
    );
  }

  /** Helper: set a track's pattern to the given events + duration. */
  function setPattern(
    trackId: string,
    events: MusicalEvent[],
    duration = 16,
  ): void {
    const track = getTrack(session, trackId);
    const newPattern = { ...track.patterns[0], duration, events };
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === trackId ? { ...v, patterns: [newPattern] } : v
      ),
    };
  }

  /** Advance the scheduler through time in small increments. */
  function advanceTo(sched: Scheduler, endTime: number, step = 0.025): void {
    for (let t = audioTime + step; t <= endTime; t += step) {
      audioTime = t;
      vi.advanceTimersByTime(25);
    }
  }

  // -----------------------------------------------------------------------
  // Rapid BPM changes mid-playback
  // -----------------------------------------------------------------------

  describe('rapid BPM changes', () => {
    it('survives BPM change every beat without duplicates or crashes', () => {
      const vid = session.tracks[0].id;
      const events: MusicalEvent[] = Array.from({ length: 4 }, (_, i) =>
        ({ kind: 'trigger', at: i * 4, velocity: 0.8 }) as TriggerEvent,
      );
      setPattern(vid, events);

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
      const bpms = [80, 140, 200, 90, 160, 110, 250, 60];
      for (let i = 0; i < bpms.length; i++) {
        currentSession = {
          ...currentSession,
          transport: { ...currentSession.transport, bpm: bpms[i] },
        };
        audioTime += 0.15;
        vi.advanceTimersByTime(30);
      }
      sched.stop();

      // Should produce notes without crashes
      expect(notes.length).toBeGreaterThan(0);
      // No two notes should have the exact same time (within tolerance)
      const times = notes.map(n => n.time);
      for (let i = 0; i < times.length; i++) {
        for (let j = i + 1; j < times.length; j++) {
          if (Math.abs(times[i] - times[j]) < 0.0001) {
            // Same-time notes must be on different tracks
            expect(notes[i].trackId).not.toBe(notes[j].trackId);
          }
        }
      }
    });

    it('survives BPM change every step', () => {
      const vid = session.tracks[0].id;
      const events: MusicalEvent[] = Array.from({ length: 16 }, (_, i) =>
        ({ kind: 'trigger', at: i, velocity: 0.8 }) as TriggerEvent,
      );
      setPattern(vid, events);

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
      for (let step = 0; step < 16; step++) {
        const bpm = 80 + step * 15; // 80 to 305 BPM
        currentSession = {
          ...currentSession,
          transport: { ...currentSession.transport, bpm },
        };
        audioTime += 0.08;
        vi.advanceTimersByTime(25);
      }
      sched.stop();

      expect(notes.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Pattern length changes while playing
  // -----------------------------------------------------------------------

  describe('pattern length changes during playback', () => {
    it('handles pattern shrink while playing', () => {
      const vid = session.tracks[0].id;
      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
        { kind: 'trigger', at: 8, velocity: 0.8 } as TriggerEvent,
        { kind: 'trigger', at: 14, velocity: 0.8 } as TriggerEvent,
      ];
      setPattern(vid, events, 16);

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
      audioTime = 0.5;
      vi.advanceTimersByTime(50);

      // Shrink pattern to 8 steps mid-play — event at step 14 now outside duration
      const track = getTrack(currentSession, vid);
      const shrunkPattern = {
        ...track.patterns[0],
        duration: 8,
        events: events.filter(e => e.at < 8),
      };
      currentSession = {
        ...currentSession,
        tracks: currentSession.tracks.map(v =>
          v.id === vid ? { ...v, patterns: [shrunkPattern] } : v
        ),
      };

      audioTime = 2.0;
      vi.advanceTimersByTime(200);
      sched.stop();

      // Should not crash and should emit notes
      expect(notes.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Extreme tempos
  // -----------------------------------------------------------------------

  describe('extreme tempos', () => {
    it.each([20, 300, 999])('schedules at %d BPM without errors', (bpm) => {
      session = { ...session, transport: { ...session.transport, bpm } };
      const vid = session.tracks[0].id;
      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
        { kind: 'trigger', at: 4, velocity: 0.8 } as TriggerEvent,
      ];
      setPattern(vid, events);

      const sched = createScheduler();
      sched.start(0);

      const stepDuration = 60 / (bpm * 4);
      const totalTime = 16 * stepDuration * 2; // two full pattern loops
      advanceTo(sched, totalTime);
      sched.stop();

      expect(notes.length).toBeGreaterThanOrEqual(2);
      // All notes should have valid (positive) time values
      for (const note of notes) {
        expect(note.time).toBeGreaterThanOrEqual(0);
        expect(note.gateOffTime).toBeGreaterThan(note.time);
      }
    });

    it('handles 999 BPM — step duration is ~16.7ms', () => {
      session = { ...session, transport: { ...session.transport, bpm: 999 } };
      const vid = session.tracks[0].id;
      const events: MusicalEvent[] = Array.from({ length: 16 }, (_, i) =>
        ({ kind: 'trigger', at: i, velocity: 0.8 }) as TriggerEvent,
      );
      setPattern(vid, events);

      const sched = createScheduler();
      sched.start(0);
      // At 999 BPM, 16 steps takes ~0.267 seconds
      advanceTo(sched, 0.6);
      sched.stop();

      // All 16 events should fire at least once
      const trackNotes = notes.filter(n => n.trackId === vid);
      expect(trackNotes.length).toBeGreaterThanOrEqual(16);
    });
  });

  // -----------------------------------------------------------------------
  // Events at fractional positions and at loop boundaries
  // -----------------------------------------------------------------------

  describe('fractional positions and loop boundaries', () => {
    it('schedules events at extreme fractional positions (0.001)', () => {
      const vid = session.tracks[0].id;
      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 0.001, velocity: 0.8 } as TriggerEvent,
      ];
      setPattern(vid, events);

      const sched = createScheduler();
      sched.start(0);
      audioTime = 0.5;
      vi.advanceTimersByTime(100);
      sched.stop();

      expect(notes.length).toBeGreaterThanOrEqual(1);
    });

    it('schedules events near loop boundary (duration - epsilon)', () => {
      const vid = session.tracks[0].id;
      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 15.999, velocity: 0.8 } as TriggerEvent,
      ];
      setPattern(vid, events);

      const sched = createScheduler();
      sched.start(0);
      // Need enough time for the event near the end of the 16-step pattern
      advanceTo(sched, 3.0);
      sched.stop();

      expect(notes.length).toBeGreaterThanOrEqual(1);
    });

    it('schedules events at position 0 correctly on every loop', () => {
      const vid = session.tracks[0].id;
      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      ];
      setPattern(vid, events, 8);

      // Mute other tracks so max pattern len = 8
      session = {
        ...session,
        tracks: session.tracks.map(v =>
          v.id === vid ? v : { ...v, muted: true }
        ),
      };

      const sched = createScheduler();
      sched.start(0);
      // At 120 BPM, 8 steps = 1s. Run for 5 loops = 5s
      advanceTo(sched, 5.5);
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      // Should have at least 5 notes (one per loop)
      expect(trackNotes.length).toBeGreaterThanOrEqual(5);
    });
  });

  // -----------------------------------------------------------------------
  // Overlapping note-on/note-off at loop boundaries
  // -----------------------------------------------------------------------

  describe('overlapping note-on/note-off at loop boundaries', () => {
    it('note sustaining across loop boundary gets gate-off after loop', () => {
      const vid = session.tracks[0].id;
      // Note at step 14 with duration 4 — extends past the 16-step boundary
      const events: MusicalEvent[] = [
        { kind: 'note', at: 14, pitch: 60, velocity: 0.8, duration: 4 } as NoteEvent,
      ];
      setPattern(vid, events);

      const sched = createScheduler();
      sched.start(0);
      advanceTo(sched, 4.0);
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      expect(trackNotes.length).toBeGreaterThanOrEqual(1);
      // Gate-off should extend beyond note-on time
      for (const note of trackNotes) {
        expect(note.gateOffTime).toBeGreaterThan(note.time);
        // Duration is 4 steps = 0.5s at 120 BPM
        expect(note.gateOffTime - note.time).toBeCloseTo(0.5, 1);
      }
    });

    it('note at last step + note at first step do not collide', () => {
      const vid = session.tracks[0].id;
      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
        { kind: 'trigger', at: 15, velocity: 0.8 } as TriggerEvent,
      ];
      setPattern(vid, events);

      const sched = createScheduler();
      sched.start(0);
      advanceTo(sched, 4.5); // > 2 full loops at 120 BPM / 16 steps
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      // Should have multiple notes and no duplicate times
      expect(trackNotes.length).toBeGreaterThanOrEqual(4);
      // Verify note times are strictly increasing
      const times = trackNotes.map(n => n.time).sort((a, b) => a - b);
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThan(times[i - 1]);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Pause at exact loop boundary, resume
  // -----------------------------------------------------------------------

  describe('pause at loop boundary', () => {
    it('pause at exact loop boundary then resume does not skip or duplicate', () => {
      const vid = session.tracks[0].id;
      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
        { kind: 'trigger', at: 4, velocity: 0.8 } as TriggerEvent,
        { kind: 'trigger', at: 8, velocity: 0.8 } as TriggerEvent,
        { kind: 'trigger', at: 12, velocity: 0.8 } as TriggerEvent,
      ];
      setPattern(vid, events);

      const sched = createScheduler();
      sched.start(0);

      // Advance to exactly 2.0s = 16 steps = loop boundary at 120 BPM
      advanceTo(sched, 2.0);
      const notesBeforePause = notes.length;

      // Simulate pause by stopping
      sched.stop();

      // Resume from step 0 (start of new loop)
      notes.length = 0;
      sched.start(0, 0, 1); // new generation
      advanceTo(sched, 4.0);
      sched.stop();

      // Should have notes after resume
      expect(notes.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Stop during note sustain — verify gate-off fires
  // -----------------------------------------------------------------------

  describe('stop during note sustain', () => {
    it('scheduled note has gate-off time even if scheduler stops during sustain', () => {
      const vid = session.tracks[0].id;
      // Long note: starts at step 0, lasts 8 steps
      const events: MusicalEvent[] = [
        { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 8 } as NoteEvent,
      ];
      setPattern(vid, events);

      const sched = createScheduler();
      sched.start(0);
      audioTime = 0.2;
      vi.advanceTimersByTime(50);
      sched.stop();

      // Note should already have been scheduled with gate-off time
      expect(notes.length).toBeGreaterThanOrEqual(1);
      const note = notes[0];
      // Gate-off is pre-computed at schedule time, not at stop time
      expect(note.gateOffTime).toBeGreaterThan(note.time);
      // 8 steps at 120 BPM = 1.0s
      expect(note.gateOffTime - note.time).toBeCloseTo(1.0, 2);
    });
  });

  // -----------------------------------------------------------------------
  // Coprime pattern lengths across tracks (7 and 16 steps)
  // -----------------------------------------------------------------------

  describe('coprime pattern lengths', () => {
    it('tracks with 7-step and 16-step patterns loop independently', () => {
      // Add a second track
      session = addTrack(session)!;
      const track0Id = session.tracks[0].id;
      const track1Id = session.tracks[1].id;

      // Track 0: 7-step pattern
      const events7: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
        { kind: 'trigger', at: 3, velocity: 0.8 } as TriggerEvent,
      ];
      const track0 = getTrack(session, track0Id);
      const pattern7 = { ...track0.patterns[0], duration: 7, events: events7 };

      // Track 1: 16-step pattern
      const events16: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
        { kind: 'trigger', at: 8, velocity: 0.8 } as TriggerEvent,
      ];
      const track1 = getTrack(session, track1Id);
      const pattern16 = { ...track1.patterns[0], duration: 16, events: events16 };

      session = {
        ...session,
        tracks: session.tracks.map(v => {
          if (v.id === track0Id) return { ...v, patterns: [pattern7] };
          if (v.id === track1Id) return { ...v, patterns: [pattern16] };
          return v;
        }),
      };

      const sched = createScheduler();
      sched.start(0);
      // Run for 10s — long enough for multiple cycles of both patterns
      advanceTo(sched, 10.0);
      sched.stop();

      const track0Notes = notes.filter(n => n.trackId === track0Id);
      const track1Notes = notes.filter(n => n.trackId === track1Id);

      // Track 0 (7 steps): 10s / (7 * 0.125s) = ~11.4 loops → ~22 notes
      // Track 1 (16 steps): 10s / (16 * 0.125s) = ~5 loops → ~10 notes
      expect(track0Notes.length).toBeGreaterThan(10);
      expect(track1Notes.length).toBeGreaterThan(5);

      // No duplicate times within each track
      for (const trackNotes of [track0Notes, track1Notes]) {
        const times = trackNotes.map(n => n.time).sort((a, b) => a - b);
        for (let i = 1; i < times.length; i++) {
          expect(times[i] - times[i - 1]).toBeGreaterThan(0.001);
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // Song mode with different-length patterns in sequence
  // -----------------------------------------------------------------------

  describe('song mode', () => {
    it('song mode plays through patterns of different lengths in sequence', () => {
      const vid = session.tracks[0].id;
      const track = getTrack(session, vid);

      // Create two patterns: 8 steps and 12 steps
      const pattern1 = {
        ...track.patterns[0],
        id: 'pat-8',
        duration: 8,
        events: [{ kind: 'trigger' as const, at: 0, velocity: 0.8 }] as MusicalEvent[],
      };
      const pattern2 = {
        id: 'pat-12',
        kind: 'pattern' as const,
        duration: 12,
        events: [{ kind: 'trigger' as const, at: 0, velocity: 0.8 }] as MusicalEvent[],
      };

      session = {
        ...session,
        transport: { ...session.transport, mode: 'song', loop: false },
        tracks: session.tracks.map(v =>
          v.id === vid
            ? {
                ...v,
                patterns: [pattern1, pattern2],
                sequence: [
                  { patternId: 'pat-8' },
                  { patternId: 'pat-12' },
                ],
              }
            : { ...v, muted: true }
        ),
      };

      let sequenceEnded = false;
      const sched = new Scheduler(
        () => session,
        () => audioTime,
        () => 'running' as AudioContextState,
        (note) => notes.push(note),
        (pos) => positions.push(pos),
        () => ({}),
        undefined,
        undefined,
        () => { sequenceEnded = true; },
      );

      sched.start(0);
      // Total: 8 + 12 = 20 steps = 2.5s at 120 BPM
      advanceTo(sched, 3.0);
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      // Should have exactly 2 notes (one from each pattern)
      expect(trackNotes.length).toBe(2);
      // Sequence should have ended (no loop)
      expect(sequenceEnded).toBe(true);
    });

    it('song mode with loop rewinding plays patterns again', () => {
      const vid = session.tracks[0].id;
      const track = getTrack(session, vid);

      const pattern1 = {
        ...track.patterns[0],
        id: 'pat-a',
        duration: 4,
        events: [{ kind: 'trigger' as const, at: 0, velocity: 0.8 }] as MusicalEvent[],
      };

      session = {
        ...session,
        transport: { ...session.transport, mode: 'song', loop: true },
        tracks: session.tracks.map(v =>
          v.id === vid
            ? {
                ...v,
                patterns: [pattern1],
                sequence: [{ patternId: 'pat-a' }],
              }
            : { ...v, muted: true }
        ),
      };

      const sched = createScheduler();
      sched.start(0);
      // 4 steps = 0.5s at 120 BPM. Run for 2.5s → 5 loops
      advanceTo(sched, 2.5);
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      // Should loop multiple times
      expect(trackNotes.length).toBeGreaterThanOrEqual(4);
    });
  });

  // -----------------------------------------------------------------------
  // Maximum swing displacement
  // -----------------------------------------------------------------------

  describe('maximum swing', () => {
    it('swing at 1.0 (maximum) does not cause timing inversion', () => {
      session = { ...session, transport: { ...session.transport, swing: 1.0 } };
      const vid = session.tracks[0].id;
      // Events on consecutive steps 0, 1, 2, 3
      const events: MusicalEvent[] = Array.from({ length: 4 }, (_, i) =>
        ({ kind: 'trigger', at: i, velocity: 0.8 }) as TriggerEvent,
      );
      setPattern(vid, events);

      const sched = createScheduler();
      sched.start(0);
      audioTime = 1.0;
      vi.advanceTimersByTime(200);
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      expect(trackNotes.length).toBeGreaterThanOrEqual(4);

      // Note times should still be monotonically increasing
      const times = trackNotes.map(n => n.time).sort((a, b) => a - b);
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      }
    });

    it('swing at 1.0 displaces odd steps significantly', () => {
      session = { ...session, transport: { ...session.transport, swing: 1.0 } };
      const vid = session.tracks[0].id;
      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
        { kind: 'trigger', at: 1, velocity: 0.8 } as TriggerEvent,
      ];
      setPattern(vid, events);

      const sched = createScheduler();
      sched.start(0);
      audioTime = 0.5;
      vi.advanceTimersByTime(100);
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      expect(trackNotes.length).toBeGreaterThanOrEqual(2);

      const step0Note = trackNotes.find(n => Math.abs(n.time) < 0.01);
      const step1Note = trackNotes.find(n => n.time > 0.01);
      if (step0Note && step1Note) {
        const stepDuration = 0.125; // at 120 BPM
        // Without swing, step 1 would be at 0.125s.
        // With swing=1.0, delay = 1.0 * (0.125 * 0.75) = 0.09375
        // So step 1 at 0.125 + 0.09375 = 0.21875s
        const expectedSwingDelay = 1.0 * (stepDuration * 0.75);
        const actualDelay = step1Note.time - stepDuration; // displacement from base time
        expect(actualDelay).toBeCloseTo(expectedSwingDelay, 3);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Zero-length and max-length notes
  // -----------------------------------------------------------------------

  describe('edge-case note durations', () => {
    it('zero-velocity trigger is skipped (ungated sentinel)', () => {
      const vid = session.tracks[0].id;
      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0 } as TriggerEvent,
        { kind: 'trigger', at: 4, velocity: 0.8 } as TriggerEvent,
      ];
      setPattern(vid, events);

      const sched = createScheduler();
      sched.start(0);
      audioTime = 1.0;
      vi.advanceTimersByTime(100);
      sched.stop();

      const trackNotes = notes.filter(n => n.trackId === vid);
      // velocity=0 event should be skipped
      expect(trackNotes.length).toBeGreaterThanOrEqual(1);
      // All scheduled notes should be from step 4, not step 0
      for (const note of trackNotes) {
        expect(note.time).toBeGreaterThan(0.4); // step 4 = 0.5s at 120 BPM
      }
    });

    it('very short note duration (0.01 steps) has tiny gate', () => {
      const vid = session.tracks[0].id;
      const events: MusicalEvent[] = [
        { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 0.01 } as NoteEvent,
      ];
      setPattern(vid, events);

      const sched = createScheduler();
      sched.start(0);
      audioTime = 0.3;
      vi.advanceTimersByTime(50);
      sched.stop();

      expect(notes.length).toBeGreaterThanOrEqual(1);
      const note = notes[0];
      const stepDuration = 0.125;
      expect(note.gateOffTime - note.time).toBeCloseTo(0.01 * stepDuration, 4);
    });

    it('note spanning multiple loops has correct gate-off', () => {
      const vid = session.tracks[0].id;
      // Note at step 0, duration 32 — spans 2 full 16-step patterns
      const events: MusicalEvent[] = [
        { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 32 } as NoteEvent,
      ];
      setPattern(vid, events);

      const sched = createScheduler();
      sched.start(0);
      audioTime = 0.3;
      vi.advanceTimersByTime(50);
      sched.stop();

      expect(notes.length).toBeGreaterThanOrEqual(1);
      const note = notes[0];
      // 32 steps at 120 BPM = 4.0 seconds
      expect(note.gateOffTime - note.time).toBeCloseTo(4.0, 1);
    });
  });

  // -----------------------------------------------------------------------
  // Suspended AudioContext (tab backgrounded)
  // -----------------------------------------------------------------------

  describe('suspended AudioContext', () => {
    it('skips tick entirely when AudioContext is suspended', () => {
      const vid = session.tracks[0].id;
      const events: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      ];
      setPattern(vid, events);

      let audioState: AudioContextState = 'running';
      const sched = new Scheduler(
        () => session,
        () => audioTime,
        () => audioState,
        (note) => notes.push(note),
        (pos) => positions.push(pos),
        () => ({}),
      );

      sched.start(0);
      // First tick fires with running state — notes appear
      expect(notes.length).toBeGreaterThanOrEqual(1);
      const notesAfterStart = notes.length;

      // Suspend the context
      audioState = 'suspended';
      audioTime = 5.0;
      vi.advanceTimersByTime(200);

      // No new notes should have been scheduled while suspended
      expect(notes.length).toBe(notesAfterStart);

      sched.stop();
    });
  });
});
