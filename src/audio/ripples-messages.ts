export interface RipplesPatchMessage {
  type: 'set-patch';
  patch: RipplesPatchParams;
  time?: number;
}

export interface RipplesModeMessage {
  type: 'set-mode';
  mode: number;
  time?: number;
}

export interface RipplesClearScheduledMessage {
  type: 'clear-scheduled';
  fence: number;
}

export interface RipplesDestroyMessage {
  type: 'destroy';
}

export type RipplesProcessorCommand =
  | RipplesPatchMessage
  | RipplesModeMessage
  | RipplesClearScheduledMessage
  | RipplesDestroyMessage;

export interface RipplesProcessorReady {
  type: 'ready';
}

export interface RipplesProcessorError {
  type: 'error';
  message: string;
}

export type RipplesProcessorStatus = RipplesProcessorReady | RipplesProcessorError;

export interface RipplesPatchParams {
  cutoff: number;
  resonance: number;
  drive: number;
}
