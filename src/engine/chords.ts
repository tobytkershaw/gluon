// src/engine/chords.ts
// Lightweight chord parsing utilities for harmonic guidance and AI state compression.

import type { ChordProgressionEntry } from './types';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const ROOT_LOOKUP: Record<string, number> = {
  C: 0,
  'B#': 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  FB: 4,
  F: 5,
  'E#': 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
  CB: 11,
};

const CHORD_INTERVALS: Array<{ test: RegExp; intervals: number[] }> = [
  { test: /^(maj7|ma7|M7|Δ7|△7)$/, intervals: [0, 4, 7, 11] },
  { test: /^(m7|min7|minor7|-7)$/, intervals: [0, 3, 7, 10] },
  { test: /^(7|dom7)$/, intervals: [0, 4, 7, 10] },
  { test: /^(m|min|minor|-)$/, intervals: [0, 3, 7] },
  { test: /^(dim|o|°)$/, intervals: [0, 3, 6] },
  { test: /^(m7b5|ø|half-diminished)$/, intervals: [0, 3, 6, 10] },
  { test: /^(aug|\+)$/, intervals: [0, 4, 8] },
  { test: /^(sus2)$/, intervals: [0, 2, 7] },
  { test: /^(sus4|sus)$/, intervals: [0, 5, 7] },
  { test: /^(6|maj6)$/, intervals: [0, 4, 7, 9] },
  { test: /^(m6|min6)$/, intervals: [0, 3, 7, 9] },
  { test: /^(9|maj9)$/, intervals: [0, 4, 7, 11, 14] },
  { test: /^(m9|min9)$/, intervals: [0, 3, 7, 10, 14] },
];

export function parseChordSymbol(chord: string): { rootPitchClass: number; rootName: string; intervals: number[] } | null {
  const trimmed = chord.trim();
  const match = trimmed.match(/^([A-Ga-g])([#b♯♭]?)(.*)$/);
  if (!match) return null;

  const letter = match[1].toUpperCase();
  const accidental = match[2].replace('♯', '#').replace('♭', 'b');
  const suffix = match[3].trim();
  const rootName = `${letter}${accidental}`.toUpperCase();
  const rootPitchClass = ROOT_LOOKUP[rootName];
  if (rootPitchClass === undefined) return null;

  const normalizedSuffix = suffix
    .replace(/\s+/g, '')
    .replace(/[−–—]/g, '-');

  const matchEntry = CHORD_INTERVALS.find(entry => entry.test.test(normalizedSuffix));
  const intervals = matchEntry?.intervals ?? [0, 4, 7];

  return { rootPitchClass, rootName: NOTE_NAMES[rootPitchClass], intervals };
}

export function getChordToneNames(chord: string): string[] {
  const parsed = parseChordSymbol(chord);
  if (!parsed) return [];

  const tones = parsed.intervals.map(interval => NOTE_NAMES[(parsed.rootPitchClass + interval) % 12]);
  return Array.from(new Set(tones));
}

export function normalizeChordProgression(chords: ChordProgressionEntry[]): ChordProgressionEntry[] {
  return [...chords].sort((a, b) => a.bar - b.bar);
}

// ---------------------------------------------------------------------------
// Chord recognition from MIDI pitches
// ---------------------------------------------------------------------------

/** Chord interval dictionary — semitones from root -> chord type suffix. */
const CHORD_DICTIONARY: Array<{ intervals: number[]; name: string }> = [
  // Extended chords first (more intervals = more specific match)
  { intervals: [0, 4, 7, 11, 14], name: 'maj9' },
  { intervals: [0, 4, 7, 10, 14], name: '9' },
  { intervals: [0, 3, 7, 10, 14], name: 'min9' },
  { intervals: [0, 3, 6, 9], name: 'dim7' },
  { intervals: [0, 4, 7, 11], name: 'maj7' },
  { intervals: [0, 3, 7, 10], name: 'min7' },
  { intervals: [0, 4, 7, 10], name: '7' },
  { intervals: [0, 3, 6, 10], name: 'm7b5' },
  { intervals: [0, 4, 7, 9], name: '6' },
  { intervals: [0, 3, 7, 9], name: 'm6' },
  // Triads
  { intervals: [0, 4, 7], name: 'maj' },
  { intervals: [0, 3, 7], name: 'min' },
  { intervals: [0, 3, 6], name: 'dim' },
  { intervals: [0, 4, 8], name: 'aug' },
  { intervals: [0, 2, 7], name: 'sus2' },
  { intervals: [0, 5, 7], name: 'sus4' },
];

/**
 * Recognise a chord from a set of MIDI pitches.
 * Returns a chord symbol (e.g. "Fm9") or null if no match.
 */
export function recogniseChord(pitches: number[]): string | null {
  if (pitches.length < 2) return null;

  // Reduce to unique pitch classes
  const pitchClasses = [...new Set(pitches.map(p => p % 12))].sort((a, b) => a - b);
  if (pitchClasses.length < 2) return null;

  // Try each pitch class as potential root
  for (const root of pitchClasses) {
    const intervals = pitchClasses
      .map(pc => (pc - root + 12) % 12)
      .sort((a, b) => a - b);

    for (const entry of CHORD_DICTIONARY) {
      if (entry.intervals.length !== intervals.length) continue;
      if (entry.intervals.every((iv, i) => iv === intervals[i])) {
        const rootName = NOTE_NAMES[root];
        // Shorten chord type names for display
        const suffix = entry.name
          .replace(/^maj$/, '')
          .replace(/^min/, 'm');
        return `${rootName}${suffix}`;
      }
    }
  }

  return null;
}
