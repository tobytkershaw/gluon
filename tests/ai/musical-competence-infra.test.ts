// tests/ai/musical-competence-infra.test.ts
//
// Infrastructure verification for musical competence scenarios (#364).
// Proves that each scenario's expected output can be constructed and verified
// through the sketch tool pipeline BEFORE asking GPT-5.4 to do it via API.

import { describe, it, expect } from 'vitest';
import { createSession } from '../../src/engine/session';
import { updateTrack, getTrack } from '../../src/engine/types';
import type { NoteEvent, TriggerEvent, MusicalEvent } from '../../src/engine/canonical-types';

// --- Helpers: build events the way the AI would via the sketch tool ---

function noteEvent(at: number, pitch: number, velocity = 0.8, duration = 0.25): NoteEvent {
  return { kind: 'note', at, pitch, velocity, duration };
}

function triggerEvent(at: number, velocity = 0.8, accent = false): TriggerEvent {
  return { kind: 'trigger', at, velocity, accent };
}

/** Apply a sketch action's events to a track's first region (mirrors projectAction logic). */
function applySketch(session: ReturnType<typeof createSession>, trackId: string, events: MusicalEvent[]) {
  const track = getTrack(session, trackId);
  const region = track.patterns[0];
  const updatedRegion = { ...region, events };
  return updateTrack(session, trackId, {
    patterns: [updatedRegion, ...track.patterns.slice(1)],
    _regionDirty: true,
  });
}

/** Extract NoteEvents from a track's first region. */
function getNotes(session: ReturnType<typeof createSession>, trackId: string): NoteEvent[] {
  return getTrack(session, trackId).patterns[0].events.filter(
    (e): e is NoteEvent => e.kind === 'note',
  );
}

/** Extract TriggerEvents (velocity > 0) from a track's first region. */
function getTriggers(session: ReturnType<typeof createSession>, trackId: string): TriggerEvent[] {
  return getTrack(session, trackId).patterns[0].events.filter(
    (e): e is TriggerEvent => e.kind === 'trigger' && (e.velocity ?? 1) > 0,
  );
}

// --- Assertion helpers (same logic the Playwright tests will use) ---

/** Check all pitches belong to a given set of pitch classes (mod 12). */
function allPitchesInSet(notes: NoteEvent[], allowedPitchClasses: Set<number>): boolean {
  return notes.every(n => allowedPitchClasses.has(n.pitch % 12));
}

/** Count distinct pitch classes in a set of notes. */
function distinctPitchClasses(notes: NoteEvent[]): number {
  return new Set(notes.map(n => n.pitch % 12)).size;
}

/** Check if pitches form a monotonic sequence (ascending or descending). */
function isMonotonic(notes: NoteEvent[]): boolean {
  if (notes.length < 2) return true;
  const sorted = [...notes].sort((a, b) => a.at - b.at);
  const ascending = sorted.every((n, i) => i === 0 || n.pitch >= sorted[i - 1].pitch);
  const descending = sorted.every((n, i) => i === 0 || n.pitch <= sorted[i - 1].pitch);
  return ascending || descending;
}

/** Fraction of events on on-beats (positions 0,4,8,12 in a 16-step grid). */
function onBeatFraction(events: Array<{ at: number }>): number {
  const onBeats = new Set([0, 4, 8, 12]);
  const onBeatCount = events.filter(e => onBeats.has(Math.round(e.at))).length;
  return onBeatCount / events.length;
}

/** Fraction of consecutive pitch intervals that are stepwise (≤ 4 semitones). */
function stepwiseFraction(notes: NoteEvent[]): number {
  if (notes.length < 2) return 1;
  const sorted = [...notes].sort((a, b) => a.at - b.at);
  let stepwise = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].pitch - sorted[i - 1].pitch) <= 4) stepwise++;
  }
  return stepwise / (sorted.length - 1);
}

// =========================================================================
// H1: Arpeggio — C major triad, ascending
// =========================================================================
describe('H1: Arpeggio (C major)', () => {
  it('sketch tool can create ascending C major arpeggio', () => {
    let s = createSession();
    // AI would sketch: C4, E4, G4, C5 on melodic track v1
    const events: MusicalEvent[] = [
      noteEvent(0, 60),  // C4
      noteEvent(4, 64),  // E4
      noteEvent(8, 67),  // G4
      noteEvent(12, 72), // C5
    ];
    s = applySketch(s, 'v1', events);
    const notes = getNotes(s, 'v1');

    expect(notes).toHaveLength(4);
    // All pitches in C major triad (pitch classes 0, 4, 7)
    expect(allPitchesInSet(notes, new Set([0, 4, 7]))).toBe(true);
    // Ascending sequence
    expect(isMonotonic(notes)).toBe(true);
    // At least 3 distinct pitch classes
    expect(distinctPitchClasses(notes)).toBeGreaterThanOrEqual(3);
  });

  it('assertion catches wrong scale', () => {
    let s = createSession();
    // Wrong: includes Db (pitch class 1)
    const events: MusicalEvent[] = [
      noteEvent(0, 61),  // Db — not in C major triad
      noteEvent(4, 64),
      noteEvent(8, 67),
    ];
    s = applySketch(s, 'v1', events);
    const notes = getNotes(s, 'v1');
    expect(allPitchesInSet(notes, new Set([0, 4, 7]))).toBe(false);
  });
});

// =========================================================================
// H2: Scale-correct melody — D minor
// =========================================================================
describe('H2: Scale-correct melody (D minor)', () => {
  // D natural minor: D(2) E(4) F(5) G(7) A(9) Bb(10) C(0)
  // D harmonic minor also accepts C#(1)
  const dMinorNatural = new Set([2, 4, 5, 7, 9, 10, 0]);
  const dMinorHarmonic = new Set([2, 4, 5, 7, 9, 10, 1]);
  const dMinorAll = new Set([...dMinorNatural, ...dMinorHarmonic]);

  it('sketch tool can create D minor melody', () => {
    let s = createSession();
    const events: MusicalEvent[] = [
      noteEvent(0, 62),  // D4
      noteEvent(2, 65),  // F4
      noteEvent(4, 69),  // A4
      noteEvent(6, 67),  // G4
      noteEvent(8, 65),  // F4
      noteEvent(10, 64), // E4 — leading back to D
      noteEvent(12, 62), // D4
    ];
    s = applySketch(s, 'v1', events);
    const notes = getNotes(s, 'v1');

    expect(allPitchesInSet(notes, dMinorAll)).toBe(true);
    expect(distinctPitchClasses(notes)).toBeGreaterThanOrEqual(4);
    // Range spans at least a fifth (7 semitones)
    const pitches = notes.map(n => n.pitch);
    expect(Math.max(...pitches) - Math.min(...pitches)).toBeGreaterThanOrEqual(7);
  });
});

// =========================================================================
// H3: Chord progression bass — i-iv-v-i in C minor
// =========================================================================
describe('H3: Chord progression bass (i-iv-v-i in Cm)', () => {
  it('bass roots follow Cm-Fm-Gm-Cm', () => {
    let s = createSession();
    // One note per beat: C2, F2, G2, C2
    const events: MusicalEvent[] = [
      noteEvent(0, 36),   // C2 — i
      noteEvent(4, 41),   // F2 — iv
      noteEvent(8, 43),   // G2 — v
      noteEvent(12, 36),  // C2 — i
    ];
    s = applySketch(s, 'v1', events);
    const notes = getNotes(s, 'v1');

    // Group by beat
    const beats = [0, 4, 8, 12];
    const expectedRoots = [0, 5, 7, 0]; // C, F, G, C in pitch classes
    for (let i = 0; i < beats.length; i++) {
      const beatNotes = notes.filter(n => Math.abs(n.at - beats[i]) < 1);
      expect(beatNotes.length).toBeGreaterThanOrEqual(1);
      expect(beatNotes[0].pitch % 12).toBe(expectedRoots[i]);
    }
  });
});

// =========================================================================
// H4: Counterpoint (contrary motion)
// =========================================================================
describe('H4: Counterpoint (contrary motion)', () => {
  it('can detect contrary motion between two tracks', () => {
    let s = createSession();
    // Melody on v1: ascending C-D-E-F
    s = applySketch(s, 'v1', [
      noteEvent(0, 60), noteEvent(4, 62), noteEvent(8, 64), noteEvent(12, 65),
    ]);
    // Bass on v2: descending C-B-A-G (contrary motion)
    s = applySketch(s, 'v2', [
      noteEvent(0, 48), noteEvent(4, 47), noteEvent(8, 45), noteEvent(12, 43),
    ]);

    const melody = getNotes(s, 'v1').sort((a, b) => a.at - b.at);
    const bass = getNotes(s, 'v2').sort((a, b) => a.at - b.at);

    // Check contrary motion: when melody goes up, bass goes down
    let contraryCount = 0;
    let totalPairs = 0;
    for (let i = 1; i < Math.min(melody.length, bass.length); i++) {
      const melodyDelta = melody[i].pitch - melody[i - 1].pitch;
      const bassDelta = bass[i].pitch - bass[i - 1].pitch;
      if (melodyDelta !== 0 && bassDelta !== 0) {
        totalPairs++;
        if (Math.sign(melodyDelta) !== Math.sign(bassDelta)) contraryCount++;
      }
    }
    expect(totalPairs).toBeGreaterThan(0);
    expect(contraryCount / totalPairs).toBeGreaterThanOrEqual(0.6);
  });

  it('assertion fails for parallel motion', () => {
    let s = createSession();
    // Both ascending — parallel, NOT contrary
    s = applySketch(s, 'v1', [
      noteEvent(0, 60), noteEvent(4, 62), noteEvent(8, 64), noteEvent(12, 65),
    ]);
    s = applySketch(s, 'v2', [
      noteEvent(0, 48), noteEvent(4, 50), noteEvent(8, 52), noteEvent(12, 53),
    ]);

    const melody = getNotes(s, 'v1').sort((a, b) => a.at - b.at);
    const bass = getNotes(s, 'v2').sort((a, b) => a.at - b.at);

    let contraryCount = 0;
    let totalPairs = 0;
    for (let i = 1; i < Math.min(melody.length, bass.length); i++) {
      const melodyDelta = melody[i].pitch - melody[i - 1].pitch;
      const bassDelta = bass[i].pitch - bass[i - 1].pitch;
      if (melodyDelta !== 0 && bassDelta !== 0) {
        totalPairs++;
        if (Math.sign(melodyDelta) !== Math.sign(bassDelta)) contraryCount++;
      }
    }
    // Parallel motion should fail the 60% threshold
    expect(contraryCount / totalPairs).toBeLessThan(0.6);
  });
});

// =========================================================================
// R1: Syncopation
// =========================================================================
describe('R1: Syncopation', () => {
  it('syncopated pattern has majority off-beat events', () => {
    let s = createSession();
    // Syncopated hi-hat: hits on off-beats
    const events: MusicalEvent[] = [
      triggerEvent(1), triggerEvent(3), triggerEvent(5), triggerEvent(7),
      triggerEvent(9), triggerEvent(11), triggerEvent(13), triggerEvent(15),
    ];
    s = applySketch(s, 'v0', events);
    const triggers = getTriggers(s, 'v0');

    expect(triggers.length).toBeGreaterThanOrEqual(6);
    expect(onBeatFraction(triggers)).toBeLessThan(0.5);
  });

  it('assertion catches on-beat pattern', () => {
    let s = createSession();
    // Straight: all on beats
    const events: MusicalEvent[] = [
      triggerEvent(0), triggerEvent(4), triggerEvent(8), triggerEvent(12),
    ];
    s = applySketch(s, 'v0', events);
    const triggers = getTriggers(s, 'v0');
    expect(onBeatFraction(triggers)).toBe(1.0);
  });
});

// =========================================================================
// R2: Call and response
// =========================================================================
describe('R2: Call and response', () => {
  it('response is in second half when call is in first half', () => {
    let s = createSession();
    // Call on v0: first half
    s = applySketch(s, 'v0', [
      triggerEvent(0), triggerEvent(2), triggerEvent(4), triggerEvent(6),
    ]);
    // Response on v1: second half
    s = applySketch(s, 'v1', [
      noteEvent(8, 60), noteEvent(10, 62), noteEvent(12, 64), noteEvent(14, 65),
    ]);

    const v1Notes = getNotes(s, 'v1');
    const secondHalfCount = v1Notes.filter(n => n.at >= 8).length;
    expect(secondHalfCount / v1Notes.length).toBeGreaterThanOrEqual(0.7);
    expect(v1Notes.length).toBeGreaterThanOrEqual(2);
  });
});

// =========================================================================
// R3: Polyrhythm (3 against 4)
// =========================================================================
describe('R3: Polyrhythm (3 against 4)', () => {
  it('can represent 3-against-4 in the event model', () => {
    let s = createSession();
    // 4 evenly spaced (every 4 steps in 16-step bar)
    s = applySketch(s, 'v0', [
      triggerEvent(0), triggerEvent(4), triggerEvent(8), triggerEvent(12),
    ]);
    // 3 evenly spaced (every 5.33 steps — approximate to nearest step)
    s = applySketch(s, 'v1', [
      triggerEvent(0), triggerEvent(5), triggerEvent(11),
    ]);

    const v0 = getTriggers(s, 'v0');
    const v1 = getTriggers(s, 'v1');
    expect(v0).toHaveLength(4);
    expect(v1).toHaveLength(3);
    // Different groupings
    const v0Spacing = v0[1].at - v0[0].at;
    const v1Spacing = v1[1].at - v1[0].at;
    expect(v0Spacing).not.toBe(v1Spacing);
  });
});

// =========================================================================
// M1: Walking bass (F major)
// =========================================================================
describe('M1: Walking bass (F major)', () => {
  const fMajor = new Set([5, 7, 9, 10, 0, 2, 4]); // F G A Bb C D E

  it('walking bass has one note per beat, stepwise motion, in F major', () => {
    let s = createSession();
    const events: MusicalEvent[] = [
      noteEvent(0, 41),   // F2
      noteEvent(4, 43),   // G2
      noteEvent(8, 45),   // A2
      noteEvent(12, 46),  // Bb2
    ];
    s = applySketch(s, 'v1', events);
    const notes = getNotes(s, 'v1');

    // ~1 note per beat
    expect(notes.length).toBeGreaterThanOrEqual(3);
    expect(notes.length).toBeLessThanOrEqual(5);
    // All in F major
    expect(allPitchesInSet(notes, fMajor)).toBe(true);
    // Mostly stepwise
    expect(stepwiseFraction(notes)).toBeGreaterThanOrEqual(0.6);
  });
});

// =========================================================================
// M2: Melodic sequence (motif transposition)
// =========================================================================
describe('M2: Melodic sequence (motif transposition)', () => {
  it('transposed motif preserves intervals', () => {
    let s = createSession();
    // Original motif at positions 0-3: C4 D4 E4 F4
    // Transposed up a major third at positions 8-11: E4 F#4 G#4 A4
    const events: MusicalEvent[] = [
      noteEvent(0, 60), noteEvent(1, 62), noteEvent(2, 64), noteEvent(3, 65),
      noteEvent(8, 64), noteEvent(9, 66), noteEvent(10, 68), noteEvent(11, 69),
    ];
    s = applySketch(s, 'v1', events);
    const notes = getNotes(s, 'v1').sort((a, b) => a.at - b.at);

    const original = notes.filter(n => n.at < 4);
    const transposed = notes.filter(n => n.at >= 8 && n.at < 12);

    expect(original).toHaveLength(4);
    expect(transposed).toHaveLength(4);

    // Each note should be ~4 semitones higher (major third)
    for (let i = 0; i < original.length; i++) {
      const delta = transposed[i].pitch - original[i].pitch;
      expect(delta).toBeGreaterThanOrEqual(3); // tolerance ±1
      expect(delta).toBeLessThanOrEqual(5);
    }
  });
});

// =========================================================================
// M3: Arpeggiated Am7 in 16th notes
// =========================================================================
describe('M3: Arpeggiated Am7 in even 16th notes', () => {
  const am7PitchClasses = new Set([9, 0, 4, 7]); // A C E G

  it('even 16th-note arpeggio of Am7', () => {
    let s = createSession();
    // Am7 arpeggio: A C E G A C E G across 8 16th notes
    const events: MusicalEvent[] = [
      noteEvent(0, 57),  // A3
      noteEvent(2, 60),  // C4
      noteEvent(4, 64),  // E4
      noteEvent(6, 67),  // G4
      noteEvent(8, 69),  // A4
      noteEvent(10, 72), // C5
      noteEvent(12, 76), // E5
      noteEvent(14, 79), // G5
    ];
    s = applySketch(s, 'v1', events);
    const notes = getNotes(s, 'v1');

    expect(notes.length).toBeGreaterThanOrEqual(8);
    expect(allPitchesInSet(notes, am7PitchClasses)).toBe(true);

    // Evenly spaced: all intervals within 20% of mean
    const sorted = [...notes].sort((a, b) => a.at - b.at);
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(sorted[i].at - sorted[i - 1].at);
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const allWithin20 = intervals.every(iv => Math.abs(iv - mean) / mean <= 0.2);
    expect(allWithin20).toBe(true);
  });
});
