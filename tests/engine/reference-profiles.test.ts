import { describe, expect, it } from 'vitest';
import {
  getProfileIds,
  getProfile,
  compareToProfile,
} from '../../src/engine/reference-profiles';
import type { ReferenceProfile } from '../../src/engine/reference-profiles';

// ---------------------------------------------------------------------------
// Profile lookup
// ---------------------------------------------------------------------------

describe('getProfileIds', () => {
  it('returns all built-in profile IDs', () => {
    const ids = getProfileIds();
    expect(ids).toContain('techno_dark');
    expect(ids).toContain('techno_minimal');
    expect(ids).toContain('house_deep');
    expect(ids).toContain('ambient');
    expect(ids).toContain('dnb');
    expect(ids).toContain('hiphop');
    expect(ids.length).toBe(6);
  });
});

describe('getProfile', () => {
  it('returns a profile by ID', () => {
    const profile = getProfile('techno_dark');
    expect(profile).toBeDefined();
    expect(profile!.id).toBe('techno_dark');
    expect(profile!.label).toBe('Dark Techno');
    expect(profile!.bands.length).toBe(6);
    expect(profile!.dynamics).toBeDefined();
  });

  it('returns undefined for unknown profile', () => {
    expect(getProfile('nonexistent')).toBeUndefined();
    expect(getProfile('')).toBeUndefined();
  });

  it('each profile has valid band targets', () => {
    for (const id of getProfileIds()) {
      const profile = getProfile(id)!;
      for (const band of profile.bands) {
        expect(band.minDb).toBeLessThanOrEqual(band.maxDb);
        expect(band.band).toBeTruthy();
        expect(band.range).toBeTruthy();
      }
    }
  });

  it('each profile has valid dynamics targets', () => {
    for (const id of getProfileIds()) {
      const profile = getProfile(id)!;
      const d = profile.dynamics;
      expect(d.lufsMin).toBeLessThanOrEqual(d.lufsMax);
      expect(d.crestFactorMin).toBeLessThanOrEqual(d.crestFactorMax);
      expect(d.dynamicRangeMin).toBeLessThanOrEqual(d.dynamicRangeMax);
    }
  });
});

// ---------------------------------------------------------------------------
// Gap computation
// ---------------------------------------------------------------------------

describe('compareToProfile', () => {
  const profile = getProfile('techno_dark')!;

  // Helper: create band energies that are within the profile's targets
  function inRangeEnergies(): Record<string, number> {
    // Peak band at 0dB, others relative to profile targets (midpoint)
    return {
      sub: -3,     // target: -6 to 0, relative to peak
      low: -1,     // target: -4 to 2
      'low-mid': -7,  // target: -10 to -4
      mid: -11,    // target: -14 to -8
      'high-mid': -14, // target: -18 to -10
      high: -19,   // target: -24 to -14
    };
  }

  function inRangeDynamics() {
    return {
      lufs: -8,
      crest_factor: 6,
      dynamic_range: 7,
      confidence: 0.9,
    };
  }

  it('returns no gaps when mix matches the profile', () => {
    const result = compareToProfile(profile, inRangeEnergies(), inRangeDynamics());
    expect(result.profileId).toBe('techno_dark');
    expect(result.profileLabel).toBe('Dark Techno');
    expect(result.gaps).toHaveLength(0);
    expect(result.matchScore).toBe(1);
    expect(result.summary).toContain('matches');
  });

  it('detects spectral gaps when a band is too low', () => {
    const energies = inRangeEnergies();
    energies.sub = -15; // way below the -6 to 0 target (relative to peak at -1)
    // peak is -1 (low band), so sub relative = -15 - (-1) = -14, target is -6 to 0
    const result = compareToProfile(profile, energies, inRangeDynamics());
    const subGap = result.gaps.find(g => g.dimension === 'sub');
    expect(subGap).toBeDefined();
    expect(subGap!.delta).toBeLessThan(0);
    expect(subGap!.suggestion).toContain('below target');
  });

  it('detects spectral gaps when a band is too high', () => {
    const energies = inRangeEnergies();
    energies.high = 0; // peak = 0, relative = 0, target is -24 to -14 → way above
    const result = compareToProfile(profile, energies, inRangeDynamics());
    const highGap = result.gaps.find(g => g.dimension === 'high');
    expect(highGap).toBeDefined();
    expect(highGap!.delta).toBeGreaterThan(0);
    expect(highGap!.suggestion).toContain('above target');
  });

  it('detects dynamic gaps when LUFS is too quiet', () => {
    const dynamics = inRangeDynamics();
    dynamics.lufs = -18; // target: -10 to -6
    const result = compareToProfile(profile, inRangeEnergies(), dynamics);
    const lufsGap = result.gaps.find(g => g.dimension === 'lufs');
    expect(lufsGap).toBeDefined();
    expect(lufsGap!.delta).toBeLessThan(0);
    expect(lufsGap!.suggestion).toContain('too quiet');
  });

  it('detects dynamic gaps when LUFS is too loud', () => {
    const dynamics = inRangeDynamics();
    dynamics.lufs = -3; // target: -10 to -6
    const result = compareToProfile(profile, inRangeEnergies(), dynamics);
    const lufsGap = result.gaps.find(g => g.dimension === 'lufs');
    expect(lufsGap).toBeDefined();
    expect(lufsGap!.delta).toBeGreaterThan(0);
    expect(lufsGap!.suggestion).toContain('too loud');
  });

  it('detects crest factor too flat', () => {
    const dynamics = inRangeDynamics();
    dynamics.crest_factor = 2; // target: 4-8
    const result = compareToProfile(profile, inRangeEnergies(), dynamics);
    const gap = result.gaps.find(g => g.dimension === 'crest_factor');
    expect(gap).toBeDefined();
    expect(gap!.suggestion).toContain('flat');
  });

  it('detects crest factor too peaky', () => {
    const dynamics = inRangeDynamics();
    dynamics.crest_factor = 15; // target: 4-8
    const result = compareToProfile(profile, inRangeEnergies(), dynamics);
    const gap = result.gaps.find(g => g.dimension === 'crest_factor');
    expect(gap).toBeDefined();
    expect(gap!.suggestion).toContain('peaking');
  });

  it('detects dynamic range too narrow', () => {
    const dynamics = inRangeDynamics();
    dynamics.dynamic_range = 2; // target: 4-10
    const result = compareToProfile(profile, inRangeEnergies(), dynamics);
    const gap = result.gaps.find(g => g.dimension === 'dynamic_range');
    expect(gap).toBeDefined();
    expect(gap!.suggestion).toContain('narrow');
  });

  it('detects dynamic range too wide', () => {
    const dynamics = inRangeDynamics();
    dynamics.dynamic_range = 20; // target: 4-10
    const result = compareToProfile(profile, inRangeEnergies(), dynamics);
    const gap = result.gaps.find(g => g.dimension === 'dynamic_range');
    expect(gap).toBeDefined();
    expect(gap!.suggestion).toContain('wide');
  });

  it('handles silent bands gracefully', () => {
    const energies = inRangeEnergies();
    energies.sub = -Infinity;
    const result = compareToProfile(profile, energies, inRangeDynamics());
    const subGap = result.gaps.find(g => g.dimension === 'sub');
    expect(subGap).toBeDefined();
    expect(subGap!.delta).toBe(-Infinity);
    expect(subGap!.suggestion).toContain('No energy');
  });

  it('handles -Infinity LUFS gracefully (no gap for dynamics)', () => {
    const dynamics = { ...inRangeDynamics(), lufs: -Infinity };
    const result = compareToProfile(profile, inRangeEnergies(), dynamics);
    // Should not crash, and LUFS gap should not be added for -Infinity
    const lufsGap = result.gaps.find(g => g.dimension === 'lufs');
    expect(lufsGap).toBeUndefined();
  });

  it('match score decreases with more gaps', () => {
    const perfect = compareToProfile(profile, inRangeEnergies(), inRangeDynamics());
    const bad = compareToProfile(profile, {
      sub: -30, low: -30, 'low-mid': -30, mid: -30, 'high-mid': -30, high: -30,
    }, { lufs: -30, crest_factor: 0, dynamic_range: 0, confidence: 0.5 });
    expect(perfect.matchScore).toBeGreaterThan(bad.matchScore);
    expect(bad.matchScore).toBeLessThan(0.5);
  });

  it('confidence propagates from dynamics input', () => {
    const result = compareToProfile(profile, inRangeEnergies(), { ...inRangeDynamics(), confidence: 0.42 });
    expect(result.confidence).toBe(0.42);
  });

  it('summary mentions the profile label', () => {
    const result = compareToProfile(profile, inRangeEnergies(), inRangeDynamics());
    expect(result.summary).toContain('Dark Techno');
  });

  it('works with all built-in profiles', () => {
    for (const id of getProfileIds()) {
      const p = getProfile(id)!;
      const result = compareToProfile(p, inRangeEnergies(), inRangeDynamics());
      expect(result.profileId).toBe(id);
      expect(result.matchScore).toBeGreaterThanOrEqual(0);
      expect(result.matchScore).toBeLessThanOrEqual(1);
    }
  });
});
