// src/audio/instrument-registry-compressor.ts
// Compressor processor instrument definition — extracted from instrument-registry.ts
import type {
  SemanticRole,
  ControlKind,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Compressor control factory ---

function makeCompressorControl(
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
      adapterId: 'compressor',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function compressorControls(): ControlSchema[] {
  return [
    makeCompressorControl(
      'threshold',
      'Threshold',
      'body',
      'Level above which compression begins. 0.0 is -60dB (heavy compression), 1.0 is 0dB (no compression).',
      0.5,
      'large',
      { type: 'dB', min: -60, max: 0, unit: 'dB', decimals: 1 },
    ),
    makeCompressorControl(
      'ratio',
      'Ratio',
      'body',
      'Compression ratio. Low values are gentle, high values are aggressive. In limiter mode this is overridden to brickwall.',
      0.3,
      'large',
      { type: 'linear', min: 1, max: 20, unit: ':1', decimals: 1 },
    ),
    makeCompressorControl(
      'attack',
      'Attack',
      'attack',
      'How fast the compressor reacts to signals above threshold. Low values are fast (punchy), high values are slow (transient-preserving).',
      0.3,
      'medium',
      { type: 'log', min: 0.1, max: 100, unit: 'ms', decimals: 1 },
    ),
    makeCompressorControl(
      'release',
      'Release',
      'decay',
      'How fast the compressor recovers after the signal drops below threshold. In opto mode this is program-dependent.',
      0.4,
      'medium',
      { type: 'log', min: 10, max: 1000, unit: 'ms', decimals: 0 },
    ),
    makeCompressorControl(
      'makeup',
      'Makeup',
      'body',
      'Output gain compensation. Restores level lost to compression.',
      0.0,
      'small',
      { type: 'linear', min: 0, max: 24, unit: 'dB', decimals: 1 },
    ),
    makeCompressorControl(
      'mix',
      'Mix',
      'body',
      'Dry/wet blend for parallel compression. 0 is fully dry, 1 is fully wet.',
      1.0,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
  ];
}

// --- Compressor engine definitions ---

const COMPRESSOR_ENGINE_DATA: [string, string, string][] = [
  ['clean', 'Clean', 'Transparent VCA compressor — precise, clinical dynamics control'],
  ['opto', 'Opto', 'Optical compressor character — smooth, program-dependent release (LA-2A style)'],
  ['bus', 'Bus', 'Bus/glue compressor — SSL-style with soft knee, punchy recovery'],
  ['limit', 'Limiter', 'Brickwall limiter — fast attack, high ratio safety net'],
];

const compressorEngines: EngineDef[] = COMPRESSOR_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: compressorControls(),
}));

// --- Compressor instrument definition ---

export const compressorInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Compressor',
  adapterId: 'compressor',
  engines: compressorEngines,
};

const compressorEngineByIdMap = new Map<string, EngineDef>(
  compressorEngines.map(e => [e.id, e]),
);

export function getCompressorEngineById(engineId: string): EngineDef | undefined {
  return compressorEngineByIdMap.get(engineId);
}

export function getCompressorEngineByIndex(index: number): EngineDef | undefined {
  return compressorEngines[index];
}

export function getCompressorModelList(): { index: number; name: string; description: string }[] {
  return compressorEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
