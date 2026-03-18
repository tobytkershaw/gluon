// src/audio/instrument-registry-stereo.ts
// Stereo processor instrument definition — extracted following instrument-registry-compressor.ts pattern
import type {
  SemanticRole,
  ControlKind,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Stereo control factory ---

function makeStereoControl(
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
      adapterId: 'stereo',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function stereoControls(): ControlSchema[] {
  return [
    makeStereoControl(
      'width',
      'Width',
      'space',
      'Stereo width. 0.0 is mono, 0.5 is original stereo image, 1.0 is extra-wide.',
      0.5,
      'large',
      { type: 'linear', min: 0, max: 200, unit: '%', decimals: 0 },
    ),
    makeStereoControl(
      'mid_gain',
      'Mid Gain',
      'body',
      'Mid channel gain. Controls the center/mono content level. 0.0 is -12dB, 0.5 is 0dB, 1.0 is +12dB.',
      0.5,
      'medium',
      { type: 'linear', min: -12, max: 12, unit: 'dB', decimals: 1 },
    ),
    makeStereoControl(
      'side_gain',
      'Side Gain',
      'space',
      'Side channel gain. Controls the stereo/difference content level. 0.0 is -12dB, 0.5 is 0dB, 1.0 is +12dB.',
      0.5,
      'medium',
      { type: 'linear', min: -12, max: 12, unit: 'dB', decimals: 1 },
    ),
    makeStereoControl(
      'delay',
      'Delay',
      'space',
      'Haas effect delay applied to one channel for spatial widening. 0.0 is off, 1.0 is 30ms.',
      0.0,
      'small',
      { type: 'linear', min: 0, max: 30, unit: 'ms', decimals: 1 },
    ),
  ];
}

// --- Stereo engine definitions ---

const STEREO_ENGINE_DATA: [string, string, string][] = [
  ['width', 'Width', 'M/S processing with Haas effect — stereo width and spatial control'],
  ['pan_law', 'Pan Law', 'Frequency-dependent panning — maintains mono bass compatibility'],
];

const stereoEngines: EngineDef[] = STEREO_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: stereoControls(),
}));

// --- Stereo instrument definition ---

export const stereoInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Stereo',
  adapterId: 'stereo',
  engines: stereoEngines,
};

const stereoEngineByIdMap = new Map<string, EngineDef>(
  stereoEngines.map(e => [e.id, e]),
);

export function getStereoEngineById(engineId: string): EngineDef | undefined {
  return stereoEngineByIdMap.get(engineId);
}

export function getStereoEngineByIndex(index: number): EngineDef | undefined {
  return stereoEngines[index];
}

export function getStereoModelList(): { index: number; name: string; description: string }[] {
  return stereoEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
