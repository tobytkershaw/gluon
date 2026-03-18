// src/audio/instrument-registry-ripples.ts
// Ripples processor instrument definition — extracted from instrument-registry.ts
import type {
  SemanticRole,
  ControlKind,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Ripples control factory ---

function makeRipplesControl(
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
      adapterId: 'ripples',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function ripplesControls(): ControlSchema[] {
  return [
    makeRipplesControl(
      'cutoff',
      'Cutoff',
      'brightness',
      'Filter cutoff frequency. Low values are dark and muffled, high values let everything through.',
      0.5,
      'large',
      { type: 'log', min: 20, max: 20000, unit: 'Hz', decimals: 0 },
    ),
    makeRipplesControl(
      'resonance',
      'Resonance',
      'resonance',
      'Filter resonance / Q. Emphasises frequencies around the cutoff. At maximum, the filter self-oscillates.',
      0.0,
    ),
    makeRipplesControl(
      'drive',
      'Drive',
      'drive',
      'Input saturation before filtering. Adds warmth and harmonics at low values, distortion at high values.',
      0.0,
      'medium',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
  ];
}

// --- Ripples engine definitions ---

const RIPPLES_ENGINE_DATA: [string, string, string][] = [
  ['lp2', '2-Pole Low-Pass', 'Gentle 12dB/oct low-pass filter — warm and smooth'],
  ['lp4', '4-Pole Low-Pass', 'Classic 24dB/oct low-pass filter — Moog-style, deep and resonant'],
  ['bp2', '2-Pole Band-Pass', 'Band-pass filter — vocal, resonant character'],
  ['hp2', '2-Pole High-Pass', 'High-pass filter — removes low end, thin and airy'],
];

const ripplesEngines: EngineDef[] = RIPPLES_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: ripplesControls(),
}));

// --- Ripples instrument definition ---

export const ripplesInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Mutable Instruments Ripples',
  adapterId: 'ripples',
  engines: ripplesEngines,
};

const ripplesEngineByIdMap = new Map<string, EngineDef>(
  ripplesEngines.map(e => [e.id, e]),
);

export function getRipplesEngineById(engineId: string): EngineDef | undefined {
  return ripplesEngineByIdMap.get(engineId);
}

export function getRipplesEngineByIndex(index: number): EngineDef | undefined {
  return ripplesEngines[index];
}

export function getRipplesModelList(): { index: number; name: string; description: string }[] {
  return ripplesEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
