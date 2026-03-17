// src/ui/keyboard-piano-map.ts
// Shared keyboard-to-MIDI mapping used by both the keyboard piano hook
// and the tracker's Renoise-style note entry.

// --- Keyboard-to-semitone mappings ---
// Lower octave: bottom two rows (Z-M = white keys, S/D/G/H/J = black keys)
// Upper octave: top two rows (Q-U = white keys, 2/3/5/6/7 = black keys)
// Values are semitone offsets from the octave root (C).

export const LOWER_WHITE: Record<string, number> = {
  z: 0,   // C
  x: 2,   // D
  c: 4,   // E
  v: 5,   // F
  b: 7,   // G
  n: 9,   // A
  m: 11,  // B
};

export const LOWER_BLACK: Record<string, number> = {
  s: 1,   // C#
  d: 3,   // D#
  g: 6,   // F#
  h: 8,   // G#
  j: 10,  // A#
};

export const UPPER_WHITE: Record<string, number> = {
  q: 0,   // C
  w: 2,   // D
  e: 4,   // E
  r: 5,   // F
  t: 7,   // G
  y: 9,   // A
  u: 11,  // B
};

export const UPPER_BLACK: Record<string, number> = {
  '2': 1,  // C#
  '3': 3,  // D#
  '5': 6,  // F#
  '6': 8,  // G#
  '7': 10, // A#
};

/** Default base MIDI note for the lower octave (C3). */
export const BASE_MIDI_LOWER = 48;

/** Upper octave is always 12 semitones above lower. */
export const OCTAVE = 12;

/**
 * Convert a keyboard key to a MIDI note number, given the current octave offset.
 * Returns undefined if the key is not mapped.
 */
export function keyToMidi(key: string, octaveOffset: number): number | undefined {
  const lower = key.toLowerCase();

  let semitone: number | undefined;
  let octaveBase: number;

  if (lower in LOWER_WHITE) {
    semitone = LOWER_WHITE[lower];
    octaveBase = BASE_MIDI_LOWER + octaveOffset * OCTAVE;
  } else if (lower in LOWER_BLACK) {
    semitone = LOWER_BLACK[lower];
    octaveBase = BASE_MIDI_LOWER + octaveOffset * OCTAVE;
  } else if (lower in UPPER_WHITE) {
    semitone = UPPER_WHITE[lower];
    octaveBase = BASE_MIDI_LOWER + OCTAVE + octaveOffset * OCTAVE;
  } else if (key in UPPER_BLACK) {
    // Number keys: use raw key (not lowercased) since '2' === '2'
    semitone = UPPER_BLACK[key];
    octaveBase = BASE_MIDI_LOWER + OCTAVE + octaveOffset * OCTAVE;
  } else {
    return undefined;
  }

  const midi = octaveBase + semitone;
  if (midi < 0 || midi > 127) return undefined;
  return midi;
}

/** Check if a key is a piano key (would be handled by keyToMidi at some octave offset). */
export function isPianoKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower in LOWER_WHITE ||
    lower in LOWER_BLACK ||
    lower in UPPER_WHITE ||
    key in UPPER_BLACK
  );
}
