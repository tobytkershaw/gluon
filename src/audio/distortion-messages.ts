export interface DistortionPatchParams {
  drive: number;
  tone: number;
  mix: number;
  bits: number;
  downsample: number;
}

export interface DistortionPatchMessage {
  type: 'set-patch';
  patch: DistortionPatchParams;
  time?: number;
}

export interface DistortionModeMessage {
  type: 'set-mode';
  mode: number;
  time?: number;
}

export interface DistortionClearScheduledMessage {
  type: 'clear-scheduled';
  fence: number;
}

export interface DistortionDestroyMessage {
  type: 'destroy';
}

export type DistortionProcessorCommand =
  | DistortionPatchMessage
  | DistortionModeMessage
  | DistortionClearScheduledMessage
  | DistortionDestroyMessage;

export interface DistortionProcessorReady {
  type: 'ready';
}

export interface DistortionProcessorError {
  type: 'error';
  message: string;
}

export type DistortionProcessorStatus = DistortionProcessorReady | DistortionProcessorError;
