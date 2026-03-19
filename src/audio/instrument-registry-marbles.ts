// src/audio/instrument-registry-marbles.ts
// Marbles modulator instrument definition — controlled randomness generator.
// Based on Mutable Instruments Marbles: random voltage/gate generator with
// probability distribution shaping, quantization, and deja vu loop memory.
import type {
  ControlKind,
  SemanticRole,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Marbles control factory ---

function makeMarblesControl(
  id: string,
  name: string,
  semanticRole: SemanticRole,
  description: string,
  defaultVal = 0.5,
  size: 'large' | 'medium' | 'small' = 'large',
  displayMapping?: DisplayMapping,
): ControlSchema {
  return {
    id,
    name,
    kind: 'continuous' as ControlKind,
    semanticRole,
    description,
    readable: true,
    writable: true,
    range: { min: 0, max: 1, default: defaultVal },
    size,
    binding: {
      adapterId: 'marbles',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function marblesControls(): ControlSchema[] {
  return [
    makeMarblesControl(
      'rate',
      'Rate',
      'movement_rate',
      'Clock rate of the random generator. Controls how frequently new random values are produced. 120 BPM at center.',
      0.5,
      'large',
      { type: 'log', min: 0.05, max: 100, unit: 'Hz', decimals: 1 },
    ),
    makeMarblesControl(
      'spread',
      'Spread',
      'richness',
      'Probability distribution width and shape. Fully low = constant output. Low-center = bell-shaped (values concentrate toward center). Center-high = uniform (equal probability across range). Fully high = extreme values favored, creating random gate-like output.',
      0.5,
      'large',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeMarblesControl(
      'bias',
      'Bias',
      'body',
      'Skews the probability distribution toward low or high values. Center = symmetric distribution. Below center = low values more likely. Above center = high values more likely. In gate mode, controls gate probability (density of triggers).',
      0.5,
      'large',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeMarblesControl(
      'steps',
      'Steps',
      'texture',
      'Quantization amount. Below center = smooth, continuous output (curves and linear segments). At center = chromatic scale quantization. Above center = progressively eliminates notes from the scale until only octaves remain.',
      0.0,
      'medium',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeMarblesControl(
      'deja_vu',
      'Deja Vu',
      'stability',
      'Loop probability. Low = fully random. Rising toward center = increasing chance of replaying past values (locked loop at center). Above center = random permutations within the stored loop. Creates evolving-but-familiar patterns.',
      0.0,
      'large',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeMarblesControl(
      'length',
      'Length',
      'density',
      'Deja vu loop length. Controls how many steps are stored in the loop buffer before it wraps. Shorter = tighter repetition, longer = more variation before repeating.',
      0.25,
      'medium',
      { type: 'linear', min: 1, max: 16, unit: 'steps', decimals: 0 },
    ),
  ];
}

// --- Marbles engine definitions ---
// The hardware Marbles has separate t (gate) and X (voltage) sections.
// Our modulator abstraction exposes these as engine modes.

const MARBLES_ENGINE_DATA: [string, string, string][] = [
  ['voltage', 'Voltage', 'Random voltage generator with distribution shaping and quantization. Output is shaped random CV for pitch or parameter modulation.'],
  ['gate', 'Gate', 'Random gate/trigger pattern generator. Bias controls trigger probability. Output is gate high (1.0) or low (0.0).'],
  ['both', 'Both', 'Paired voltage and gate output. Left channel outputs shaped random voltage, right channel outputs random gate triggers.'],
];

const marblesEngines: EngineDef[] = MARBLES_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: marblesControls(),
}));

// --- Marbles instrument definition ---

export const marblesInstrument: InstrumentDef = {
  type: 'modulator',
  label: 'Mutable Instruments Marbles',
  adapterId: 'marbles',
  engines: marblesEngines,
};

const marblesEngineByIdMap = new Map<string, EngineDef>(
  marblesEngines.map(e => [e.id, e]),
);

export function getMarblesEngineById(engineId: string): EngineDef | undefined {
  return marblesEngineByIdMap.get(engineId);
}

export function getMarblesEngineByIndex(index: number): EngineDef | undefined {
  return marblesEngines[index];
}

export function getMarblesModelList(): { index: number; name: string; description: string }[] {
  return marblesEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
