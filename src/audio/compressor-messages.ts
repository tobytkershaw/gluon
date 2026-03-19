export interface CompressorPatchParams {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  makeup: number;
  mix: number;
}

export interface CompressorPatchMessage {
  type: 'set-patch';
  patch: CompressorPatchParams;
  time?: number;
}

export interface CompressorModeMessage {
  type: 'set-mode';
  mode: number;
  time?: number;
}

export interface CompressorClearScheduledMessage {
  type: 'clear-scheduled';
  fence: number;
}

export interface CompressorDestroyMessage {
  type: 'destroy';
}

export interface CompressorSidechainMessage {
  type: 'sidechain';
  enabled: boolean;
}

export type CompressorProcessorCommand =
  | CompressorPatchMessage
  | CompressorModeMessage
  | CompressorClearScheduledMessage
  | CompressorDestroyMessage
  | CompressorSidechainMessage;

export interface CompressorProcessorReady {
  type: 'ready';
}

export interface CompressorProcessorError {
  type: 'error';
  message: string;
}

export type CompressorProcessorStatus = CompressorProcessorReady | CompressorProcessorError;
