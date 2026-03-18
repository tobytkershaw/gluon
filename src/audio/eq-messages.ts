export interface EqPatchParams {
  low_freq: number;
  low_gain: number;
  mid1_freq: number;
  mid1_gain: number;
  mid1_q: number;
  mid2_freq: number;
  mid2_gain: number;
  mid2_q: number;
  high_freq: number;
  high_gain: number;
}

export interface EqPatchMessage {
  type: 'set-patch';
  patch: EqPatchParams;
  time?: number;
}

export interface EqModeMessage {
  type: 'set-mode';
  mode: number;
  time?: number;
}

export interface EqClearScheduledMessage {
  type: 'clear-scheduled';
  fence: number;
}

export interface EqDestroyMessage {
  type: 'destroy';
}

export type EqProcessorCommand =
  | EqPatchMessage
  | EqModeMessage
  | EqClearScheduledMessage
  | EqDestroyMessage;

export interface EqProcessorReady {
  type: 'ready';
}

export interface EqProcessorError {
  type: 'error';
  message: string;
}

export type EqProcessorStatus = EqProcessorReady | EqProcessorError;
