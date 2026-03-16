// src/engine/sequencer-types.ts
import type { SynthParamValues } from './types';

export interface Step {
  gate: boolean;
  accent: boolean;
  params?: Partial<SynthParamValues>;
  micro: number;
}

export interface Pattern {
  steps: Step[];
  length: number;
}

export interface MetronomeState {
  enabled: boolean;
  volume: number; // 0.0–1.0
}

export interface Transport {
  status: 'stopped' | 'playing' | 'paused';
  playing: boolean;
  bpm: number;
  swing: number;
  metronome: MetronomeState;
  /** When true, playback wraps between loopStart and loopEnd instead of the full pattern. */
  loopEnabled?: boolean;
  /** Loop start position in steps (inclusive). Default: 0. */
  loopStart?: number;
  /** Loop end position in steps (exclusive). Default: patternLength. */
  loopEnd?: number;
  /** When set, next play should start from this step (consumed on play). */
  playFromStep?: number;
}

export interface ScheduledNote {
  eventId?: string;
  generation?: number;
  trackId: string;
  time: number;
  gateOffTime: number;
  accent: boolean;
  params: SynthParamValues;
  /** Base track params — if params matches this, no set-patch is sent (sync effect handles it). */
  baseParams?: SynthParamValues;
}

export interface PatternSketch {
  length?: number;
  steps: StepSketch[];
}

export interface StepSketch {
  index: number;
  gate?: boolean;
  accent?: boolean;
  params?: Partial<SynthParamValues>;
  micro?: number;
}
