import type { SynthParams } from './synth-interface';

export interface PlaitsPatchMessage {
  type: 'set-patch';
  patch: SynthParams;
  time?: number;
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
}

export interface PlaitsGateMessage {
  type: 'set-gate';
  time?: number;
  open: boolean;
}

export interface PlaitsClearScheduledMessage {
  type: 'clear-scheduled';
}

export interface PlaitsDestroyMessage {
  type: 'destroy';
}

export type PlaitsProcessorCommand =
  | PlaitsPatchMessage
  | PlaitsModelMessage
  | PlaitsTriggerMessage
  | PlaitsGateMessage
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
