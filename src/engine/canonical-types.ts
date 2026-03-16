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
  /** Physical control size hint for Rack view layout.
   *  'large' = primary knob, 'small' = secondary/attenuverter. Defaults to 'large'. */
  size?: 'large' | 'small';
  binding: ControlBinding;
}

// --- Control State (with Provenance) ---
export interface ControlValue {
  value: number | string | boolean;
  source: 'human' | 'ai' | 'default';
  updatedAt?: number;
}

export type ControlState = Record<string, ControlValue>;

// --- Region ---
export type RegionKind = 'pattern' | 'clip' | 'automation_lane';

/**
 * A Region is a time-bounded container for musical events.
 *
 * ## Structural invariants
 * 1. `duration > 0`
 * 2. `start >= 0`
 * 3. All events: `0 <= event.at < duration`
 * 4. Events are sorted ascending by `at` (enforced via normalization on write)
 *
 * ## Collision rules (per kind)
 * 8. No duplicate TriggerEvents at the same `at` (tolerance 0.001)
 * 9. No duplicate ParameterEvents for the same `controlId` at the same `at` (tolerance 0.001)
 * 10. Multiple NoteEvents allowed at the same `at` (polyphonic, max 4 columns)
 *     — no duplicate (same pitch at same `at`)
 *
 * ## Deferred
 * - Cross-region overlap detection
 * - Region splitting / merging
 * - Non-looping clip playback
 * - Automation lane semantics
 */
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

/**
 * Base for all musical events.
 *
 * ## Invariant
 * 3. `0 <= at < region.duration` (validated in region context)
 */
export interface BaseEvent {
  at: number;
  kind: EventKind;
}

/**
 * A pitched note event.
 *
 * ## Invariants
 * 6. `pitch` in 0–127 (MIDI range)
 * 6. `velocity` in 0–1
 * 6. `duration > 0`
 * 10. Multiple notes allowed at same position (polyphonic, max 4)
 *     — no duplicate pitch at same `at`
 */
export interface NoteEvent extends BaseEvent {
  kind: 'note';
  pitch: number; // MIDI 0-127
  velocity: number; // 0-1
  duration: number; // length in beats
}

/**
 * A percussive trigger (unpitched).
 *
 * ## Invariants
 * 5. `velocity` in 0–1 when present
 * 8. No duplicate TriggerEvents at the same `at` (tolerance 0.001)
 */
export interface TriggerEvent extends BaseEvent {
  kind: 'trigger';
  velocity?: number;
  accent?: boolean;
  /** Gate length in steps. Default: 1. */
  gate?: number;
}

/**
 * A parameter automation event.
 *
 * ## Invariants
 * 7. `controlId` is non-empty
 * 9. No duplicate ParameterEvents for the same `controlId` at the same `at` (tolerance 0.001)
 */
export interface ParameterEvent extends BaseEvent {
  kind: 'parameter';
  controlId: string;
  value: number | string | boolean;
  interpolation?: 'step' | 'linear' | 'curve';
  /** Curve tension for 'curve' interpolation. Range: -1.0 to 1.0.
   *  0 = linear, positive = fast start/slow end, negative = slow start/fast end. */
  tension?: number;
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
  trackId: string;
  controlId: string;
  target: { absolute: number } | { relative: number };
  overMs?: number;
}

export interface SketchOp {
  type: 'sketch';
  trackId: string;
  regionId?: string;
  mode: 'replace' | 'merge';
  events: MusicalEvent[];
  description: string;
}

export interface AddProcessorOp {
  type: 'add_processor';
  trackId: string;
  processorType: string;
  position?: number;
}

export interface RemoveProcessorOp {
  type: 'remove_processor';
  trackId: string;
  processorId: string;
}

export interface SetProcessorParamOp {
  type: 'set_processor_param';
  trackId: string;
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
  trackId: string;
  trackLabel: string;
  description: string;
}

