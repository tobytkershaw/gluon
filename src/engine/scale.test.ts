// src/engine/scale.test.ts
import { describe, it, expect } from 'vitest';
import {
  getScalePitchClasses,
  getScaleMidiNotes,
  quantizePitch,
  scaleToString,
  scaleNoteNames,
  SCALE_INTERVALS,
  SCALE_MODES,
} from './scale';
import type { ScaleConstraint } from './types';

describe('SCALE_INTERVALS', () => {
  it('has entries for all declared modes', () => {
    for (const mode of SCALE_MODES) {
      expect(SCALE_INTERVALS[mode]).toBeDefined();
      expect(SCALE_INTERVALS[mode].length).toBeGreaterThan(0);
    }
  });

  it('major scale has 7 notes', () => {
    expect(SCALE_INTERVALS.major).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('chromatic scale has 12 notes', () => {
    expect(SCALE_INTERVALS.chromatic).toHaveLength(12);
  });
});

describe('getScalePitchClasses', () => {
  it('returns correct pitch classes for C major', () => {
    const scale: ScaleConstraint = { root: 0, mode: 'major' };
    const classes = getScalePitchClasses(scale);
    expect(classes).toEqual(new Set([0, 2, 4, 5, 7, 9, 11])); // C D E F G A B
  });

  it('transposes correctly for D major', () => {
    const scale: ScaleConstraint = { root: 2, mode: 'major' };
    const classes = getScalePitchClasses(scale);
    // D E F# G A B C#
    expect(classes).toEqual(new Set([2, 4, 6, 7, 9, 11, 1]));
  });

  it('handles minor scale correctly', () => {
    const scale: ScaleConstraint = { root: 9, mode: 'minor' }; // A minor
    const classes = getScalePitchClasses(scale);
    // A B C D E F G
    expect(classes).toEqual(new Set([9, 11, 0, 2, 4, 5, 7]));
  });
});

describe('getScaleMidiNotes', () => {
  it('returns all MIDI notes in C major', () => {
    const scale: ScaleConstraint = { root: 0, mode: 'major' };
    const notes = getScaleMidiNotes(scale);
    // C major has 7 pitch classes, spread across 0-127
    expect(notes.length).toBeGreaterThan(50);
    // All should be in-scale
    const classes = getScalePitchClasses(scale);
    for (const n of notes) {
      expect(classes.has(n % 12)).toBe(true);
    }
  });
});

describe('quantizePitch', () => {
  const cMajor: ScaleConstraint = { root: 0, mode: 'major' };

  it('returns pitch unchanged when already in scale', () => {
    // C4 = 60, already in C major
    expect(quantizePitch(60, cMajor)).toBe(60);
    // E4 = 64, already in C major
    expect(quantizePitch(64, cMajor)).toBe(64);
  });

  it('quantizes C# (61) down to C (60) in C major', () => {
    // C#4 = 61, nearest in-scale is C (60) — lower wins on tie
    expect(quantizePitch(61, cMajor)).toBe(60);
  });

  it('quantizes D# (63) down to D (62) in C major', () => {
    // D#4 = 63, equidistant from D(62) and E(64), lower wins
    expect(quantizePitch(63, cMajor)).toBe(62);
  });

  it('quantizes F# (66) down to F (65) in C major', () => {
    // F#4 = 66, equidistant from F(65) and G(67), lower wins
    expect(quantizePitch(66, cMajor)).toBe(65);
  });

  it('quantizes Bb (70) to A (69) in C major', () => {
    // Bb4 = 70, equidistant from A(69) and B(71), lower wins
    expect(quantizePitch(70, cMajor)).toBe(69);
  });

  it('quantizes G# (68) to G (67) in C major', () => {
    // G#4 = 68, equidistant from G(67) and A(69), lower wins
    expect(quantizePitch(68, cMajor)).toBe(67);
  });

  it('clamps to MIDI range', () => {
    expect(quantizePitch(0, cMajor)).toBe(0);
    expect(quantizePitch(127, cMajor)).toBe(127); // B7, already in C major
  });

  it('works with pentatonic scale', () => {
    const cPent: ScaleConstraint = { root: 0, mode: 'pentatonic' };
    // C pentatonic: C(0) D(2) E(4) G(7) A(9)
    // F(65) is not in C pentatonic, nearest are E(64) and G(67), lower wins
    expect(quantizePitch(65, cPent)).toBe(64);
  });

  it('chromatic scale returns pitch unchanged', () => {
    const chromatic: ScaleConstraint = { root: 0, mode: 'chromatic' };
    for (let p = 0; p <= 127; p++) {
      expect(quantizePitch(p, chromatic)).toBe(p);
    }
  });
});

describe('scaleToString', () => {
  it('formats C major correctly', () => {
    expect(scaleToString({ root: 0, mode: 'major' })).toBe('C major');
  });

  it('formats F# minor correctly', () => {
    expect(scaleToString({ root: 6, mode: 'minor' })).toBe('F# minor');
  });

  it('formats A dorian correctly', () => {
    expect(scaleToString({ root: 9, mode: 'dorian' })).toBe('A dorian');
  });
});

describe('scaleNoteNames', () => {
  it('returns correct note names for C major', () => {
    expect(scaleNoteNames({ root: 0, mode: 'major' })).toEqual(
      ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
    );
  });

  it('returns correct note names for A minor', () => {
    expect(scaleNoteNames({ root: 9, mode: 'minor' })).toEqual(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    );
  });

  it('returns correct note names for D major', () => {
    expect(scaleNoteNames({ root: 2, mode: 'major' })).toEqual(
      ['D', 'E', 'F#', 'G', 'A', 'B', 'C#'],
    );
  });
});
