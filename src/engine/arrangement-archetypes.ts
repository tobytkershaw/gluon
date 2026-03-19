// src/engine/arrangement-archetypes.ts — Genre-aware structural templates for song sections.
//
// An arrangement archetype defines the section structure for a full song:
// ordered sections with bar ranges, density levels, and energy values.
// The compound tool decomposes these into manage_pattern + sketch + manage_sequence actions.

/**
 * Density level — describes how active/dense a section should be.
 * Maps to event generation parameters (count, velocity range, probability).
 */
export type DensityLevel = 'silent' | 'sparse' | 'rising' | 'full' | 'minimal' | 'dissolving';

/**
 * Configuration derived from a density level for event generation.
 */
export interface DensityConfig {
  /** Fraction of available steps that should have events (0.0-1.0). */
  eventDensity: number;
  /** Base velocity for events. */
  velocityBase: number;
  /** Velocity variation range (+/-). */
  velocityRange: number;
  /** Energy level (0.0-1.0) for tension curve coordination. */
  energy: number;
}

/**
 * A section within an arrangement archetype.
 */
export interface SectionDef {
  /** Section name (e.g. "Intro", "Build", "Drop"). */
  name: string;
  /** Number of bars for this section. */
  bars: number;
  /** Density level controlling event generation. */
  density: DensityLevel;
  /** Target energy (0.0-1.0) for this section. */
  energy: number;
  /** Optional: whether this section should include a fill in the last bar. */
  hasFill?: boolean;
}

/**
 * An arrangement archetype — a genre-aware structural template.
 */
export interface ArrangementArchetype {
  /** Machine-readable name (e.g. "techno_64bar"). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Genre tags. */
  genre: string[];
  /** Total bars across all sections. */
  totalBars: number;
  /** Ordered list of sections. */
  sections: SectionDef[];
}

/**
 * Expanded section — ready for action generation.
 * Includes computed start/end bars and pattern length in steps.
 */
export interface ExpandedSection {
  /** Section name. */
  name: string;
  /** 1-based start bar (inclusive). */
  startBar: number;
  /** 1-based end bar (inclusive). */
  endBar: number;
  /** Number of bars. */
  bars: number;
  /** Pattern length in steps (bars * 16). */
  lengthSteps: number;
  /** Density level. */
  density: DensityLevel;
  /** Density config for event generation. */
  densityConfig: DensityConfig;
  /** Target energy. */
  energy: number;
  /** Whether to include a fill in the last bar. */
  hasFill: boolean;
}

// ---------------------------------------------------------------------------
// Density mappings
// ---------------------------------------------------------------------------

const DENSITY_CONFIGS: Record<DensityLevel, DensityConfig> = {
  silent: {
    eventDensity: 0.0,
    velocityBase: 0.0,
    velocityRange: 0.0,
    energy: 0.0,
  },
  sparse: {
    eventDensity: 0.15,
    velocityBase: 0.5,
    velocityRange: 0.15,
    energy: 0.2,
  },
  rising: {
    eventDensity: 0.35,
    velocityBase: 0.65,
    velocityRange: 0.15,
    energy: 0.5,
  },
  full: {
    eventDensity: 0.6,
    velocityBase: 0.85,
    velocityRange: 0.1,
    energy: 0.9,
  },
  minimal: {
    eventDensity: 0.2,
    velocityBase: 0.55,
    velocityRange: 0.2,
    energy: 0.3,
  },
  dissolving: {
    eventDensity: 0.1,
    velocityBase: 0.4,
    velocityRange: 0.15,
    energy: 0.15,
  },
};

// ---------------------------------------------------------------------------
// Built-in archetypes
// ---------------------------------------------------------------------------

const ARCHETYPES: Record<string, ArrangementArchetype> = {
  techno_64bar: {
    name: 'techno_64bar',
    description: '64-bar techno arrangement: intro, build, drop, breakdown, drop, outro.',
    genre: ['techno'],
    totalBars: 64,
    sections: [
      { name: 'Intro', bars: 8, density: 'sparse', energy: 0.2 },
      { name: 'Build', bars: 8, density: 'rising', energy: 0.5, hasFill: true },
      { name: 'Drop', bars: 16, density: 'full', energy: 0.9 },
      { name: 'Breakdown', bars: 8, density: 'minimal', energy: 0.3 },
      { name: 'Drop 2', bars: 16, density: 'full', energy: 1.0, hasFill: true },
      { name: 'Outro', bars: 8, density: 'dissolving', energy: 0.15 },
    ],
  },

  house_32bar: {
    name: 'house_32bar',
    description: '32-bar house arrangement: intro, groove, breakdown, drop, outro.',
    genre: ['house', 'deep house'],
    totalBars: 32,
    sections: [
      { name: 'Intro', bars: 4, density: 'sparse', energy: 0.2 },
      { name: 'Groove', bars: 8, density: 'rising', energy: 0.6 },
      { name: 'Breakdown', bars: 4, density: 'minimal', energy: 0.25, hasFill: true },
      { name: 'Drop', bars: 12, density: 'full', energy: 0.9 },
      { name: 'Outro', bars: 4, density: 'dissolving', energy: 0.15 },
    ],
  },

  dnb_64bar: {
    name: 'dnb_64bar',
    description: '64-bar drum & bass arrangement: intro, build, drop, breakdown, second drop, outro.',
    genre: ['dnb', 'drum and bass', 'jungle'],
    totalBars: 64,
    sections: [
      { name: 'Intro', bars: 8, density: 'sparse', energy: 0.15 },
      { name: 'Build', bars: 8, density: 'rising', energy: 0.55, hasFill: true },
      { name: 'Drop', bars: 16, density: 'full', energy: 0.95 },
      { name: 'Breakdown', bars: 8, density: 'minimal', energy: 0.2 },
      { name: 'Drop 2', bars: 16, density: 'full', energy: 1.0 },
      { name: 'Outro', bars: 8, density: 'dissolving', energy: 0.1 },
    ],
  },

  ambient_32bar: {
    name: 'ambient_32bar',
    description: '32-bar ambient arrangement: emerge, develop, plateau, dissolve.',
    genre: ['ambient', 'downtempo'],
    totalBars: 32,
    sections: [
      { name: 'Emerge', bars: 8, density: 'sparse', energy: 0.1 },
      { name: 'Develop', bars: 8, density: 'rising', energy: 0.4 },
      { name: 'Plateau', bars: 8, density: 'minimal', energy: 0.5 },
      { name: 'Dissolve', bars: 8, density: 'dissolving', energy: 0.1 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** All arrangement archetype names. */
export const ARRANGEMENT_ARCHETYPE_NAMES = Object.keys(ARCHETYPES);

/**
 * Look up an arrangement archetype by name.
 */
export function getArrangementArchetype(name: string): ArrangementArchetype | undefined {
  return ARCHETYPES[name];
}

/**
 * Get the density config for a density level.
 */
export function getDensityConfig(level: DensityLevel): DensityConfig {
  return DENSITY_CONFIGS[level];
}

/**
 * Expand an archetype into action-ready sections with computed bar ranges
 * and step lengths.
 */
export function expandArchetype(archetype: ArrangementArchetype): ExpandedSection[] {
  const sections: ExpandedSection[] = [];
  let currentBar = 1;

  for (const section of archetype.sections) {
    const startBar = currentBar;
    const endBar = currentBar + section.bars - 1;
    sections.push({
      name: section.name,
      startBar,
      endBar,
      bars: section.bars,
      lengthSteps: section.bars * 16,
      density: section.density,
      densityConfig: DENSITY_CONFIGS[section.density],
      energy: section.energy,
      hasFill: section.hasFill ?? false,
    });
    currentBar = endBar + 1;
  }

  return sections;
}

/**
 * Return a summary list of all available arrangement archetypes.
 */
export function getArrangementArchetypeList(): { name: string; description: string; genre: string[]; totalBars: number }[] {
  return Object.values(ARCHETYPES).map(a => ({
    name: a.name,
    description: a.description,
    genre: a.genre,
    totalBars: a.totalBars,
  }));
}
