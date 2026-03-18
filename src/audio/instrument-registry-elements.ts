// src/audio/instrument-registry-elements.ts
// Elements processor instrument definition — MI Elements physical modeling synthesizer
import type {
  SemanticRole,
  ControlKind,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Elements control factory ---

function makeElementsControl(
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
      adapterId: 'elements',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function elementsControls(): ControlSchema[] {
  return [
    // --- Exciter controls ---
    makeElementsControl(
      'bow_level',
      'Bow Level',
      'body',
      'Bowing exciter level. Controls how much the bowing excitation contributes to the sound.',
      0.0,
      'large',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeElementsControl(
      'bow_timbre',
      'Bow Timbre',
      'brightness',
      'Tonal character of the bowing excitation. Low values are smooth, high values add rosin-like grit.',
      0.5,
      'medium',
    ),
    makeElementsControl(
      'blow_level',
      'Blow Level',
      'body',
      'Blowing exciter level. Controls how much the blowing excitation (air, breath) contributes to the sound.',
      0.0,
      'large',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeElementsControl(
      'blow_timbre',
      'Blow Timbre',
      'brightness',
      'Tonal character of the blowing excitation. Adjusts the noise color and air turbulence character.',
      0.5,
      'medium',
    ),
    makeElementsControl(
      'strike_level',
      'Strike Level',
      'body',
      'Strike exciter level. Controls how much the striking excitation (mallet, plectrum) contributes to the sound.',
      0.8,
      'large',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeElementsControl(
      'strike_timbre',
      'Strike Timbre',
      'brightness',
      'Tonal character of the striking excitation. Low values are soft mallets, high values are hard sharp strikes.',
      0.5,
      'medium',
    ),
    // --- Resonator controls ---
    makeElementsControl(
      'coarse',
      'Coarse',
      'pitch',
      'Coarse pitch of the resonator. Controls the fundamental frequency of the resonating body.',
      0.5,
      'large',
    ),
    makeElementsControl(
      'fine',
      'Fine',
      'pitch',
      'Fine pitch adjustment. 0.5 is centered (no offset), 0.0 is -1 semitone, 1.0 is +1 semitone.',
      0.5,
      'small',
    ),
    makeElementsControl(
      'geometry',
      'Geometry',
      'richness',
      'Geometry of the resonator. Controls the harmonic structure — inharmonic (low) to harmonic (high).',
      0.5,
      'large',
    ),
    makeElementsControl(
      'brightness',
      'Brightness',
      'brightness',
      'Spectral brightness of the resonance. Low values are dark and muffled, high values are bright and present.',
      0.5,
      'large',
    ),
    makeElementsControl(
      'damping',
      'Damping',
      'texture',
      'Decay time of the resonance. Low values ring long, high values decay quickly.',
      0.5,
      'large',
    ),
    makeElementsControl(
      'position',
      'Position',
      'texture',
      'Excitation position along the resonator. Changes the harmonic content by exciting different modes.',
      0.5,
      'large',
    ),
    // --- Output ---
    makeElementsControl(
      'space',
      'Space',
      'texture',
      'Built-in reverb amount. Adds spatial depth and ambience to the output.',
      0.3,
      'medium',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
  ];
}

// --- Elements engine definitions ---

const ELEMENTS_ENGINE_DATA: [string, string, string][] = [
  ['modal', 'Modal Resonator', 'Modal resonator bank — struck, bowed, and blown metallic and wooden tones'],
  ['string', 'String Resonator', 'String resonator — sympathetic resonance, plucked and bowed behavior'],
];

const elementsEngines: EngineDef[] = ELEMENTS_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: elementsControls(),
}));

// --- Elements instrument definition ---

export const elementsInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Mutable Instruments Elements',
  adapterId: 'elements',
  engines: elementsEngines,
};

const elementsEngineByIdMap = new Map<string, EngineDef>(
  elementsEngines.map(e => [e.id, e]),
);

export function getElementsEngineById(engineId: string): EngineDef | undefined {
  return elementsEngineByIdMap.get(engineId);
}

export function getElementsEngineByIndex(index: number): EngineDef | undefined {
  return elementsEngines[index];
}

export function getElementsModelList(): { index: number; name: string; description: string }[] {
  return elementsEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
