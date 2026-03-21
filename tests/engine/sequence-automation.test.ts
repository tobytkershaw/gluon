import { describe, it, expect } from 'vitest';
import {
  interpolateSequenceAutomationValue,
  normalizeSequenceAutomationPoints,
  evaluateSequenceAutomationAt,
  splitSequenceAutomationAcrossRefs,
  getSequenceAutomationValue,
  getSequenceAutomationValuesAt,
  hasSequenceAutomationPointAt,
} from '../../src/engine/sequence-automation';
import type { SequenceAutomationPoint, PatternRef } from '../../src/engine/sequencer-types';
import type { Pattern } from '../../src/engine/canonical-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function point(at: number, value: number, extra: Partial<SequenceAutomationPoint> = {}): SequenceAutomationPoint {
  return { at, value, ...extra };
}

function makePattern(id: string, duration: number): Pattern {
  return { id, kind: 'pattern', duration, events: [] };
}

function makeRef(patternId: string, automation?: PatternRef['automation']): PatternRef {
  return automation ? { patternId, automation } : { patternId };
}

// ---------------------------------------------------------------------------
// interpolateSequenceAutomationValue
// ---------------------------------------------------------------------------

describe('interpolateSequenceAutomationValue', () => {
  it('returns fromPoint value for step interpolation', () => {
    const from = point(0, 0.2, { interpolation: 'step' });
    const to = point(4, 0.8);
    expect(interpolateSequenceAutomationValue(from, to, 2)).toBe(0.2);
  });

  it('defaults to step when no interpolation is set', () => {
    const from = point(0, 0.3);
    const to = point(4, 0.9);
    expect(interpolateSequenceAutomationValue(from, to, 2)).toBe(0.3);
  });

  it('linearly interpolates midpoint', () => {
    const from = point(0, 0.0, { interpolation: 'linear' });
    const to = point(4, 1.0);
    expect(interpolateSequenceAutomationValue(from, to, 2)).toBeCloseTo(0.5, 5);
  });

  it('linearly interpolates at quarter point', () => {
    const from = point(0, 0.0, { interpolation: 'linear' });
    const to = point(8, 1.0);
    expect(interpolateSequenceAutomationValue(from, to, 2)).toBeCloseTo(0.25, 5);
  });

  it('linearly interpolates at three-quarter point', () => {
    const from = point(0, 0.0, { interpolation: 'linear' });
    const to = point(8, 1.0);
    expect(interpolateSequenceAutomationValue(from, to, 6)).toBeCloseTo(0.75, 5);
  });

  it('returns fromPoint value when duration is zero', () => {
    const from = point(2, 0.5, { interpolation: 'linear' });
    const to = point(2, 0.9);
    expect(interpolateSequenceAutomationValue(from, to, 2)).toBe(0.5);
  });

  it('returns fromPoint value when duration is negative', () => {
    const from = point(4, 0.5, { interpolation: 'linear' });
    const to = point(2, 0.9);
    expect(interpolateSequenceAutomationValue(from, to, 3)).toBe(0.5);
  });

  it('clamps t to [0,1] range', () => {
    const from = point(0, 0.0, { interpolation: 'linear' });
    const to = point(4, 1.0);
    // at before fromPoint
    expect(interpolateSequenceAutomationValue(from, to, -1)).toBeCloseTo(0.0, 5);
    // at after toPoint
    expect(interpolateSequenceAutomationValue(from, to, 5)).toBeCloseTo(1.0, 5);
  });

  it('applies curve interpolation with zero tension (same as linear)', () => {
    const from = point(0, 0.0, { interpolation: 'curve', tension: 0 });
    const to = point(4, 1.0);
    expect(interpolateSequenceAutomationValue(from, to, 2)).toBeCloseTo(0.5, 5);
  });

  it('applies curve interpolation with positive tension (fast start)', () => {
    const from = point(0, 0.0, { interpolation: 'curve', tension: 1 });
    const to = point(4, 1.0);
    const midValue = interpolateSequenceAutomationValue(from, to, 2);
    // Positive tension = fast start / slow end, so midpoint value should be > 0.5
    expect(midValue).toBeGreaterThan(0.5);
  });

  it('applies curve interpolation with negative tension (slow start)', () => {
    const from = point(0, 0.0, { interpolation: 'curve', tension: -1 });
    const to = point(4, 1.0);
    const midValue = interpolateSequenceAutomationValue(from, to, 2);
    // Negative tension = slow start / fast end, so midpoint value should be < 0.5
    expect(midValue).toBeLessThan(0.5);
  });

  it('clamps tension to [-1, 1]', () => {
    const from = point(0, 0.0, { interpolation: 'curve', tension: 5 });
    const to = point(4, 1.0);
    const withExtreme = interpolateSequenceAutomationValue(from, to, 2);
    const from2 = point(0, 0.0, { interpolation: 'curve', tension: 1 });
    const withClamped = interpolateSequenceAutomationValue(from2, to, 2);
    expect(withExtreme).toBeCloseTo(withClamped, 5);
  });
});

// ---------------------------------------------------------------------------
// normalizeSequenceAutomationPoints
// ---------------------------------------------------------------------------

describe('normalizeSequenceAutomationPoints', () => {
  it('sorts points by at position', () => {
    const points = [point(4, 0.5), point(1, 0.3), point(8, 0.9)];
    const result = normalizeSequenceAutomationPoints(points);
    expect(result.map(p => p.at)).toEqual([1, 4, 8]);
  });

  it('deduplicates points at the same position (later wins)', () => {
    const points = [point(2, 0.3), point(2, 0.7)];
    const result = normalizeSequenceAutomationPoints(points);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(0.7);
  });

  it('deduplicates points within tolerance (0.0001)', () => {
    const points = [point(2.0, 0.3), point(2.00005, 0.7)];
    const result = normalizeSequenceAutomationPoints(points);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(0.7);
  });

  it('clamps values to [0, 1]', () => {
    const points = [point(0, -0.5), point(4, 1.5)];
    const result = normalizeSequenceAutomationPoints(points);
    expect(result[0].value).toBe(0);
    expect(result[1].value).toBe(1);
  });

  it('clamps tension to [-1, 1]', () => {
    const points = [point(0, 0.5, { tension: -5 }), point(4, 0.5, { tension: 3 })];
    const result = normalizeSequenceAutomationPoints(points);
    expect(result[0].tension).toBe(-1);
    expect(result[1].tension).toBe(1);
  });

  it('preserves interpolation mode', () => {
    const points = [point(0, 0.5, { interpolation: 'linear' })];
    const result = normalizeSequenceAutomationPoints(points);
    expect(result[0].interpolation).toBe('linear');
  });

  it('returns empty array for empty input', () => {
    expect(normalizeSequenceAutomationPoints([])).toEqual([]);
  });

  it('does not mutate input', () => {
    const points = [point(4, 0.5), point(1, 0.3)];
    const copy = points.map(p => ({ ...p }));
    normalizeSequenceAutomationPoints(points);
    expect(points).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// evaluateSequenceAutomationAt
// ---------------------------------------------------------------------------

describe('evaluateSequenceAutomationAt', () => {
  it('returns undefined for empty points', () => {
    expect(evaluateSequenceAutomationAt([], 2)).toBeUndefined();
  });

  it('returns exact point when position matches', () => {
    const points = [point(0, 0.3), point(4, 0.7)];
    const result = evaluateSequenceAutomationAt(points, 4);
    expect(result?.value).toBe(0.7);
    expect(result?.at).toBe(4);
  });

  it('returns exact point within tolerance', () => {
    const points = [point(4, 0.7)];
    const result = evaluateSequenceAutomationAt(points, 4.00005);
    expect(result?.value).toBe(0.7);
  });

  it('interpolates between two points', () => {
    const points = [point(0, 0.0, { interpolation: 'linear' }), point(4, 1.0)];
    const result = evaluateSequenceAutomationAt(points, 2);
    expect(result?.value).toBeCloseTo(0.5, 5);
    expect(result?.at).toBe(2);
  });

  it('holds last point value after all points (step)', () => {
    const points = [point(0, 0.3), point(4, 0.7)];
    const result = evaluateSequenceAutomationAt(points, 8);
    expect(result?.value).toBe(0.7);
    expect(result?.interpolation).toBe('step');
  });

  it('returns undefined before first point', () => {
    const points = [point(4, 0.7)];
    const result = evaluateSequenceAutomationAt(points, 2);
    expect(result).toBeUndefined();
  });

  it('returns interpolated result with correct interpolation mode', () => {
    const points = [point(0, 0.0, { interpolation: 'linear', tension: 0.5 }), point(4, 1.0)];
    const result = evaluateSequenceAutomationAt(points, 2);
    expect(result?.interpolation).toBe('linear');
    expect(result?.tension).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// splitSequenceAutomationAcrossRefs
// ---------------------------------------------------------------------------

describe('splitSequenceAutomationAcrossRefs', () => {
  const patterns = [makePattern('A', 4), makePattern('B', 4)];

  it('distributes points to the correct pattern refs', () => {
    const sequence = [makeRef('A'), makeRef('B')];
    const points = [point(1, 0.3), point(5, 0.7)];
    const result = splitSequenceAutomationAcrossRefs(sequence, patterns, 'filter', points);

    // Pattern A spans 0..4, pattern B spans 4..8
    const laneA = result[0].automation?.find(l => l.controlId === 'filter');
    const laneB = result[1].automation?.find(l => l.controlId === 'filter');

    expect(laneA).toBeDefined();
    expect(laneB).toBeDefined();
    // Point at=1 is within A (local at=1)
    expect(laneA!.points.some(p => Math.abs(p.at - 1) < 0.001)).toBe(true);
    // Point at=5 is within B (local at=1)
    expect(laneB!.points.some(p => Math.abs(p.at - 1) < 0.001)).toBe(true);
  });

  it('adds interpolated boundary points', () => {
    const sequence = [makeRef('A'), makeRef('B')];
    const points = [
      point(0, 0.0, { interpolation: 'linear' }),
      point(8, 1.0),
    ];
    const result = splitSequenceAutomationAcrossRefs(sequence, patterns, 'filter', points);

    const laneA = result[0].automation?.find(l => l.controlId === 'filter');
    const laneB = result[1].automation?.find(l => l.controlId === 'filter');

    // Pattern A should have start (at=0) and end (at=4) points
    expect(laneA!.points.length).toBeGreaterThanOrEqual(2);
    // Pattern B should have start (at=0) and end (at=4) points
    expect(laneB!.points.length).toBeGreaterThanOrEqual(2);

    // Boundary value at t=4 of [0,8] linear ramp should be ~0.5
    const bEndA = laneA!.points.find(p => Math.abs(p.at - 4) < 0.01);
    const bStartB = laneB!.points.find(p => Math.abs(p.at - 0) < 0.01);
    expect(bEndA?.value).toBeCloseTo(0.5, 2);
    expect(bStartB?.value).toBeCloseTo(0.5, 2);
  });

  it('removes lane when points are empty', () => {
    const sequence = [
      makeRef('A', [{ controlId: 'filter', points: [point(0, 0.5)] }]),
    ];
    const result = splitSequenceAutomationAcrossRefs(sequence, patterns, 'filter', []);
    // Should have cleared the filter lane
    const lane = result[0].automation?.find(l => l.controlId === 'filter');
    expect(lane).toBeUndefined();
  });

  it('preserves other automation lanes on the ref', () => {
    const sequence = [
      makeRef('A', [
        { controlId: 'resonance', points: [point(0, 0.3)] },
        { controlId: 'filter', points: [point(0, 0.5)] },
      ]),
    ];
    const result = splitSequenceAutomationAcrossRefs(sequence, patterns, 'filter', [point(0, 0.9)]);
    const resLane = result[0].automation?.find(l => l.controlId === 'resonance');
    expect(resLane).toBeDefined();
    expect(resLane!.points[0].value).toBe(0.3);
  });

  it('handles pattern with zero duration', () => {
    const zeroDurPatterns = [makePattern('Z', 0), makePattern('B', 4)];
    const sequence = [makeRef('Z'), makeRef('B')];
    const points = [point(0, 0.5)];
    const result = splitSequenceAutomationAcrossRefs(sequence, zeroDurPatterns, 'filter', points);
    // Zero-duration pattern should get no automation
    const laneZ = result[0].automation?.find(l => l.controlId === 'filter');
    expect(laneZ).toBeUndefined();
  });

  it('handles missing pattern (not found in patterns array)', () => {
    const sequence = [makeRef('missing'), makeRef('B')];
    const points = [point(0, 0.5)];
    const result = splitSequenceAutomationAcrossRefs(sequence, patterns, 'filter', points);
    const laneMissing = result[0].automation?.find(l => l.controlId === 'filter');
    expect(laneMissing).toBeUndefined();
  });

  it('normalizes input points before splitting', () => {
    const sequence = [makeRef('A')];
    // Unsorted, duplicate, out-of-range values
    const points = [point(3, 1.5), point(1, -0.2), point(1, 0.4)];
    const result = splitSequenceAutomationAcrossRefs(sequence, patterns, 'filter', points);
    const lane = result[0].automation?.find(l => l.controlId === 'filter');
    expect(lane).toBeDefined();
    // Values should be clamped
    for (const p of lane!.points) {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// getSequenceAutomationValue
// ---------------------------------------------------------------------------

describe('getSequenceAutomationValue', () => {
  it('returns value from a lane at a given position', () => {
    const ref = makeRef('A', [
      { controlId: 'filter', points: [point(0, 0.3), point(4, 0.7)] },
    ]);
    expect(getSequenceAutomationValue(ref, 'filter', 0)).toBe(0.3);
  });

  it('interpolates between points', () => {
    const ref = makeRef('A', [
      { controlId: 'filter', points: [point(0, 0.0, { interpolation: 'linear' }), point(4, 1.0)] },
    ]);
    expect(getSequenceAutomationValue(ref, 'filter', 2)).toBeCloseTo(0.5, 5);
  });

  it('returns undefined for missing lane', () => {
    const ref = makeRef('A', [
      { controlId: 'filter', points: [point(0, 0.5)] },
    ]);
    expect(getSequenceAutomationValue(ref, 'resonance', 0)).toBeUndefined();
  });

  it('returns undefined for undefined ref', () => {
    expect(getSequenceAutomationValue(undefined, 'filter', 0)).toBeUndefined();
  });

  it('returns undefined for ref without automation', () => {
    const ref = makeRef('A');
    expect(getSequenceAutomationValue(ref, 'filter', 0)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getSequenceAutomationValuesAt
// ---------------------------------------------------------------------------

describe('getSequenceAutomationValuesAt', () => {
  it('returns values from all lanes at a position', () => {
    const ref = makeRef('A', [
      { controlId: 'filter', points: [point(0, 0.3)] },
      { controlId: 'resonance', points: [point(0, 0.7)] },
    ]);
    const result = getSequenceAutomationValuesAt(ref, 0);
    expect(result.filter).toBe(0.3);
    expect(result.resonance).toBe(0.7);
  });

  it('returns empty object for undefined ref', () => {
    const result = getSequenceAutomationValuesAt(undefined, 0);
    expect(result).toEqual({});
  });

  it('returns empty object for ref without automation', () => {
    const ref = makeRef('A');
    const result = getSequenceAutomationValuesAt(ref, 0);
    expect(result).toEqual({});
  });

  it('excludes lanes with no value at the given position', () => {
    const ref = makeRef('A', [
      { controlId: 'filter', points: [point(4, 0.5)] }, // starts at 4, no value at 0
    ]);
    const result = getSequenceAutomationValuesAt(ref, 0);
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// hasSequenceAutomationPointAt
// ---------------------------------------------------------------------------

describe('hasSequenceAutomationPointAt', () => {
  it('returns true when a point exists at the position', () => {
    const ref = makeRef('A', [
      { controlId: 'filter', points: [point(2, 0.5)] },
    ]);
    expect(hasSequenceAutomationPointAt(ref, 'filter', 2)).toBe(true);
  });

  it('returns true within tolerance', () => {
    const ref = makeRef('A', [
      { controlId: 'filter', points: [point(2.00005, 0.5)] },
    ]);
    expect(hasSequenceAutomationPointAt(ref, 'filter', 2)).toBe(true);
  });

  it('returns false outside tolerance', () => {
    const ref = makeRef('A', [
      { controlId: 'filter', points: [point(2.001, 0.5)] },
    ]);
    expect(hasSequenceAutomationPointAt(ref, 'filter', 2)).toBe(false);
  });

  it('returns false for wrong controlId', () => {
    const ref = makeRef('A', [
      { controlId: 'filter', points: [point(2, 0.5)] },
    ]);
    expect(hasSequenceAutomationPointAt(ref, 'resonance', 2)).toBe(false);
  });

  it('returns false for undefined ref', () => {
    expect(hasSequenceAutomationPointAt(undefined, 'filter', 2)).toBe(false);
  });

  it('returns false for ref without automation', () => {
    const ref = makeRef('A');
    expect(hasSequenceAutomationPointAt(ref, 'filter', 2)).toBe(false);
  });
});
