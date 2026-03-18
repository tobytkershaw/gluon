// src/audio/instrument-registry-chorus.ts
// Chorus processor instrument definition — extracted following instrument-registry-compressor.ts pattern
import type {
  SemanticRole,
  ControlKind,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Chorus control factory ---

function makeChorusControl(
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
      adapterId: 'chorus',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function chorusControls(): ControlSchema[] {
  return [
    makeChorusControl(
      'rate',
      'Rate',
      'movement_rate',
      'LFO speed controlling the modulation rate. Low values are slow and lush, high values are fast and vibrato-like.',
      0.3,
      'large',
      { type: 'log', min: 0.01, max: 10, unit: 'Hz', decimals: 2 },
    ),
    makeChorusControl(
      'depth',
      'Depth',
      'mod_depth',
      'Modulation depth. Controls how far the delay time / allpass coefficient sweeps.',
      0.5,
      'large',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeChorusControl(
      'feedback',
      'Feedback',
      'resonance',
      'Feedback amount. In flanger mode creates metallic resonance, in phaser mode intensifies the notches.',
      0.0,
      'medium',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeChorusControl(
      'mix',
      'Mix',
      'body',
      'Dry/wet blend. 0 is fully dry, 1 is fully wet.',
      0.5,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeChorusControl(
      'stereo',
      'Stereo',
      'space',
      'Stereo spread. Controls the LFO phase offset between left and right channels (0-180 degrees).',
      0.5,
      'small',
      { type: 'linear', min: 0, max: 180, unit: '\u00B0', decimals: 0 },
    ),
  ];
}

// --- Chorus engine definitions ---

const CHORUS_ENGINE_DATA: [string, string, string][] = [
  ['chorus', 'Chorus', 'Classic chorus — multiple modulated delay taps for lush doubling and widening'],
  ['flanger', 'Flanger', 'Flanger — short modulated delay with feedback for metallic comb filtering sweeps'],
  ['phaser', 'Phaser', 'Phaser — chain of allpass filters with LFO-modulated cutoff for moving notch effects'],
];

const chorusEngines: EngineDef[] = CHORUS_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: chorusControls(),
}));

// --- Chorus instrument definition ---

export const chorusInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Chorus',
  adapterId: 'chorus',
  engines: chorusEngines,
};

const chorusEngineByIdMap = new Map<string, EngineDef>(
  chorusEngines.map(e => [e.id, e]),
);

export function getChorusEngineById(engineId: string): EngineDef | undefined {
  return chorusEngineByIdMap.get(engineId);
}

export function getChorusEngineByIndex(index: number): EngineDef | undefined {
  return chorusEngines[index];
}

export function getChorusModelList(): { index: number; name: string; description: string }[] {
  return chorusEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
