// tests/engine/spectral-slots.test.ts — Tests for spectral slot assignment and collision resolution.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SpectralSlotManager,
  BAND_RANGES,
  FREQUENCY_BANDS,
  bandCenterFreq,
} from '../../src/engine/spectral-slots';
import type { FrequencyBand, SpectralSlot, EQAdjustment, BandCollision } from '../../src/engine/spectral-slots';

describe('SpectralSlotManager', () => {
  let mgr: SpectralSlotManager;

  beforeEach(() => {
    mgr = new SpectralSlotManager();
  });

  // ── Band assignment ─────────────────────────────────────────────────────

  describe('assign', () => {
    it('assigns a track to bands with priority', () => {
      const slot = mgr.assign('kick', ['sub', 'low'], 10);
      expect(slot.trackId).toBe('kick');
      expect(slot.primaryBands).toEqual(['sub', 'low']);
      expect(slot.priority).toBe(10);
    });

    it('stores and retrieves assigned slots', () => {
      mgr.assign('kick', ['sub', 'low'], 10);
      const retrieved = mgr.get('kick');
      expect(retrieved).toBeDefined();
      expect(retrieved!.trackId).toBe('kick');
    });

    it('overwrites existing assignment', () => {
      mgr.assign('bass', ['sub'], 5);
      mgr.assign('bass', ['low'], 8);
      const slot = mgr.get('bass');
      expect(slot!.primaryBands).toEqual(['low']);
      expect(slot!.priority).toBe(8);
    });

    it('filters out invalid band names', () => {
      const slot = mgr.assign('track', ['sub', 'bogus' as FrequencyBand, 'mid'], 5);
      expect(slot.primaryBands).toEqual(['sub', 'mid']);
    });

    it('throws if no valid bands remain after filtering', () => {
      expect(() => mgr.assign('track', ['invalid' as FrequencyBand], 5)).toThrow(/No valid frequency bands/);
    });

    it('clamps priority to 0-10 range', () => {
      const low = mgr.assign('a', ['sub'], -5);
      expect(low.priority).toBe(0);
      const high = mgr.assign('b', ['sub'], 99);
      expect(high.priority).toBe(10);
    });
  });

  // ── Removal ─────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('removes an assigned slot', () => {
      mgr.assign('kick', ['sub'], 10);
      expect(mgr.remove('kick')).toBe(true);
      expect(mgr.get('kick')).toBeUndefined();
    });

    it('returns false for unassigned track', () => {
      expect(mgr.remove('nonexistent')).toBe(false);
    });
  });

  // ── getAll ──────────────────────────────────────────────────────────────

  describe('getAll', () => {
    it('returns all assigned slots', () => {
      mgr.assign('kick', ['sub'], 10);
      mgr.assign('bass', ['low'], 8);
      const all = mgr.getAll();
      expect(all).toHaveLength(2);
      expect(all.map(s => s.trackId).sort()).toEqual(['bass', 'kick']);
    });

    it('returns empty array when no slots assigned', () => {
      expect(mgr.getAll()).toEqual([]);
    });
  });

  // ── Collision detection ─────────────────────────────────────────────────

  describe('detectCollisions', () => {
    it('returns no collisions when tracks occupy different bands', () => {
      mgr.assign('kick', ['sub'], 10);
      mgr.assign('hat', ['high', 'air'], 5);
      expect(mgr.detectCollisions()).toEqual([]);
    });

    it('detects collision when two tracks share a band', () => {
      mgr.assign('kick', ['sub', 'low'], 10);
      mgr.assign('bass', ['sub', 'low'], 8);
      const collisions = mgr.detectCollisions();
      expect(collisions).toHaveLength(2); // sub and low
      const subCollision = collisions.find(c => c.band === 'sub')!;
      expect(subCollision.winnerId).toBe('kick');
      expect(subCollision.losers).toEqual(['bass']);
    });

    it('detects three-way collision', () => {
      mgr.assign('a', ['mid'], 10);
      mgr.assign('b', ['mid'], 5);
      mgr.assign('c', ['mid'], 3);
      const collisions = mgr.detectCollisions();
      expect(collisions).toHaveLength(1);
      expect(collisions[0].winnerId).toBe('a');
      expect(collisions[0].losers).toEqual(['b', 'c']);
    });

    it('breaks ties by trackId for determinism', () => {
      mgr.assign('beta', ['mid'], 5);
      mgr.assign('alpha', ['mid'], 5);
      const collisions = mgr.detectCollisions();
      expect(collisions[0].winnerId).toBe('alpha');
      expect(collisions[0].losers).toEqual(['beta']);
    });
  });

  // ── EQ adjustment computation ───────────────────────────────────────────

  describe('computeAdjustments', () => {
    it('returns no adjustments when no collisions', () => {
      mgr.assign('kick', ['sub'], 10);
      mgr.assign('hat', ['high'], 5);
      expect(mgr.computeAdjustments()).toEqual([]);
    });

    it('suggests attenuation for lower-priority tracks', () => {
      mgr.assign('kick', ['sub'], 10);
      mgr.assign('bass', ['sub'], 5);
      const adjustments = mgr.computeAdjustments();
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0].trackId).toBe('bass');
      expect(adjustments[0].band).toBe('sub');
      expect(adjustments[0].gainDb).toBeLessThan(0);
      expect(adjustments[0].gainDb).toBeGreaterThanOrEqual(-4);
    });

    it('provides center frequency for each adjustment', () => {
      mgr.assign('kick', ['sub'], 10);
      mgr.assign('bass', ['sub'], 5);
      const adjustments = mgr.computeAdjustments();
      const expectedCenter = Math.round(Math.sqrt(20 * 60));
      expect(adjustments[0].centerFreq).toBe(expectedCenter);
    });

    it('includes reason with track IDs and priorities', () => {
      mgr.assign('kick', ['low'], 10);
      mgr.assign('bass', ['low'], 3);
      const adjustments = mgr.computeAdjustments();
      expect(adjustments[0].reason).toContain('kick');
      expect(adjustments[0].reason).toContain('low');
    });

    it('scales attenuation with priority difference', () => {
      // Small priority difference
      mgr.assign('a', ['mid'], 6);
      mgr.assign('b', ['mid'], 5);
      const adj1 = mgr.computeAdjustments();

      // Large priority difference
      const mgr2 = new SpectralSlotManager();
      mgr2.assign('a', ['mid'], 10);
      mgr2.assign('b', ['mid'], 1);
      const adj2 = mgr2.computeAdjustments();

      // Larger priority gap should produce more attenuation (more negative)
      expect(adj2[0].gainDb).toBeLessThanOrEqual(adj1[0].gainDb);
    });

    it('caps attenuation at -4 dB', () => {
      mgr.assign('a', ['mid'], 10);
      mgr.assign('b', ['mid'], 0);
      const adjustments = mgr.computeAdjustments();
      expect(adjustments[0].gainDb).toBe(-4);
    });

    it('minimum attenuation is -2 dB', () => {
      mgr.assign('a', ['mid'], 5);
      mgr.assign('b', ['mid'], 5);
      const adjustments = mgr.computeAdjustments();
      expect(adjustments[0].gainDb).toBe(-2);
    });
  });
});

// ── Constants ─────────────────────────────────────────────────────────────

describe('BAND_RANGES', () => {
  it('covers all frequency bands', () => {
    for (const band of FREQUENCY_BANDS) {
      expect(BAND_RANGES[band]).toBeDefined();
      const [lo, hi] = BAND_RANGES[band];
      expect(lo).toBeLessThan(hi);
    }
  });

  it('bands are contiguous (no gaps between adjacent bands)', () => {
    for (let i = 0; i < FREQUENCY_BANDS.length - 1; i++) {
      const currentHi = BAND_RANGES[FREQUENCY_BANDS[i]][1];
      const nextLo = BAND_RANGES[FREQUENCY_BANDS[i + 1]][0];
      expect(currentHi).toBe(nextLo);
    }
  });

  it('spans 20 Hz to 20 kHz', () => {
    expect(BAND_RANGES.sub[0]).toBe(20);
    expect(BAND_RANGES.air[1]).toBe(20000);
  });
});

describe('bandCenterFreq', () => {
  it('returns geometric mean of band range', () => {
    const center = bandCenterFreq('sub');
    expect(center).toBe(Math.round(Math.sqrt(20 * 60)));
  });

  it('returns a value between lo and hi for every band', () => {
    for (const band of FREQUENCY_BANDS) {
      const center = bandCenterFreq(band);
      const [lo, hi] = BAND_RANGES[band];
      expect(center).toBeGreaterThanOrEqual(lo);
      expect(center).toBeLessThanOrEqual(hi);
    }
  });
});
