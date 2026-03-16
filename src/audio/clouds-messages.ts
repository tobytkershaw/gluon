export interface CloudsPatchMessage {
  type: 'set-patch';
  patch: CloudsPatchParams;
  time?: number;
}

export interface CloudsModeMessage {
  type: 'set-mode';
  mode: number;
  time?: number;
}

export interface CloudsFreezeMessage {
  type: 'set-freeze';
  freeze: boolean;
  time?: number;
}

export interface CloudsClearScheduledMessage {
  type: 'clear-scheduled';
  fence: number;
}

export interface CloudsDestroyMessage {
  type: 'destroy';
}

export type CloudsProcessorCommand =
  | CloudsPatchMessage
  | CloudsExtendedMessage
  | CloudsModeMessage
  | CloudsFreezeMessage
  | CloudsClearScheduledMessage
  | CloudsDestroyMessage;

export interface CloudsProcessorReady {
  type: 'ready';
}

export interface CloudsProcessorError {
  type: 'error';
  message: string;
}

export type CloudsProcessorStatus = CloudsProcessorReady | CloudsProcessorError;

export interface CloudsPatchParams {
  position: number;
  size: number;
  density: number;
  feedback: number;
}

export interface CloudsExtendedParams {
  texture: number;
  pitch: number;
  dry_wet: number;
  stereo_spread: number;
  reverb: number;
}

export interface CloudsExtendedMessage {
  type: 'set-extended';
  extended: CloudsExtendedParams;
  time?: number;
}
