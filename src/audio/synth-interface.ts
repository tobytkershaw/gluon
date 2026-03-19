// src/audio/synth-interface.ts
import type { ScheduledNote } from '../engine/sequencer-types';
import type { PlaitsExtendedParams } from './plaits-messages';
import { getModelList } from './instrument-registry';

export interface SynthEngine {
  setModel(model: number): void;
  setParams(params: SynthParams): void;
  /** Set Plaits-specific extended parameters (FM, LPG, etc.).
   *  Optional — only implemented by PlaitsSynth. */
  setExtended?(params: PlaitsExtendedParams): void;
  /** Set portamento (pitch glide) time and mode.
   *  Optional — only implemented by PlaitsSynth. */
  setPortamento?(time: number, mode: number): void;
  scheduleNote(note: ScheduledNote, fence?: number): void;
  /** Immediately close gate and clear all scheduled events.
   *  @param fence  Monotonic sequence fence — worklet only clears events with fence < this value.
   */
  silence(fence?: number): void;
  destroy(): void;
  /** The underlying AudioWorkletNode, if available (for modulation routing). */
  readonly workletNode?: AudioWorkletNode;
}

export interface SynthParams {
  harmonics: number;
  timbre: number;
  morph: number;
  note: number;
}

export const PLAITS_MODELS = getModelList();

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
