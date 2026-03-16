import { describe, it, expect } from 'vitest';
import type { ParameterEvent, MusicalEvent } from './canonical-types';
import {
  interpolateParameterValue,
  getInterpolatedParams,
  findNextParameterEvent,
} from './interpolation';

function pe(at: number, controlId: string, value: number, interpolation?: 'step' | 'linear' | 'curve', tension?: number): ParameterEvent {
  return { kind: 'parameter', at, controlId, value, interpolation, tension };
}

describe('interpolateParameterValue', () => {
  it('returns undefined for step interpolation', () => {
    const from = pe(0, 'timbre', 0.0, 'step');
    const to = pe(4, 'timbre', 1.0);
    expect(interpolateParameterValue(from, to, 2)).toBeUndefined();
  });

  it('returns undefined for default (no interpolation field)', () => {
    const from = pe(0, 'timbre', 0.0);
    const to = pe(4, 'timbre', 1.0);
    expect(interpolateParameterValue(from, to, 2)).toBeUndefined();
  });

  it('computes linear interpolation at midpoint', () => {
    const from = pe(0, 'timbre', 0.0, 'linear');
    const to = pe(4, 'timbre', 1.0);
    expect(interpolateParameterValue(from, to, 2)).toBeCloseTo(0.5);
  });

  it('computes linear interpolation at quarter point', () => {
    const from = pe(0, 'timbre', 0.0, 'linear');
    const to = pe(8, 'timbre', 1.0);
    expect(interpolateParameterValue(from, to, 2)).toBeCloseTo(0.25);
  });

  it('computes linear interpolation at start', () => {
    const from = pe(0, 'timbre', 0.2, 'linear');
    const to = pe(4, 'timbre', 0.8);
    expect(interpolateParameterValue(from, to, 0)).toBeCloseTo(0.2);
  });

  it('computes linear interpolation at end', () => {
    const from = pe(0, 'timbre', 0.2, 'linear');
    const to = pe(4, 'timbre', 0.8);
    expect(interpolateParameterValue(from, to, 4)).toBeCloseTo(0.8);
  });

  it('computes curve interpolation with tension=0 (same as linear)', () => {
    const from = pe(0, 'timbre', 0.0, 'curve', 0);
    const to = pe(4, 'timbre', 1.0);
    expect(interpolateParameterValue(from, to, 2)).toBeCloseTo(0.5);
  });

  it('computes curve with positive tension (fast start, slow end)', () => {
    const from = pe(0, 'timbre', 0.0, 'curve', 0.5);
    const to = pe(4, 'timbre', 1.0);
    const val = interpolateParameterValue(from, to, 2)!;
    // Positive tension: value at midpoint should be > 0.5 (concave up)
    expect(val).toBeGreaterThan(0.5);
    expect(val).toBeLessThan(1.0);
  });

  it('computes curve with negative tension (slow start, fast end)', () => {
    const from = pe(0, 'timbre', 0.0, 'curve', -0.5);
    const to = pe(4, 'timbre', 1.0);
    const val = interpolateParameterValue(from, to, 2)!;
    // Negative tension: value at midpoint should be < 0.5 (concave down)
    expect(val).toBeLessThan(0.5);
    expect(val).toBeGreaterThan(0.0);
  });

  it('returns undefined for non-numeric values', () => {
    const from: ParameterEvent = { kind: 'parameter', at: 0, controlId: 'mode', value: 'saw', interpolation: 'linear' };
    const to: ParameterEvent = { kind: 'parameter', at: 4, controlId: 'mode', value: 'square' };
    expect(interpolateParameterValue(from, to, 2)).toBeUndefined();
  });

  it('returns undefined when duration is zero', () => {
    const from = pe(2, 'timbre', 0.0, 'linear');
    const to = pe(2, 'timbre', 1.0);
    expect(interpolateParameterValue(from, to, 2)).toBeUndefined();
  });

  it('clamps tension to [-1, 1]', () => {
    const from = pe(0, 'timbre', 0.0, 'curve', 5.0);
    const to = pe(4, 'timbre', 1.0);
    // Should not crash; tension clamped to 1.0
    const val = interpolateParameterValue(from, to, 2);
    expect(val).toBeDefined();
    expect(val).toBeGreaterThan(0.0);
    expect(val).toBeLessThan(1.0);
  });
});

describe('findNextParameterEvent', () => {
  it('finds the next event for the same controlId', () => {
    const events: MusicalEvent[] = [
      pe(0, 'timbre', 0.0, 'linear'),
      pe(4, 'timbre', 1.0),
    ];
    const next = findNextParameterEvent(events, 'timbre', 0);
    expect(next).toBeDefined();
    expect(next!.at).toBe(4);
  });

  it('returns undefined when no next event exists', () => {
    const events: MusicalEvent[] = [
      pe(0, 'timbre', 0.0, 'linear'),
    ];
    expect(findNextParameterEvent(events, 'timbre', 0)).toBeUndefined();
  });

  it('skips events for different controlId', () => {
    const events: MusicalEvent[] = [
      pe(0, 'timbre', 0.0, 'linear'),
      pe(2, 'morph', 0.5),
      pe(4, 'timbre', 1.0),
    ];
    const next = findNextParameterEvent(events, 'timbre', 0);
    expect(next!.at).toBe(4);
    expect(next!.controlId).toBe('timbre');
  });

  it('respects beforeAt limit', () => {
    const events: MusicalEvent[] = [
      pe(0, 'timbre', 0.0, 'linear'),
      pe(8, 'timbre', 1.0),
    ];
    expect(findNextParameterEvent(events, 'timbre', 0, 6)).toBeUndefined();
  });
});

describe('getInterpolatedParams', () => {
  it('returns empty for step-only events', () => {
    const events: MusicalEvent[] = [
      pe(0, 'timbre', 0.0),
      pe(4, 'timbre', 1.0),
    ];
    expect(getInterpolatedParams(events, 2)).toEqual([]);
  });

  it('returns interpolated value for linear events', () => {
    const events: MusicalEvent[] = [
      pe(0, 'timbre', 0.0, 'linear'),
      pe(4, 'timbre', 1.0),
    ];
    const result = getInterpolatedParams(events, 2);
    expect(result).toHaveLength(1);
    expect(result[0].controlId).toBe('timbre');
    expect(result[0].value).toBeCloseTo(0.5);
  });

  it('handles multiple controlIds independently', () => {
    const events: MusicalEvent[] = [
      pe(0, 'timbre', 0.0, 'linear'),
      pe(0, 'morph', 1.0, 'linear'),
      pe(4, 'timbre', 1.0),
      pe(4, 'morph', 0.0),
    ];
    const result = getInterpolatedParams(events, 2);
    expect(result).toHaveLength(2);
    const timbreResult = result.find(r => r.controlId === 'timbre');
    const morphResult = result.find(r => r.controlId === 'morph');
    expect(timbreResult!.value).toBeCloseTo(0.5);
    expect(morphResult!.value).toBeCloseTo(0.5);
  });

  it('returns empty when position is before any event', () => {
    const events: MusicalEvent[] = [
      pe(4, 'timbre', 0.0, 'linear'),
      pe(8, 'timbre', 1.0),
    ];
    expect(getInterpolatedParams(events, 2)).toEqual([]);
  });

  it('returns empty when position is past the interpolation range', () => {
    const events: MusicalEvent[] = [
      pe(0, 'timbre', 0.0, 'linear'),
      pe(4, 'timbre', 1.0),
    ];
    // at=6 is past the target event at 4
    expect(getInterpolatedParams(events, 6)).toEqual([]);
  });

  it('handles curve interpolation', () => {
    const events: MusicalEvent[] = [
      pe(0, 'timbre', 0.0, 'curve', 0.5),
      pe(8, 'timbre', 1.0),
    ];
    const result = getInterpolatedParams(events, 4);
    expect(result).toHaveLength(1);
    // Positive tension: midpoint value > linear midpoint (0.5)
    expect(result[0].value).toBeGreaterThan(0.5);
  });

  it('ignores non-parameter events', () => {
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 0.8 },
      pe(0, 'timbre', 0.0, 'linear'),
      pe(4, 'timbre', 1.0),
      { kind: 'trigger', at: 4, velocity: 0.8 },
    ];
    const result = getInterpolatedParams(events, 2);
    expect(result).toHaveLength(1);
    expect(result[0].controlId).toBe('timbre');
  });
});
