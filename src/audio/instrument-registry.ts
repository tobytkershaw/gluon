// src/audio/instrument-registry.ts
import type {
  ControlKind,
  SemanticRole,
  ControlSchema,
  ControlBinding,
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

// --- Plaits extended parameters (exposed via _plaits_set_extended) ---

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

// --- Rings extended parameters (exposed via _rings_set_fine_tune) ---

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
  if (index < 0) return 'No Source';
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

// --- Clouds extended parameters (exposed via _clouds_set_extended) ---

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
      adapterId: 'tides',
      path: `params.${id}`,
    },
    displayMapping,
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
      'large',
      { type: 'log', min: 0.05, max: 100, unit: 'Hz', decimals: 1 },
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
    // --- Extended parameters (via _tides_set_extended) ---
    makeTidesControl(
      'shift',
      'Shift',
      'texture',
      'Multi-channel phase spread. Controls the phase offset between output channels.',
      0.0,
      'small',
    ),
    {
      id: 'output-mode',
      name: 'Output Mode',
      kind: 'discrete' as ControlKind,
      semanticRole: 'body',
      description: 'Output signal type: gates (0), amplitude (1), slope/phase (2), frequency (3).',
      readable: true,
      writable: true,
      range: { min: 0, max: 3, default: 1 },
      size: 'small',
      binding: {
        adapterId: 'tides',
        path: 'params.output-mode',
      },
    } as ControlSchema,
    {
      id: 'range',
      name: 'Range',
      kind: 'discrete' as ControlKind,
      semanticRole: 'pitch',
      description: 'Operating range: control rate (0) for LFO use, audio rate (1) for oscillator use.',
      readable: true,
      writable: true,
      range: { min: 0, max: 1, default: 0 },
      size: 'small',
      binding: {
        adapterId: 'tides',
        path: 'params.range',
      },
    } as ControlSchema,
  ];
}

// --- Tides extended parameters (exposed via _tides_set_extended) ---

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

// --- Ripples control factory ---

function makeRipplesControl(
// --- EQ control factory ---

function makeEqControl(
// --- Compressor control factory ---

function makeCompressorControl(
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
      adapterId: 'ripples',
      adapterId: 'eq',
      adapterId: 'compressor',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function ripplesControls(): ControlSchema[] {
  return [
    makeRipplesControl(
      'cutoff',
      'Cutoff',
      'brightness',
      'Filter cutoff frequency. Low values are dark and muffled, high values let everything through.',
      0.5,
      'large',
      { type: 'log', min: 20, max: 20000, unit: 'Hz', decimals: 0 },
    ),
    makeRipplesControl(
      'resonance',
      'Resonance',
      'resonance',
      'Filter resonance / Q. Emphasises frequencies around the cutoff. At maximum, the filter self-oscillates.',
      0.0,
    ),
    makeRipplesControl(
      'drive',
      'Drive',
      'drive',
      'Input saturation before filtering. Adds warmth and harmonics at low values, distortion at high values.',
      0.0,
      'medium',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
function eqControls(): ControlSchema[] {
  return [
    makeEqControl(
      'low-freq',
      'Low Freq',
      'brightness',
      'Low shelf frequency. 0.0 = 20Hz, 1.0 = 500Hz. Controls where the low shelf takes effect.',
      0.25,
      'medium',
      { type: 'log', min: 20, max: 500, unit: 'Hz', decimals: 0 },
    ),
    makeEqControl(
      'low-gain',
      'Low Gain',
      'level',
      'Low shelf gain. 0.0 = -18dB, 0.5 = unity (0dB), 1.0 = +18dB. Cut low end to reduce mud, boost for warmth.',
      0.5,
      'large',
      { type: 'linear', min: -18, max: 18, unit: 'dB', decimals: 1 },
    ),
    makeEqControl(
      'mid1-freq',
      'Mid 1 Freq',
      'brightness',
      'Mid band 1 center frequency. 0.0 = 100Hz, 1.0 = 8kHz. Target specific frequency ranges.',
      0.4,
      'medium',
      { type: 'log', min: 100, max: 8000, unit: 'Hz', decimals: 0 },
    ),
    makeEqControl(
      'mid1-gain',
      'Mid 1 Gain',
      'level',
      'Mid band 1 gain. 0.0 = -18dB, 0.5 = unity, 1.0 = +18dB. Cut to remove problem frequencies, boost for presence.',
      0.5,
      'large',
      { type: 'linear', min: -18, max: 18, unit: 'dB', decimals: 1 },
    ),
    makeEqControl(
      'mid1-q',
      'Mid 1 Q',
      'resonance',
      'Mid band 1 bandwidth. 0.0 = wide (0.1), 1.0 = narrow (18). Narrow Q for surgical cuts, wide for gentle shaping.',
      0.3,
      'small',
      { type: 'log', min: 0.1, max: 18, unit: '', decimals: 1 },
    ),
    makeEqControl(
      'mid2-freq',
      'Mid 2 Freq',
      'brightness',
      'Mid band 2 center frequency. 0.0 = 100Hz, 1.0 = 8kHz. Second mid band for independent frequency targeting.',
      0.6,
      'medium',
      { type: 'log', min: 100, max: 8000, unit: 'Hz', decimals: 0 },
    ),
    makeEqControl(
      'mid2-gain',
      'Mid 2 Gain',
      'level',
      'Mid band 2 gain. 0.0 = -18dB, 0.5 = unity, 1.0 = +18dB.',
      0.5,
      'large',
      { type: 'linear', min: -18, max: 18, unit: 'dB', decimals: 1 },
    ),
    makeEqControl(
      'mid2-q',
      'Mid 2 Q',
      'resonance',
      'Mid band 2 bandwidth. 0.0 = wide (0.1), 1.0 = narrow (18).',
      0.3,
      'small',
      { type: 'log', min: 0.1, max: 18, unit: '', decimals: 1 },
    ),
    makeEqControl(
      'high-freq',
      'High Freq',
      'brightness',
      'High shelf frequency. 0.0 = 1kHz, 1.0 = 20kHz. Controls where the high shelf takes effect.',
      0.75,
      'medium',
      { type: 'log', min: 1000, max: 20000, unit: 'Hz', decimals: 0 },
    ),
    makeEqControl(
      'high-gain',
      'High Gain',
      'level',
      'High shelf gain. 0.0 = -18dB, 0.5 = unity, 1.0 = +18dB. Cut harshness or boost air/presence.',
      0.5,
      'large',
      { type: 'linear', min: -18, max: 18, unit: 'dB', decimals: 1 },
function compressorControls(): ControlSchema[] {
  return [
    makeCompressorControl(
      'threshold',
      'Threshold',
      'body',
      'Level above which compression begins. 0.0 is -60dB (heavy compression), 1.0 is 0dB (no compression).',
      0.5,
      'large',
      { type: 'dB', min: -60, max: 0, unit: 'dB', decimals: 1 },
    ),
    makeCompressorControl(
      'ratio',
      'Ratio',
      'body',
      'Compression ratio. Low values are gentle, high values are aggressive. In limiter mode this is overridden to brickwall.',
      0.3,
      'large',
      { type: 'linear', min: 1, max: 20, unit: ':1', decimals: 1 },
    ),
    makeCompressorControl(
      'attack',
      'Attack',
      'attack',
      'How fast the compressor reacts to signals above threshold. Low values are fast (punchy), high values are slow (transient-preserving).',
      0.3,
      'medium',
      { type: 'log', min: 0.1, max: 100, unit: 'ms', decimals: 1 },
    ),
    makeCompressorControl(
      'release',
      'Release',
      'decay',
      'How fast the compressor recovers after the signal drops below threshold. In opto mode this is program-dependent.',
      0.4,
      'medium',
      { type: 'log', min: 10, max: 1000, unit: 'ms', decimals: 0 },
    ),
    makeCompressorControl(
      'makeup',
      'Makeup',
      'body',
      'Output gain compensation. Restores level lost to compression.',
      0.0,
      'small',
      { type: 'linear', min: 0, max: 24, unit: 'dB', decimals: 1 },
    ),
    makeCompressorControl(
      'mix',
      'Mix',
      'body',
      'Dry/wet blend for parallel compression. 0 is fully dry, 1 is fully wet.',
      1.0,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
  ];
}

// --- Ripples engine definitions ---

const RIPPLES_ENGINE_DATA: [string, string, string][] = [
  ['lp2', '2-Pole Low-Pass', 'Gentle 12dB/oct low-pass filter — warm and smooth'],
  ['lp4', '4-Pole Low-Pass', 'Classic 24dB/oct low-pass filter — Moog-style, deep and resonant'],
  ['bp2', '2-Pole Band-Pass', 'Band-pass filter — vocal, resonant character'],
  ['hp2', '2-Pole High-Pass', 'High-pass filter — removes low end, thin and airy'],
];

const ripplesEngines: EngineDef[] = RIPPLES_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: ripplesControls(),
}));

// --- Ripples instrument definition ---

export const ripplesInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Mutable Instruments Ripples',
  adapterId: 'ripples',
  engines: ripplesEngines,
};

const ripplesEngineByIdMap = new Map<string, EngineDef>(
  ripplesEngines.map(e => [e.id, e]),
);

export function getRipplesEngineById(engineId: string): EngineDef | undefined {
  return ripplesEngineByIdMap.get(engineId);
}

export function getRipplesEngineByIndex(index: number): EngineDef | undefined {
  return ripplesEngines[index];
}

export function getRipplesModelList(): { index: number; name: string; description: string }[] {
  return ripplesEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
// --- EQ engine definitions ---

const EQ_ENGINE_DATA: [string, string, string][] = [
  ['4band', '4-Band Parametric', 'Low shelf + 2 peaking mids + high shelf — covers most mixing needs'],
  ['8band', '8-Band Parametric', 'Low shelf + 6 peaking mids + high shelf — surgical precision for complex corrections'],
];

const eqEngines: EngineDef[] = EQ_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: eqControls(),
}));

// --- EQ instrument definition ---

export const eqInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Parametric EQ',
  adapterId: 'eq',
  engines: eqEngines,
};

const eqEngineByIdMap = new Map<string, EngineDef>(
  eqEngines.map(e => [e.id, e]),
);

export function getEqEngineById(engineId: string): EngineDef | undefined {
  return eqEngineByIdMap.get(engineId);
}

export function getEqEngineByIndex(index: number): EngineDef | undefined {
  return eqEngines[index];
}

export function getEqModelList(): { index: number; name: string; description: string }[] {
  return eqEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
// --- Compressor engine definitions ---

const COMPRESSOR_ENGINE_DATA: [string, string, string][] = [
  ['clean', 'Clean', 'Transparent VCA compressor — precise, clinical dynamics control'],
  ['opto', 'Opto', 'Optical compressor character — smooth, program-dependent release (LA-2A style)'],
  ['bus', 'Bus', 'Bus/glue compressor — SSL-style with soft knee, punchy recovery'],
  ['limit', 'Limiter', 'Brickwall limiter — fast attack, high ratio safety net'],
];

const compressorEngines: EngineDef[] = COMPRESSOR_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: compressorControls(),
}));

// --- Compressor instrument definition ---

export const compressorInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Compressor',
  adapterId: 'compressor',
  engines: compressorEngines,
};

const compressorEngineByIdMap = new Map<string, EngineDef>(
  compressorEngines.map(e => [e.id, e]),
);

export function getCompressorEngineById(engineId: string): EngineDef | undefined {
  return compressorEngineByIdMap.get(engineId);
}

export function getCompressorEngineByIndex(index: number): EngineDef | undefined {
  return compressorEngines[index];
}

export function getCompressorModelList(): { index: number; name: string; description: string }[] {
  return compressorEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}

// --- Processor registry ---

const processorInstruments = new Map<string, InstrumentDef>([
  ['rings', ringsInstrument],
  ['clouds', cloudsInstrument],
  ['ripples', ripplesInstrument],
  ['eq', eqInstrument],
  ['compressor', compressorInstrument],
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

/** Look up a ControlSchema for a processor type by control ID */
export function getProcessorControlSchema(type: string, controlId: string): ControlSchema | undefined {
  const inst = processorInstruments.get(type);
  if (!inst || inst.engines.length === 0) return undefined;
  return inst.engines[0].controls.find(c => c.id === controlId);
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

/** Get default parameter values for a processor type at a given model index.
 *  Returns an empty object if the type or model is unrecognised. */
export function getProcessorDefaultParams(type: string, modelIndex: number): Record<string, number> {
  const inst = processorInstruments.get(type);
  const engine = inst?.engines[modelIndex];
  if (!engine) return {};
  const defaults: Record<string, number> = {};
  for (const c of engine.controls) {
    defaults[c.id] = c.range?.default ?? 0.5;
  }
  return defaults;
}

/** Get default parameter values for a modulator type at a given model index.
 *  Returns an empty object if the type or model is unrecognised. */
export function getModulatorDefaultParams(type: string, modelIndex: number): Record<string, number> {
  const inst = modulatorInstruments.get(type);
  const engine = inst?.engines[modelIndex];
  if (!engine) return {};
  const defaults: Record<string, number> = {};
  for (const c of engine.controls) {
    defaults[c.id] = c.range?.default ?? 0.5;
  }
  return defaults;
}
