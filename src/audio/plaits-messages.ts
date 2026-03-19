import type { SynthParams } from './synth-interface';

export interface PlaitsPatchMessage {
  type: 'set-patch';
  patch: SynthParams;
  time?: number;
  fence?: number;
}

export interface PlaitsExtendedParams {
  fm_amount: number;
  timbre_mod_amount: number;
  morph_mod_amount: number;
  decay: number;
  lpg_colour: number;
}

export interface PlaitsExtendedMessage {
  type: 'set-extended';
  extended: PlaitsExtendedParams;
  time?: number;
  fence?: number;
}

export interface PlaitsModelMessage {
  type: 'set-model';
  model: number;
  time?: number;
}

export interface PlaitsTriggerMessage {
  type: 'trigger';
  time: number;
  accentLevel: number;
  fence?: number;
}

export interface PlaitsGateMessage {
  type: 'set-gate';
  time?: number;
  open: boolean;
  fence?: number;
}

export interface PlaitsClearScheduledMessage {
  type: 'clear-scheduled';
  fence: number;
}

export interface PlaitsPortamentoMessage {
  type: 'set-portamento';
  time: number;   // 0-1 normalised (maps to 0-500ms)
  mode: number;   // 0=off, 1=always, 2=legato-only
}

export interface PlaitsDestroyMessage {
  type: 'destroy';
}

export type PlaitsProcessorCommand =
  | PlaitsPatchMessage
  | PlaitsExtendedMessage
  | PlaitsModelMessage
  | PlaitsTriggerMessage
  | PlaitsGateMessage
  | PlaitsPortamentoMessage
  | PlaitsClearScheduledMessage
  | PlaitsDestroyMessage;

export interface PlaitsProcessorReady {
  type: 'ready';
}

export interface PlaitsProcessorError {
  type: 'error';
  message: string;
}

export type PlaitsProcessorStatus = PlaitsProcessorReady | PlaitsProcessorError;
