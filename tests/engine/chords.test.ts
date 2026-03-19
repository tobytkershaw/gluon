// tests/engine/chords.test.ts
import { describe, it, expect } from 'vitest';
import { getChordToneNames, normalizeChordProgression } from '../../src/engine/chords';

describe('chord utilities', () => {
  it('derives chord tones for common minor and major chords', () => {
    expect(getChordToneNames('Fm')).toEqual(['F', 'G#', 'C']);
    expect(getChordToneNames('Eb')).toEqual(['D#', 'G', 'A#']);
    expect(getChordToneNames('C7')).toEqual(['C', 'E', 'G', 'A#']);
  });

  it('normalizes chord progression order by bar', () => {
    expect(normalizeChordProgression([
      { bar: 5, chord: 'Db' },
      { bar: 1, chord: 'Fm' },
      { bar: 3, chord: 'Eb' },
    ])).toEqual([
      { bar: 1, chord: 'Fm' },
      { bar: 3, chord: 'Eb' },
      { bar: 5, chord: 'Db' },
    ]);
  });
});
