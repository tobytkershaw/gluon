// src/engine/types.ts
import type { Pattern, PatternSketch, Step, Transport } from './sequencer-types';

export type Agency = 'OFF' | 'ON';

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
  pattern: Pattern;
  muted: boolean;
  solo: boolean;
}

export interface MusicalContext {
  key: string | null;
  scale: string | null;
  tempo: number | null;  // Derived from transport.bpm when transport exists; see getEffectiveTempo()
  energy: number;
  density: number;
}

// --- Snapshots (discriminated union) ---

export interface ParamSnapshot {
  kind: 'param';
  voiceId: string;
  prevValues: Partial<SynthParamValues>;
  aiTargetValues: Partial<SynthParamValues>;
  timestamp: number;
  description: string;
}

export interface PatternSnapshot {
  kind: 'pattern';
  voiceId: string;
  prevSteps: { index: number; step: Step }[];
  prevLength?: number;
  timestamp: number;
  description: string;
}

export type Snapshot = ParamSnapshot | PatternSnapshot;

// --- AI Actions ---

export interface AIMoveAction {
  type: 'move';
  voiceId?: string;
  param: string;
  target: { absolute: number } | { relative: number };
  over?: number;
}

export interface AISayAction {
  type: 'say';
  text: string;
}

export interface AISketchAction {
  type: 'sketch';
  voiceId: string;
  description: string;
  pattern: PatternSketch;
}

export type AIAction = AIMoveAction | AISayAction | AISketchAction;

// --- Session ---

export interface HumanAction {
  voiceId: string;
  param: string;
  from: number;
  to: number;
  timestamp: number;
}

export interface Session {
  voices: Voice[];
  activeVoiceId: string;
  transport: Transport;
  undoStack: Snapshot[];
  context: MusicalContext;
  messages: ChatMessage[];
  recentHumanActions: HumanAction[];
}

export interface ChatMessage {
  role: 'human' | 'ai';
  text: string;
  timestamp: number;
}

// --- Helpers ---

export function getVoice(session: Session, voiceId: string): Voice {
  const voice = session.voices.find(v => v.id === voiceId);
  if (!voice) throw new Error(`Voice not found: ${voiceId}`);
  return voice;
}

export function getActiveVoice(session: Session): Voice {
  return getVoice(session, session.activeVoiceId);
}

export function updateVoice(session: Session, voiceId: string, update: Partial<Voice>): Session {
  return {
    ...session,
    voices: session.voices.map(v => v.id === voiceId ? { ...v, ...update } : v),
  };
}

/** Effective tempo: transport.bpm when transport exists, else context.tempo fallback */
export function getEffectiveTempo(session: Session): number | null {
  return session.transport.bpm ?? session.context.tempo;
}
