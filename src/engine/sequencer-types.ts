// src/engine/sequencer-types.ts
import type { SynthParamValues } from './types';

export interface Step {
  gate: boolean;
  accent: boolean;
  params?: Partial<SynthParamValues>;
  micro: number;
}

/** Derived step-grid cache — read-only projection from canonical Pattern events. */
export interface StepGrid {
  steps: Step[];
  length: number;
}

export type TransportMode = 'pattern' | 'song';

export interface MetronomeState {
  enabled: boolean;
  volume: number; // 0.0–1.0
}

export interface TimeSignature {
  /** Beats per bar (numerator). Default: 4. */
  numerator: number;
  /** Beat unit (denominator). Default: 4 (quarter note). */
  denominator: number;
}

export interface Transport {
  status: 'stopped' | 'playing' | 'paused';
  bpm: number;
  swing: number;
  metronome: MetronomeState;
  /** Time signature. Default: 4/4. */
  timeSignature: TimeSignature;
  /** Transport mode: 'pattern' loops active pattern, 'song' walks sequence. Default: 'pattern'. */
  mode?: TransportMode;
}

export interface TransportCommand {
  kind: 'play-from-step';
  step: number;
  requestId: number;
}

/** A reference to a pattern within a track's sequence (arrangement). */
export interface PatternRef {
  patternId: string;
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

export interface ScheduledParameterEvent {
  trackId: string;
  controlId: string;
  value: number | string | boolean;
  time: number;
}

export interface StepGridSketch {
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
