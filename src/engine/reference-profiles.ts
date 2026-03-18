// src/engine/reference-profiles.ts — Genre spectral/dynamic reference profiles
// for AI mix comparison. Static baked-in profiles that the AI compares rendered
// audio against to get actionable mix feedback.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Target energy range for a frequency band (in dB, relative to overall level). */
export interface BandTarget {
  /** Band label matching audio-analysis MASKING_BANDS. */
  band: string;
  /** Human-readable frequency range. */
  range: string;
  /** Target energy in dB (relative). Lower bound of acceptable range. */
  minDb: number;
  /** Target energy in dB (relative). Upper bound of acceptable range. */
  maxDb: number;
}

/** Dynamic range targets for a genre profile. */
export interface DynamicsTarget {
  /** Target integrated loudness range (LUFS). */
  lufsMin: number;
  lufsMax: number;
  /** Target crest factor range (dB). */
  crestFactorMin: number;
  crestFactorMax: number;
  /** Target dynamic range (dB). */
  dynamicRangeMin: number;
  dynamicRangeMax: number;
}

/** A genre reference profile with spectral and dynamic targets. */
export interface ReferenceProfile {
  id: string;
  label: string;
  description: string;
  /** Spectral energy targets per frequency band. */
  bands: BandTarget[];
  /** Dynamic range targets. */
  dynamics: DynamicsTarget;
}

/** A gap between actual and target values for a single dimension. */
export interface ReferenceGap {
  /** Which dimension: band label or dynamic metric name. */
  dimension: string;
  /** Actual measured value. */
  actual: number;
  /** Target range [min, max]. */
  targetMin: number;
  targetMax: number;
  /** Signed delta from nearest target boundary (negative = below, positive = above). */
  delta: number;
  /** Human-readable suggestion for correction. */
  suggestion: string;
}

/** Result of comparing audio analysis against a reference profile. */
export interface ReferenceResult {
  profileId: string;
  profileLabel: string;
  gaps: ReferenceGap[];
  /** Overall match score 0.0 (poor) to 1.0 (excellent). */
  matchScore: number;
  /** Plain-language summary of the comparison. */
  summary: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Built-in profiles
// ---------------------------------------------------------------------------

// Band energy targets are relative dB values. They represent the expected
// energy balance between bands for a well-mixed track in each genre.
// These are empirical approximations based on published reference analyses
// and common mastering targets.

const PROFILES: ReferenceProfile[] = [
  {
    id: 'techno_dark',
    label: 'Dark Techno',
    description: 'Heavy sub/low emphasis, recessed highs, compressed dynamics. Think Surgeon, Regis, Perc.',
    bands: [
      { band: 'sub',      range: '20-60Hz',    minDb: -6,  maxDb: 0   },
      { band: 'low',      range: '60-200Hz',   minDb: -4,  maxDb: 2   },
      { band: 'low-mid',  range: '200-500Hz',  minDb: -10, maxDb: -4  },
      { band: 'mid',      range: '500Hz-2kHz', minDb: -14, maxDb: -8  },
      { band: 'high-mid', range: '2-6kHz',     minDb: -18, maxDb: -10 },
      { band: 'high',     range: '6-20kHz',    minDb: -24, maxDb: -14 },
    ],
    dynamics: {
      lufsMin: -10, lufsMax: -6,
      crestFactorMin: 4, crestFactorMax: 8,
      dynamicRangeMin: 4, dynamicRangeMax: 10,
    },
  },
  {
    id: 'techno_minimal',
    label: 'Minimal Techno',
    description: 'Balanced low end, cleaner mids, moderate compression. Think Richie Hawtin, Plastikman.',
    bands: [
      { band: 'sub',      range: '20-60Hz',    minDb: -8,  maxDb: -2  },
      { band: 'low',      range: '60-200Hz',   minDb: -6,  maxDb: 0   },
      { band: 'low-mid',  range: '200-500Hz',  minDb: -12, maxDb: -6  },
      { band: 'mid',      range: '500Hz-2kHz', minDb: -12, maxDb: -6  },
      { band: 'high-mid', range: '2-6kHz',     minDb: -14, maxDb: -8  },
      { band: 'high',     range: '6-20kHz',    minDb: -20, maxDb: -12 },
    ],
    dynamics: {
      lufsMin: -12, lufsMax: -7,
      crestFactorMin: 5, crestFactorMax: 10,
      dynamicRangeMin: 5, dynamicRangeMax: 12,
    },
  },
  {
    id: 'house_deep',
    label: 'Deep House',
    description: 'Warm low end, present mids, smooth highs. Think Larry Heard, Kerri Chandler.',
    bands: [
      { band: 'sub',      range: '20-60Hz',    minDb: -8,  maxDb: -2  },
      { band: 'low',      range: '60-200Hz',   minDb: -4,  maxDb: 2   },
      { band: 'low-mid',  range: '200-500Hz',  minDb: -8,  maxDb: -2  },
      { band: 'mid',      range: '500Hz-2kHz', minDb: -10, maxDb: -4  },
      { band: 'high-mid', range: '2-6kHz',     minDb: -12, maxDb: -6  },
      { band: 'high',     range: '6-20kHz',    minDb: -18, maxDb: -10 },
    ],
    dynamics: {
      lufsMin: -12, lufsMax: -7,
      crestFactorMin: 6, crestFactorMax: 12,
      dynamicRangeMin: 6, dynamicRangeMax: 14,
    },
  },
  {
    id: 'ambient',
    label: 'Ambient',
    description: 'Wide frequency spread, high dynamic range, no loudness war. Think Brian Eno, Stars of the Lid.',
    bands: [
      { band: 'sub',      range: '20-60Hz',    minDb: -14, maxDb: -4  },
      { band: 'low',      range: '60-200Hz',   minDb: -10, maxDb: -2  },
      { band: 'low-mid',  range: '200-500Hz',  minDb: -10, maxDb: -2  },
      { band: 'mid',      range: '500Hz-2kHz', minDb: -10, maxDb: -2  },
      { band: 'high-mid', range: '2-6kHz',     minDb: -12, maxDb: -4  },
      { band: 'high',     range: '6-20kHz',    minDb: -16, maxDb: -6  },
    ],
    dynamics: {
      lufsMin: -24, lufsMax: -12,
      crestFactorMin: 10, crestFactorMax: 20,
      dynamicRangeMin: 12, dynamicRangeMax: 30,
    },
  },
  {
    id: 'dnb',
    label: 'Drum & Bass',
    description: 'Strong sub, aggressive mids, bright highs, heavy compression. Think Noisia, Andy C.',
    bands: [
      { band: 'sub',      range: '20-60Hz',    minDb: -4,  maxDb: 2   },
      { band: 'low',      range: '60-200Hz',   minDb: -6,  maxDb: 0   },
      { band: 'low-mid',  range: '200-500Hz',  minDb: -10, maxDb: -4  },
      { band: 'mid',      range: '500Hz-2kHz', minDb: -8,  maxDb: -2  },
      { band: 'high-mid', range: '2-6kHz',     minDb: -10, maxDb: -4  },
      { band: 'high',     range: '6-20kHz',    minDb: -16, maxDb: -8  },
    ],
    dynamics: {
      lufsMin: -10, lufsMax: -5,
      crestFactorMin: 4, crestFactorMax: 8,
      dynamicRangeMin: 4, dynamicRangeMax: 10,
    },
  },
  {
    id: 'hiphop',
    label: 'Hip-Hop',
    description: 'Heavy low end, clear vocals mid, controlled highs. Think J Dilla, Madlib, Metro Boomin.',
    bands: [
      { band: 'sub',      range: '20-60Hz',    minDb: -4,  maxDb: 2   },
      { band: 'low',      range: '60-200Hz',   minDb: -4,  maxDb: 2   },
      { band: 'low-mid',  range: '200-500Hz',  minDb: -10, maxDb: -4  },
      { band: 'mid',      range: '500Hz-2kHz', minDb: -8,  maxDb: -2  },
      { band: 'high-mid', range: '2-6kHz',     minDb: -12, maxDb: -6  },
      { band: 'high',     range: '6-20kHz',    minDb: -18, maxDb: -10 },
    ],
    dynamics: {
      lufsMin: -10, lufsMax: -5,
      crestFactorMin: 4, crestFactorMax: 9,
      dynamicRangeMin: 4, dynamicRangeMax: 10,
    },
  },
];

// ---------------------------------------------------------------------------
// Profile lookup
// ---------------------------------------------------------------------------

/** Get all available profile IDs. */
export function getProfileIds(): string[] {
  return PROFILES.map(p => p.id);
}

/** Look up a profile by ID. Returns undefined if not found. */
export function getProfile(id: string): ReferenceProfile | undefined {
  return PROFILES.find(p => p.id === id);
}

// ---------------------------------------------------------------------------
// Gap computation
// ---------------------------------------------------------------------------

/**
 * Compare actual band energies and dynamics against a reference profile.
 *
 * @param profile - The reference profile to compare against.
 * @param bandEnergies - Actual band energies from `computeBandEnergies()`, keyed by band label.
 * @param dynamics - Actual dynamics from `analyzeDynamics()`.
 * @returns Structured gaps with suggestions, match score, and summary.
 */
export function compareToProfile(
  profile: ReferenceProfile,
  bandEnergies: Record<string, number>,
  dynamics: { lufs: number; crest_factor: number; dynamic_range: number; confidence: number },
): ReferenceResult {
  const gaps: ReferenceGap[] = [];

  // --- Spectral band gaps ---
  // Normalize band energies relative to the peak band to make them comparable
  // to the profile's relative dB targets.
  const finiteEnergies = Object.values(bandEnergies).filter(e => isFinite(e));
  const peakEnergy = finiteEnergies.length > 0 ? Math.max(...finiteEnergies) : 0;

  for (const target of profile.bands) {
    const rawEnergy = bandEnergies[target.band];
    if (rawEnergy === undefined) continue;

    // Convert to relative dB (relative to peak band)
    const relativeDb = isFinite(rawEnergy) ? rawEnergy - peakEnergy : -Infinity;

    if (!isFinite(relativeDb)) {
      // Silent band — always a gap if the profile expects energy
      if (target.maxDb > -30) {
        gaps.push({
          dimension: target.band,
          actual: -Infinity,
          targetMin: target.minDb,
          targetMax: target.maxDb,
          delta: -Infinity,
          suggestion: `No energy detected in ${target.range} — ${generateBandSuggestion(target.band, 'below')}`,
        });
      }
      continue;
    }

    const roundedDb = Math.round(relativeDb * 10) / 10;

    if (relativeDb < target.minDb) {
      const delta = Math.round((relativeDb - target.minDb) * 10) / 10;
      gaps.push({
        dimension: target.band,
        actual: roundedDb,
        targetMin: target.minDb,
        targetMax: target.maxDb,
        delta,
        suggestion: `${target.range} is ${Math.abs(delta).toFixed(1)}dB below target — ${generateBandSuggestion(target.band, 'below')}`,
      });
    } else if (relativeDb > target.maxDb) {
      const delta = Math.round((relativeDb - target.maxDb) * 10) / 10;
      gaps.push({
        dimension: target.band,
        actual: roundedDb,
        targetMin: target.minDb,
        targetMax: target.maxDb,
        delta,
        suggestion: `${target.range} is ${Math.abs(delta).toFixed(1)}dB above target — ${generateBandSuggestion(target.band, 'above')}`,
      });
    }
  }

  // --- Dynamic gaps ---
  if (isFinite(dynamics.lufs)) {
    if (dynamics.lufs < profile.dynamics.lufsMin) {
      const delta = Math.round((dynamics.lufs - profile.dynamics.lufsMin) * 10) / 10;
      gaps.push({
        dimension: 'lufs',
        actual: dynamics.lufs,
        targetMin: profile.dynamics.lufsMin,
        targetMax: profile.dynamics.lufsMax,
        delta,
        suggestion: `Overall level is ${Math.abs(delta).toFixed(1)}dB too quiet — increase track volumes or add makeup gain on the bus compressor.`,
      });
    } else if (dynamics.lufs > profile.dynamics.lufsMax) {
      const delta = Math.round((dynamics.lufs - profile.dynamics.lufsMax) * 10) / 10;
      gaps.push({
        dimension: 'lufs',
        actual: dynamics.lufs,
        targetMin: profile.dynamics.lufsMin,
        targetMax: profile.dynamics.lufsMax,
        delta,
        suggestion: `Overall level is ${Math.abs(delta).toFixed(1)}dB too loud — reduce master volume or add a limiter.`,
      });
    }
  }

  if (dynamics.crest_factor < profile.dynamics.crestFactorMin) {
    const delta = Math.round((dynamics.crest_factor - profile.dynamics.crestFactorMin) * 10) / 10;
    gaps.push({
      dimension: 'crest_factor',
      actual: dynamics.crest_factor,
      targetMin: profile.dynamics.crestFactorMin,
      targetMax: profile.dynamics.crestFactorMax,
      delta,
      suggestion: `Mix is too flat/squashed (crest factor ${dynamics.crest_factor.toFixed(1)}dB) — reduce compression or increase transient contrast.`,
    });
  } else if (dynamics.crest_factor > profile.dynamics.crestFactorMax) {
    const delta = Math.round((dynamics.crest_factor - profile.dynamics.crestFactorMax) * 10) / 10;
    gaps.push({
      dimension: 'crest_factor',
      actual: dynamics.crest_factor,
      targetMin: profile.dynamics.crestFactorMin,
      targetMax: profile.dynamics.crestFactorMax,
      delta,
      suggestion: `Mix has too much transient peaking (crest factor ${dynamics.crest_factor.toFixed(1)}dB) — add bus compression to tame peaks.`,
    });
  }

  if (dynamics.dynamic_range < profile.dynamics.dynamicRangeMin) {
    const delta = Math.round((dynamics.dynamic_range - profile.dynamics.dynamicRangeMin) * 10) / 10;
    gaps.push({
      dimension: 'dynamic_range',
      actual: dynamics.dynamic_range,
      targetMin: profile.dynamics.dynamicRangeMin,
      targetMax: profile.dynamics.dynamicRangeMax,
      delta,
      suggestion: `Dynamic range is too narrow (${dynamics.dynamic_range.toFixed(1)}dB) — ease off compression or add variation in arrangement.`,
    });
  } else if (dynamics.dynamic_range > profile.dynamics.dynamicRangeMax) {
    const delta = Math.round((dynamics.dynamic_range - profile.dynamics.dynamicRangeMax) * 10) / 10;
    gaps.push({
      dimension: 'dynamic_range',
      actual: dynamics.dynamic_range,
      targetMin: profile.dynamics.dynamicRangeMin,
      targetMax: profile.dynamics.dynamicRangeMax,
      delta,
      suggestion: `Dynamic range is too wide (${dynamics.dynamic_range.toFixed(1)}dB) — add bus compression or level automation to even things out.`,
    });
  }

  // --- Match score ---
  // Score is 1.0 when everything is in range, decreasing with each gap.
  // Each band gap reduces score proportionally to the delta magnitude.
  const totalDimensions = profile.bands.length + 3; // bands + lufs + crest + dynamic_range
  let penaltySum = 0;
  for (const gap of gaps) {
    if (!isFinite(gap.delta)) {
      penaltySum += 1; // silent band = full penalty for that dimension
    } else {
      // Penalty proportional to how far outside the range, capped at 1
      const range = gap.targetMax - gap.targetMin;
      const maxExpectedDeviation = Math.max(range, 6); // at least 6dB deviation = full penalty
      penaltySum += Math.min(1, Math.abs(gap.delta) / maxExpectedDeviation);
    }
  }
  const matchScore = Math.round(Math.max(0, 1 - penaltySum / totalDimensions) * 100) / 100;

  // --- Summary ---
  const summary = generateSummary(profile, gaps, matchScore);

  return {
    profileId: profile.id,
    profileLabel: profile.label,
    gaps,
    matchScore,
    summary,
    confidence: dynamics.confidence,
  };
}

// ---------------------------------------------------------------------------
// Suggestion generators
// ---------------------------------------------------------------------------

function generateBandSuggestion(band: string, direction: 'above' | 'below'): string {
  const suggestions: Record<string, Record<'above' | 'below', string>> = {
    sub: {
      below: 'boost sub-bass with EQ or use a heavier kick/bass sound.',
      above: 'cut sub-bass with EQ or high-pass filter to reduce rumble.',
    },
    low: {
      below: 'add low-end warmth with EQ boost around 80-150Hz or layer a bass element.',
      above: 'cut low-mid mud with EQ or high-pass non-bass tracks.',
    },
    'low-mid': {
      below: 'boost body/warmth around 200-500Hz or add a mid-range element.',
      above: 'cut muddy frequencies around 200-500Hz — this is the most common problem area.',
    },
    mid: {
      below: 'add presence with a mid-range boost or a more forward sound design.',
      above: 'cut harsh mids — try a narrow EQ cut around 1-2kHz or adjust timbre.',
    },
    'high-mid': {
      below: 'add presence and attack with EQ boost around 3-5kHz or brighter sound design.',
      above: 'tame harshness with a gentle high-mid cut around 3-5kHz.',
    },
    high: {
      below: 'add air and sparkle with a high shelf boost or add hi-hat/cymbal elements.',
      above: 'roll off excessive highs with a low-pass filter or high shelf cut.',
    },
  };
  return suggestions[band]?.[direction] ?? `adjust EQ in the ${band} band.`;
}

function generateSummary(profile: ReferenceProfile, gaps: ReferenceGap[], matchScore: number): string {
  if (gaps.length === 0) {
    return `Mix matches the ${profile.label} reference profile well (score: ${matchScore}).`;
  }

  const spectralGaps = gaps.filter(g => !['lufs', 'crest_factor', 'dynamic_range'].includes(g.dimension));
  const dynamicGaps = gaps.filter(g => ['lufs', 'crest_factor', 'dynamic_range'].includes(g.dimension));

  const parts: string[] = [];
  parts.push(`${profile.label} reference match: ${matchScore} (${matchScore >= 0.8 ? 'good' : matchScore >= 0.5 ? 'fair' : 'poor'}).`);

  if (spectralGaps.length > 0) {
    parts.push(`${spectralGaps.length} spectral gap${spectralGaps.length > 1 ? 's' : ''} detected.`);
  }
  if (dynamicGaps.length > 0) {
    parts.push(`${dynamicGaps.length} dynamic gap${dynamicGaps.length > 1 ? 's' : ''} detected.`);
  }

  // Highlight the most significant gap
  const worstGap = gaps
    .filter(g => isFinite(g.delta))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  if (worstGap) {
    parts.push(`Biggest issue: ${worstGap.suggestion}`);
  }

  return parts.join(' ');
}
