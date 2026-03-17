// src/engine/types.ts
import type { StepGrid, StepGridSketch, Step, Transport, PatternRef } from './sequencer-types';
import type { ControlState, Pattern, MusicalEvent as CanonicalMusicalEvent, SemanticRole } from './canonical-types';

export type Agency = 'OFF' | 'ON';

/** Discriminates audio tracks (sound sources) from bus tracks (send/return mixing). */
export type TrackKind = 'audio' | 'bus';

/** A send from one track to a bus track, with a post-fader send level. */
export interface Send {
  busId: string;
  level: number; // 0.0–1.0, default 1.0
}

/**
 * Approval level for a track's current material.
 * Controls how the AI should treat the material during edits.
 * See docs/rfcs/preservation-contracts.md for full semantics.
 */
export type ApprovalLevel = 'exploratory' | 'liked' | 'approved' | 'anchor';

/**
 * Report generated after a sketch edit on a track with approval level 'liked' or higher.
 * Informational only — does not block operations.
 */
export interface PreservationReport {
  /** Track that was edited */
  trackId: string;
  /** What was preserved */
  preserved: {
    rhythmPositions: boolean;  // Did rhythm positions survive?
    eventCount: boolean;       // Same number of events?
    pitchContour: boolean;     // Relative pitch relationships maintained?
  };
  /** What changed */
  changed: string[];  // Human-readable list of changes (e.g., "2 velocity values modified")
  /** Track's approval level at time of edit */
  approvalLevel: ApprovalLevel;
}

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
  /** Whether this processor is active in the signal chain. Default: true (enabled).
   *  When false, audio bypasses this processor entirely. */
  enabled?: boolean;
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
  /** Track kind: 'audio' (default) generates sound, 'bus' receives audio via sends. */
  kind?: TrackKind;
  engine: string;
  model: number;
  params: SynthParamValues;
  agency: Agency;
  /** Derived step-grid cache — always re-projected from patterns, never mutated directly. */
  stepGrid: StepGrid;
  /** Canonical pattern containers (content, no position). */
  patterns: Pattern[];
  /** Per-track arrangement: ordered list of pattern references. */
  sequence: PatternRef[];
  muted: boolean;
  solo: boolean;
  /** Per-track volume (linear gain), 0.0–1.0, default 0.8 */
  volume: number;
  /** Per-track pan, -1.0 (left) to 1.0 (right), default 0.0 */
  pan: number;
  /** Post-fader sends to bus tracks. Default: [] */
  sends?: Send[];
  controlProvenance?: ControlState;
  /** Addable sequencer views. Presentation state — persisted but not part of musical state. */
  views?: SequencerViewConfig[];
  /** Events hidden by setPatternLength, restored on expand. Persisted to prevent data loss. */
  _hiddenEvents?: CanonicalMusicalEvent[];
  /** Internal flag: set when pattern events change, cleared after transport sync reads it. */
  _patternDirty?: boolean;
  /** Processor chain (effects applied after source). */
  processors?: ProcessorConfig[];
  /** Modulator modules (control-rate signal generators). */
  modulators?: ModulatorConfig[];
  /** Modulation routings (modulator → target param). */
  modulations?: ModulationRouting[];
  /** UI surface configuration (Layer model). Semantic controls activated in Steps 5+. */
  surface: TrackSurface;
  /** Approval level for the track's current material. Default: 'exploratory'. */
  approval?: ApprovalLevel;
  /** AI-assigned importance of this track in the current mix context.
   *  Higher = more prominent/essential. Range: 0.0-1.0. */
  importance?: number;
  /** Brief description of this track's musical role (e.g., "driving rhythm", "ambient pad") */
  musicalRole?: string;
  /** ID of the currently-active pattern for editing. Falls back to patterns[0] if unset. */
  activePatternId?: string;
}

// --- Master channel ---

export interface MasterChannel {
  volume: number;  // 0.0–1.0 (linear gain), default 0.8
  pan: number;     // -1.0 (left) to 1.0 (right), default 0.0
}

export const DEFAULT_MASTER: MasterChannel = { volume: 0.8, pan: 0.0 };

/** Soft cap on the number of tracks in a session. */
export const MAX_TRACKS = 16;

/** Well-known ID for the master bus track. */
export const MASTER_BUS_ID = 'master-bus';

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
  /** Pattern events before the legacy sketch was applied (for full undo). */
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

export interface PatternEditSnapshot {
  kind: 'pattern-edit';
  trackId: string;
  /** Which pattern was edited. When absent, defaults to the active pattern. */
  patternId?: string;
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

export interface SurfaceSnapshot {
  kind: 'surface';
  trackId: string;
  prevSurface: TrackSurface;
  timestamp: number;
  description: string;
}

export interface ApprovalSnapshot {
  kind: 'approval';
  trackId: string;
  prevApproval: ApprovalLevel;
  timestamp: number;
  description: string;
}

export interface TrackAddSnapshot {
  kind: 'track-add';
  trackId: string;
  timestamp: number;
  description: string;
}

export interface TrackRemoveSnapshot {
  kind: 'track-remove';
  removedTrack: Track;
  removedIndex: number;
  /** If the active track was the removed one, stores the prev activeTrackId for restore. */
  prevActiveTrackId: string;
  /** Sends from other tracks that pointed at the removed track, captured before stripping. */
  affectedSends?: Array<{ trackId: string; prevSends: Send[] }>;
  timestamp: number;
  description: string;
}

export interface SendSnapshot {
  kind: 'send';
  trackId: string;
  prevSends: Send[];
  timestamp: number;
  description: string;
}

export interface PatternCrudSnapshot {
  kind: 'pattern-crud';
  trackId: string;
  action: 'add' | 'remove' | 'duplicate' | 'rename';
  /** For remove: the removed pattern and its index for reinsertion. */
  removedPattern?: import('./canonical-types').Pattern;
  removedIndex?: number;
  /** For add/duplicate: the ID of the added pattern, so undo can remove it. */
  addedPatternId?: string;
  /** Previous activePatternId, so undo restores the selection. */
  prevActivePatternId?: string;
  /** For rename: the pattern that was renamed and its previous name. */
  patternId?: string;
  previousName?: string;
  /** Previous sequence state, so undo restores dangling/missing refs. */
  prevSequence?: import('./sequencer-types').PatternRef[];
  timestamp: number;
  description: string;
}

/** Snapshot for discrete track-level property changes (mute, solo, volume, pan, name, agency). */
export interface TrackPropertySnapshot {
  kind: 'track-property';
  trackId: string;
  prevProps: Partial<Track>;
  timestamp: number;
  description: string;
}

/** Snapshot for A/B restore — captures the full musical state before the swap. */
export interface ABRestoreSnapshot {
  kind: 'ab-restore';
  prevTracks: Track[];
  prevTransport: Transport;
  prevMaster: MasterChannel;
  prevContext: MusicalContext;
  prevActiveTrackId: string;
  timestamp: number;
  description: string;
}

export type Snapshot = ParamSnapshot | PatternSnapshot | TransportSnapshot | ModelSnapshot | PatternEditSnapshot | ViewSnapshot | ProcessorSnapshot | ProcessorStateSnapshot | ModulatorSnapshot | ModulatorStateSnapshot | ModulationRoutingSnapshot | MasterSnapshot | SurfaceSnapshot | ApprovalSnapshot | TrackAddSnapshot | TrackRemoveSnapshot | SendSnapshot | PatternCrudSnapshot | TrackPropertySnapshot | ABRestoreSnapshot;

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
  /** Legacy step-grid shape */
  pattern?: StepGridSketch;
  /** Canonical event shape */
  events?: CanonicalMusicalEvent[];
}

export interface AITransportAction {
  type: 'set_transport';
  bpm?: number;
  swing?: number;
  playing?: boolean;
  timeSignatureNumerator?: number;
  timeSignatureDenominator?: number;
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

export interface AIBypassProcessorAction {
  type: 'bypass_processor';
  trackId: string;
  processorId: string;
  enabled: boolean;
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

export interface AISetSurfaceAction {
  type: 'set_surface';
  trackId: string;
  semanticControls: SemanticControlDef[];
  xyAxes?: { x: string; y: string };
  description: string;
}

export interface AIPinAction {
  type: 'pin';
  trackId: string;
  moduleId: string;
  controlId: string;
  description: string;
}

export interface AIUnpinAction {
  type: 'unpin';
  trackId: string;
  moduleId: string;
  controlId: string;
  description: string;
}

export interface AILabelAxesAction {
  type: 'label_axes';
  trackId: string;
  x: string;
  y: string;
  description: string;
}

export interface AISetImportanceAction {
  type: 'set_importance';
  trackId: string;
  importance: number;
  musicalRole?: string;
}

export interface AIRaiseDecisionAction {
  type: 'raise_decision';
  decisionId: string;
  question: string;
  context?: string;
  options?: string[];
  trackIds?: string[];
}

export interface AIMarkApprovedAction {
  type: 'mark_approved';
  trackId: string;
  level: ApprovalLevel;
  reason: string;
}

export type AIAction = AIMoveAction | AISayAction | AISketchAction | AITransportAction | AISetModelAction | AITransformAction | AIAddViewAction | AIRemoveViewAction | AIAddProcessorAction | AIRemoveProcessorAction | AIReplaceProcessorAction | AIBypassProcessorAction | AIAddModulatorAction | AIRemoveModulatorAction | AIConnectModulatorAction | AIDisconnectModulatorAction | AISetMasterAction | AISetSurfaceAction | AIPinAction | AIUnpinAction | AILabelAxesAction | AISetImportanceAction | AIRaiseDecisionAction | AIMarkApprovedAction;

// --- Reaction History ---

export interface Reaction {
  /** Which action group this reaction is about */
  actionGroupIndex: number;
  /** The human's verdict */
  verdict: 'approved' | 'rejected' | 'neutral';
  /** Optional rationale explaining why */
  rationale?: string;
  /** When the reaction was recorded */
  timestamp: number;
}

// --- Open Decisions ---

export interface OpenDecision {
  id: string;
  /** What needs to be decided */
  question: string;
  /** Context for why this matters */
  context?: string;
  /** Options the AI sees (if any) */
  options?: string[];
  /** When this decision was raised */
  raisedAt: number;
  /** Which track(s) this relates to, if any */
  trackIds?: string[];
  /** Whether this has been resolved */
  resolved?: boolean;
}

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
  /** Redo stack: entries moved here on undo, cleared on new user actions. */
  redoStack: UndoEntry[];
  context: MusicalContext;
  messages: ChatMessage[];
  recentHumanActions: HumanAction[];
  /** History of human reactions to AI actions */
  reactionHistory?: Reaction[];
  /** Unresolved decisions that need human input */
  openDecisions?: OpenDecision[];
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
  | { kind: 'master-change'; field: string; from: number; to: number }
  | { kind: 'surface-set'; controlCount: number; description: string }
  | { kind: 'surface-pin'; moduleId: string; controlId: string }
  | { kind: 'surface-unpin'; moduleId: string; controlId: string }
  | { kind: 'surface-label-axes'; x: string; y: string }
  | { kind: 'approval-change'; from: ApprovalLevel; to: ApprovalLevel };

export interface ActionLogEntry {
  trackId: string;
  trackLabel: string;
  description: string;
  diff?: ActionDiff;
}

/** A tool call the AI made during a turn, for display in chat. */
export interface ToolCallEntry {
  /** Raw tool name (e.g. "move", "listen", "sketch") */
  name: string;
  /** Tool arguments (for optional detail display) */
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'human' | 'ai' | 'system';
  text: string;
  timestamp: number;
  actions?: ActionLogEntry[];
  /** Tool calls the AI made during this turn (for transparency display). */
  toolCalls?: ToolCallEntry[];
  /** Index into the undo stack where this message's grouped undo entry lives.
   *  Set by executeOperations on AI messages that produce undoable changes. */
  undoStackIndex?: number;
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

/** Return the active pattern for a track (by activePatternId), falling back to patterns[0]. */
export function getActivePattern(track: Track): import('./canonical-types').Pattern {
  if (track.activePatternId) {
    const pattern = track.patterns.find(p => p.id === track.activePatternId);
    if (pattern) return pattern;
  }
  return track.patterns[0];
}

export function updateTrack(session: Session, trackId: string, update: Partial<Track>): Session {
  return {
    ...session,
    tracks: session.tracks.map(v => v.id === trackId ? { ...v, ...update } : v),
  };
}

/** Update a specific pattern within a track, returning a new session with the pattern replaced. */
export function updatePattern(
  session: Session,
  trackId: string,
  patternId: string,
  patternUpdate: Partial<import('./canonical-types').Pattern>,
): Session {
  return {
    ...session,
    tracks: session.tracks.map(t => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        patterns: t.patterns.map(p => p.id === patternId ? { ...p, ...patternUpdate } : p),
      };
    }),
  };
}

/** Effective tempo: transport.bpm when transport exists, else context.tempo fallback */
export function getEffectiveTempo(session: Session): number | null {
  return session.transport.bpm ?? session.context.tempo;
}

/** Return the kind of a track, defaulting to 'audio' for backward compatibility. */
export function getTrackKind(track: Track): TrackKind {
  return track.kind ?? 'audio';
}

/** Return all audio tracks (excluding buses). */
export function getAudioTracks(session: Session): Track[] {
  return session.tracks.filter(t => getTrackKind(t) === 'audio');
}

/** Return all bus tracks. */
export function getBusTracks(session: Session): Track[] {
  return session.tracks.filter(t => getTrackKind(t) === 'bus');
}

/** Return the master bus track, or undefined if not present. */
export function getMasterBus(session: Session): Track | undefined {
  return session.tracks.find(t => t.id === MASTER_BUS_ID);
}

/**
 * Return tracks sorted for display: audio tracks first, then non-master bus tracks,
 * then the master bus last.
 */
export function getOrderedTracks(session: Session): Track[] {
  const audio: Track[] = [];
  const buses: Track[] = [];
  let master: Track | undefined;
  for (const t of session.tracks) {
    if (t.id === MASTER_BUS_ID) {
      master = t;
    } else if (getTrackKind(t) === 'bus') {
      buses.push(t);
    } else {
      audio.push(t);
    }
  }
  return [...audio, ...buses, ...(master ? [master] : [])];
}
