// src/engine/modulation-recipes.ts — Pre-configured modulation routing recipes.

export interface ModulationRecipe {
  name: string;
  description: string;
  modulatorType: string;      // 'tides'
  modulatorModel: number;     // engine index: 0=AD, 1=Looping, 2=AR
  modulatorParams: Record<string, number>;
  routeTarget: string;        // control ID to modulate (e.g. 'cutoff', 'frequency')
  routeTargetType: 'source' | 'processor';
  routeTargetProcessorType?: string;  // e.g. 'ripples' — which processor type to target
  routeDepth: number;
}

/**
 * Tides frequency mapping (from instrument-registry-tides.ts):
 *   displayMapping: log, 0.05Hz to 100Hz
 *   normalized 0-1 maps logarithmically across that range.
 *
 * Approximate normalized values for target rates:
 *   ~0.1 Hz  -> ~0.10
 *   ~1 Hz    -> ~0.39
 *   ~2 Hz    -> ~0.49
 *   ~4 Hz    -> ~0.59
 *   ~5 Hz    -> ~0.63
 *   ~0.02 Hz -> ~0.0  (very slow drift)
 */
const RECIPES: Record<string, ModulationRecipe> = {
  vibrato: {
    name: 'vibrato',
    description: 'Vibrato — subtle pitch modulation at ~5Hz',
    modulatorType: 'tides',
    modulatorModel: 1, // Looping (LFO)
    modulatorParams: { frequency: 0.63, shape: 0.0, slope: 0.5, smoothness: 0.8 },
    routeTarget: 'frequency',
    routeTargetType: 'source',
    routeDepth: 0.02,
  },

  slow_filter_sweep: {
    name: 'slow_filter_sweep',
    description: 'Slow filter sweep — LFO modulating Ripples cutoff at ~0.1Hz',
    modulatorType: 'tides',
    modulatorModel: 1,
    modulatorParams: { frequency: 0.10, shape: 0.0, slope: 0.5, smoothness: 0.9 },
    routeTarget: 'cutoff',
    routeTargetType: 'processor',
    routeTargetProcessorType: 'ripples',
    routeDepth: 0.3,
  },

  fast_filter_sweep: {
    name: 'fast_filter_sweep',
    description: 'Fast filter sweep — LFO modulating Ripples cutoff at ~2Hz',
    modulatorType: 'tides',
    modulatorModel: 1,
    modulatorParams: { frequency: 0.49, shape: 0.0, slope: 0.5, smoothness: 0.7 },
    routeTarget: 'cutoff',
    routeTargetType: 'processor',
    routeTargetProcessorType: 'ripples',
    routeDepth: 0.2,
  },

  tremolo: {
    name: 'tremolo',
    description: 'Tremolo — amplitude modulation at ~4Hz',
    modulatorType: 'tides',
    modulatorModel: 1,
    modulatorParams: { frequency: 0.59, shape: 0.0, slope: 0.5, smoothness: 0.8 },
    routeTarget: 'harmonics',
    routeTargetType: 'source',
    routeDepth: 0.4,
  },

  wobble: {
    name: 'wobble',
    description: 'Wobble bass — LFO modulating Ripples cutoff at ~1Hz',
    modulatorType: 'tides',
    modulatorModel: 1,
    modulatorParams: { frequency: 0.39, shape: 0.3, slope: 0.5, smoothness: 0.5 },
    routeTarget: 'cutoff',
    routeTargetType: 'processor',
    routeTargetProcessorType: 'ripples',
    routeDepth: 0.5,
  },

  wobble_bass: {
    name: 'wobble_bass',
    description: 'Wobble bass — aggressive LFO on Ripples cutoff at ~1Hz with deeper modulation',
    modulatorType: 'tides',
    modulatorModel: 1,
    modulatorParams: { frequency: 0.39, shape: 0.3, slope: 0.5, smoothness: 0.5 },
    routeTarget: 'cutoff',
    routeTargetType: 'processor',
    routeTargetProcessorType: 'ripples',
    routeDepth: 0.8,
  },

  pulsing_pad: {
    name: 'pulsing_pad',
    description: 'Pulsing pad — gentle amplitude LFO at ~2Hz for rhythmic pad movement',
    modulatorType: 'tides',
    modulatorModel: 1,
    modulatorParams: { frequency: 0.49, shape: 0.0, slope: 0.5, smoothness: 0.9 },
    routeTarget: 'harmonics',
    routeTargetType: 'source',
    routeDepth: 0.3,
  },

  auto_wah: {
    name: 'auto_wah',
    description: 'Auto-wah — LFO modulating Ripples cutoff at ~2Hz with medium depth',
    modulatorType: 'tides',
    modulatorModel: 1,
    modulatorParams: { frequency: 0.49, shape: 0.0, slope: 0.3, smoothness: 0.6 },
    routeTarget: 'cutoff',
    routeTargetType: 'processor',
    routeTargetProcessorType: 'ripples',
    routeDepth: 0.5,
  },

  ducking_sidechain: {
    name: 'ducking_sidechain',
    description: 'Sidechain-style ducking — fast AD envelope on amplitude for pumping effect',
    modulatorType: 'tides',
    modulatorModel: 0, // AD envelope
    modulatorParams: { frequency: 0.39, shape: 0.0, slope: 0.2, smoothness: 0.7 },
    routeTarget: 'harmonics',
    routeTargetType: 'source',
    routeDepth: -0.7,
  },

  drift: {
    name: 'drift',
    description: 'Drift — very slow random pitch modulation for organic movement',
    modulatorType: 'tides',
    modulatorModel: 1,
    modulatorParams: { frequency: 0.03, shape: 0.7, slope: 0.5, smoothness: 1.0 },
    routeTarget: 'frequency',
    routeTargetType: 'source',
    routeDepth: 0.01,
  },
};

/** All known modulation recipe names. */
export const MODULATION_RECIPE_NAMES = Object.keys(RECIPES);

/** Get a modulation recipe by name, or undefined if not found. */
export function getModulationRecipe(name: string): ModulationRecipe | undefined {
  return RECIPES[name];
}

/** List all available modulation recipes (name, description). */
export function getModulationRecipeList(): { name: string; description: string }[] {
  return Object.values(RECIPES).map(r => ({
    name: r.name,
    description: r.description,
  }));
}

/**
 * Overrides that can be applied on top of a recipe.
 * Explicit values always win over recipe defaults.
 */
export interface ModulationRecipeOverrides {
  depth?: number;
  rate?: number;            // maps to modulatorParams.frequency
  shape?: number;           // maps to modulatorParams.shape
  slope?: number;           // maps to modulatorParams.slope
  smoothness?: number;      // maps to modulatorParams.smoothness
  target?: string;          // override routeTarget
  targetType?: 'source' | 'processor';
}

/**
 * Resolve a recipe by name, applying any explicit overrides.
 * Returns a new ModulationRecipe with override values merged in.
 * Returns undefined if the recipe name is not found.
 */
export function resolveModulationRecipe(
  name: string,
  overrides?: ModulationRecipeOverrides,
): ModulationRecipe | undefined {
  const base = RECIPES[name];
  if (!base) return undefined;
  if (!overrides) return { ...base };

  const resolved: ModulationRecipe = {
    ...base,
    modulatorParams: { ...base.modulatorParams },
  };

  if (overrides.depth !== undefined) {
    resolved.routeDepth = Math.max(-1, Math.min(1, overrides.depth));
  }
  if (overrides.rate !== undefined) {
    resolved.modulatorParams.frequency = Math.max(0, Math.min(1, overrides.rate));
  }
  if (overrides.shape !== undefined) {
    resolved.modulatorParams.shape = Math.max(0, Math.min(1, overrides.shape));
  }
  if (overrides.slope !== undefined) {
    resolved.modulatorParams.slope = Math.max(0, Math.min(1, overrides.slope));
  }
  if (overrides.smoothness !== undefined) {
    resolved.modulatorParams.smoothness = Math.max(0, Math.min(1, overrides.smoothness));
  }
  if (overrides.target !== undefined) {
    resolved.routeTarget = overrides.target;
  }
  if (overrides.targetType !== undefined) {
    resolved.routeTargetType = overrides.targetType;
    // Clear processor type if switching to source targeting
    if (overrides.targetType === 'source') {
      resolved.routeTargetProcessorType = undefined;
    }
  }

  return resolved;
}
