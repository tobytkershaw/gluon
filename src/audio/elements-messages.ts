export interface ElementsPatchMessage {
  type: 'set-patch';
  patch: ElementsPatchParams;
  time?: number;
}

export interface ElementsModelMessage {
  type: 'set-model';
  model: number;
  time?: number;
}

export interface ElementsNoteMessage {
  type: 'set-note';
  note: number;
  time?: number;
}

export interface ElementsGateMessage {
  type: 'gate';
  gate: boolean;
  time?: number;
}

export interface ElementsDampMessage {
  type: 'damp';
}

export interface ElementsClearScheduledMessage {
  type: 'clear-scheduled';
  fence: number;
}

export interface ElementsDestroyMessage {
  type: 'destroy';
}

export type ElementsProcessorCommand =
  | ElementsPatchMessage
  | ElementsModelMessage
  | ElementsNoteMessage
  | ElementsGateMessage
  | ElementsDampMessage
  | ElementsClearScheduledMessage
  | ElementsDestroyMessage;

export interface ElementsProcessorReady {
  type: 'ready';
}

export interface ElementsProcessorError {
  type: 'error';
  message: string;
}

export type ElementsProcessorStatus = ElementsProcessorReady | ElementsProcessorError;

export interface ElementsPatchParams {
  bow_level: number;
  bow_timbre: number;
  blow_level: number;
  blow_timbre: number;
  strike_level: number;
  strike_timbre: number;
  coarse: number;
  fine: number;
  geometry: number;
  brightness: number;
  damping: number;
  position: number;
  space: number;
}
