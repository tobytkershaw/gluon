export interface BeadsPatchMessage {
  type: 'set-patch';
  patch: BeadsPatchParams;
  time?: number;
}

export interface BeadsModelMessage {
  type: 'set-model';
  model: number;
  time?: number;
}

export interface BeadsClearScheduledMessage {
  type: 'clear-scheduled';
  fence: number;
}

export interface BeadsDestroyMessage {
  type: 'destroy';
}

export type BeadsProcessorCommand =
  | BeadsPatchMessage
  | BeadsModelMessage
  | BeadsClearScheduledMessage
  | BeadsDestroyMessage;

export interface BeadsProcessorReady {
  type: 'ready';
}

export interface BeadsProcessorError {
  type: 'error';
  message: string;
}

export type BeadsProcessorStatus = BeadsProcessorReady | BeadsProcessorError;

export interface BeadsPatchParams {
  time: number;      // grain size / delay time / decay
  density: number;   // grain density / feedback
  texture: number;   // grain envelope / tone
  position: number;  // buffer position / tap position
  pitch: number;     // pitch shift
  dry_wet: number;   // mix balance
}
