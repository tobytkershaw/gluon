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

// --- Rings control factory ---

function makeRingsControl(
  id: string,
  name: string,
  semanticRole: SemanticRole,
  description: string,
  defaultVal = 0.5,
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
    binding: {
      adapterId: 'rings',
      path: `params.${id}`,
    },
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
      0.7,
    ),
    makeRingsControl(
      'position',
      'Position',
      'texture',
      'Excitation position along the resonator. Changes the harmonic content by exciting different modes.',
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

// --- Clouds control factory ---

function makeCloudsControl(
  id: string,
  name: string,
  semanticRole: SemanticRole,
  description: string,
  defaultVal = 0.5,
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
    binding: {
      adapterId: 'clouds',
      path: `params.${id}`,
    },
  };
}

function cloudsControls(): ControlSchema[] {
  return [
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
      'density',
      'Density',
      'density',
      'Grain generation rate. Low values are sparse, high values create dense textures.',
    ),
    makeCloudsControl(
      'feedback',
      'Feedback',
      'decay',
      'Wet signal recirculation. High values create evolving, self-reinforcing textures.',
      0.0,
    ),
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

// --- Tides control factory ---

function makeTidesControl(
  id: string,
  name: string,
  semanticRole: SemanticRole,
  description: string,
  defaultVal = 0.5,
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
    binding: {
      adapterId: 'tides',
      path: `params.${id}`,
    },
  };
}

function tidesControls(): ControlSchema[] {
  return [
    makeTidesControl(
      'frequency',
      'Frequency',
      'pitch',
      'Rate of the modulation cycle. Low values are slow sweeps, high values are fast oscillation.',
      0.3,
    ),
    makeTidesControl(
      'shape',
      'Shape',
      'texture',
      'Waveform character. Blends between different waveshapes (sine, triangle, saw, square-like).',
    ),
    makeTidesControl(
      'slope',
      'Slope',
      'texture',
      'Attack/decay symmetry. Low values have fast attack/slow decay, high values have slow attack/fast decay.',
    ),
    makeTidesControl(
      'smoothness',
      'Smoothness',
      'brightness',
      'Waveform smoothing. Low values are sharp/stepped, high values are smooth/rounded.',
      0.5,
    ),
  ];
}

// --- Tides engine definitions ---

const TIDES_ENGINE_DATA: [string, string, string][] = [
  ['ad', 'AD', 'Attack-decay envelope — one-shot shape triggered by events'],
  ['looping', 'Looping', 'Free-running LFO — continuous cyclic modulation'],
  ['ar', 'AR', 'Attack-release envelope — sustained shape with gate control'],
];

const tidesEngines: EngineDef[] = TIDES_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: tidesControls(),
}));

// --- Tides instrument definition ---

export const tidesInstrument: InstrumentDef = {
  type: 'modulator',
  label: 'Mutable Instruments Tides',
  adapterId: 'tides',
  engines: tidesEngines,
};

const tidesEngineByIdMap = new Map<string, EngineDef>(
  tidesEngines.map(e => [e.id, e]),
);

export function getTidesEngineById(engineId: string): EngineDef | undefined {
  return tidesEngineByIdMap.get(engineId);
}

export function getTidesEngineByIndex(index: number): EngineDef | undefined {
  return tidesEngines[index];
}

export function getTidesModelList(): { index: number; name: string; description: string }[] {
  return tidesEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}

// --- Processor registry ---

const processorInstruments = new Map<string, InstrumentDef>([
  ['rings', ringsInstrument],
  ['clouds', cloudsInstrument],
]);

/** Get the instrument definition for a processor type */
export function getProcessorInstrument(type: string): InstrumentDef | undefined {
  return processorInstruments.get(type);
}

/** Get valid control IDs for a processor type */
export function getProcessorControlIds(type: string): string[] {
  const inst = processorInstruments.get(type);
  if (!inst || inst.engines.length === 0) return [];
  return inst.engines[0].controls.map(c => c.id);
}

/** Get all registered processor type names */
export function getRegisteredProcessorTypes(): string[] {
  return Array.from(processorInstruments.keys());
}

// --- Modulator registry ---

const modulatorInstruments = new Map<string, InstrumentDef>([
  ['tides', tidesInstrument],
]);

/** Get the instrument definition for a modulator type */
export function getModulatorInstrument(type: string): InstrumentDef | undefined {
  return modulatorInstruments.get(type);
}

/** Get valid control IDs for a modulator type */
export function getModulatorControlIds(type: string): string[] {
  const inst = modulatorInstruments.get(type);
  if (!inst || inst.engines.length === 0) return [];
  return inst.engines[0].controls.map(c => c.id);
}

/** Get all registered modulator type names */
export function getRegisteredModulatorTypes(): string[] {
  return Array.from(modulatorInstruments.keys());
}

/** Look up a modulator engine (model/mode) by name, returning its index */
export function getModulatorEngineByName(type: string, name: string): { index: number; engine: EngineDef } | undefined {
  const inst = modulatorInstruments.get(type);
  if (!inst) return undefined;
  const index = inst.engines.findIndex(e => e.id === name);
  if (index < 0) return undefined;
  return { index, engine: inst.engines[index] };
}

/** Get the engine name for a modulator type by index */
export function getModulatorEngineName(type: string, index: number): string | undefined {
  const inst = modulatorInstruments.get(type);
  return inst?.engines[index]?.id;
}

/** Look up a processor engine (model/mode) by name, returning its index */
export function getProcessorEngineByName(type: string, name: string): { index: number; engine: EngineDef } | undefined {
  const inst = processorInstruments.get(type);
  if (!inst) return undefined;
  const index = inst.engines.findIndex(e => e.id === name);
  if (index < 0) return undefined;
  return { index, engine: inst.engines[index] };
}

/** Get the engine name for a processor type by index */
export function getProcessorEngineName(type: string, index: number): string | undefined {
  const inst = processorInstruments.get(type);
  return inst?.engines[index]?.id;
}
