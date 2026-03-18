export interface WarpsPatchParams {
  algorithm: number;
  timbre: number;
  level: number;
}

export interface WarpsPatchMessage {
  type: 'set-patch';
  patch: WarpsPatchParams;
  time?: number;
}

export interface WarpsModelMessage {
  type: 'set-model';
  model: number;
  time?: number;
}

export interface WarpsClearScheduledMessage {
  type: 'clear-scheduled';
  fence: number;
}

export interface WarpsDestroyMessage {
  type: 'destroy';
}

export type WarpsProcessorCommand =
  | WarpsPatchMessage
  | WarpsModelMessage
  | WarpsClearScheduledMessage
  | WarpsDestroyMessage;

export interface WarpsProcessorReady {
  type: 'ready';
}

export interface WarpsProcessorError {
  type: 'error';
  message: string;
}

export type WarpsProcessorStatus = WarpsProcessorReady | WarpsProcessorError;
