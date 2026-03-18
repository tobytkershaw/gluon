export interface ChorusPatchParams {
  rate: number;
  depth: number;
  feedback: number;
  mix: number;
  stereo: number;
}

export interface ChorusPatchMessage {
  type: 'set-patch';
  patch: ChorusPatchParams;
  time?: number;
}

export interface ChorusModeMessage {
  type: 'set-mode';
  mode: number;
  time?: number;
}

export interface ChorusClearScheduledMessage {
  type: 'clear-scheduled';
  fence: number;
}

export interface ChorusDestroyMessage {
  type: 'destroy';
}

export type ChorusProcessorCommand =
  | ChorusPatchMessage
  | ChorusModeMessage
  | ChorusClearScheduledMessage
  | ChorusDestroyMessage;

export interface ChorusProcessorReady {
  type: 'ready';
}

export interface ChorusProcessorError {
  type: 'error';
  message: string;
}

export type ChorusProcessorStatus = ChorusProcessorReady | ChorusProcessorError;
