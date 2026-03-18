import { describe, expect, it } from 'vitest';
import { keyToMidi, isPianoKey, BASE_MIDI_LOWER, OCTAVE } from '../../src/ui/keyboard-piano-map';

describe('keyboard-piano-map', () => {
  describe('isPianoKey', () => {
    it('recognises lower-row white keys', () => {
      for (const k of ['z', 'x', 'c', 'v', 'b', 'n', 'm']) {
        expect(isPianoKey(k)).toBe(true);
      }
    });

    it('recognises lower-row black keys', () => {
      for (const k of ['s', 'd', 'g', 'h', 'j']) {
        expect(isPianoKey(k)).toBe(true);
      }
    });

    it('recognises upper-row white keys', () => {
      for (const k of ['q', 'w', 'e', 'r', 't', 'y', 'u']) {
        expect(isPianoKey(k)).toBe(true);
      }
    });

    it('recognises upper-row black keys (number keys)', () => {
      for (const k of ['2', '3', '5', '6', '7']) {
        expect(isPianoKey(k)).toBe(true);
      }
    });

    it('rejects non-piano keys', () => {
      for (const k of ['a', 'f', 'k', 'l', 'p', '1', '4', '8', '9', '0', ' ', 'Enter']) {
        expect(isPianoKey(k)).toBe(false);
      }
    });
  });

  describe('keyToMidi', () => {
    it('maps Z to C at base octave (MIDI 48 at offset 0)', () => {
      expect(keyToMidi('z', 0)).toBe(BASE_MIDI_LOWER); // 48 = C3
    });

    it('maps S to C# at base octave', () => {
      expect(keyToMidi('s', 0)).toBe(BASE_MIDI_LOWER + 1); // 49 = C#3
    });

    it('maps M to B at base octave', () => {
      expect(keyToMidi('m', 0)).toBe(BASE_MIDI_LOWER + 11); // 59 = B3
    });

    it('maps Q to C one octave above base', () => {
      expect(keyToMidi('q', 0)).toBe(BASE_MIDI_LOWER + OCTAVE); // 60 = C4
    });

    it('maps upper-row number keys as black keys', () => {
      expect(keyToMidi('2', 0)).toBe(BASE_MIDI_LOWER + OCTAVE + 1); // C#4
      expect(keyToMidi('3', 0)).toBe(BASE_MIDI_LOWER + OCTAVE + 3); // D#4
    });

    it('applies octave offset correctly', () => {
      expect(keyToMidi('z', 1)).toBe(BASE_MIDI_LOWER + OCTAVE); // C4
      expect(keyToMidi('z', -1)).toBe(BASE_MIDI_LOWER - OCTAVE); // C2
    });

    it('returns undefined for non-piano keys', () => {
      expect(keyToMidi('a', 0)).toBeUndefined();
      expect(keyToMidi('f', 0)).toBeUndefined();
      expect(keyToMidi('1', 0)).toBeUndefined();
    });

    it('returns undefined when MIDI note would be out of range', () => {
      // Shift octave so far up that upper-row notes exceed 127
      expect(keyToMidi('u', 5)).toBeUndefined(); // B at very high octave
    });

    it('returns undefined when MIDI note would be negative', () => {
      expect(keyToMidi('z', -5)).toBeUndefined(); // C at negative octave
    });

    it('handles uppercase keys (case insensitive for letter keys)', () => {
      expect(keyToMidi('Z', 0)).toBe(keyToMidi('z', 0));
      expect(keyToMidi('Q', 0)).toBe(keyToMidi('q', 0));
    });
  });

  describe('standard Renoise/FT2 mapping', () => {
    it('lower row produces correct chromatic scale', () => {
      // Z=C, S=C#, X=D, D=D#, C=E, V=F, G=F#, B=G, H=G#, N=A, J=A#, M=B
      const expected = [
        ['z', 0], ['s', 1], ['x', 2], ['d', 3], ['c', 4],
        ['v', 5], ['g', 6], ['b', 7], ['h', 8], ['n', 9], ['j', 10], ['m', 11],
      ] as const;

      for (const [key, semitone] of expected) {
        expect(keyToMidi(key, 0)).toBe(BASE_MIDI_LOWER + semitone);
      }
    });

    it('upper row produces correct chromatic scale one octave up', () => {
      // Q=C, 2=C#, W=D, 3=D#, E=E, R=F, 5=F#, T=G, 6=G#, Y=A, 7=A#, U=B
      const expected = [
        ['q', 0], ['2', 1], ['w', 2], ['3', 3], ['e', 4],
        ['r', 5], ['5', 6], ['t', 7], ['6', 8], ['y', 9], ['7', 10], ['u', 11],
      ] as const;

      for (const [key, semitone] of expected) {
        expect(keyToMidi(key, 0)).toBe(BASE_MIDI_LOWER + OCTAVE + semitone);
      }
    });
  });
});
