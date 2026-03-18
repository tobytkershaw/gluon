// src/audio/instrument-registry-rings.ts
// Rings processor instrument definition — extracted from instrument-registry.ts
import type {
  ControlKind,
  SemanticRole,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Rings control factory ---

function makeRingsControl(
  id: string,
  name: string,
  semanticRole: SemanticRole,
  description: string,
  kind: ControlKind = 'continuous',
  defaultVal = 0.5,
  size: 'large' | 'medium' | 'small' = 'large',
  range?: { min: number; max: number; default: number },
  displayMapping?: DisplayMapping,
): ControlSchema {
  return {
    id,
    name,
    kind,
    semanticRole,
    description,
    readable: true,
    writable: true,
    range: range ?? { min: 0, max: 1, default: defaultVal },
    size,
    binding: {
      adapterId: 'rings',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function ringsControls(): ControlSchema[] {
  return [
    makeRingsControl(
      'structure',
      'Structure',
      'richness',
      'Harmonic structure. Controls the intervals between partials (modal) or string arrangement (string).',
    ),
    makeRingsControl(
      'brightness',
      'Brightness',
      'brightness',
      'Spectral brightness of the resonance. Low values are dark and muffled, high values are bright and present.',
    ),
    makeRingsControl(
      'damping',
      'Damping',
      'texture',
      'Decay time of the resonance. Low values ring long, high values decay quickly.',
      'continuous',
      0.7,
    ),
    makeRingsControl(
      'position',
      'Position',
      'texture',
      'Excitation position along the resonator. Changes the harmonic content by exciting different modes.',
    ),
    // --- Secondary controls (WASM bridge exists) ---
    makeRingsControl(
      'fine-tune',
      'Fine Tune',
      'pitch',
      'Fine pitch offset in semitones. 0.5 is centered (no offset), 0.0 is -1 semitone, 1.0 is +1 semitone.',
      'continuous',
      0.5,
      'small',
    ),
    {
      id: 'internal-exciter',
      name: 'Internal Exciter',
      kind: 'boolean' as ControlKind,
      semanticRole: 'body',
      description: 'When enabled, Rings uses its own built-in exciter instead of processing external audio input.',
      readable: true,
      writable: true,
      range: { min: 0, max: 1, default: 1 },
      size: 'small',
      binding: {
        adapterId: 'rings',
        path: 'params.internal-exciter',
      },
    },
    makeRingsControl(
      'polyphony',
      'Polyphony',
      'density',
      'Number of simultaneous resonating voices (1–4).',
      'discrete',
      1,
      'small',
      { min: 1, max: 4, default: 1 },
    ),
  ];
}

// --- Rings engine definitions ---

const RINGS_ENGINE_DATA: [string, string, string][] = [
  ['modal', 'Modal Resonator', 'Resonant body model — bells, plates, bowls'],
  ['sympathetic-string', 'Sympathetic String', 'Sympathetic string resonance — sitar, tanpura'],
  ['string', 'String', 'Karplus-Strong string model — plucked and bowed'],
  ['fm-voice', 'FM Voice', 'FM synthesis through the resonator'],
  ['sympathetic-quantized', 'Sympathetic Quantized', 'Sympathetic strings with quantized pitches — chordal'],
  ['string-and-reverb', 'String + Reverb', 'String model with integrated reverb'],
];

const ringsEngines: EngineDef[] = RINGS_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: ringsControls(),
}));

// --- Rings instrument definition ---

export const ringsInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Mutable Instruments Rings',
  adapterId: 'rings',
  engines: ringsEngines,
};

const ringsEngineByIdMap = new Map<string, EngineDef>(
  ringsEngines.map(e => [e.id, e]),
);

export function getRingsEngineById(engineId: string): EngineDef | undefined {
  return ringsEngineByIdMap.get(engineId);
}

export function getRingsEngineByIndex(index: number): EngineDef | undefined {
  return ringsEngines[index];
}

export function getRingsModelList(): { index: number; name: string; description: string }[] {
  return ringsEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
