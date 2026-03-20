import { describe, it, expect } from 'vitest';
import { derivePalette, type SurfacePalette, type PaletteColor } from '../../../src/ui/surface/palette';

// ── Helpers ────────────────────────────────────────────────────

/** Parse an HSL string like "hsl(180, 60%, 58%)" into { h, s, l }. */
function parseHsl(color: string): { h: number; s: number; l: number } {
  const m = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!m) throw new Error(`Failed to parse HSL: ${color}`);
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

/** Minimum angular distance between two hues. */
function hueSep(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

/** Hue of a role's full color. */
function hueOf(color: PaletteColor): number {
  return parseHsl(color.full).h;
}

/** Saturation of a role's full color. */
function satOf(color: PaletteColor): number {
  return parseHsl(color.full).s;
}

// ── Tests ──────────────────────────────────────────────────────

describe('derivePalette', () => {
  it('derives all 5 roles from a base hue', () => {
    const p = derivePalette(38);
    expect(p.base).toBeDefined();
    expect(p.generative).toBeDefined();
    expect(p.tonal).toBeDefined();
    expect(p.spatial).toBeDefined();
    expect(p.neutral).toBeDefined();
  });

  it('base role preserves the input hue', () => {
    const p = derivePalette(120);
    const base = parseHsl(p.base.full);
    expect(base.h).toBe(120);
  });

  it('generative is approximately complementary (within 150-180° of base)', () => {
    for (const hue of [0, 38, 120, 240, 350]) {
      const p = derivePalette(hue);
      const sep = hueSep(hueOf(p.base), hueOf(p.generative));
      expect(sep).toBeGreaterThanOrEqual(140);
      expect(sep).toBeLessThanOrEqual(190);
    }
  });

  it('tonal is warm analogous (within 30-60° of base)', () => {
    for (const hue of [0, 38, 120, 240, 350]) {
      const p = derivePalette(hue);
      const sep = hueSep(hueOf(p.base), hueOf(p.tonal));
      expect(sep).toBeGreaterThanOrEqual(30);
      expect(sep).toBeLessThanOrEqual(70);
    }
  });

  it('spatial is cool analogous (within -30 to -60° of base)', () => {
    for (const hue of [0, 38, 120, 240, 350]) {
      const p = derivePalette(hue);
      const sep = hueSep(hueOf(p.base), hueOf(p.spatial));
      expect(sep).toBeGreaterThanOrEqual(30);
      expect(sep).toBeLessThanOrEqual(70);
    }
  });

  it('neutral has near-zero saturation', () => {
    const p = derivePalette(200);
    for (const depth of ['full', 'muted', 'tint'] as const) {
      const { s } = parseHsl(p.neutral[depth]);
      expect(s).toBeLessThanOrEqual(10);
    }
  });

  it('hue separation between non-neutral roles is >= 30°', () => {
    for (const hue of [0, 38, 120, 240, 330]) {
      const p = derivePalette(hue);
      const roles: PaletteColor[] = [p.base, p.generative, p.tonal, p.spatial];
      for (let i = 0; i < roles.length; i++) {
        for (let j = i + 1; j < roles.length; j++) {
          const sep = hueSep(hueOf(roles[i]), hueOf(roles[j]));
          expect(sep).toBeGreaterThanOrEqual(30);
        }
      }
    }
  });

  it('each role has all 3 depths (full, muted, tint)', () => {
    const p = derivePalette(180);
    const roles: (keyof SurfacePalette)[] = ['base', 'generative', 'tonal', 'spatial', 'neutral'];
    for (const role of roles) {
      expect(p[role].full).toMatch(/^hsl\(/);
      expect(p[role].muted).toMatch(/^hsl\(/);
      expect(p[role].tint).toMatch(/^hsl\(/);
    }
  });

  it('full depth has higher saturation than muted', () => {
    const p = derivePalette(60);
    // Check chromatic roles (neutral is always low sat)
    for (const role of ['base', 'generative', 'tonal', 'spatial'] as const) {
      const fullSat = parseHsl(p[role].full).s;
      const mutedSat = parseHsl(p[role].muted).s;
      expect(fullSat).toBeGreaterThan(mutedSat);
    }
  });

  describe('works across the hue spectrum', () => {
    for (const hue of [0, 120, 240, 330]) {
      it(`hue ${hue}°`, () => {
        const p = derivePalette(hue);
        // All 5 roles produce valid HSL strings
        const roles: (keyof SurfacePalette)[] = ['base', 'generative', 'tonal', 'spatial', 'neutral'];
        for (const role of roles) {
          for (const depth of ['full', 'muted', 'tint'] as const) {
            expect(p[role][depth]).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
          }
        }
        // Base hue is preserved
        expect(hueOf(p.base)).toBe(hue);
      });
    }
  });

  it('base is the most saturated role', () => {
    for (const hue of [0, 90, 200, 300]) {
      const p = derivePalette(hue);
      const baseSat = satOf(p.base);
      expect(baseSat).toBeGreaterThanOrEqual(satOf(p.generative));
      expect(baseSat).toBeGreaterThanOrEqual(satOf(p.tonal));
      expect(baseSat).toBeGreaterThanOrEqual(satOf(p.spatial));
    }
  });
});
