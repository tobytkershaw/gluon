// tests/engine/sequencing-regression.test.ts
//
// Sequencing regression harness (issue #51).
// Asserts on musical observables: which steps trigger, at what time,
// with what params. No assertions on internal snapshot shapes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applySketch, applyUndo } from '../../src/engine/primitives';
import { createSession, setAgency } from '../../src/engine/session';
import { toggleStepGate } from '../../src/engine/pattern-primitives';
import { Scheduler } from '../../src/engine/scheduler';
import { getVoice } from '../../src/engine/types';
import type { Session } from '../../src/engine/types';
import type { PatternSketch, ScheduledNote, Step } from '../../src/engine/sequencer-types';
import {
  FOUR_ON_FLOOR_SKETCH,
  FOUR_ON_FLOOR_EXPECTED,
  FOUR_ON_FLOOR_GATE_POSITIONS,
  OFFBEAT_HATS_SKETCH,
  OFFBEAT_HATS_EXPECTED,
  OFFBEAT_HATS_GATE_POSITIONS,
  PARAM_LOCKS_SKETCH,
  PARAM_LOCKS_EXPECTED,
  PARAM_LOCKS_GATE_POSITIONS,
  PARAM_LOCKS_LOCK_MAP,
  PITCHED_MELODY_SKETCH,
  PITCHED_MELODY_EXPECTED,
  PITCHED_MELODY_GATE_POSITIONS,
  PITCHED_MELODY_NOTES,
  MIXED_PATTERN_SKETCH,
  MIXED_PATTERN_EXPECTED,
  MIXED_PATTERN_GATE_POSITIONS,
  MIXED_PATTERN_ACCENT_POSITIONS,
  EMPTY_PATTERN_SKETCH,
  MAX_LENGTH_SKETCH,
  MAX_LENGTH_GATE_POSITIONS,
} from './sequencing-fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Apply a sketch and return the resulting voice pattern steps. */
function sketchAndRead(session: Session, voiceId: string, sketch: PatternSketch): Step[] {
  const result = applySketch(session, voiceId, 'test sketch', sketch);
  return getVoice(result, voiceId).pattern.steps;
}

/** Build a PatternSketch from a Step array (reverse direction for round-trip). */
function stepsToSketch(steps: Step[], length?: number): PatternSketch {
  const sketchSteps = steps
    .map((s, i) => {
      const hasContent = s.gate || s.accent || s.params || s.micro !== 0;
      if (!hasContent) return null;
      return {
        index: i,
        gate: s.gate || undefined,
        accent: s.accent || undefined,
        params: s.params,
        micro: s.micro || undefined,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
  return { length: length ?? steps.length, steps: sketchSteps };
}

/** Positions in pattern where gate is true. */
function gatedPositions(steps: Step[]): number[] {
  return steps.map((s, i) => (s.gate ? i : -1)).filter(i => i >= 0);
}

/** Positions where accent is true. */
function accentedPositions(steps: Step[]): number[] {
  return steps.map((s, i) => (s.accent ? i : -1)).filter(i => i >= 0);
}

/** Param lock value at a given step. */
function paramAt(steps: Step[], index: number, param: string): number | undefined {
  return steps[index]?.params?.[param];
}

function setupSessionWithAgency(voiceId = 'v0'): Session {
  let session = createSession();
  session = setAgency(session, voiceId, 'ON');
  return session;
}

// ---------------------------------------------------------------------------
// Round-trip fidelity (musical content preserved)
// ---------------------------------------------------------------------------
describe('Round-trip fidelity', () => {
  const VID = 'v0';

  it('four-on-floor: sketch produces expected gates', () => {
    const session = createSession();
    const steps = sketchAndRead(session, VID, FOUR_ON_FLOOR_SKETCH);
    expect(gatedPositions(steps)).toEqual(FOUR_ON_FLOOR_GATE_POSITIONS);
  });

  it('four-on-floor: gate+accent preserved through steps → sketch → steps', () => {
    const session = createSession();
    const firstPass = sketchAndRead(session, VID, FOUR_ON_FLOOR_SKETCH);
    // Rebuild a sketch from the result steps and re-apply
    const rebuilt = stepsToSketch(firstPass, 16);
    const secondPass = sketchAndRead(createSession(), VID, rebuilt);
    for (let i = 0; i < 16; i++) {
      expect(secondPass[i].gate).toBe(FOUR_ON_FLOOR_EXPECTED[i].gate);
      expect(secondPass[i].accent).toBe(FOUR_ON_FLOOR_EXPECTED[i].accent);
    }
  });

  it('offbeat hats: sketch produces expected gates', () => {
    const session = createSession();
    const steps = sketchAndRead(session, VID, OFFBEAT_HATS_SKETCH);
    expect(gatedPositions(steps)).toEqual(OFFBEAT_HATS_GATE_POSITIONS);
  });

  it('offbeat hats: round-trip preserves gate positions', () => {
    const session = createSession();
    const firstPass = sketchAndRead(session, VID, OFFBEAT_HATS_SKETCH);
    const rebuilt = stepsToSketch(firstPass, 16);
    const secondPass = sketchAndRead(createSession(), VID, rebuilt);
    expect(gatedPositions(secondPass)).toEqual(OFFBEAT_HATS_GATE_POSITIONS);
  });

  it('param locks: sketch produces expected gates and locks', () => {
    const session = createSession();
    const steps = sketchAndRead(session, VID, PARAM_LOCKS_SKETCH);
    expect(gatedPositions(steps)).toEqual(PARAM_LOCKS_GATE_POSITIONS);
    for (const [idx, locks] of Object.entries(PARAM_LOCKS_LOCK_MAP)) {
      for (const [param, value] of Object.entries(locks)) {
        expect(paramAt(steps, Number(idx), param)).toBe(value);
      }
    }
  });

  it('param locks: round-trip preserves lock values', () => {
    const session = createSession();
    const firstPass = sketchAndRead(session, VID, PARAM_LOCKS_SKETCH);
    const rebuilt = stepsToSketch(firstPass, 16);
    const secondPass = sketchAndRead(createSession(), VID, rebuilt);
    for (const [idx, locks] of Object.entries(PARAM_LOCKS_LOCK_MAP)) {
      for (const [param, value] of Object.entries(locks)) {
        expect(paramAt(secondPass, Number(idx), param)).toBe(value);
      }
    }
  });

  it('pitched melody: round-trip preserves note values within tolerance', () => {
    const session = createSession();
    const steps = sketchAndRead(session, VID, PITCHED_MELODY_SKETCH);
    for (const [idx, note] of Object.entries(PITCHED_MELODY_NOTES)) {
      expect(paramAt(steps, Number(idx), 'note')).toBeCloseTo(note, 2);
    }
    // Round-trip
    const rebuilt = stepsToSketch(steps, 8);
    const secondPass = sketchAndRead(createSession(), VID, rebuilt);
    for (const [idx, note] of Object.entries(PITCHED_MELODY_NOTES)) {
      expect(paramAt(secondPass, Number(idx), 'note')).toBeCloseTo(note, 2);
    }
  });

  it('pitched melody: accented step preserved', () => {
    const session = createSession();
    const steps = sketchAndRead(session, VID, PITCHED_MELODY_SKETCH);
    expect(steps[6].accent).toBe(true);
  });

  it('empty pattern: round-trips cleanly (no gates)', () => {
    const session = createSession();
    const steps = sketchAndRead(session, VID, EMPTY_PATTERN_SKETCH);
    expect(gatedPositions(steps)).toEqual([]);
    // Round-trip
    const rebuilt = stepsToSketch(steps, 16);
    const secondPass = sketchAndRead(createSession(), VID, rebuilt);
    expect(gatedPositions(secondPass)).toEqual([]);
  });

  it('max-length (64-step) pattern: round-trip preserves gates', () => {
    const session = createSession();
    const steps = sketchAndRead(session, VID, MAX_LENGTH_SKETCH);
    expect(gatedPositions(steps)).toEqual(MAX_LENGTH_GATE_POSITIONS);
    expect(steps.length).toBeGreaterThanOrEqual(64);
    // Round-trip
    const rebuilt = stepsToSketch(steps, 64);
    const secondPass = sketchAndRead(createSession(), VID, rebuilt);
    expect(gatedPositions(secondPass)).toEqual(MAX_LENGTH_GATE_POSITIONS);
  });

  it('mixed pattern: gates, accents, and params all preserved', () => {
    const session = createSession();
    const steps = sketchAndRead(session, VID, MIXED_PATTERN_SKETCH);
    expect(gatedPositions(steps)).toEqual(MIXED_PATTERN_GATE_POSITIONS);
    expect(accentedPositions(steps)).toEqual(MIXED_PATTERN_ACCENT_POSITIONS);
    // Param locks
    expect(paramAt(steps, 1, 'note')).toBe(0.47);
    expect(paramAt(steps, 5, 'note')).toBe(0.52);
    expect(paramAt(steps, 5, 'morph')).toBe(0.3);
    // Silent step with param lock
    expect(steps[3].gate).toBe(false);
    expect(paramAt(steps, 3, 'timbre')).toBe(0.7);
  });

  it('mixed pattern: round-trip preserves all musical content', () => {
    const session = createSession();
    const firstPass = sketchAndRead(session, VID, MIXED_PATTERN_SKETCH);
    const rebuilt = stepsToSketch(firstPass, 16);
    const secondPass = sketchAndRead(createSession(), VID, rebuilt);
    expect(gatedPositions(secondPass)).toEqual(MIXED_PATTERN_GATE_POSITIONS);
    expect(accentedPositions(secondPass)).toEqual(MIXED_PATTERN_ACCENT_POSITIONS);
    expect(paramAt(secondPass, 3, 'timbre')).toBe(0.7);
  });
});

// ---------------------------------------------------------------------------
// AI sketch execution (musical outcome)
// ---------------------------------------------------------------------------
describe('AI sketch execution', () => {
  const VID = 'v0';

  it('sketch produces voice with correct gates at expected positions', () => {
    const session = setupSessionWithAgency(VID);
    const result = applySketch(session, VID, 'four on floor', FOUR_ON_FLOOR_SKETCH);
    const voice = getVoice(result, VID);
    expect(gatedPositions(voice.pattern.steps)).toEqual(FOUR_ON_FLOOR_GATE_POSITIONS);
  });

  it('sketch with accents sets accent flag correctly', () => {
    const session = setupSessionWithAgency(VID);
    const sketch: PatternSketch = {
      length: 16,
      steps: [
        { index: 0, gate: true, accent: true },
        { index: 4, gate: true, accent: false },
      ],
    };
    const result = applySketch(session, VID, 'accented kick', sketch);
    const voice = getVoice(result, VID);
    expect(voice.pattern.steps[0].accent).toBe(true);
    expect(voice.pattern.steps[4].accent).toBe(false);
  });

  it('sketch with param locks sets per-step params', () => {
    const session = setupSessionWithAgency(VID);
    const result = applySketch(session, VID, 'param locks', PARAM_LOCKS_SKETCH);
    const voice = getVoice(result, VID);
    expect(voice.pattern.steps[0].params?.timbre).toBe(0.2);
    expect(voice.pattern.steps[8].params?.timbre).toBe(0.9);
    expect(voice.pattern.steps[4].params).toBeUndefined();
  });

  it('sketch on agency-OFF voice still applies (applySketch has no agency check)', () => {
    // Note: agency checking happens at the dispatch/executor level, not in applySketch.
    // applySketch is a pure state primitive. The executor is responsible for rejecting.
    const session = createSession(); // default agency is OFF
    const result = applySketch(session, VID, 'test', FOUR_ON_FLOOR_SKETCH);
    const voice = getVoice(result, VID);
    // applySketch applies regardless — this documents current behavior
    expect(gatedPositions(voice.pattern.steps)).toEqual(FOUR_ON_FLOOR_GATE_POSITIONS);
  });

  it('sketch preserves untouched steps musical content', () => {
    let session = createSession();
    // Pre-populate: gate on step 2 with param lock
    session = toggleStepGate(session, VID, 2);
    const voice = getVoice(session, VID);
    const stepsWithLock = [...voice.pattern.steps];
    stepsWithLock[2] = { ...stepsWithLock[2], params: { morph: 0.6 } };
    session = {
      ...session,
      voices: session.voices.map(v =>
        v.id === VID ? { ...v, pattern: { ...v.pattern, steps: stepsWithLock } } : v,
      ),
    };

    // Sketch only touches steps 0 and 4
    const sketch: PatternSketch = {
      steps: [
        { index: 0, gate: true },
        { index: 4, gate: true },
      ],
    };
    const result = applySketch(session, VID, 'partial', sketch);
    const resultVoice = getVoice(result, VID);

    // Step 2 should be untouched
    expect(resultVoice.pattern.steps[2].gate).toBe(true);
    expect(resultVoice.pattern.steps[2].params?.morph).toBe(0.6);
    // Sketched steps should be applied
    expect(resultVoice.pattern.steps[0].gate).toBe(true);
    expect(resultVoice.pattern.steps[4].gate).toBe(true);
  });

  it('sketch with length change extends pattern', () => {
    const session = createSession(); // default 16 steps
    const sketch: PatternSketch = {
      length: 32,
      steps: [{ index: 24, gate: true }],
    };
    const result = applySketch(session, VID, 'extend', sketch);
    const voice = getVoice(result, VID);
    expect(voice.pattern.length).toBe(32);
    expect(voice.pattern.steps[24].gate).toBe(true);
  });

  it('empty sketch does not alter existing pattern', () => {
    let session = createSession();
    session = toggleStepGate(session, VID, 0);
    const before = getVoice(session, VID).pattern.steps.map(s => ({ ...s }));

    const emptySketch: PatternSketch = { steps: [] };
    const result = applySketch(session, VID, 'empty', emptySketch);
    const after = getVoice(result, VID).pattern.steps;

    // All steps identical
    for (let i = 0; i < before.length; i++) {
      expect(after[i].gate).toBe(before[i].gate);
      expect(after[i].accent).toBe(before[i].accent);
    }
  });
});

// ---------------------------------------------------------------------------
// Undo coherence (musical state restored)
// ---------------------------------------------------------------------------
describe('Undo coherence', () => {
  const VID = 'v0';

  it('sketch → undo → voice plays same as pre-sketch', () => {
    const session = createSession();
    const before = getVoice(session, VID).pattern.steps.map(s => ({ ...s }));

    const sketched = applySketch(session, VID, 'four on floor', FOUR_ON_FLOOR_SKETCH);
    // Verify sketch applied
    expect(gatedPositions(getVoice(sketched, VID).pattern.steps)).toEqual(FOUR_ON_FLOOR_GATE_POSITIONS);

    const undone = applyUndo(sketched);
    const after = getVoice(undone, VID).pattern.steps;

    for (let i = 0; i < before.length; i++) {
      expect(after[i].gate).toBe(before[i].gate);
      expect(after[i].accent).toBe(before[i].accent);
    }
  });

  it('sketch with param locks → undo → locks removed', () => {
    const session = createSession();
    const sketched = applySketch(session, VID, 'locks', PARAM_LOCKS_SKETCH);
    expect(paramAt(getVoice(sketched, VID).pattern.steps, 0, 'timbre')).toBe(0.2);

    const undone = applyUndo(sketched);
    expect(getVoice(undone, VID).pattern.steps[0].params).toBeUndefined();
  });

  it('pitched sketch → undo → note params removed', () => {
    const session = createSession();
    const sketched = applySketch(session, VID, 'melody', PITCHED_MELODY_SKETCH);
    expect(paramAt(getVoice(sketched, VID).pattern.steps, 0, 'note')).toBe(0.47);

    const undone = applyUndo(sketched);
    expect(getVoice(undone, VID).pattern.steps[0].params).toBeUndefined();
  });

  it('multiple sketches → multiple undos → original state restored', () => {
    let session = createSession();
    const originalGates = gatedPositions(getVoice(session, VID).pattern.steps);

    session = applySketch(session, VID, 'first', FOUR_ON_FLOOR_SKETCH);
    session = applySketch(session, VID, 'second', OFFBEAT_HATS_SKETCH);

    // After second sketch: offbeat hats + four on floor overlap
    const combined = gatedPositions(getVoice(session, VID).pattern.steps);
    expect(combined).toContain(1); // from offbeat hats

    // Undo second sketch
    session = applyUndo(session);
    expect(gatedPositions(getVoice(session, VID).pattern.steps)).toEqual(FOUR_ON_FLOOR_GATE_POSITIONS);

    // Undo first sketch
    session = applyUndo(session);
    expect(gatedPositions(getVoice(session, VID).pattern.steps)).toEqual(originalGates);
  });

  it('sketch preserves untouched steps through undo', () => {
    let session = createSession();
    // Pre-set step 2 as gated
    session = toggleStepGate(session, VID, 2);
    expect(getVoice(session, VID).pattern.steps[2].gate).toBe(true);

    // Sketch only step 0
    session = applySketch(session, VID, 'partial', {
      steps: [{ index: 0, gate: true }],
    });
    expect(getVoice(session, VID).pattern.steps[0].gate).toBe(true);
    expect(getVoice(session, VID).pattern.steps[2].gate).toBe(true);

    // Undo the sketch — step 2 should still be gated (from toggle), step 0 reverted
    session = applyUndo(session);
    expect(getVoice(session, VID).pattern.steps[0].gate).toBe(false);
    expect(getVoice(session, VID).pattern.steps[2].gate).toBe(true);
  });

  it('length-changing sketch → undo → original length restored', () => {
    const session = createSession();
    const originalLength = getVoice(session, VID).pattern.length;

    const sketched = applySketch(session, VID, 'extend', {
      length: 32,
      steps: [{ index: 24, gate: true }],
    });
    expect(getVoice(sketched, VID).pattern.length).toBe(32);

    const undone = applyUndo(sketched);
    expect(getVoice(undone, VID).pattern.length).toBe(originalLength);
  });
});

// ---------------------------------------------------------------------------
// Scheduler (audible timing)
// ---------------------------------------------------------------------------
describe('Scheduler timing', () => {
  const VID = 'v0';
  let session: Session;
  let notes: ScheduledNote[];
  let audioTime: number;

  beforeEach(() => {
    vi.useFakeTimers();
    session = createSession();
    notes = [];
    audioTime = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createTestScheduler(getSession?: () => Session) {
    return new Scheduler(
      getSession ?? (() => session),
      () => audioTime,
      (note) => notes.push(note),
      () => {},
      () => ({}),
    );
  }

  it('four-on-floor at 120 BPM: notes at expected times', () => {
    // Apply four-on-floor pattern
    session = applySketch(session, VID, 'kick', FOUR_ON_FLOOR_SKETCH);

    const sched = createTestScheduler();
    sched.start();
    // At 120 BPM, step duration = 60 / (120 * 4) = 0.125s
    // Advance 2 seconds to capture all 16 steps
    audioTime = 2.0;
    vi.advanceTimersByTime(500);
    sched.stop();

    const kickNotes = notes.filter(n => n.voiceId === VID);
    // Should have at least 4 notes (steps 0, 4, 8, 12)
    expect(kickNotes.length).toBeGreaterThanOrEqual(4);

    // Step 0 at t=0, step 4 at t=0.5, step 8 at t=1.0, step 12 at t=1.5
    const expectedTimes = [0, 0.5, 1.0, 1.5];
    for (const expected of expectedTimes) {
      const match = kickNotes.find(n => Math.abs(n.time - expected) < 0.01);
      expect(match).toBeDefined();
    }
  });

  it('offbeat hats at 120 BPM: notes at odd-step times', () => {
    session = applySketch(session, VID, 'hats', OFFBEAT_HATS_SKETCH);

    const sched = createTestScheduler();
    sched.start();
    audioTime = 2.0;
    vi.advanceTimersByTime(500);
    sched.stop();

    const hatNotes = notes.filter(n => n.voiceId === VID);
    expect(hatNotes.length).toBeGreaterThanOrEqual(8);

    // First hat at step 1 = 0.125s
    const firstHat = hatNotes.find(n => Math.abs(n.time - 0.125) < 0.02);
    expect(firstHat).toBeDefined();
  });

  it('swing offsets at known positions', () => {
    // Gate steps 0 and 1 (a swing pair)
    session = applySketch(session, VID, 'pair', {
      length: 16,
      steps: [
        { index: 0, gate: true },
        { index: 1, gate: true },
      ],
    });
    session = { ...session, transport: { ...session.transport, swing: 0.5 } };

    const sched = createTestScheduler();
    sched.start();
    audioTime = 0.5;
    vi.advanceTimersByTime(200);
    sched.stop();

    const voiceNotes = notes.filter(n => n.voiceId === VID);
    if (voiceNotes.length >= 2) {
      // Step 0 is even (no swing), step 1 is odd (swung)
      const step0 = voiceNotes.find(n => n.time < 0.1);
      const step1 = voiceNotes.find(n => n.time >= 0.1);
      expect(step0).toBeDefined();
      expect(step1).toBeDefined();
      if (step0 && step1) {
        // With swing=0.5, step 1 should be delayed beyond its base time (0.125)
        const stepDuration = 0.125; // at 120 BPM
        const baseStep1Time = step0.time + stepDuration;
        expect(step1.time).toBeGreaterThan(baseStep1Time);
      }
    }
  });

  it('pattern length wrapping: 8-step pattern triggers twice in 16 steps', () => {
    // Create 8-step pattern with gate on step 0
    session = applySketch(session, VID, 'short', {
      length: 8,
      steps: [{ index: 0, gate: true }],
    });

    const sched = createTestScheduler();
    sched.start();
    // 16 steps at 120 BPM = 2 seconds; pattern wraps at step 8
    audioTime = 2.0;
    vi.advanceTimersByTime(500);
    sched.stop();

    const voiceNotes = notes.filter(n => n.voiceId === VID);
    // Step 0 fires at t=0 and t=1.0 (after wrapping)
    expect(voiceNotes.length).toBeGreaterThanOrEqual(2);
  });

  it('param locks resolve into scheduled notes', () => {
    session = applySketch(session, VID, 'locked', PARAM_LOCKS_SKETCH);

    const sched = createTestScheduler();
    sched.start();
    audioTime = 0.2;
    vi.advanceTimersByTime(100);
    sched.stop();

    const step0Note = notes.find(n => n.voiceId === VID && Math.abs(n.time) < 0.01);
    expect(step0Note).toBeDefined();
    if (step0Note) {
      // Step 0 has timbre locked to 0.2
      expect(step0Note.params.timbre).toBe(0.2);
    }
  });

  it('pitched melody notes carry note param values', () => {
    session = applySketch(session, VID, 'melody', PITCHED_MELODY_SKETCH);

    const sched = createTestScheduler();
    sched.start();
    audioTime = 1.0;
    vi.advanceTimersByTime(300);
    sched.stop();

    const voiceNotes = notes.filter(n => n.voiceId === VID);
    expect(voiceNotes.length).toBeGreaterThanOrEqual(4);

    // First note (step 0) should carry note=0.47
    const firstNote = voiceNotes.find(n => Math.abs(n.time) < 0.01);
    expect(firstNote).toBeDefined();
    if (firstNote) {
      expect(firstNote.params.note).toBe(0.47);
    }
  });

  it('gateOffTime equals next step time at 120 BPM', () => {
    session = applySketch(session, VID, 'kick', {
      length: 16,
      steps: [{ index: 0, gate: true }],
    });

    const sched = createTestScheduler();
    sched.start();
    audioTime = 0.2;
    vi.advanceTimersByTime(100);
    sched.stop();

    const note = notes.find(n => n.voiceId === VID);
    expect(note).toBeDefined();
    if (note) {
      // At 120 BPM, step = 0.125s
      expect(note.gateOffTime).toBeCloseTo(note.time + 0.125, 2);
    }
  });

  it('different BPM produces proportionally different timing', () => {
    session = applySketch(session, VID, 'kick', FOUR_ON_FLOOR_SKETCH);

    // Test at 60 BPM — step duration = 60/(60*4) = 0.25s
    session = { ...session, transport: { ...session.transport, bpm: 60 } };

    const sched = createTestScheduler();
    sched.start();
    audioTime = 2.0;
    vi.advanceTimersByTime(500);
    sched.stop();

    const voiceNotes = notes.filter(n => n.voiceId === VID);
    // Step 4 at 60 BPM = 4 * 0.25s = 1.0s
    const step4Note = voiceNotes.find(n => Math.abs(n.time - 1.0) < 0.02);
    expect(step4Note).toBeDefined();
  });
});
