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
    // --- BLEND sub-parameters ---
    // On hardware, a single BLEND knob selects between these four parameters.
    // In Gluon they are exposed as separate controls for direct access.
    makeCloudsControl(
      'feedback',
      'Feedback',
      'decay',
      'Wet signal recirculation. High values create evolving, self-reinforcing textures. (BLEND sub-parameter on hardware)',
      'continuous',
      0.0,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeCloudsControl(
      'stereo-spread',
      'Stereo Spread',
      'density',
      'Random panning amount applied to grains. 0 is mono, 1 is full spread. (BLEND sub-parameter on hardware)',
      'continuous',
      0.0,
      'small',
    ),
    makeCloudsControl(
      'reverb',
      'Reverb',
      'decay',
      'Built-in reverb amount. Adds space and depth to the processed signal. (BLEND sub-parameter on hardware)',
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
// Official Clouds playback modes (selected by long-pressing the quality button):
// 1. Granular — classic granular processing
// 2. Pitch Shifter / Time Stretcher
// 3. Looping Delay
// 4. Spectral Madness — phase vocoder spectral processing

const CLOUDS_ENGINE_DATA: [string, string, string][] = [
  ['granular', 'Granular', 'Classic granular processing — slice and scatter frozen audio'],
  ['pitch-shifter', 'Pitch Shifter / Time Stretcher', 'Time stretching and pitch shifting with formant preservation'],
  ['looping-delay', 'Looping Delay', 'Looping delay with pitch shifting and feedback'],
  ['spectral', 'Spectral Madness', 'Phase vocoder spectral processing — freeze and warp frequency content'],
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
