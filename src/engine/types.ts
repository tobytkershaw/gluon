// src/engine/types.ts
import type { Pattern, PatternSketch, Step, Transport } from './sequencer-types';
import type { ControlState, Region, MusicalEvent as CanonicalMusicalEvent } from './canonical-types';

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
  regions: Region[];
  muted: boolean;
  solo: boolean;
  controlProvenance?: ControlState;
  /** Events hidden by setPatternLength, restored on expand. Not persisted. */
  _hiddenEvents?: CanonicalMusicalEvent[];
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
  prevProvenance?: Partial<ControlState>;
}

export interface PatternSnapshot {
  kind: 'pattern';
  voiceId: string;
  prevSteps: { index: number; step: Step }[];
  prevLength?: number;
  timestamp: number;
  description: string;
}

export interface TransportSnapshot {
  kind: 'transport';
  prevTransport: Transport;
  timestamp: number;
  description: string;
}

export interface ModelSnapshot {
  kind: 'model';
  voiceId: string;
  prevModel: number;
  prevEngine: string;
  timestamp: number;
  description: string;
}

export interface RegionSnapshot {
  kind: 'region';
  voiceId: string;
  prevEvents: CanonicalMusicalEvent[];
  prevDuration?: number;
  timestamp: number;
  description: string;
}

export type Snapshot = ParamSnapshot | PatternSnapshot | TransportSnapshot | ModelSnapshot | RegionSnapshot;

export interface ActionGroupSnapshot {
  kind: 'group';
  snapshots: Snapshot[];
  timestamp: number;
  description: string;
}

export type UndoEntry = Snapshot | ActionGroupSnapshot;

// --- AI Actions ---

export interface AIMoveAction {
  type: 'move';
  voiceId?: string;
  /** Runtime param key (legacy) or canonical controlId */
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
  /** Legacy pattern shape */
  pattern?: PatternSketch;
  /** Canonical event shape */
  events?: CanonicalMusicalEvent[];
}

export interface AITransportAction {
  type: 'set_transport';
  bpm?: number;
  swing?: number;
  playing?: boolean;
}

export interface AISetModelAction {
  type: 'set_model';
  voiceId: string;
  model: string;  // Engine ID from the instrument registry (e.g. "analog-bass-drum")
}

export type AIAction = AIMoveAction | AISayAction | AISketchAction | AITransportAction | AISetModelAction;

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
  undoStack: UndoEntry[];
  context: MusicalContext;
  messages: ChatMessage[];
  recentHumanActions: HumanAction[];
}

export interface ActionLogEntry {
  voiceId: string;
  voiceLabel: string;
  description: string;
}

export interface ChatMessage {
  role: 'human' | 'ai';
  text: string;
  timestamp: number;
  actions?: ActionLogEntry[];
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
