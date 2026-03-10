// src/audio/synth-interface.ts

export interface SynthEngine {
  setModel(model: number): void;
  setParams(params: SynthParams): void;
  render(output: Float32Array): Float32Array;
  trigger(): void;              // restart envelope/exciter
  setGateOpen(open: boolean): void;  // for sustained note models
  destroy(): void;
}

export interface SynthParams {
  harmonics: number;
  timbre: number;
  morph: number;
  note: number;
}

export const PLAITS_MODELS = [
  { index: 0, name: 'Virtual Analog', description: 'VA oscillator with variable waveshape' },
  { index: 1, name: 'Waveshaping', description: 'Waveshaping oscillator' },
  { index: 2, name: 'FM', description: '2-operator FM synthesis' },
  { index: 3, name: 'Grain/Formant', description: 'Granular formant oscillator' },
  { index: 4, name: 'Harmonic', description: 'Additive harmonic oscillator' },
  { index: 5, name: 'Wavetable', description: 'Wavetable oscillator' },
  { index: 6, name: 'Chords', description: 'Chord engine' },
  { index: 7, name: 'Vowel/Speech', description: 'Speech synthesis' },
  { index: 8, name: 'Swarm', description: 'Swarm of 8 sawtooth oscillators' },
  { index: 9, name: 'Filtered Noise', description: 'Filtered noise generator' },
  { index: 10, name: 'Particle/Dust', description: 'Particle noise (dust)' },
  { index: 11, name: 'Inharmonic String', description: 'Inharmonic string model' },
  { index: 12, name: 'Modal Resonator', description: 'Struck objects, bells' },
  { index: 13, name: 'Analog Bass Drum', description: 'Analog bass drum' },
  { index: 14, name: 'Analog Snare', description: 'Analog snare drum' },
  { index: 15, name: 'Analog Hi-Hat', description: 'Analog hi-hat' },
] as const;

export const DEFAULT_PARAMS: SynthParams = {
  harmonics: 0.5,
  timbre: 0.5,
  morph: 0.5,
  note: 0.47,
};

export function noteToHz(note: number): number {
  const midiNote = note * 127;
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

export function midiToNote(midi: number): number {
  return Math.max(0, Math.min(1, midi / 127));
}
