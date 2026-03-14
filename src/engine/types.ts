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

// --- Track Surface (Layer model for UI, Steps 5+ activate semantic controls) ---

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

export interface TrackSurface {
  semanticControls: SemanticControlDef[];
  pinnedControls: PinnedControl[];
  xyAxes: { x: string; y: string };
  thumbprint: ThumbprintConfig;
}

export interface Track {
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
  surface: TrackSurface;
}

// --- Master channel ---

export interface MasterChannel {
  volume: number;  // 0.0–1.0 (linear gain), default 0.8
  pan: number;     // -1.0 (left) to 1.0 (right), default 0.0
}

export const DEFAULT_MASTER: MasterChannel = { volume: 0.8, pan: 0.0 };

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
  trackId: string;
  prevValues: Partial<SynthParamValues>;
  aiTargetValues: Partial<SynthParamValues>;
  timestamp: number;
  description: string;
  prevProvenance?: Partial<ControlState>;
}

export interface PatternSnapshot {
  kind: 'pattern';
  trackId: string;
  prevSteps: { index: number; step: Step }[];
  prevLength?: number;
  /** Region events before the legacy sketch was applied (for full undo). */
  prevEvents?: CanonicalMusicalEvent[];
  /** Hidden events before the legacy sketch was applied (for length undo). */
  prevHiddenEvents?: CanonicalMusicalEvent[];
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
  trackId: string;
  prevModel: number;
  prevEngine: string;
  timestamp: number;
  description: string;
}

export interface RegionSnapshot {
  kind: 'region';
  trackId: string;
  prevEvents: CanonicalMusicalEvent[];
  prevDuration?: number;
  prevHiddenEvents?: CanonicalMusicalEvent[];
  timestamp: number;
  description: string;
}

export interface ViewSnapshot {
  kind: 'view';
  trackId: string;
  prevViews: SequencerViewConfig[];
  timestamp: number;
  description: string;
}

export interface ProcessorSnapshot {
  kind: 'processor';
  trackId: string;
  prevProcessors: ProcessorConfig[];
  timestamp: number;
  description: string;
}

export interface ProcessorStateSnapshot {
  kind: 'processor-state';
  trackId: string;
  processorId: string;
  prevParams: Record<string, number>;
  prevModel: number;
  timestamp: number;
  description: string;
}

export interface ModulatorSnapshot {
  kind: 'modulator';
  trackId: string;
  prevModulators: ModulatorConfig[];
  prevModulations: ModulationRouting[];
  timestamp: number;
  description: string;
}

export interface ModulatorStateSnapshot {
  kind: 'modulator-state';
  trackId: string;
  modulatorId: string;
  prevParams: Record<string, number>;
  prevModel: number;
  timestamp: number;
  description: string;
}

export interface ModulationRoutingSnapshot {
  kind: 'modulation-routing';
  trackId: string;
  prevModulations: ModulationRouting[];
  timestamp: number;
  description: string;
}

export interface MasterSnapshot {
  kind: 'master';
  prevMaster: MasterChannel;
  timestamp: number;
  description: string;
}

export type Snapshot = ParamSnapshot | PatternSnapshot | TransportSnapshot | ModelSnapshot | RegionSnapshot | ViewSnapshot | ProcessorSnapshot | ProcessorStateSnapshot | ModulatorSnapshot | ModulatorStateSnapshot | ModulationRoutingSnapshot | MasterSnapshot;

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
  trackId?: string;
  /** When present, targets a processor control instead of a track/source control */
  processorId?: string;
  /** When present, targets a modulator control instead of a track/source control */
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
  trackId: string;
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
  trackId: string;
  /** When present, switches the processor's mode instead of the track's synthesis engine */
  processorId?: string;
  /** When present, switches the modulator's mode */
  modulatorId?: string;
  model: string;  // Engine ID from the instrument registry (e.g. "analog-bass-drum" for track, "modal" for Rings)
}

export interface AITransformAction {
  type: 'transform';
  trackId: string;
  operation: 'rotate' | 'transpose' | 'reverse' | 'duplicate';
  steps?: number;
  semitones?: number;
  description: string;
}

export interface AIAddViewAction {
  type: 'add_view';
  trackId: string;
  viewKind: SequencerViewKind;
  description: string;
}

export interface AIRemoveViewAction {
  type: 'remove_view';
  trackId: string;
  viewId: string;
  description: string;
}

export interface AIAddProcessorAction {
  type: 'add_processor';
  trackId: string;
  moduleType: string;  // processor type from registry (e.g. "rings")
  processorId: string; // assigned at tool-call time; used by projection + execution
  description: string;
}

export interface AIRemoveProcessorAction {
  type: 'remove_processor';
  trackId: string;
  processorId: string;
  description: string;
}

export interface AIReplaceProcessorAction {
  type: 'replace_processor';
  trackId: string;
  processorId: string;       // existing processor to replace
  newModuleType: string;     // new processor type from registry
  newProcessorId: string;    // pre-assigned ID for the replacement
  description: string;
}

export interface AIAddModulatorAction {
  type: 'add_modulator';
  trackId: string;
  moduleType: string;
  modulatorId: string;
  description: string;
}

export interface AIRemoveModulatorAction {
  type: 'remove_modulator';
  trackId: string;
  modulatorId: string;
  description: string;
}

export interface AIConnectModulatorAction {
  type: 'connect_modulator';
  trackId: string;
  modulatorId: string;
  target: ModulationTarget;
  depth: number;
  /** Pre-assigned route ID (assigned at tool-call time for same-turn composition). */
  modulationId?: string;
  description: string;
}

export interface AIDisconnectModulatorAction {
  type: 'disconnect_modulator';
  trackId: string;
  modulationId: string;
  description: string;
}

export interface AISetMasterAction {
  type: 'set_master';
  volume?: number;  // 0.0–1.0
  pan?: number;     // -1.0 to 1.0
}

export type AIAction = AIMoveAction | AISayAction | AISketchAction | AITransportAction | AISetModelAction | AITransformAction | AIAddViewAction | AIRemoveViewAction | AIAddProcessorAction | AIRemoveProcessorAction | AIReplaceProcessorAction | AIAddModulatorAction | AIRemoveModulatorAction | AIConnectModulatorAction | AIDisconnectModulatorAction | AISetMasterAction;

// --- Session ---

export interface HumanAction {
  trackId: string;
  param: string;
  from: number;
  to: number;
  timestamp: number;
}

export interface Session {
  tracks: Track[];
  activeTrackId: string;
  transport: Transport;
  master: MasterChannel;
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
  | { kind: 'transform'; operation: string; description: string }
  | { kind: 'master-change'; field: string; from: number; to: number };

export interface ActionLogEntry {
  trackId: string;
  trackLabel: string;
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

export function getTrack(session: Session, trackId: string): Track {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) throw new Error(`Track not found: ${trackId}`);
  return track;
}

export function getActiveTrack(session: Session): Track {
  return getTrack(session, session.activeTrackId);
}

export function updateTrack(session: Session, trackId: string, update: Partial<Track>): Session {
  return {
    ...session,
    tracks: session.tracks.map(v => v.id === trackId ? { ...v, ...update } : v),
  };
}

/** Effective tempo: transport.bpm when transport exists, else context.tempo fallback */
export function getEffectiveTempo(session: Session): number | null {
  return session.transport.bpm ?? session.context.tempo;
}
