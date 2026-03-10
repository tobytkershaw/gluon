// src/engine/types.ts

export type Agency = 'OFF' | 'SUGGEST' | 'PLAY';

export interface SynthParamValues {
  harmonics: number;
  timbre: number;
  morph: number;
  note: number;
  [key: string]: number;
}

export interface Voice {
  id: string;
  engine: string;
  model: number;
  params: SynthParamValues;
  agency: Agency;
}

export interface MusicalContext {
  key: string | null;
  scale: string | null;
  tempo: number | null;
  energy: number;
  density: number;
}

export interface Snapshot {
  prevValues: Partial<SynthParamValues>;
  aiTargetValues: Partial<SynthParamValues>;
  timestamp: number;
  description: string;
}

export type PendingActionType = 'suggestion' | 'audition';

export interface PendingAction {
  id: string;
  type: PendingActionType;
  voiceId: string;
  changes: Partial<SynthParamValues>;
  reason?: string;
  expiresAt: number;
  previousValues: Partial<SynthParamValues>;
}

export interface AIMoveAction {
  type: 'move';
  param: string;
  target: { absolute: number } | { relative: number };
  over?: number;
}

export interface AISuggestAction {
  type: 'suggest';
  changes: Partial<SynthParamValues>;
  reason?: string;
}

export interface AIAuditionAction {
  type: 'audition';
  changes: Partial<SynthParamValues>;
  duration?: number;
}

export interface AISayAction {
  type: 'say';
  text: string;
}

export interface AISketchAction {
  type: 'sketch';
  sketchType: 'pattern' | 'automation' | 'voice' | 'arrangement';
  description: string;
  content: unknown;
  target?: string;
}

export type AIAction = AIMoveAction | AISuggestAction | AIAuditionAction | AISayAction | AISketchAction;

export interface HumanAction {
  param: string;
  from: number;
  to: number;
  timestamp: number;
}

export interface Session {
  voice: Voice;
  leash: number;
  undoStack: Snapshot[];
  pending: PendingAction[];
  context: MusicalContext;
  messages: ChatMessage[];
  recentHumanActions: HumanAction[];
}

export interface ChatMessage {
  role: 'human' | 'ai';
  text: string;
  timestamp: number;
}
