export interface StereoPatchParams {
  width: number;
  mid_gain: number;
  side_gain: number;
  delay: number;
}

export interface StereoPatchMessage {
  type: 'set-patch';
  patch: StereoPatchParams;
  time?: number;
}

export interface StereoModeMessage {
  type: 'set-mode';
  mode: number;
  time?: number;
}

export interface StereoClearScheduledMessage {
  type: 'clear-scheduled';
  fence: number;
}

export interface StereoDestroyMessage {
  type: 'destroy';
}

export type StereoProcessorCommand =
  | StereoPatchMessage
  | StereoModeMessage
  | StereoClearScheduledMessage
  | StereoDestroyMessage;

export interface StereoProcessorReady {
  type: 'ready';
}

export interface StereoProcessorError {
  type: 'error';
  message: string;
}

export type StereoProcessorStatus = StereoProcessorReady | StereoProcessorError;
