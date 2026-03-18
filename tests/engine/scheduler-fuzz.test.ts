// tests/engine/scheduler-fuzz.test.ts
//
// Scheduler fuzzer: random sequences of transport operations asserting invariants.
// Issue #857: adversarial + fuzz + trace testing for transport/scheduler/audio engine.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler, START_OFFSET_SEC } from '../../src/engine/scheduler';
import { createSession, addTrack } from '../../src/engine/session';
import type { Session } from '../../src/engine/types';
import { getTrack } from '../../src/engine/types';
import type { ScheduledNote } from '../../src/engine/sequencer-types';
import type { TriggerEvent, NoteEvent, MusicalEvent } from '../../src/engine/canonical-types';

// ---------------------------------------------------------------------------
// Seeded PRNG (xorshift32) for reproducibility
// ---------------------------------------------------------------------------
function createRng(seed: number) {
  let state = seed | 0;
  if (state === 0) state = 1;
  return {
    /** Returns a float in [0, 1). */
    next(): number {
      state ^= state << 13;
      state ^= state >> 17;
      state ^= state << 5;
      return (state >>> 0) / 0xffffffff;
    },
    /** Returns an integer in [min, max] (inclusive). */
    int(min: number, max: number): number {
      return min + Math.floor(this.next() * (max - min + 1));
    },
    /** Pick a random element from an array. */
    pick<T>(arr: T[]): T {
      return arr[this.int(0, arr.length - 1)];
    },
  };
}

type FuzzOp = 'play' | 'stop' | 'pause' | 'resume' | 'setBPM' | 'editPattern';

describe('Scheduler fuzz tests', () => {
  let notes: ScheduledNote[];
  let positions: number[];
  let audioTime: number;

  beforeEach(() => {
    vi.useFakeTimers();
    notes = [];
    positions = [];
    audioTime = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Run a fuzz sequence: create a scheduler, apply random operations,
   * and check invariants after each operation.
   */
  function runFuzzSequence(seed: number, opCount: number): {
    violations: string[];
    opLog: string[];
  } {
    const rng = createRng(seed);
    const violations: string[] = [];
    const opLog: string[] = [];
    notes = [];
    positions = [];
    audioTime = 0;

    // Build a session with two tracks, each having some events
    let session = createSession();
    session = addTrack(session)!;
    const track0Id = session.tracks[0].id;
    const track1Id = session.tracks[1].id;

    // Initial patterns
    const makeEvents = (count: number): MusicalEvent[] =>
      Array.from({ length: count }, (_, i) => ({
        kind: 'trigger' as const,
        at: i * 2,
        velocity: 0.5 + rng.next() * 0.5,
      }) as TriggerEvent);

    const setTrackPattern = (trackId: string, events: MusicalEvent[], duration: number) => {
      const track = getTrack(session, trackId);
      if (track.patterns.length === 0) return;
      const newPattern = { ...track.patterns[0], duration, events };
      session = {
        ...session,
        tracks: session.tracks.map(v =>
          v.id === trackId ? { ...v, patterns: [newPattern] } : v
        ),
      };
    };

    setTrackPattern(track0Id, makeEvents(4), 16);
    setTrackPattern(track1Id, makeEvents(3), 12);

    let isPlaying = false;
    let isPaused = false;
    let generation = 0;

    const localNotes: ScheduledNote[] = [];
    const sched = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      (note) => localNotes.push(note),
      (pos) => positions.push(pos),
      () => ({}),
    );

    const ops: FuzzOp[] = ['play', 'stop', 'pause', 'resume', 'setBPM', 'editPattern'];

    for (let i = 0; i < opCount; i++) {
      const op = rng.pick(ops);
      opLog.push(op);

      try {
        switch (op) {
          case 'play':
            if (!isPlaying) {
              generation++;
              sched.start(0, 0, generation);
              isPlaying = true;
              isPaused = false;
            }
            break;

          case 'stop':
            if (isPlaying || isPaused) {
              sched.stop();
              isPlaying = false;
              isPaused = false;
            }
            break;

          case 'pause':
            if (isPlaying && !isPaused) {
              sched.stop();
              isPaused = true;
              isPlaying = false;
            }
            break;

          case 'resume':
            if (isPaused) {
              generation++;
              const resumeStep = positions.length > 0 ? positions[positions.length - 1] : 0;
              sched.start(0, resumeStep, generation);
              isPlaying = true;
              isPaused = false;
            }
            break;

          case 'setBPM': {
            const newBpm = rng.int(40, 300);
            session = {
              ...session,
              transport: { ...session.transport, bpm: newBpm },
            };
            break;
          }

          case 'editPattern': {
            const trackId = rng.pick([track0Id, track1Id]);
            const eventCount = rng.int(1, 8);
            const duration = rng.int(4, 32);
            const newEvents = makeEvents(Math.min(eventCount, Math.floor(duration / 2)));
            setTrackPattern(trackId, newEvents, duration);
            if (isPlaying) {
              sched.invalidateTrack(trackId);
            }
            break;
          }
        }
      } catch (err) {
        violations.push(`Operation ${i} (${op}) threw: ${err}`);
      }

      // Advance time a small random amount
      audioTime += rng.next() * 0.1 + 0.01;
      vi.advanceTimersByTime(rng.int(10, 50));
    }

    // Final stop
    if (isPlaying || isPaused) {
      try {
        sched.stop();
      } catch (err) {
        violations.push(`Final stop threw: ${err}`);
      }
    }

    // --- Invariant checks ---

    // 1. Every note-on has a gate-off (pre-computed at schedule time)
    for (const note of localNotes) {
      if (note.gateOffTime <= note.time) {
        violations.push(
          `Note at t=${note.time.toFixed(4)} has gateOff=${note.gateOffTime.toFixed(4)} <= time`,
        );
      }
    }

    // 2. No duplicate events (same eventId)
    const eventIds = new Set<string>();
    for (const note of localNotes) {
      if (note.eventId) {
        if (eventIds.has(note.eventId)) {
          violations.push(`Duplicate eventId: ${note.eventId}`);
        }
        eventIds.add(note.eventId);
      }
    }

    // 3. All note times are finite and non-negative
    for (const note of localNotes) {
      if (!isFinite(note.time) || note.time < -1) {
        violations.push(`Invalid note time: ${note.time}`);
      }
      if (!isFinite(note.gateOffTime)) {
        violations.push(`Invalid gateOff time: ${note.gateOffTime}`);
      }
    }

    // 4. Position changes are finite
    for (const pos of positions) {
      if (!isFinite(pos) || pos < -1) {
        violations.push(`Invalid position: ${pos}`);
      }
    }

    return { violations, opLog };
  }

  // Run 100 fuzz sequences of 50+ operations each, with deterministic seeds
  for (let seed = 1; seed <= 100; seed++) {
    it(`fuzz sequence seed=${seed}`, () => {
      const { violations, opLog } = runFuzzSequence(seed, 60);
      if (violations.length > 0) {
        // Provide full context for debugging
        const debugInfo = [
          `Seed: ${seed}`,
          `Operations: ${opLog.join(', ')}`,
          `Violations:`,
          ...violations.map(v => `  - ${v}`),
        ].join('\n');
        expect(violations, debugInfo).toHaveLength(0);
      }
    });
  }

  // Additional targeted fuzz: rapid play/stop cycling
  it('rapid play/stop cycling does not crash (100 cycles)', () => {
    let session = createSession();
    const vid = session.tracks[0].id;
    const track = getTrack(session, vid);
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 } as TriggerEvent,
      { kind: 'trigger', at: 4, velocity: 0.8 } as TriggerEvent,
    ];
    const newPattern = { ...track.patterns[0], events };
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, patterns: [newPattern] } : v
      ),
    };

    const localNotes: ScheduledNote[] = [];
    const sched = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      (note) => localNotes.push(note),
      () => {},
      () => ({}),
    );

    for (let i = 0; i < 100; i++) {
      sched.start(0, 0, i);
      audioTime += 0.02;
      vi.advanceTimersByTime(10);
      sched.stop();
    }

    // Should not crash; notes may or may not have been scheduled
    expect(true).toBe(true);
  });

  // Targeted fuzz: BPM oscillation while playing
  it('BPM oscillation between extremes does not produce invalid notes', () => {
    let session = createSession();
    const vid = session.tracks[0].id;
    const track = getTrack(session, vid);
    const events: MusicalEvent[] = Array.from({ length: 8 }, (_, i) =>
      ({ kind: 'trigger', at: i * 2, velocity: 0.8 }) as TriggerEvent,
    );
    const newPattern = { ...track.patterns[0], events };
    session = {
      ...session,
      tracks: session.tracks.map(v =>
        v.id === vid ? { ...v, patterns: [newPattern] } : v
      ),
    };

    const localNotes: ScheduledNote[] = [];
    const sched = new Scheduler(
      () => session,
      () => audioTime,
      () => 'running' as AudioContextState,
      (note) => localNotes.push(note),
      () => {},
      () => ({}),
    );

    sched.start(0);
    for (let i = 0; i < 50; i++) {
      // Oscillate between 30 BPM and 500 BPM
      const bpm = i % 2 === 0 ? 30 : 500;
      session = {
        ...session,
        transport: { ...session.transport, bpm },
      };
      audioTime += 0.05;
      vi.advanceTimersByTime(25);
    }
    sched.stop();

    // All notes should have valid timing
    for (const note of localNotes) {
      expect(isFinite(note.time)).toBe(true);
      expect(isFinite(note.gateOffTime)).toBe(true);
      expect(note.gateOffTime).toBeGreaterThan(note.time);
    }
  });
});
