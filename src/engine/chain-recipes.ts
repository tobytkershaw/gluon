// src/engine/chain-recipes.ts — Pre-configured signal chain recipes for common musical roles.

export interface ChainRecipe {
  name: string;
  description: string;
  genre: string[];
  role: string;
  processors: {
    type: string;
    model: number;
    params: Record<string, number>;
  }[];
}

/**
 * Processor model indices (from instrument registries):
 * - EQ: 0=4band, 1=8band
 * - Compressor: 0=clean, 1=opto, 2=bus, 3=limit
 * - Ripples: 0=lp2, 1=lp4, 2=bp2, 3=hp2
 * - Clouds: 0=granular, 1=pitch-shifter, 2=looping-delay, 3=spectral
 */
const RECIPES: Record<string, ChainRecipe> = {
  techno_kick: {
    name: 'techno_kick',
    description: 'Punchy techno kick — sub boost, mid scoop, bus compression, subtle tape',
    genre: ['techno', 'house'],
    role: 'kick',
    processors: [
      {
        type: 'eq', model: 0,
        params: {
          'low-gain': 0.7, 'mid1-gain': 0.3, 'high-gain': 0.5,
          'low-freq': 0.3, 'high-freq': 0.6,
          'mid1-freq': 0.4, 'mid1-q': 0.3,
          'mid2-gain': 0.5, 'mid2-freq': 0.6, 'mid2-q': 0.3,
        },
      },
      {
        type: 'compressor', model: 2, // bus
        params: { threshold: 0.4, ratio: 0.4, attack: 0.2, release: 0.3, makeup: 0.3, mix: 1.0 },
      },
    ],
  },

  deep_bass: {
    name: 'deep_bass',
    description: 'Deep bass — sub-focused EQ with gentle opto compression',
    genre: ['techno', 'house', 'dub'],
    role: 'bass',
    processors: [
      {
        type: 'eq', model: 0,
        params: {
          'low-gain': 0.75, 'low-freq': 0.2,
          'mid1-gain': 0.4, 'mid1-freq': 0.5, 'mid1-q': 0.4,
          'mid2-gain': 0.5, 'mid2-freq': 0.6, 'mid2-q': 0.3,
          'high-gain': 0.35, 'high-freq': 0.6,
        },
      },
      {
        type: 'compressor', model: 1, // opto
        params: { threshold: 0.5, ratio: 0.25, attack: 0.4, release: 0.5, makeup: 0.15, mix: 1.0 },
      },
    ],
  },

  crispy_hat: {
    name: 'crispy_hat',
    description: 'Crispy hi-hat — high-pass at 500Hz with air boost',
    genre: ['techno', 'house', 'electro'],
    role: 'hat',
    processors: [
      {
        type: 'eq', model: 0,
        params: {
          'low-gain': 0.15, 'low-freq': 0.5,    // cut below ~500Hz
          'mid1-gain': 0.5, 'mid1-freq': 0.5, 'mid1-q': 0.3,
          'mid2-gain': 0.5, 'mid2-freq': 0.6, 'mid2-q': 0.3,
          'high-gain': 0.7, 'high-freq': 0.8,    // air boost around 12kHz+
        },
      },
    ],
  },

  ambient_pad: {
    name: 'ambient_pad',
    description: 'Ambient pad — low-pass filter with resonance into granular clouds',
    genre: ['ambient', 'drone', 'electronica'],
    role: 'pad',
    processors: [
      {
        type: 'ripples', model: 1, // lp4
        params: { cutoff: 0.35, resonance: 0.6, drive: 0.1 },
      },
      {
        type: 'clouds', model: 0, // granular
        params: {
          position: 0.5, size: 0.8, pitch: 0.5,
          density: 0.6, texture: 0.7, feedback: 0.4,
          reverb: 0.6, 'dry-wet': 0.5,
        },
      },
    ],
  },

  aggressive_lead: {
    name: 'aggressive_lead',
    description: 'Aggressive lead — presence boost EQ with fast clean compression',
    genre: ['techno', 'electro', 'industrial'],
    role: 'lead',
    processors: [
      {
        type: 'eq', model: 0,
        params: {
          'low-gain': 0.45, 'low-freq': 0.3,
          'mid1-gain': 0.65, 'mid1-freq': 0.6, 'mid1-q': 0.4, // presence boost ~2-4kHz
          'mid2-gain': 0.5, 'mid2-freq': 0.6, 'mid2-q': 0.3,
          'high-gain': 0.55, 'high-freq': 0.7,
        },
      },
      {
        type: 'compressor', model: 0, // clean
        params: { threshold: 0.45, ratio: 0.35, attack: 0.15, release: 0.3, makeup: 0.25, mix: 1.0 },
      },
    ],
  },

  mix_bus: {
    name: 'mix_bus',
    description: 'Mix bus — gentle smile EQ curve with bus glue compression',
    genre: ['any'],
    role: 'bus',
    processors: [
      {
        type: 'eq', model: 0,
        params: {
          'low-gain': 0.55, 'low-freq': 0.25,    // gentle low shelf boost
          'mid1-gain': 0.47, 'mid1-freq': 0.5, 'mid1-q': 0.2, // slight mid scoop
          'mid2-gain': 0.5, 'mid2-freq': 0.6, 'mid2-q': 0.3,
          'high-gain': 0.55, 'high-freq': 0.7,    // gentle high shelf boost
        },
      },
      {
        type: 'compressor', model: 2, // bus
        params: { threshold: 0.55, ratio: 0.2, attack: 0.4, release: 0.35, makeup: 0.1, mix: 1.0 },
      },
    ],
  },
};

/** All known recipe names. */
export const RECIPE_NAMES = Object.keys(RECIPES);

/** Get a chain recipe by name, or undefined if not found. */
export function getChainRecipe(name: string): ChainRecipe | undefined {
  return RECIPES[name];
}

/** List all available chain recipes (name, description, role). */
export function getChainRecipeList(): { name: string; description: string; role: string }[] {
  return Object.values(RECIPES).map(r => ({
    name: r.name,
    description: r.description,
    role: r.role,
  }));
}
