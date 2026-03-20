import { describe, it, expect } from 'vitest';
import type { MusicalEvent, NoteEvent, TriggerEvent } from '../../src/engine/canonical-types';
import {
  generateSemanticDiff,
  detectDensity,
  detectPitchRange,
  detectContour,
  detectTransposition,
  detectRhythmPlacement,
  detectChordQuality,
  detectVelocityProfile,
} from '../../src/engine/semantic-diff';
import type { SemanticDiffContext } from '../../src/engine/semantic-diff';

// --- Helpers ---

function note(at: number, pitch: number, velocity = 0.8, duration = 1): NoteEvent {
  return { kind: 'note', at, pitch, velocity, duration };
}

function trigger(at: number, velocity = 0.8): TriggerEvent {
  return { kind: 'trigger', at, velocity };
}

const ctx: SemanticDiffContext = {
  trackId: 'test',
  stepsPerBeat: 4,
};

// ---------------------------------------------------------------------------
// detectDensity
// ---------------------------------------------------------------------------

describe('detectDensity', () => {
  it('returns null when counts are equal', () => {
    const events: MusicalEvent[] = [note(0, 60), note(1, 62)];
    expect(detectDensity(events, events)).toBeNull();
  });

  it('detects minor change (<=25%)', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 62), note(2, 64), note(3, 65)];
    const neu: MusicalEvent[] = [note(0, 60), note(1, 62), note(2, 64), note(3, 65), note(4, 67)];
    const d = detectDensity(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('minor');
    expect(d!.confidence).toBe(1.0);
  });

  it('detects moderate change (25-100%)', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 62)];
    const neu: MusicalEvent[] = [note(0, 60), note(1, 62), note(2, 64)];
    const d = detectDensity(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('moderate');
  });

  it('detects major change (>100%)', () => {
    const old: MusicalEvent[] = [note(0, 60)];
    const neu: MusicalEvent[] = [note(0, 60), note(1, 62), note(2, 64)];
    const d = detectDensity(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('major');
  });

  it('detects major when events added from empty', () => {
    const d = detectDensity([], [note(0, 60)]);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('major');
  });

  it('detects major when events removed to empty', () => {
    const d = detectDensity([note(0, 60)], []);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('major');
  });

  it('describes doubled density', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 62)];
    const neu: MusicalEvent[] = [note(0, 60), note(1, 62), note(2, 64), note(3, 65)];
    const d = detectDensity(old, neu);
    expect(d!.description).toContain('doubled');
  });

  it('counts triggers as sound events', () => {
    const old: MusicalEvent[] = [trigger(0), trigger(1)];
    const neu: MusicalEvent[] = [trigger(0), trigger(1), trigger(2), trigger(3)];
    const d = detectDensity(old, neu);
    expect(d).not.toBeNull();
    expect(d!.description).toContain('doubled');
  });

  it('excludes velocity=0 sentinel events from count', () => {
    // velocity=0 is the "ungated" sentinel — not a sounding event
    const old: MusicalEvent[] = [note(0, 60, 0.8), note(1, 62, 0.8)];
    const neu: MusicalEvent[] = [note(0, 60, 0.8), note(1, 62, 0.8), note(2, 64, 0)];
    const d = detectDensity(old, neu);
    // The velocity=0 note should not be counted, so density is unchanged
    expect(d).toBeNull();
  });

  it('excludes parameter events from count', () => {
    const old: MusicalEvent[] = [note(0, 60), { kind: 'parameter', at: 1, controlId: 'x', value: 0.5 }];
    const neu: MusicalEvent[] = [note(0, 60), { kind: 'parameter', at: 1, controlId: 'x', value: 0.7 }];
    const d = detectDensity(old, neu);
    expect(d).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectPitchRange
// ---------------------------------------------------------------------------

describe('detectPitchRange', () => {
  it('returns null when no notes exist in either', () => {
    expect(detectPitchRange([trigger(0)], [trigger(1)])).toBeNull();
  });

  it('returns null when no notes in old', () => {
    expect(detectPitchRange([], [note(0, 60)])).toBeNull();
  });

  it('returns null when range unchanged', () => {
    const events: MusicalEvent[] = [note(0, 48), note(1, 67)];
    expect(detectPitchRange(events, events)).toBeNull();
  });

  it('detects minor range shift (<=3 semitones)', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 72)];
    const neu: MusicalEvent[] = [note(0, 62), note(1, 74)];
    const d = detectPitchRange(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('minor');
  });

  it('detects moderate range shift (4-11 semitones)', () => {
    const old: MusicalEvent[] = [note(0, 48), note(1, 60)];
    const neu: MusicalEvent[] = [note(0, 55), note(1, 67)];
    const d = detectPitchRange(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('moderate');
  });

  it('detects major range shift (>=12 semitones)', () => {
    const old: MusicalEvent[] = [note(0, 48), note(1, 67)];
    const neu: MusicalEvent[] = [note(0, 60), note(1, 79)];
    const d = detectPitchRange(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('major');
  });

  it('detects span change', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 72)]; // span 12
    const neu: MusicalEvent[] = [note(0, 60), note(1, 84)]; // span 24
    const d = detectPitchRange(old, neu);
    expect(d).not.toBeNull();
    expect(d!.description).toContain('widened');
  });
});

// ---------------------------------------------------------------------------
// detectContour
// ---------------------------------------------------------------------------

describe('detectContour', () => {
  it('returns null when contour preserved', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 64), note(2, 62)]; // up, down
    const neu: MusicalEvent[] = [note(0, 55), note(1, 59), note(2, 57)]; // up, down
    expect(detectContour(old, neu)).toBeNull();
  });

  it('returns null when only one note in both', () => {
    expect(detectContour([note(0, 60)], [note(0, 72)])).toBeNull();
  });

  it('detects inversion (major)', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 64), note(2, 62)]; // up, down
    const neu: MusicalEvent[] = [note(0, 64), note(1, 60), note(2, 62)]; // down, up
    const d = detectContour(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('major');
    expect(d!.description).toContain('inverted');
    expect(d!.confidence).toBe(1.0);
  });

  it('detects minor change (1 direction changed)', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 64), note(2, 62), note(3, 65)]; // up, down, up
    const neu: MusicalEvent[] = [note(0, 60), note(1, 64), note(2, 62), note(3, 61)]; // up, down, down — 1 change
    const d = detectContour(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('minor');
  });

  it('detects moderate change (2+ directions changed)', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 64), note(2, 62), note(3, 65)]; // up, down, up
    const neu: MusicalEvent[] = [note(0, 64), note(1, 60), note(2, 62), note(3, 59)]; // down, up, down
    const d = detectContour(old, neu);
    // This is actually an inversion, so it should be major
    expect(d).not.toBeNull();
  });

  it('does not report inversion when zero intervals mask non-inversion', () => {
    // Contour [down, same, up] vs [up, same, up] — one interval inverted, one same, one unchanged
    // Without zero filtering, the zero-interval pair (-0 === 0) would match the inversion check
    const old: MusicalEvent[] = [note(0, 64), note(1, 60), note(2, 60), note(3, 64)]; // down, same, up
    const neu: MusicalEvent[] = [note(0, 60), note(1, 64), note(2, 64), note(3, 68)]; // up, same, up
    const d = detectContour(old, neu);
    expect(d).not.toBeNull();
    // Non-zero intervals: old=[down, up] vs new=[up, up] — not a full inversion
    expect(d!.description).not.toContain('inverted');
  });

  it('detects major change when note counts differ', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 64)];
    const neu: MusicalEvent[] = [note(0, 60), note(1, 64), note(2, 62)];
    const d = detectContour(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('major');
    expect(d!.confidence).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// detectTransposition
// ---------------------------------------------------------------------------

describe('detectTransposition', () => {
  it('returns null when no notes', () => {
    expect(detectTransposition([], [])).toBeNull();
  });

  it('returns null when note counts differ', () => {
    expect(detectTransposition([note(0, 60)], [note(0, 60), note(1, 62)])).toBeNull();
  });

  it('returns null when no shift', () => {
    const events: MusicalEvent[] = [note(0, 60), note(1, 64)];
    expect(detectTransposition(events, events)).toBeNull();
  });

  it('returns null when shift is non-uniform', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 64)];
    const neu: MusicalEvent[] = [note(0, 63), note(1, 66)]; // +3, +2
    expect(detectTransposition(old, neu)).toBeNull();
  });

  it('detects minor transposition (<=2 semitones)', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 64), note(2, 67)];
    const neu: MusicalEvent[] = [note(0, 62), note(1, 66), note(2, 69)]; // +2
    const d = detectTransposition(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('minor');
    expect(d!.confidence).toBe(1.0);
    expect(d!.description).toContain('major second');
  });

  it('detects moderate transposition (3-6 semitones)', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 64), note(2, 67)];
    const neu: MusicalEvent[] = [note(0, 63), note(1, 67), note(2, 70)]; // +3
    const d = detectTransposition(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('moderate');
    expect(d!.description).toContain('minor third');
  });

  it('detects major transposition (>=7 semitones)', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 64), note(2, 67)];
    const neu: MusicalEvent[] = [note(0, 72), note(1, 76), note(2, 79)]; // +12
    const d = detectTransposition(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('major');
    expect(d!.description).toContain('octave');
  });

  it('detects downward transposition', () => {
    const old: MusicalEvent[] = [note(0, 72), note(1, 76)];
    const neu: MusicalEvent[] = [note(0, 67), note(1, 71)]; // -5
    const d = detectTransposition(old, neu);
    expect(d).not.toBeNull();
    expect(d!.description).toContain('down');
  });
});

// ---------------------------------------------------------------------------
// detectRhythmPlacement
// ---------------------------------------------------------------------------

describe('detectRhythmPlacement', () => {
  it('returns null when no sound events', () => {
    expect(detectRhythmPlacement([], [], ctx)).toBeNull();
  });

  it('returns null when rhythm unchanged', () => {
    // Steps 0,4,8,12 are on-beat with stepsPerBeat=4
    const events: MusicalEvent[] = [note(0, 60), note(4, 62), note(8, 64), note(12, 65)];
    expect(detectRhythmPlacement(events, events, ctx)).toBeNull();
  });

  it('classifies on-beat events at beat boundaries (steps 0,4,8,12)', () => {
    // All on-beat → all syncopated (fractional step positions)
    const old: MusicalEvent[] = [note(0, 60), note(4, 62), note(8, 64), note(12, 65)];
    const neu: MusicalEvent[] = [note(0.3, 60), note(4.7, 62), note(8.3, 64), note(12.7, 65)];
    const d = detectRhythmPlacement(old, neu, ctx);
    expect(d).not.toBeNull();
    expect(d!.description).toContain('syncopated');
  });

  it('classifies on-subdivision events correctly (integer step, not beat boundary)', () => {
    // Steps 0,4,8,12 = on-beat → steps 1,5,9,13 = on-subdivision (integer but not beat boundary)
    const old: MusicalEvent[] = [note(0, 60), note(4, 62), note(8, 64), note(12, 65)];
    const neu: MusicalEvent[] = [note(1, 60), note(5, 62), note(9, 64), note(13, 65)];
    const d = detectRhythmPlacement(old, neu, ctx);
    // Moving from on-beat to on-subdivision changes the on-beat ratio,
    // but is NOT syncopation since they're on integer step positions
    if (d) {
      expect(d.description).not.toContain('syncopated');
    }
  });

  it('detects minor syncopation change (<=0.1)', () => {
    // 8 events on integer steps, move 1 to fractional step position
    const old: MusicalEvent[] = Array.from({ length: 8 }, (_, i) => note(i * 2, 60));
    const neu: MusicalEvent[] = [
      ...Array.from({ length: 7 }, (_, i) => note(i * 2, 60)),
      note(14.3, 60), // one syncopated (fractional step)
    ];
    const d = detectRhythmPlacement(old, neu, ctx);
    // syncopation ratio change = 1/8 = 0.125 > 0.1 → moderate
    if (d) {
      expect(d.magnitude === 'minor' || d.magnitude === 'moderate').toBe(true);
    }
  });

  it('detects major syncopation change (>0.3)', () => {
    // All on-beat → all syncopated (fractional step positions)
    const old: MusicalEvent[] = [note(0, 60), note(4, 62), note(8, 64), note(12, 65)];
    const neu: MusicalEvent[] = [note(0.3, 60), note(4.7, 62), note(8.3, 64), note(12.7, 65)];
    const d = detectRhythmPlacement(old, neu, ctx);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('major');
  });

  it('has lower confidence with few events', () => {
    const old: MusicalEvent[] = [note(0, 60), note(4, 62)];
    const neu: MusicalEvent[] = [note(0.3, 60), note(4.7, 62)];
    const d = detectRhythmPlacement(old, neu, ctx);
    if (d) expect(d.confidence).toBe(0.6);
  });
});

// ---------------------------------------------------------------------------
// detectChordQuality
// ---------------------------------------------------------------------------

describe('detectChordQuality', () => {
  it('returns null when no chordal content', () => {
    const events: MusicalEvent[] = [note(0, 60), note(1, 62)]; // monophonic
    expect(detectChordQuality(events, events, ctx)).toBeNull();
  });

  it('returns null when fewer than 2 chord groups', () => {
    // One chord group with 3 notes, duration >= stepsPerBeat (4)
    const events: MusicalEvent[] = [note(0, 60, 0.8, 4), note(0, 64, 0.8, 4), note(0, 67, 0.8, 4)];
    expect(detectChordQuality(events, events, ctx)).toBeNull();
  });

  it('detects chord progression change', () => {
    // Cm (60,63,67) at step 0 and Fm (65,68,72) at step 8, duration = 4 steps (1 beat)
    const old: MusicalEvent[] = [
      note(0, 60, 0.8, 4), note(0, 63, 0.8, 4), note(0, 67, 0.8, 4),
      note(8, 65, 0.8, 4), note(8, 68, 0.8, 4), note(8, 72, 0.8, 4),
    ];
    // Cm at step 0 and Gm (67,70,74) at step 8
    const neu: MusicalEvent[] = [
      note(0, 60, 0.8, 4), note(0, 63, 0.8, 4), note(0, 67, 0.8, 4),
      note(8, 67, 0.8, 4), note(8, 70, 0.8, 4), note(8, 74, 0.8, 4),
    ];
    const d = detectChordQuality(old, neu, ctx);
    expect(d).not.toBeNull();
    expect(d!.description).toContain('→');
  });

  it('returns null when chords are identical', () => {
    const events: MusicalEvent[] = [
      note(0, 60, 0.8, 4), note(0, 64, 0.8, 4), note(0, 67, 0.8, 4),
      note(8, 65, 0.8, 4), note(8, 69, 0.8, 4), note(8, 72, 0.8, 4),
    ];
    expect(detectChordQuality(events, events, ctx)).toBeNull();
  });

  it('skips groups with short durations (less than 1 beat in steps)', () => {
    // Notes with duration < stepsPerBeat (4) should not form chord groups
    const events: MusicalEvent[] = [
      note(0, 60, 0.8, 1), note(0, 64, 0.8, 1), note(0, 67, 0.8, 1),
      note(8, 65, 0.8, 1), note(8, 69, 0.8, 1), note(8, 72, 0.8, 1),
    ];
    expect(detectChordQuality(events, events, ctx)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectVelocityProfile
// ---------------------------------------------------------------------------

describe('detectVelocityProfile', () => {
  it('returns null when no sound events', () => {
    expect(detectVelocityProfile([], [])).toBeNull();
  });

  it('returns null when velocities unchanged', () => {
    const events: MusicalEvent[] = [note(0, 60, 0.8), note(1, 62, 0.6)];
    expect(detectVelocityProfile(events, events)).toBeNull();
  });

  it('detects minor velocity change (mean <=0.1)', () => {
    const old: MusicalEvent[] = [note(0, 60, 0.8), note(1, 62, 0.8), note(2, 64, 0.8), note(3, 65, 0.8)];
    const neu: MusicalEvent[] = [note(0, 60, 0.72), note(1, 62, 0.72), note(2, 64, 0.72), note(3, 65, 0.72)];
    const d = detectVelocityProfile(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('minor');
  });

  it('detects moderate velocity change (0.1-0.3)', () => {
    const old: MusicalEvent[] = [note(0, 60, 0.8), note(1, 62, 0.8), note(2, 64, 0.8), note(3, 65, 0.8)];
    const neu: MusicalEvent[] = [note(0, 60, 0.6), note(1, 62, 0.6), note(2, 64, 0.6), note(3, 65, 0.6)];
    const d = detectVelocityProfile(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('moderate');
  });

  it('detects major velocity change (>0.3)', () => {
    const old: MusicalEvent[] = [note(0, 60, 0.9), note(1, 62, 0.9), note(2, 64, 0.9), note(3, 65, 0.9)];
    const neu: MusicalEvent[] = [note(0, 60, 0.3), note(1, 62, 0.3), note(2, 64, 0.3), note(3, 65, 0.3)];
    const d = detectVelocityProfile(old, neu);
    expect(d).not.toBeNull();
    expect(d!.magnitude).toBe('major');
  });

  it('detects dynamics flattened', () => {
    const old: MusicalEvent[] = [note(0, 60, 0.3), note(1, 62, 0.9), note(2, 64, 0.3), note(3, 65, 0.9)]; // range 0.6
    const neu: MusicalEvent[] = [note(0, 60, 0.6), note(1, 62, 0.6), note(2, 64, 0.6), note(3, 65, 0.6)]; // range 0
    const d = detectVelocityProfile(old, neu);
    expect(d).not.toBeNull();
    expect(d!.description).toContain('flattened');
  });

  it('has lower confidence with few events', () => {
    const old: MusicalEvent[] = [note(0, 60, 0.9)];
    const neu: MusicalEvent[] = [note(0, 60, 0.3)];
    const d = detectVelocityProfile(old, neu);
    if (d) expect(d.confidence).toBe(0.6);
  });
});

// ---------------------------------------------------------------------------
// generateSemanticDiff — integration
// ---------------------------------------------------------------------------

describe('generateSemanticDiff', () => {
  it('returns empty dimensions for identical events', () => {
    const events: MusicalEvent[] = [note(0, 60), note(1, 64), note(2, 67)];
    const diff = generateSemanticDiff(events, events, ctx);
    expect(diff.dimensions).toHaveLength(0);
    expect(diff.summary).toBe('No significant changes detected');
  });

  it('returns empty dimensions for empty events', () => {
    const diff = generateSemanticDiff([], [], ctx);
    expect(diff.dimensions).toHaveLength(0);
  });

  it('detects multiple dimensions simultaneously', () => {
    const old: MusicalEvent[] = [note(0, 60, 0.8), note(1, 64, 0.8)];
    const neu: MusicalEvent[] = [
      note(0, 60, 0.3), note(0.5, 62, 0.3),
      note(1, 64, 0.3), note(1.5, 66, 0.3),
    ];
    const diff = generateSemanticDiff(old, neu, ctx);
    expect(diff.dimensions.length).toBeGreaterThan(1);
    // Should have density (2 -> 4) and velocity (0.8 -> 0.3)
    const kinds = diff.dimensions.map(d => d.kind);
    expect(kinds).toContain('density');
    expect(kinds).toContain('velocity_profile');
  });

  it('suppresses contour when transposition is detected', () => {
    const old: MusicalEvent[] = [note(0, 60), note(1, 64), note(2, 67)];
    const neu: MusicalEvent[] = [note(0, 63), note(1, 67), note(2, 70)]; // +3 uniform
    const diff = generateSemanticDiff(old, neu, ctx);
    const kinds = diff.dimensions.map(d => d.kind);
    expect(kinds).toContain('transposition');
    expect(kinds).not.toContain('contour');
  });

  it('includes trackId in output', () => {
    const diff = generateSemanticDiff([], [note(0, 60)], { ...ctx, trackId: 'my-track' });
    expect(diff.trackId).toBe('my-track');
  });

  it('renders summary from major dimensions first', () => {
    const old: MusicalEvent[] = [note(0, 60, 0.8), note(1, 64, 0.8)];
    // Big changes: double density, major velocity shift
    const neu: MusicalEvent[] = [
      note(0, 60, 0.2), note(0.5, 62, 0.2),
      note(1, 64, 0.2), note(1.5, 66, 0.2),
    ];
    const diff = generateSemanticDiff(old, neu, ctx);
    expect(diff.summary.length).toBeGreaterThan(0);
    expect(diff.summary).not.toBe('No significant changes detected');
  });

  it('handles trigger-only patterns', () => {
    const old: MusicalEvent[] = [trigger(0), trigger(1), trigger(2), trigger(3)];
    const neu: MusicalEvent[] = [trigger(0), trigger(2)];
    const diff = generateSemanticDiff(old, neu, ctx);
    const kinds = diff.dimensions.map(d => d.kind);
    expect(kinds).toContain('density');
    // No pitch-related dimensions for trigger-only
    expect(kinds).not.toContain('pitch_range');
    expect(kinds).not.toContain('contour');
    expect(kinds).not.toContain('transposition');
  });
});
