// src/engine/scale.ts — Scale/key constraint utilities.
// Pure functions for scale quantization and note lookup.

import type { ScaleConstraint, ScaleMode } from './types';

/**
 * Interval patterns (semitones from root) for each supported scale mode.
 * All patterns are relative to root = 0.
 */
export const SCALE_INTERVALS: Record<ScaleMode, number[]> = {
  major:            [0, 2, 4, 5, 7, 9, 11],
  minor:            [0, 2, 3, 5, 7, 8, 10],
  dorian:           [0, 2, 3, 5, 7, 9, 10],
  phrygian:         [0, 1, 3, 5, 7, 8, 10],
  lydian:           [0, 2, 4, 6, 7, 9, 11],
  mixolydian:       [0, 2, 4, 5, 7, 9, 10],
  aeolian:          [0, 2, 3, 5, 7, 8, 10],
  locrian:          [0, 1, 3, 5, 6, 8, 10],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic-minor':  [0, 2, 3, 5, 7, 9, 11],
  pentatonic:       [0, 2, 4, 7, 9],
  'minor-pentatonic': [0, 3, 5, 7, 10],
  blues:            [0, 3, 5, 6, 7, 10],
  chromatic:        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  'whole-tone':     [0, 2, 4, 6, 8, 10],
};

/** All supported scale mode names. */
export const SCALE_MODES = Object.keys(SCALE_INTERVALS) as ScaleMode[];

/** Note name lookup (sharps). */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Convert a MIDI pitch number (0-127) to a note name string (e.g. 60 → "C4").
 * Uses standard MIDI octave numbering where middle C (60) = C4.
 */
export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

/**
 * Convert a note name string (e.g. "C4", "F#3") back to a MIDI pitch number.
 * Returns undefined if the string is not a valid note name.
 */
export function noteNameToMidi(name: string): number | undefined {
  const match = name.match(/^([A-Ga-g]#?)(-?\d+)$/);
  if (!match) return undefined;
  const notePart = match[1].toUpperCase();
  const octave = parseInt(match[2], 10);
  const noteIndex = NOTE_NAMES.indexOf(notePart);
  if (noteIndex < 0) return undefined;
  const midi = (octave + 1) * 12 + noteIndex;
  return midi >= 0 && midi <= 127 ? midi : undefined;
}

/**
 * Get the pitch classes (0-11) that belong to a given scale.
 * Returns a sorted Set for fast membership testing.
 */
export function getScalePitchClasses(scale: ScaleConstraint): Set<number> {
  const intervals = SCALE_INTERVALS[scale.mode];
  return new Set(intervals.map(i => (i + scale.root) % 12));
}

/**
 * Get all MIDI pitches (0-127) that belong to a given scale.
 */
export function getScaleMidiNotes(scale: ScaleConstraint): number[] {
  const pitchClasses = getScalePitchClasses(scale);
  const notes: number[] = [];
  for (let midi = 0; midi <= 127; midi++) {
    if (pitchClasses.has(midi % 12)) {
      notes.push(midi);
    }
  }
  return notes;
}

/**
 * Quantize a MIDI pitch to the nearest in-scale note.
 * If the pitch is already in scale, returns it unchanged.
 * Ties are resolved by rounding down (towards lower pitch).
 * Clamps result to 0-127.
 */
export function quantizePitch(pitch: number, scale: ScaleConstraint): number {
  const pitchClasses = getScalePitchClasses(scale);

  // Already in scale
  if (pitchClasses.has(pitch % 12)) return pitch;

  // Search outward from the pitch for the nearest in-scale note
  let lower = pitch - 1;
  let upper = pitch + 1;

  while (lower >= 0 || upper <= 127) {
    if (lower >= 0 && pitchClasses.has(lower % 12)) return lower;
    if (upper <= 127 && pitchClasses.has(upper % 12)) return upper;
    lower--;
    upper++;
  }

  // Fallback (should never happen with chromatic scale)
  return Math.max(0, Math.min(127, pitch));
}

/**
 * Human-readable scale description (e.g. "C major", "F# minor").
 */
export function scaleToString(scale: ScaleConstraint): string {
  return `${NOTE_NAMES[scale.root]} ${scale.mode}`;
}

/**
 * Human-readable list of note names in a scale (e.g. "C D E F G A B").
 */
export function scaleNoteNames(scale: ScaleConstraint): string[] {
  const intervals = SCALE_INTERVALS[scale.mode];
  return intervals.map(i => NOTE_NAMES[(i + scale.root) % 12]);
}
