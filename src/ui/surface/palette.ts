/**
 * Surface Palette Derivation
 *
 * Derives a 5-role color palette from a track's base hue for Surface module styling.
 * Each role has 3 depths (full, muted, tint) expressed as HSL color strings.
 *
 * Roles:
 *   base       — track identity color (most vivid)
 *   generative — complement (~+160°) for algorithmic/pattern elements
 *   tonal      — warm analogous (~+45°) for filter/timbre elements
 *   spatial    — cool analogous (~-45°) for space/movement elements
 *   neutral    — zinc/gray for utility elements
 *
 * See mockups/20-surface-palette-system.html for the full visual spec.
 */

// ── Types ──────────────────────────────────────────────────────

export type PaletteRole = 'base' | 'generative' | 'tonal' | 'spatial' | 'neutral';
export type PaletteDepth = 'full' | 'muted' | 'tint';

export interface PaletteColor {
  /** HSL color string — for knob arcs, active elements */
  full: string;
  /** HSL color string — for labels, ~60% visual weight */
  muted: string;
  /** HSL color string — for borders, ~15% visual weight */
  tint: string;
}

export interface SurfacePalette {
  base: PaletteColor;
  generative: PaletteColor;
  tonal: PaletteColor;
  spatial: PaletteColor;
  neutral: PaletteColor;
}

// ── Helpers ────────────────────────────────────────────────────

/** Normalize a hue to the 0–360 range. */
function normalizeHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

/** Minimum angular distance between two hues on the color wheel. */
function hueSeparation(a: number, b: number): number {
  const diff = Math.abs(normalizeHue(a) - normalizeHue(b));
  return Math.min(diff, 360 - diff);
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(normalizeHue(h))}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

function makeColor(h: number, s: number, l: number): PaletteColor {
  return {
    full: hsl(h, s, l),
    muted: hsl(h, s * 0.7, l * 0.75),
    tint: hsl(h, s * 0.4, l * 0.45),
  };
}

// ── Separation enforcement ─────────────────────────────────────

const MIN_SEPARATION = 30;

/**
 * Enforce minimum 30° hue separation between all non-neutral role hues.
 * Pushes overlapping hues apart symmetrically while preserving the base hue.
 */
function enforceSeparation(
  base: number,
  generative: number,
  tonal: number,
  spatial: number,
): [number, number, number, number] {
  // Base is fixed — only adjust the other three relative to each other and base.
  const hues: [number, number, number, number] = [
    normalizeHue(base),
    normalizeHue(generative),
    normalizeHue(tonal),
    normalizeHue(spatial),
  ];

  // Up to 3 passes to resolve conflicts (convergence guaranteed for 4 hues).
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 1; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const sep = hueSeparation(hues[i], hues[j]);
        if (sep < MIN_SEPARATION) {
          const deficit = (MIN_SEPARATION - sep) / 2 + 0.5;
          // Determine push direction on the circle
          const diff = normalizeHue(hues[j] - hues[i]);
          if (diff <= 180) {
            hues[i] = normalizeHue(hues[i] - deficit);
            hues[j] = normalizeHue(hues[j] + deficit);
          } else {
            hues[i] = normalizeHue(hues[i] + deficit);
            hues[j] = normalizeHue(hues[j] - deficit);
          }
          changed = true;
        }
      }
      // Also enforce against base (index 0), but only move the non-base hue
      const sep = hueSeparation(hues[0], hues[i]);
      if (sep < MIN_SEPARATION) {
        const deficit = MIN_SEPARATION - sep + 0.5;
        const diff = normalizeHue(hues[i] - hues[0]);
        if (diff <= 180) {
          hues[i] = normalizeHue(hues[i] + deficit);
        } else {
          hues[i] = normalizeHue(hues[i] - deficit);
        }
        changed = true;
      }
    }
    if (!changed) break;
  }

  return hues;
}

// ── Main derivation ────────────────────────────────────────────

/**
 * Derive a 5-role Surface palette from a track's base hue (0–360).
 *
 * Rules:
 * - Base: input hue, saturation 70%, lightness 60%
 * - Generative: hue +160° (complement region), saturation 60%, lightness 58%
 * - Tonal: hue +45° (warm analogous), saturation 58%, lightness 58%
 * - Spatial: hue -45° (cool analogous), saturation 58%, lightness 58%
 * - Neutral: zinc-equivalent grays (hue 30°, saturation 5%)
 * - 30° minimum hue separation between all non-neutral roles
 */
export function derivePalette(baseHue: number): SurfacePalette {
  const rawBase = normalizeHue(baseHue);
  const rawGenerative = normalizeHue(rawBase + 160);
  const rawTonal = normalizeHue(rawBase + 45);
  const rawSpatial = normalizeHue(rawBase - 45);

  const [finalBase, finalGenerative, finalTonal, finalSpatial] = enforceSeparation(
    rawBase,
    rawGenerative,
    rawTonal,
    rawSpatial,
  );

  return {
    base: makeColor(finalBase, 70, 60),
    generative: makeColor(finalGenerative, 60, 58),
    tonal: makeColor(finalTonal, 58, 58),
    spatial: makeColor(finalSpatial, 58, 58),
    neutral: {
      full: hsl(30, 5, 48),    // ~zinc-500
      muted: hsl(30, 5, 35),   // ~zinc-600
      tint: hsl(30, 5, 25),    // ~zinc-700
    },
  };
}
