// src/audio/instrument-registry-clouds.ts
// Clouds processor instrument definition — extracted from instrument-registry.ts
import type {
  ControlKind,
  SemanticRole,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Clouds control factory ---

function makeCloudsControl(
  id: string,
  name: string,
  semanticRole: SemanticRole,
  description: string,
  kind: ControlKind = 'continuous',
  defaultVal = 0.5,
  size: 'large' | 'medium' | 'small' = 'large',
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
    range: { min: 0, max: 1, default: defaultVal },
    size,
    binding: {
      adapterId: 'clouds',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function cloudsControls(): ControlSchema[] {
  return [
    // Large knobs (hardware top row): Position, Size, Pitch
    makeCloudsControl(
      'position',
      'Position',
      'texture',
      'Where in the recording buffer to read. Scrubs through captured audio.',
    ),
    makeCloudsControl(
      'size',
      'Size',
      'texture',
      'Grain size or texture scale. Small values are glitchy, large values are smooth and ambient.',
    ),
    makeCloudsControl(
      'pitch',
      'Pitch',
      'pitch',
      'Grain transposition. 0.5 is no shift, lower values pitch down, higher values pitch up.',
      'continuous',
      0.5,
    ),
    // Small knobs (hardware lower row, same size as attenuverters): Density, Texture, Dry/Wet (Blend)
    makeCloudsControl(
      'density',
      'Density',
      'density',
      'Grain generation rate. Low values are sparse, high values create dense textures.',
      'continuous',
      0.5,
      'small',
    ),
    makeCloudsControl(
      'texture',
      'Texture',
      'texture',
      'Grain envelope shape. Controls the window function applied to each grain.',
      'continuous',
      0.5,
      'small',
    ),
    makeCloudsControl(
      'dry-wet',
      'Blend',
      'body',
      'Blend between dry input and processed wet signal.',
      'continuous',
      0.5,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    // --- Secondary controls (attenuverters + extended) ---
    makeCloudsControl(
      'feedback',
      'Feedback',
      'decay',
      'Wet signal recirculation. High values create evolving, self-reinforcing textures.',
      'continuous',
      0.0,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeCloudsControl(
      'stereo-spread',
      'Stereo Spread',
      'density',
      'Width of the stereo image. 0 is mono, 1 is full stereo spread.',
      'continuous',
      0.0,
      'small',
    ),
    makeCloudsControl(
      'reverb',
      'Reverb',
      'decay',
      'Built-in reverb amount. Adds space and depth to the processed signal.',
      'continuous',
      0.0,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    {
      id: 'freeze',
      name: 'Freeze',
      kind: 'boolean' as ControlKind,
      semanticRole: 'stability',
      description: 'When enabled, freezes the recording buffer so no new audio is captured. Grains read from the frozen buffer.',
      readable: true,
      writable: true,
      range: { min: 0, max: 1, default: 0 },
      size: 'small',
      binding: {
        adapterId: 'clouds',
        path: 'params.freeze',
      },
    },
  ];
}

// --- Clouds engine definitions ---

const CLOUDS_ENGINE_DATA: [string, string, string][] = [
  ['granular', 'Granular', 'Classic granular processing — slice and scatter frozen audio'],
  ['pitch-shifter', 'Pitch Shifter', 'Time stretcher and pitch shifter'],
  ['looping-delay', 'Looping Delay', 'Looping delay with pitch shifting'],
  ['spectral', 'Spectral', 'Spectral processing via phase vocoder — freeze and warp frequency content'],
];

const cloudsEngines: EngineDef[] = CLOUDS_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: cloudsControls(),
}));

// --- Clouds instrument definition ---

export const cloudsInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Mutable Instruments Clouds',
  adapterId: 'clouds',
  engines: cloudsEngines,
};

const cloudsEngineByIdMap = new Map<string, EngineDef>(
  cloudsEngines.map(e => [e.id, e]),
);

export function getCloudsEngineById(engineId: string): EngineDef | undefined {
  return cloudsEngineByIdMap.get(engineId);
}

export function getCloudsEngineByIndex(index: number): EngineDef | undefined {
  return cloudsEngines[index];
}

export function getCloudsModelList(): { index: number; name: string; description: string }[] {
  return cloudsEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
