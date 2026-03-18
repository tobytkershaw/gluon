// src/engine/timbral-vocabulary.ts
// Maps musical timbral descriptors to parameter deltas for each synthesis model.

export type TimbralDirection =
  | 'darker' | 'brighter'
  | 'thicker' | 'thinner'
  | 'aggressive' | 'gentle'
  | 'metallic' | 'organic'
  | 'dry' | 'wet'
  | 'open' | 'closed'
  | 'smooth' | 'rough'
  | 'hollow' | 'full';

export interface TimbralVector {
  params: Record<string, number>;  // parameter deltas to apply
  processors?: { type: string; param: string; delta: number }[];
}

// ---------------------------------------------------------------------------
// Per-model timbral mappings — keyed by Plaits engine ID
// Engine IDs from instrument-registry-plaits.ts ENGINE_DATA
// ---------------------------------------------------------------------------

const PLAITS_VECTORS: Record<string, Partial<Record<TimbralDirection, TimbralVector>>> = {
  // Virtual Analog (VA oscillator with variable waveshape)
  'virtual-analog': {
    darker:     { params: { timbre: -0.2 } },
    brighter:   { params: { timbre: 0.15 } },
    thicker:    { params: { harmonics: 0.15 } },
    thinner:    { params: { harmonics: -0.15 } },
    aggressive: { params: { timbre: 0.2, harmonics: 0.1 } },
    gentle:     { params: { timbre: -0.15, harmonics: -0.05 } },
    smooth:     { params: { morph: -0.15 } },
    rough:      { params: { morph: 0.2 } },
    full:       { params: { harmonics: 0.2, morph: 0.1 } },
    hollow:     { params: { harmonics: -0.15, morph: -0.1 } },
  },

  // Waveshaping oscillator
  'waveshaping': {
    darker:     { params: { timbre: -0.2 } },
    brighter:   { params: { timbre: 0.15, morph: 0.05 } },
    aggressive: { params: { timbre: 0.25, harmonics: 0.15 } },
    gentle:     { params: { timbre: -0.2, harmonics: -0.1 } },
    smooth:     { params: { morph: -0.15 } },
    rough:      { params: { morph: 0.2, timbre: 0.1 } },
    full:       { params: { harmonics: 0.2 } },
    hollow:     { params: { harmonics: -0.2 } },
  },

  // 2-operator FM synthesis
  'fm': {
    darker:     { params: { timbre: -0.15, morph: -0.1 } },
    brighter:   { params: { timbre: 0.15 } },
    metallic:   { params: { timbre: 0.2, harmonics: 0.15 } },
    organic:    { params: { timbre: -0.1, harmonics: -0.1 } },
    aggressive: { params: { timbre: 0.2, morph: 0.15 } },
    gentle:     { params: { timbre: -0.15, morph: -0.1 } },
    thicker:    { params: { harmonics: 0.15, morph: 0.1 } },
    thinner:    { params: { harmonics: -0.15, morph: -0.05 } },
  },

  // Granular formant oscillator
  'grain-formant': {
    darker:     { params: { timbre: -0.2 } },
    brighter:   { params: { timbre: 0.2 } },
    smooth:     { params: { morph: -0.15 } },
    rough:      { params: { morph: 0.2, harmonics: 0.1 } },
    open:       { params: { timbre: 0.15, harmonics: 0.1 } },
    closed:     { params: { timbre: -0.15, harmonics: -0.1 } },
    thicker:    { params: { harmonics: 0.2 } },
    thinner:    { params: { harmonics: -0.2 } },
  },

  // Additive harmonic oscillator
  'harmonic': {
    darker:     { params: { timbre: -0.2 } },
    brighter:   { params: { timbre: 0.2 } },
    thicker:    { params: { harmonics: 0.2, morph: 0.1 } },
    thinner:    { params: { harmonics: -0.2 } },
    full:       { params: { harmonics: 0.2, morph: 0.15 } },
    hollow:     { params: { harmonics: -0.15, morph: -0.1 } },
    smooth:     { params: { morph: -0.15 } },
    rough:      { params: { morph: 0.2 } },
  },

  // Wavetable oscillator
  'wavetable': {
    darker:     { params: { timbre: -0.2, morph: -0.1 } },
    brighter:   { params: { timbre: 0.15 } },
    smooth:     { params: { morph: -0.2 } },
    rough:      { params: { morph: 0.2 } },
    thicker:    { params: { harmonics: 0.15 } },
    thinner:    { params: { harmonics: -0.15 } },
    metallic:   { params: { timbre: 0.15, morph: 0.15 } },
    organic:    { params: { morph: -0.1, harmonics: -0.05 } },
  },

  // Chord engine
  'chords': {
    darker:     { params: { timbre: -0.15 } },
    brighter:   { params: { timbre: 0.15 } },
    thicker:    { params: { harmonics: 0.2 } },
    thinner:    { params: { harmonics: -0.2 } },
    open:       { params: { morph: 0.15, harmonics: 0.1 } },
    closed:     { params: { morph: -0.15, harmonics: -0.1 } },
    full:       { params: { harmonics: 0.2, timbre: 0.05 } },
    hollow:     { params: { harmonics: -0.15, timbre: -0.1 } },
  },

  // Speech synthesis
  'vowel-speech': {
    darker:     { params: { timbre: -0.2 } },
    brighter:   { params: { timbre: 0.2 } },
    open:       { params: { morph: 0.2, timbre: 0.1 } },
    closed:     { params: { morph: -0.2, timbre: -0.1 } },
    smooth:     { params: { harmonics: -0.15 } },
    rough:      { params: { harmonics: 0.2 } },
    thicker:    { params: { harmonics: 0.15, morph: 0.1 } },
    thinner:    { params: { harmonics: -0.15 } },
  },

  // Swarm of 8 sawtooth oscillators
  'swarm': {
    darker:     { params: { timbre: -0.15 } },
    brighter:   { params: { timbre: 0.15 } },
    thicker:    { params: { harmonics: 0.2, morph: 0.1 } },
    thinner:    { params: { harmonics: -0.2 } },
    aggressive: { params: { timbre: 0.2, harmonics: 0.15, morph: 0.1 } },
    gentle:     { params: { timbre: -0.15, harmonics: -0.1, morph: -0.1 } },
    smooth:     { params: { morph: -0.2 } },
    rough:      { params: { morph: 0.2, timbre: 0.1 } },
  },

  // Filtered noise generator
  'filtered-noise': {
    darker:     { params: { timbre: -0.2, harmonics: -0.1 } },
    brighter:   { params: { timbre: 0.2 } },
    smooth:     { params: { morph: -0.2 } },
    rough:      { params: { morph: 0.2, harmonics: 0.15 } },
    thicker:    { params: { harmonics: 0.2 } },
    thinner:    { params: { harmonics: -0.2 } },
    dry:        { params: { morph: -0.15, timbre: -0.1 } },
    wet:        { params: { morph: 0.15, harmonics: 0.1 } },
  },

  // Particle noise (dust)
  'particle-dust': {
    darker:     { params: { timbre: -0.2 } },
    brighter:   { params: { timbre: 0.2 } },
    smooth:     { params: { morph: -0.2, harmonics: -0.1 } },
    rough:      { params: { morph: 0.2, harmonics: 0.15 } },
    thicker:    { params: { harmonics: 0.2 } },
    thinner:    { params: { harmonics: -0.2 } },
    dry:        { params: { morph: -0.15 } },
    wet:        { params: { morph: 0.15 } },
  },

  // Inharmonic string model
  'inharmonic-string': {
    darker:     { params: { timbre: -0.2 } },
    brighter:   { params: { timbre: 0.15, harmonics: 0.1 } },
    metallic:   { params: { harmonics: 0.2, timbre: 0.15 } },
    organic:    { params: { harmonics: -0.15, timbre: -0.1 } },
    smooth:     { params: { morph: -0.15 } },
    rough:      { params: { morph: 0.2 } },
    thicker:    { params: { harmonics: 0.15, morph: 0.1 } },
    thinner:    { params: { harmonics: -0.15 } },
  },

  // Modal resonator (struck objects, bells)
  'modal-resonator': {
    darker:     { params: { timbre: -0.2, harmonics: -0.1 } },
    brighter:   { params: { timbre: 0.2 } },
    metallic:   { params: { harmonics: 0.2, timbre: 0.15 } },
    organic:    { params: { harmonics: -0.15, timbre: -0.1 } },
    smooth:     { params: { morph: -0.2 } },
    rough:      { params: { morph: 0.2, harmonics: 0.1 } },
    full:       { params: { harmonics: 0.15, morph: 0.1 } },
    hollow:     { params: { harmonics: -0.2, morph: -0.1 } },
  },

  // Analog bass drum
  'analog-bass-drum': {
    darker:     { params: { timbre: -0.15, morph: -0.1 } },
    brighter:   { params: { timbre: 0.15 } },
    thicker:    { params: { harmonics: 0.2 } },
    thinner:    { params: { harmonics: -0.2 } },
    aggressive: { params: { timbre: 0.2, morph: 0.15 } },
    gentle:     { params: { timbre: -0.15, morph: -0.15 } },
    full:       { params: { harmonics: 0.15, morph: 0.1 } },
    hollow:     { params: { harmonics: -0.15 } },
  },

  // Analog snare drum
  'analog-snare': {
    darker:     { params: { timbre: -0.15 } },
    brighter:   { params: { timbre: 0.15, morph: 0.1 } },
    aggressive: { params: { morph: 0.2, timbre: 0.1 } },
    gentle:     { params: { morph: -0.2, timbre: -0.1 } },
    thicker:    { params: { harmonics: 0.15 } },
    thinner:    { params: { harmonics: -0.15 } },
    dry:        { params: { morph: -0.15 } },
    wet:        { params: { morph: 0.15 } },
  },

  // Analog hi-hat
  'analog-hi-hat': {
    darker:     { params: { timbre: -0.2 } },
    brighter:   { params: { timbre: 0.2 } },
    metallic:   { params: { harmonics: 0.2, timbre: 0.15 } },
    organic:    { params: { harmonics: -0.15 } },
    open:       { params: { morph: 0.2 } },
    closed:     { params: { morph: -0.2 } },
    smooth:     { params: { harmonics: -0.1, timbre: -0.05 } },
    rough:      { params: { harmonics: 0.15, timbre: 0.1 } },
  },
};

// ---------------------------------------------------------------------------
// Processor-level timbral vectors
// ---------------------------------------------------------------------------

const PROCESSOR_VECTORS: Record<string, Partial<Record<TimbralDirection, TimbralVector>>> = {
  ripples: {
    darker:   { params: { cutoff: -0.2 } },
    brighter: { params: { cutoff: 0.15, resonance: 0.05 } },
    smooth:   { params: { resonance: -0.1 } },
    rough:    { params: { resonance: 0.15 } },
    open:     { params: { cutoff: 0.2 } },
    closed:   { params: { cutoff: -0.2, resonance: -0.05 } },
    thicker:  { params: { resonance: 0.1, cutoff: -0.05 } },
    thinner:  { params: { resonance: -0.1, cutoff: 0.1 } },
  },
  eq: {
    darker:   { params: { high_gain: -0.15 } },
    brighter: { params: { high_gain: 0.15, mid_gain: 0.05 } },
    thicker:  { params: { low_gain: 0.15 } },
    thinner:  { params: { low_gain: -0.15 } },
    full:     { params: { low_gain: 0.1, mid_gain: 0.05, high_gain: 0.05 } },
    hollow:   { params: { mid_gain: -0.15 } },
  },
  clouds: {
    dry:    { params: { mix: -0.2 } },
    wet:    { params: { mix: 0.2 } },
    smooth: { params: { texture: -0.15 } },
    rough:  { params: { texture: 0.2 } },
    darker: { params: { texture: -0.1, mix: -0.05 } },
    brighter: { params: { texture: 0.15 } },
  },
  compressor: {
    aggressive: { params: { threshold: -0.15, ratio: 0.15 } },
    gentle:     { params: { threshold: 0.15, ratio: -0.1 } },
  },
};

// ---------------------------------------------------------------------------
// All timbral directions
// ---------------------------------------------------------------------------

const ALL_DIRECTIONS: TimbralDirection[] = [
  'darker', 'brighter',
  'thicker', 'thinner',
  'aggressive', 'gentle',
  'metallic', 'organic',
  'dry', 'wet',
  'open', 'closed',
  'smooth', 'rough',
  'hollow', 'full',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the timbral vector for a Plaits engine and direction. */
export function getTimbralVector(engineId: string, direction: TimbralDirection): TimbralVector | undefined {
  return PLAITS_VECTORS[engineId]?.[direction];
}

/** Get the timbral vector for a processor type and direction. */
export function getProcessorTimbralVector(processorType: string, direction: TimbralDirection): TimbralVector | undefined {
  return PROCESSOR_VECTORS[processorType]?.[direction];
}

/** Return all valid timbral directions. */
export function getTimbralDirections(): TimbralDirection[] {
  return [...ALL_DIRECTIONS];
}

/**
 * Resolve a timbral move to actual parameter deltas, scaled by amount.
 * Returns an array of { param, delta } entries ready to apply.
 * Returns empty array if no vector exists for the engine/direction combo.
 */
export function resolveTimbralMove(
  engineId: string,
  direction: TimbralDirection,
  amount: number,
): { param: string; delta: number }[] {
  const vector = getTimbralVector(engineId, direction);
  if (!vector) return [];

  return Object.entries(vector.params).map(([param, baseDelta]) => ({
    param,
    delta: baseDelta * amount,
  }));
}
