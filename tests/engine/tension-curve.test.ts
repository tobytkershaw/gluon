import { describe, it, expect } from 'vitest';
import {
  interpolateTension,
  resolveTrackTension,
  createTensionCurve,
  setTensionPoints,
  mergeTensionPoints,
  setTrackTensionMapping,
  removeTrackTensionMapping,
  getTensionAt,
  serializeTensionCurve,
  deserializeTensionCurve,
} from '../../src/engine/tension-curve';
import type { TensionPoint, TrackTensionMapping } from '../../src/engine/tension-curve';

describe('TensionCurve', () => {
  // ── Interpolation ───────────────────────────────────────────────────────

  describe('interpolateTension', () => {
    it('returns neutral values for empty curve', () => {
      const result = interpolateTension([], 5);
      expect(result).toEqual({ energy: 0.5, density: 0.5 });
    });

    it('returns single point values regardless of bar', () => {
      const points: TensionPoint[] = [{ bar: 8, energy: 0.7, density: 0.3 }];
      expect(interpolateTension(points, 1)).toEqual({ energy: 0.7, density: 0.3 });
      expect(interpolateTension(points, 8)).toEqual({ energy: 0.7, density: 0.3 });
      expect(interpolateTension(points, 100)).toEqual({ energy: 0.7, density: 0.3 });
    });

    it('clamps to first point before range', () => {
      const points: TensionPoint[] = [
        { bar: 4, energy: 0.2, density: 0.1 },
        { bar: 16, energy: 0.9, density: 0.8 },
      ];
      expect(interpolateTension(points, 1)).toEqual({ energy: 0.2, density: 0.1 });
    });

    it('clamps to last point after range', () => {
      const points: TensionPoint[] = [
        { bar: 4, energy: 0.2, density: 0.1 },
        { bar: 16, energy: 0.9, density: 0.8 },
      ];
      expect(interpolateTension(points, 32)).toEqual({ energy: 0.9, density: 0.8 });
    });

    it('interpolates linearly between two points', () => {
      const points: TensionPoint[] = [
        { bar: 1, energy: 0.0, density: 0.0 },
        { bar: 11, energy: 1.0, density: 1.0 },
      ];
      const mid = interpolateTension(points, 6);
      expect(mid.energy).toBeCloseTo(0.5, 5);
      expect(mid.density).toBeCloseTo(0.5, 5);
    });

    it('interpolates between multiple points', () => {
      const points: TensionPoint[] = [
        { bar: 1, energy: 0.0, density: 0.0 },
        { bar: 9, energy: 0.8, density: 0.4 },
        { bar: 17, energy: 0.2, density: 0.9 },
      ];
      // At bar 5 (midpoint of segment 1-9)
      const mid1 = interpolateTension(points, 5);
      expect(mid1.energy).toBeCloseTo(0.4, 5);
      expect(mid1.density).toBeCloseTo(0.2, 5);

      // At bar 13 (midpoint of segment 9-17)
      const mid2 = interpolateTension(points, 13);
      expect(mid2.energy).toBeCloseTo(0.5, 5);
      expect(mid2.density).toBeCloseTo(0.65, 5);
    });

    it('returns exact values at point boundaries', () => {
      const points: TensionPoint[] = [
        { bar: 1, energy: 0.3, density: 0.1 },
        { bar: 8, energy: 0.7, density: 0.5 },
      ];
      expect(interpolateTension(points, 1)).toEqual({ energy: 0.3, density: 0.1 });
      expect(interpolateTension(points, 8)).toEqual({ energy: 0.7, density: 0.5 });
    });
  });

  // ── Point ordering ──────────────────────────────────────────────────────

  describe('setTensionPoints', () => {
    it('sorts points by bar', () => {
      const curve = createTensionCurve();
      const result = setTensionPoints(curve, [
        { bar: 16, energy: 0.8, density: 0.6 },
        { bar: 1, energy: 0.1, density: 0.2 },
        { bar: 8, energy: 0.5, density: 0.4 },
      ]);
      expect(result.points.map(p => p.bar)).toEqual([1, 8, 16]);
    });

    it('deduplicates same-bar points (last wins)', () => {
      const curve = createTensionCurve();
      const result = setTensionPoints(curve, [
        { bar: 4, energy: 0.1, density: 0.2 },
        { bar: 4, energy: 0.9, density: 0.8 },
      ]);
      expect(result.points).toHaveLength(1);
      expect(result.points[0]).toEqual({ bar: 4, energy: 0.9, density: 0.8 });
    });

    it('clamps energy and density to 0-1', () => {
      const curve = createTensionCurve();
      const result = setTensionPoints(curve, [
        { bar: 1, energy: -0.5, density: 1.5 },
      ]);
      expect(result.points[0].energy).toBe(0);
      expect(result.points[0].density).toBe(1);
    });
  });

  // ── Merge points ────────────────────────────────────────────────────────

  describe('mergeTensionPoints', () => {
    it('adds new points to existing', () => {
      let curve = createTensionCurve();
      curve = setTensionPoints(curve, [{ bar: 1, energy: 0.3, density: 0.2 }]);
      const result = mergeTensionPoints(curve, [{ bar: 8, energy: 0.7, density: 0.6 }]);
      expect(result.points).toHaveLength(2);
    });

    it('overwrites existing points at same bar', () => {
      let curve = createTensionCurve();
      curve = setTensionPoints(curve, [{ bar: 1, energy: 0.3, density: 0.2 }]);
      const result = mergeTensionPoints(curve, [{ bar: 1, energy: 0.9, density: 0.8 }]);
      expect(result.points).toHaveLength(1);
      expect(result.points[0].energy).toBe(0.9);
    });
  });

  // ── Track mapping ───────────────────────────────────────────────────────

  describe('resolveTrackTension', () => {
    it('maps energy linearly to parameter ranges', () => {
      const mapping: TrackTensionMapping = {
        trackId: 'kick',
        params: [
          { param: 'velocity', low: 0.3, high: 0.9 },
        ],
      };
      const result = resolveTrackTension(mapping, 0.5, 0.5);
      expect(result).toHaveLength(1);
      expect(result[0].param).toBe('velocity');
      expect(result[0].value).toBeCloseTo(0.6, 5);
      expect(result[0].active).toBe(true);
    });

    it('returns low value when energy is 0', () => {
      const mapping: TrackTensionMapping = {
        trackId: 'pad',
        params: [{ param: 'cutoff', low: 0.1, high: 0.8 }],
      };
      const result = resolveTrackTension(mapping, 0, 0);
      expect(result[0].value).toBeCloseTo(0.1, 5);
    });

    it('returns high value when energy is 1', () => {
      const mapping: TrackTensionMapping = {
        trackId: 'pad',
        params: [{ param: 'cutoff', low: 0.1, high: 0.8 }],
      };
      const result = resolveTrackTension(mapping, 1, 0);
      expect(result[0].value).toBeCloseTo(0.8, 5);
    });

    it('respects activation threshold', () => {
      const mapping: TrackTensionMapping = {
        trackId: 'hats',
        activationThreshold: 0.5,
        params: [{ param: 'volume', low: 0.0, high: 1.0 }],
      };

      // Below threshold — inactive
      const below = resolveTrackTension(mapping, 0.3, 0.5);
      expect(below[0].active).toBe(false);
      expect(below[0].value).toBe(0.0);

      // At threshold — active
      const at = resolveTrackTension(mapping, 0.5, 0.5);
      expect(at[0].active).toBe(true);

      // Above threshold — active
      const above = resolveTrackTension(mapping, 0.8, 0.5);
      expect(above[0].active).toBe(true);
    });

    it('handles multiple param mappings', () => {
      const mapping: TrackTensionMapping = {
        trackId: 'lead',
        params: [
          { param: 'velocity', low: 0.2, high: 0.9 },
          { param: 'cutoff', low: 0.1, high: 0.7 },
        ],
      };
      const result = resolveTrackTension(mapping, 0.5, 0.5);
      expect(result).toHaveLength(2);
      expect(result[0].param).toBe('velocity');
      expect(result[1].param).toBe('cutoff');
    });
  });

  // ── Track mapping management ────────────────────────────────────────────

  describe('setTrackTensionMapping', () => {
    it('adds a new mapping', () => {
      const curve = createTensionCurve();
      const result = setTrackTensionMapping(curve, {
        trackId: 'kick',
        params: [{ param: 'velocity', low: 0.3, high: 0.9 }],
      });
      expect(result.trackMappings).toHaveLength(1);
      expect(result.trackMappings[0].trackId).toBe('kick');
    });

    it('replaces existing mapping for same track', () => {
      let curve = createTensionCurve();
      curve = setTrackTensionMapping(curve, {
        trackId: 'kick',
        params: [{ param: 'velocity', low: 0.3, high: 0.9 }],
      });
      const result = setTrackTensionMapping(curve, {
        trackId: 'kick',
        params: [{ param: 'cutoff', low: 0.1, high: 0.8 }],
      });
      expect(result.trackMappings).toHaveLength(1);
      expect(result.trackMappings[0].params[0].param).toBe('cutoff');
    });
  });

  describe('removeTrackTensionMapping', () => {
    it('removes a mapping', () => {
      let curve = createTensionCurve();
      curve = setTrackTensionMapping(curve, {
        trackId: 'kick',
        params: [{ param: 'velocity', low: 0.3, high: 0.9 }],
      });
      const result = removeTrackTensionMapping(curve, 'kick');
      expect(result.trackMappings).toHaveLength(0);
    });

    it('is a no-op for unknown trackId', () => {
      const curve = createTensionCurve();
      const result = removeTrackTensionMapping(curve, 'nonexistent');
      expect(result.trackMappings).toHaveLength(0);
    });
  });

  // ── getTensionAt ────────────────────────────────────────────────────────

  describe('getTensionAt', () => {
    it('delegates to interpolateTension', () => {
      let curve = createTensionCurve();
      curve = setTensionPoints(curve, [
        { bar: 1, energy: 0.0, density: 0.0 },
        { bar: 11, energy: 1.0, density: 1.0 },
      ]);
      const result = getTensionAt(curve, 6);
      expect(result.energy).toBeCloseTo(0.5, 5);
      expect(result.density).toBeCloseTo(0.5, 5);
    });
  });

  // ── Serialization ───────────────────────────────────────────────────────

  describe('serialization', () => {
    it('round-trips through serialize/deserialize', () => {
      let curve = createTensionCurve();
      curve = setTensionPoints(curve, [
        { bar: 1, energy: 0.2, density: 0.1 },
        { bar: 16, energy: 0.9, density: 0.7 },
      ]);
      curve = setTrackTensionMapping(curve, {
        trackId: 'kick',
        activationThreshold: 0.3,
        params: [{ param: 'velocity', low: 0.2, high: 0.9 }],
      });

      const serialized = serializeTensionCurve(curve);
      const json = JSON.parse(JSON.stringify(serialized));
      const deserialized = deserializeTensionCurve(json);

      expect(deserialized.points).toEqual(curve.points);
      expect(deserialized.trackMappings).toEqual(curve.trackMappings);
    });

    it('handles null/undefined input gracefully', () => {
      expect(deserializeTensionCurve(null)).toEqual(createTensionCurve());
      expect(deserializeTensionCurve(undefined)).toEqual(createTensionCurve());
      expect(deserializeTensionCurve({})).toEqual(createTensionCurve());
    });

    it('skips invalid points', () => {
      const result = deserializeTensionCurve({
        points: [
          { bar: 1, energy: 0.5, density: 0.3 },
          { bar: 'invalid', energy: 0.5, density: 0.3 },
          { energy: 0.5, density: 0.3 },
          null,
        ],
      });
      expect(result.points).toHaveLength(1);
      expect(result.points[0].bar).toBe(1);
    });

    it('clamps out-of-range values on deserialize', () => {
      const result = deserializeTensionCurve({
        points: [{ bar: 1, energy: 2.0, density: -0.5 }],
      });
      expect(result.points[0].energy).toBe(1);
      expect(result.points[0].density).toBe(0);
    });
  });
});
