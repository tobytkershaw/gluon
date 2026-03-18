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
