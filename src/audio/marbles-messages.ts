export interface MarblesPatchParams {
  rate: number;
  spread: number;
  bias: number;
  steps: number;
  deja_vu: number;
  length: number;
}

export interface MarblesPatchMessage {
  type: 'set-patch';
  patch: MarblesPatchParams;
}

export interface MarblesModeMessage {
  type: 'set-mode';
  mode: number; // 0=voltage, 1=gate, 2=both
}

export interface MarblesClearScheduledMessage {
  type: 'clear-scheduled';
}

export interface MarblesDestroyMessage {
  type: 'destroy';
}

export interface MarblesPauseMessage {
  type: 'pause';
}

export interface MarblesResumeMessage {
  type: 'resume';
}

export type MarblesProcessorCommand =
  | MarblesPatchMessage
  | MarblesModeMessage
  | MarblesClearScheduledMessage
  | MarblesDestroyMessage
  | MarblesPauseMessage
  | MarblesResumeMessage;

export interface MarblesProcessorReady {
  type: 'ready';
}

export interface MarblesProcessorError {
  type: 'error';
  message: string;
}

export type MarblesProcessorStatus = MarblesProcessorReady | MarblesProcessorError;
