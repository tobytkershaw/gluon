export interface RingsPatchMessage {
  type: 'set-patch';
  patch: RingsPatchParams;
  time?: number;
}

export interface RingsModelMessage {
  type: 'set-model';
  model: number;
  time?: number;
}

export interface RingsNoteMessage {
  type: 'set-note';
  tonic: number;
  note: number;
  time?: number;
}

export interface RingsPolyphonyMessage {
  type: 'set-polyphony';
  polyphony: number;
  time?: number;
}

export interface RingsInternalExciterMessage {
  type: 'set-internal-exciter';
  enabled: boolean;
  time?: number;
}

export interface RingsStrumMessage {
  type: 'strum';
  time: number;
}

export interface RingsDampMessage {
  type: 'damp';
}

export interface RingsClearScheduledMessage {
  type: 'clear-scheduled';
}

export interface RingsDestroyMessage {
  type: 'destroy';
}

export type RingsProcessorCommand =
  | RingsPatchMessage
  | RingsModelMessage
  | RingsNoteMessage
  | RingsPolyphonyMessage
  | RingsInternalExciterMessage
  | RingsStrumMessage
  | RingsDampMessage
  | RingsClearScheduledMessage
  | RingsDestroyMessage;

export interface RingsProcessorReady {
  type: 'ready';
}

export interface RingsProcessorError {
  type: 'error';
  message: string;
}

export type RingsProcessorStatus = RingsProcessorReady | RingsProcessorError;

export interface RingsPatchParams {
  structure: number;
  brightness: number;
  damping: number;
  position: number;
}
