export interface FramesPatchParams {
  frame: number;
  channel_1: number;
  channel_2: number;
  channel_3: number;
  channel_4: number;
  modulation: number;
  kf_count: number;
  // Keyframe data: kf_N_pos, kf_N_ch1..ch4 (up to 20 keyframes)
  [key: string]: number;
}

export interface FramesPatchMessage {
  type: 'set-patch';
  patch: FramesPatchParams;
  time?: number;
}

export interface FramesModeMessage {
  type: 'set-mode';
  mode: number;
  time?: number;
}

export interface FramesClearScheduledMessage {
  type: 'clear-scheduled';
  fence: number;
}

export interface FramesDestroyMessage {
  type: 'destroy';
}

export type FramesProcessorCommand =
  | FramesPatchMessage
  | FramesModeMessage
  | FramesClearScheduledMessage
  | FramesDestroyMessage;

export interface FramesProcessorReady {
  type: 'ready';
}

export interface FramesProcessorError {
  type: 'error';
  message: string;
}

export type FramesProcessorStatus = FramesProcessorReady | FramesProcessorError;
