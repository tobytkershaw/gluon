// src/audio/instrument-registry-distortion.ts
// Distortion processor instrument definition — extracted from instrument-registry.ts
import type {
  SemanticRole,
  ControlKind,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Distortion control factory ---

function makeDistortionControl(
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
      adapterId: 'distortion',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function distortionControls(): ControlSchema[] {
  return [
    makeDistortionControl(
      'drive',
      'Drive',
      'drive',
      'Gain/saturation amount. Controls how hard the signal is pushed into the distortion curve.',
      0.5,
      'large',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeDistortionControl(
      'tone',
      'Tone',
      'brightness',
      'Post-distortion lowpass filter. 0.0 is dark (200 Hz), 1.0 is bright (20 kHz). Log scale.',
      0.7,
      'medium',
      { type: 'log', min: 200, max: 20000, unit: 'Hz', decimals: 0 },
    ),
    makeDistortionControl(
      'mix',
      'Mix',
      'body',
      'Dry/wet blend. 0 is fully dry, 1 is fully wet.',
      1.0,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeDistortionControl(
      'bits',
      'Bits',
      'texture',
      'Bit depth for bitcrush mode. 0.0 is 1-bit (extreme), 1.0 is 16-bit (clean). Other modes ignore this.',
      1.0,
      'medium',
      { type: 'linear', min: 1, max: 16, unit: 'bits', decimals: 1 },
    ),
    makeDistortionControl(
      'downsample',
      'Downsample',
      'texture',
      'Sample rate reduction for bitcrush mode. 0.0 is no reduction (1x), 1.0 is maximum (64x). Other modes ignore this.',
      0.0,
      'medium',
      { type: 'linear', min: 1, max: 64, unit: 'x', decimals: 0 },
    ),
  ];
}

// --- Distortion engine definitions ---

const DISTORTION_ENGINE_DATA: [string, string, string][] = [
  ['tape', 'Tape', 'Warm asymmetric saturation — subtle tape character'],
  ['overdrive', 'Overdrive', 'Tube-style overdrive — smooth even harmonics'],
  ['fuzz', 'Fuzz', 'Hard clipping — aggressive odd harmonics'],
  ['bitcrush', 'Bitcrush', 'Digital destruction — bit depth and sample rate reduction'],
];

const distortionEngines: EngineDef[] = DISTORTION_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: distortionControls(),
}));

// --- Distortion instrument definition ---

export const distortionInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Distortion',
  adapterId: 'distortion',
  engines: distortionEngines,
};

const distortionEngineByIdMap = new Map<string, EngineDef>(
  distortionEngines.map(e => [e.id, e]),
);

export function getDistortionEngineById(engineId: string): EngineDef | undefined {
  return distortionEngineByIdMap.get(engineId);
}

export function getDistortionEngineByIndex(index: number): EngineDef | undefined {
  return distortionEngines[index];
}

export function getDistortionModelList(): { index: number; name: string; description: string }[] {
  return distortionEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
