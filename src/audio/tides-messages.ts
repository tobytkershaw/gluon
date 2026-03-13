export interface TidesPatchMessage {
  type: 'set-patch';
  frequency: number;
  shape: number;
  slope: number;
  smoothness: number;
}

export interface TidesModeMessage {
  type: 'set-mode';
  mode: number;  // 0=AD, 1=Looping, 2=AR
}

export interface TidesDestroyMessage {
  type: 'destroy';
}

export type TidesProcessorCommand =
  | TidesPatchMessage
  | TidesModeMessage
  | TidesDestroyMessage;

export interface TidesProcessorReady {
  type: 'ready';
}

export interface TidesProcessorError {
  type: 'error';
  message: string;
}

export type TidesProcessorStatus = TidesProcessorReady | TidesProcessorError;

export interface TidesPatchParams {
  frequency: number;
  shape: number;
  slope: number;
  smoothness: number;
}
