// src/audio/instrument-registry.ts
import type {
  ControlKind,
  SemanticRole,
  ControlSchema,
  ControlBinding,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Canonical-to-runtime mappings ---

export const controlIdToRuntimeParam: Record<string, string> = {
  brightness: 'timbre',
  richness: 'harmonics',
  texture: 'morph',
  pitch: 'note',
};

export const runtimeParamToControlId: Record<string, string> = {
  timbre: 'brightness',
  harmonics: 'richness',
  morph: 'texture',
  note: 'pitch',
};

// --- Control factory ---

function makeControl(
  id: string,
  name: string,
  semanticRole: SemanticRole,
  description: string,
  runtimeParam: string,
): ControlSchema {
  return {
    id,
    name,
    kind: 'continuous' as ControlKind,
    semanticRole,
    description,
    readable: true,
    writable: true,
    range: { min: 0, max: 1, default: 0.5 },
    binding: {
      adapterId: 'plaits',
      path: `params.${runtimeParam}`,
    },
  };
}

function defaultControls(): ControlSchema[] {
  return [
    makeControl(
      'brightness',
      'Brightness',
      'brightness',
      'Spectral content of the sound. Low values are dark and warm, high values are bright and cutting.',
      'timbre',
    ),
    makeControl(
      'richness',
      'Richness',
      'richness',
      'Harmonic richness and complexity. Low values are simple and pure, high values are dense and complex.',
      'harmonics',
    ),
    makeControl(
      'texture',
      'Texture',
      'texture',
      'Surface character and modulation depth. Shapes the evolving quality of the sound.',
      'morph',
    ),
    makeControl(
      'pitch',
      'Pitch',
      'pitch',
      'Fundamental pitch of the sound. 0.0 is the lowest, 1.0 is the highest.',
      'note',
    ),
  ];
}

// --- Engine definitions ---

const ENGINE_DATA: [string, string, string][] = [
  ['virtual-analog', 'Virtual Analog', 'VA oscillator with variable waveshape'],
  ['waveshaping', 'Waveshaping', 'Waveshaping oscillator'],
  ['fm', 'FM', '2-operator FM synthesis'],
  ['grain-formant', 'Grain/Formant', 'Granular formant oscillator'],
  ['harmonic', 'Harmonic', 'Additive harmonic oscillator'],
  ['wavetable', 'Wavetable', 'Wavetable oscillator'],
  ['chords', 'Chords', 'Chord engine'],
  ['vowel-speech', 'Vowel/Speech', 'Speech synthesis'],
  ['swarm', 'Swarm', 'Swarm of 8 sawtooth oscillators'],
  ['filtered-noise', 'Filtered Noise', 'Filtered noise generator'],
  ['particle-dust', 'Particle/Dust', 'Particle noise (dust)'],
  ['inharmonic-string', 'Inharmonic String', 'Inharmonic string model'],
  ['modal-resonator', 'Modal Resonator', 'Struck objects, bells'],
  ['analog-bass-drum', 'Analog Bass Drum', 'Analog bass drum'],
  ['analog-snare', 'Analog Snare', 'Analog snare drum'],
  ['analog-hi-hat', 'Analog Hi-Hat', 'Analog hi-hat'],
];

const engines: EngineDef[] = ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: defaultControls(),
}));

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
  return engines[index]?.label ?? `Unknown ${index}`;
}

export function getEngineControlSchemas(engineId: string): ControlSchema[] {
  return engineByIdMap.get(engineId)?.controls ?? [];
}

export function getControlBinding(engineId: string, controlId: string): ControlBinding | undefined {
  const engine = engineByIdMap.get(engineId);
  if (!engine) return undefined;
  return engine.controls.find(c => c.id === controlId)?.binding;
}

// --- Model list helper (for UI consumers) ---

export function getModelList(): { index: number; name: string; description: string }[] {
  return engines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
