// src/audio/instrument-registry-plaits.ts
// Plaits synth instrument definition — extracted from instrument-registry.ts
import type {
  ControlKind,
  SemanticRole,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Canonical-to-runtime mappings ---
// After the hardware-name rename (#392), most Plaits control IDs match their
// runtime param names directly (timbre→timbre, harmonics→harmonics, morph→morph).
// The only remaining mapping is frequency→note.
// Processors (Rings, Clouds) and modulators (Tides) use identity mappings.

export const controlIdToRuntimeParam: Record<string, string> = {
  frequency: 'note',
  'fm-amount': 'fm_amount',
  'timbre-mod-amount': 'timbre_mod_amount',
  'morph-mod-amount': 'morph_mod_amount',
  'lpg-colour': 'lpg_colour',
};

export const runtimeParamToControlId: Record<string, string> = {
  note: 'frequency',
  fm_amount: 'fm-amount',
  timbre_mod_amount: 'timbre-mod-amount',
  morph_mod_amount: 'morph-mod-amount',
  lpg_colour: 'lpg-colour',
};

// --- Control factory ---

function makePlaitsControl(
  id: string,
  name: string,
  semanticRole: SemanticRole,
  description: string,
  runtimeParam: string,
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
      adapterId: 'plaits',
      path: `params.${runtimeParam}`,
    },
    displayMapping,
  };
}

function defaultControls(): ControlSchema[] {
  return [
    // Row 1: Frequency, Harmonics (matching hardware 2x2 layout)
    makePlaitsControl(
      'frequency',
      'Frequency',
      'pitch',
      'Fundamental pitch of the sound. 0.0 is the lowest, 1.0 is the highest.',
      'note',
      0.5,
      'large',
      { type: 'log', min: 20, max: 16000, unit: 'Hz', decimals: 0 },
    ),
    makePlaitsControl(
      'harmonics',
      'Harmonics',
      'richness',
      'Harmonic richness and complexity. Low values are simple and pure, high values are dense and complex.',
      'harmonics',
    ),
    // Row 2: Timbre, Morph (medium — smaller knobs on hardware)
    makePlaitsControl(
      'timbre',
      'Timbre',
      'brightness',
      'Spectral content of the sound. Low values are dark and warm, high values are bright and cutting.',
      'timbre',
      0.5,
      'medium',
    ),
    makePlaitsControl(
      'morph',
      'Morph',
      'texture',
      'Surface character and modulation depth. Shapes the evolving quality of the sound.',
      'morph',
      0.5,
      'medium',
    ),
    // Row 3: Timbre Mod, FM Amount, Morph Mod (attenuverters, matching hardware order)
    makePlaitsControl(
      'timbre-mod-amount',
      'Timbre Mod',
      'brightness',
      'How much the internal envelope modulates the timbre parameter.',
      'timbre_mod_amount',
      0.0,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makePlaitsControl(
      'fm-amount',
      'FM Amount',
      'richness',
      'Frequency modulation depth. Controls how much the internal envelope modulates the pitch.',
      'fm_amount',
      0.0,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makePlaitsControl(
      'morph-mod-amount',
      'Morph Mod',
      'texture',
      'How much the internal envelope modulates the morph parameter.',
      'morph_mod_amount',
      0.0,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makePlaitsControl(
      'decay',
      'Decay',
      'decay',
      'LPG decay time. Controls how long the internal low-pass gate stays open after a trigger.',
      'decay',
      0.5,
      'small',
      { type: 'log', min: 1, max: 4000, unit: 'ms', decimals: 0 },
    ),
    makePlaitsControl(
      'lpg-colour',
      'LPG Colour',
      'brightness',
      'LPG response character. Low values are more like a VCA, high values add more filtering.',
      'lpg_colour',
      0.5,
      'small',
    ),
  ];
}

// --- Engine definitions ---

const ENGINE_DATA: [string, string, string, boolean][] = [
  ['virtual-analog', 'Virtual Analog', 'VA oscillator with variable waveshape', false],
  ['waveshaping', 'Waveshaping', 'Waveshaping oscillator', false],
  ['fm', 'FM', '2-operator FM synthesis', false],
  ['grain-formant', 'Grain/Formant', 'Granular formant oscillator', false],
  ['harmonic', 'Harmonic', 'Additive harmonic oscillator', false],
  ['wavetable', 'Wavetable', 'Wavetable oscillator', false],
  ['chords', 'Chords', 'Chord engine', false],
  ['vowel-speech', 'Vowel/Speech', 'Speech synthesis', false],
  ['swarm', 'Swarm', 'Swarm of 8 sawtooth oscillators', false],
  ['filtered-noise', 'Filtered Noise', 'Filtered noise generator', false],
  ['particle-dust', 'Particle/Dust', 'Particle noise (dust)', false],
  ['inharmonic-string', 'Inharmonic String', 'Inharmonic string model', false],
  ['modal-resonator', 'Modal Resonator', 'Struck objects, bells', false],
  ['analog-bass-drum', 'Analog Bass Drum', 'Analog bass drum', true],
  ['analog-snare', 'Analog Snare', 'Analog snare drum', true],
  ['analog-hi-hat', 'Analog Hi-Hat', 'Analog hi-hat', true],
];

const engines: EngineDef[] = ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: defaultControls(),
}));

const percussionSet = new Set(
  ENGINE_DATA.filter(([, , , perc]) => perc).map(([id]) => id),
);

export function isPercussion(engineId: string): boolean {
  return percussionSet.has(engineId);
}

export function isPercussionByIndex(index: number): boolean {
  return ENGINE_DATA[index]?.[3] ?? false;
}

// --- Instrument definition ---

export const plaitsInstrument: InstrumentDef = {
  type: 'synth',
  label: 'Mutable Instruments Plaits',
  adapterId: 'plaits',
  engines,
};

// --- Lookup helpers ---

const engineByIdMap = new Map<string, EngineDef>(
  engines.map(e => [e.id, e]),
);

export function getEngineById(engineId: string): EngineDef | undefined {
  return engineByIdMap.get(engineId);
}

export function getEngineByIndex(index: number): EngineDef | undefined {
  return engines[index];
}

export function getModelName(index: number): string {
  if (index < 0) return 'No Source';
  return engines[index]?.label ?? `Unknown ${index}`;
}

export function getEngineControlSchemas(engineId: string): ControlSchema[] {
  return engineByIdMap.get(engineId)?.controls ?? [];
}

export function getControlBinding(engineId: string, controlId: string): import('../engine/canonical-types').ControlBinding | undefined {
  const engine = engineByIdMap.get(engineId);
  if (!engine) return undefined;
  return engine.controls.find(c => c.id === controlId)?.binding;
}

export function getModelList(): { index: number; name: string; description: string }[] {
  return engines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
