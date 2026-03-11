// --- Control Schema ---
export type ControlKind = 'continuous' | 'discrete' | 'enum' | 'boolean' | 'trigger';

export type SemanticRole =
  | 'pitch'
  | 'brightness'
  | 'richness'
  | 'texture'
  | 'decay'
  | 'attack'
  | 'body'
  | 'noise'
  | 'resonance'
  | 'movement_rate'
  | 'mod_depth'
  | 'space'
  | 'drive'
  | 'stability'
  | 'density'
  | 'level'
  | 'pan';

export interface ControlBinding {
  adapterId: string;
  path: string; // dotted path like "params.timbre"
}

export interface ControlSchema {
  id: string;
  name: string;
  kind: ControlKind;
  semanticRole: SemanticRole | null;
  description: string;
  readable: boolean;
  writable: boolean;
  range?: {
    min: number;
    max: number;
    default: number;
    recommendedMin?: number;
    recommendedMax?: number;
  };
  enumValues?: string[];
  group?: string;
  binding: ControlBinding;
}

// --- Control State (with Provenance) ---
export interface ControlValue {
  value: number | string | boolean;
  source: 'human' | 'ai' | 'default';
  updatedAt?: number;
}

export type ControlState = Record<string, ControlValue>;

// --- Sound Source ---
export interface SoundSource {
  type: string;
  engine: string;
  adapterId: string;
}

// --- Processor ---
export interface Processor {
  id: string;
  type: string;
  label: string;
  enabled: boolean;
  controls: ControlSchema[];
  controlState: ControlState;
  adapterId: string;
}

// --- Region ---
export type RegionKind = 'pattern' | 'clip' | 'automation_lane';

export interface Region {
  id: string;
  kind: RegionKind;
  start: number;
  duration: number;
  loop: boolean;
  name?: string;
  events: MusicalEvent[];
}

// --- Musical Event ---
export type EventKind = 'note' | 'trigger' | 'parameter';

export interface BaseEvent {
  at: number;
  kind: EventKind;
}

export interface NoteEvent extends BaseEvent {
  kind: 'note';
  pitch: number; // MIDI 0-127
  velocity: number; // 0-1
  duration: number; // length in beats
}

export interface TriggerEvent extends BaseEvent {
  kind: 'trigger';
  velocity?: number;
  accent?: boolean;
}

export interface ParameterEvent extends BaseEvent {
  kind: 'parameter';
  controlId: string;
  value: number | string | boolean;
  interpolation?: 'step' | 'linear' | 'curve';
}

export type MusicalEvent = NoteEvent | TriggerEvent | ParameterEvent;

// --- Instrument Registry ---
export interface EngineDef {
  id: string;
  label: string;
  description: string;
  controls: ControlSchema[];
}

export interface InstrumentDef {
  type: string;
  label: string;
  adapterId: string;
  engines: EngineDef[];
}

// --- Source Adapter ---
export interface SourceAdapter {
  id: string;
  name: string;

  // Write path (canonical -> runtime)
  mapControl(controlId: string): ControlBinding;
  applyControlChanges(changes: { controlId: string; value: number | string | boolean }[]): void;
  mapEvents(events: MusicalEvent[]): unknown; // returns adapter-native format

  // Read path (runtime -> canonical)
  readControlState(): ControlState;
  readRegions(): Region[];

  // Inverse mapping (runtime -> canonical) - bare param key, NOT dotted path
  mapRuntimeParamKey(paramKey: string): string | null;

  // Schema and validation
  getControlSchemas(engineId: string): ControlSchema[];
  validateOperation(op: AIOperation): { valid: boolean; reason?: string };

  // Pitch conversion at adapter boundary
  midiToNormalisedPitch(midi: number): number;
  normalisedPitchToMidi(normalised: number): number;
}

// --- AI Operations ---
export interface MoveOp {
  type: 'move';
  voiceId: string;
  controlId: string;
  target: { absolute: number } | { relative: number };
  overMs?: number;
}

export interface SketchOp {
  type: 'sketch';
  voiceId: string;
  regionId?: string;
  mode: 'replace' | 'merge';
  events: MusicalEvent[];
  description: string;
}

export interface AddProcessorOp {
  type: 'add_processor';
  voiceId: string;
  processorType: string;
  position?: number;
}

export interface RemoveProcessorOp {
  type: 'remove_processor';
  voiceId: string;
  processorId: string;
}

export interface SetProcessorParamOp {
  type: 'set_processor_param';
  voiceId: string;
  processorId: string;
  controlId: string;
  value: number;
}

export interface SayOp {
  type: 'say';
  text: string;
}

export type AIOperation =
  | MoveOp
  | SketchOp
  | AddProcessorOp
  | RemoveProcessorOp
  | SetProcessorParamOp
  | SayOp;

// --- Execution Report ---
export interface ExecutionReportLogEntry {
  voiceId: string;
  voiceLabel: string;
  description: string;
}

export interface ExecutionReport {
  session: unknown; // Will be Session when wired in; avoid circular import for now
  accepted: AIOperation[];
  rejected: { op: AIOperation; reason: string }[];
  log: ExecutionReportLogEntry[];
}
