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

export interface Transport {
  status: 'stopped' | 'playing' | 'paused';
  playing: boolean;
  bpm: number;
  swing: number;
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
