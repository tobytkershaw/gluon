import type { SynthParams } from './synth-interface';

export interface PlaitsPatchMessage {
  type: 'set-patch';
  patch: SynthParams;
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
