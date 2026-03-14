// src/engine/types.ts
import type { Pattern, PatternSketch, Step, Transport } from './sequencer-types';
import type { ControlState, Region, MusicalEvent as CanonicalMusicalEvent, SemanticRole } from './canonical-types';

export type Agency = 'OFF' | 'ON';

// --- Sequencer views (presentation state, not musical) ---

export type SequencerViewKind = 'step-grid' | 'piano-roll';

export interface SequencerViewConfig {
  kind: SequencerViewKind;
  id: string;
}

export interface SynthParamValues {
  harmonics: number;
  timbre: number;
  morph: number;
  note: number;
  [key: string]: number;
}

export interface ProcessorConfig {
  id: string;
  type: string;
  model: number;
  params: Record<string, number>;
}

export interface ModulatorConfig {
  id: string;
  type: string;
  model: number;       // mode index (0=AD, 1=Looping, 2=AR)
  params: Record<string, number>;
}

/** Discriminated target — explicit about what's being modulated */
export type ModulationTarget =
  | { kind: 'source'; param: string }
  | { kind: 'processor'; processorId: string; param: string };

export interface ModulationRouting {
  id: string;
  modulatorId: string;
  target: ModulationTarget;
  depth: number;        // -1.0 to 1.0 (bipolar)
}

// --- Voice Surface (Layer model for UI, Steps 5+ activate semantic controls) ---

export type SemanticTransform = 'linear' | 'inverse' | 'bipolar';

export interface SemanticControlWeight {
  moduleId: string;
  controlId: string;
  weight: number;
  transform: SemanticTransform;
}

export interface SemanticControlDef {
  id: string;
  name: string;
  semanticRole: SemanticRole | null;
  description: string;
  weights: SemanticControlWeight[];
  range: { min: number; max: number; default: number };
}

export interface ThumbprintConfig {
  type: 'static-color';
}

export interface PinnedControl {
  moduleId: string;
  controlId: string;
}

export interface VoiceSurface {
  semanticControls: SemanticControlDef[];
  pinnedControls: PinnedControl[];
  xyAxes: { x: string; y: string };
  thumbprint: ThumbprintConfig;
}

export interface Voice {
  id: string;
  /** Human-assigned display name. When absent, derived from the engine model. */
  name?: string;
  engine: string;
  model: number;
  params: SynthParamValues;
  agency: Agency;
  pattern: Pattern;
  regions: Region[];
  muted: boolean;
  solo: boolean;
  controlProvenance?: ControlState;
  /** Addable sequencer views. Presentation state — persisted but not part of musical state. */
  views?: SequencerViewConfig[];
  /** Events hidden by setPatternLength, restored on expand. Persisted to prevent data loss. */
  _hiddenEvents?: CanonicalMusicalEvent[];
  /** Processor chain (effects applied after source). */
  processors?: ProcessorConfig[];
  /** Modulator modules (control-rate signal generators). */
  modulators?: ModulatorConfig[];
  /** Modulation routings (modulator → target param). */
  modulations?: ModulationRouting[];
  /** UI surface configuration (Layer model). Semantic controls activated in Steps 5+. */
  surface: VoiceSurface;
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
  prevHiddenEvents?: CanonicalMusicalEvent[];
  timestamp: number;
  description: string;
}

export interface ViewSnapshot {
  kind: 'view';
  voiceId: string;
  prevViews: SequencerViewConfig[];
  timestamp: number;
  description: string;
}

export interface ProcessorSnapshot {
  kind: 'processor';
  voiceId: string;
  prevProcessors: ProcessorConfig[];
  timestamp: number;
  description: string;
}

export interface ProcessorStateSnapshot {
  kind: 'processor-state';
  voiceId: string;
  processorId: string;
  prevParams: Record<string, number>;
  prevModel: number;
  timestamp: number;
  description: string;
}

export interface ModulatorSnapshot {
  kind: 'modulator';
  voiceId: string;
  prevModulators: ModulatorConfig[];
  prevModulations: ModulationRouting[];
  timestamp: number;
  description: string;
}

export interface ModulatorStateSnapshot {
  kind: 'modulator-state';
  voiceId: string;
  modulatorId: string;
  prevParams: Record<string, number>;
  prevModel: number;
  timestamp: number;
  description: string;
}

export interface ModulationRoutingSnapshot {
  kind: 'modulation-routing';
  voiceId: string;
  prevModulations: ModulationRouting[];
  timestamp: number;
  description: string;
}

export type Snapshot = ParamSnapshot | PatternSnapshot | TransportSnapshot | ModelSnapshot | RegionSnapshot | ViewSnapshot | ProcessorSnapshot | ProcessorStateSnapshot | ModulatorSnapshot | ModulatorStateSnapshot | ModulationRoutingSnapshot;

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
  /** When present, targets a processor control instead of a voice/source control */
  processorId?: string;
  /** When present, targets a modulator control instead of a voice/source control */
  modulatorId?: string;
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
  /** When present, switches the processor's mode instead of the voice's synthesis engine */
  processorId?: string;
  /** When present, switches the modulator's mode */
  modulatorId?: string;
  model: string;  // Engine ID from the instrument registry (e.g. "analog-bass-drum" for voice, "modal" for Rings)
}

export interface AITransformAction {
  type: 'transform';
  voiceId: string;
  operation: 'rotate' | 'transpose' | 'reverse' | 'duplicate';
  steps?: number;
  semitones?: number;
  description: string;
}

export interface AIAddViewAction {
  type: 'add_view';
  voiceId: string;
  viewKind: SequencerViewKind;
  description: string;
}

export interface AIRemoveViewAction {
  type: 'remove_view';
  voiceId: string;
  viewId: string;
  description: string;
}

export interface AIAddProcessorAction {
  type: 'add_processor';
  voiceId: string;
  moduleType: string;  // processor type from registry (e.g. "rings")
  processorId: string; // assigned at tool-call time; used by projection + execution
  description: string;
}

export interface AIRemoveProcessorAction {
  type: 'remove_processor';
  voiceId: string;
  processorId: string;
  description: string;
}

export interface AIReplaceProcessorAction {
  type: 'replace_processor';
  voiceId: string;
  processorId: string;       // existing processor to replace
  newModuleType: string;     // new processor type from registry
  newProcessorId: string;    // pre-assigned ID for the replacement
  description: string;
}

export interface AIAddModulatorAction {
  type: 'add_modulator';
  voiceId: string;
  moduleType: string;
  modulatorId: string;
  description: string;
}

export interface AIRemoveModulatorAction {
  type: 'remove_modulator';
  voiceId: string;
  modulatorId: string;
  description: string;
}

export interface AIConnectModulatorAction {
  type: 'connect_modulator';
  voiceId: string;
  modulatorId: string;
  target: ModulationTarget;
  depth: number;
  /** Pre-assigned route ID (assigned at tool-call time for same-turn composition). */
  modulationId?: string;
  description: string;
}

export interface AIDisconnectModulatorAction {
  type: 'disconnect_modulator';
  voiceId: string;
  modulationId: string;
  description: string;
}

export type AIAction = AIMoveAction | AISayAction | AISketchAction | AITransportAction | AISetModelAction | AITransformAction | AIAddViewAction | AIRemoveViewAction | AIAddProcessorAction | AIRemoveProcessorAction | AIReplaceProcessorAction | AIAddModulatorAction | AIRemoveModulatorAction | AIConnectModulatorAction | AIDisconnectModulatorAction;

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

export type ActionDiff =
  | { kind: 'param-change'; controlId: string; from: number; to: number }
  | { kind: 'pattern-change'; eventsBefore: number; eventsAfter: number; description: string }
  | { kind: 'transport-change'; field: string; from: string | number; to: string | number }
  | { kind: 'model-change'; from: string; to: string }
  | { kind: 'processor-add'; processorType: string }
  | { kind: 'processor-remove'; processorType: string }
  | { kind: 'processor-replace'; fromType: string; toType: string }
  | { kind: 'modulator-add'; modulatorType: string }
  | { kind: 'modulator-remove'; modulatorType: string }
  | { kind: 'modulation-connect'; modulatorId: string; target: string; depth: number }
  | { kind: 'modulation-disconnect'; target: string }
  | { kind: 'transform'; operation: string; description: string };

export interface ActionLogEntry {
  voiceId: string;
  voiceLabel: string;
  description: string;
  diff?: ActionDiff;
}

export interface ChatMessage {
  role: 'human' | 'ai' | 'system';
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
