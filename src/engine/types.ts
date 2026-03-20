// src/engine/types.ts
import type { StepGrid, StepGridSketch, Transport, TransportCommand, PatternRef } from './sequencer-types';
import type { ControlState, Pattern, MusicalEvent as CanonicalMusicalEvent, SemanticRole } from './canonical-types';
import type { TensionCurve, TensionPoint, TrackTensionMapping } from './tension-curve';
import type { ParamShapes } from './param-shapes';

/** Discriminates audio tracks (sound sources) from bus tracks (send/return mixing). */
export type TrackKind = 'audio' | 'bus';

// --- Drum Rack ---

/** A single sound source within a drum rack. */
export interface DrumPad {
  id: string;               // stable identifier: "kick", "snare", "hat-closed"
  name: string;             // human-readable: "Kick", "Snare", "Closed Hat"
  source: {
    engine: string;         // "plaits" (or future: "sampler")
    model: number;          // Plaits model index
    params: Record<string, number>;
  };
  chokeGroup?: number;      // pads in same group mute each other on trigger
  level: number;            // 0.0–1.0, default 0.8
  pan: number;              // 0.0–1.0 (0.5 = center), default 0.5
}

/**
 * Drum rack configuration, stored on the Track when engine === 'drum-rack'.
 * All mutations to pads must go through DrumPadSnapshot capture for undo support.
 */
export interface DrumRackConfig {
  pads: DrumPad[];          // growable, max 16 for v1
}

/** Maximum number of pads in a drum rack. */
export const MAX_DRUM_PADS = 16;

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
  /** Track ID of the sidechain source. When set, this compressor uses that track's
   *  audio as its detector input instead of its own input signal. */
  sidechainSourceId?: string;
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

// --- Track Visual Identity (constrained primitives for Surface rendering) ---

/** Constrained visual identity primitives for Surface rendering. */
export interface TrackVisualIdentity {
  /** Track colour in HSB. Hue 0-360, saturation 0-1, brightness 0-1. */
  colour: { hue: number; saturation: number; brightness: number };
  /** Visual weight — how heavy/dense the track feels. 0.0 (featherlight) to 1.0 (heavy). */
  weight: number;
  /** Edge treatment style for module borders. */
  edgeStyle: 'crisp' | 'soft' | 'glow';
  /** Visual foregrounding — how prominent this track is. 0.0 (recedes) to 1.0 (foregrounded). */
  prominence: number;
}

/** Visual context derived from track identity, consumed by Surface module rendering. */
export interface ModuleVisualContext {
  /** Track colour from identity */
  trackColour: { hue: number; saturation: number; brightness: number };
  /** Visual weight 0-1 */
  weight: number;
  /** Edge treatment */
  edgeStyle: 'crisp' | 'soft' | 'glow';
  /** Prominence 0-1 */
  prominence: number;
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

// --- Surface Module system (replaces semantic-controls-only surface) ---

export interface ModuleBinding {
  role: string;           // module-defined binding role (e.g., 'control', 'x-axis', 'region')
  // Which track this binding targets — currently constrained to the owning track's ID.
  // Cross-track bindings are reserved for future use; the Surface renderer only receives
  // a single track context so cross-track targets cannot be realized at runtime.
  // Empty string ('') is treated as "owning track" for template bindings resolved at apply time.
  trackId: string;
  target: string;         // controlId, regionId, or semantic reference
}

export interface SurfaceModule {
  type: string;           // module type from registry (e.g., 'knob-group', 'macro-knob', 'xy-pad')
  id: string;             // unique instance ID
  label: string;          // human-readable label
  bindings: ModuleBinding[];
  position: { x: number; y: number; w: number; h: number }; // grid placement
  config: Record<string, unknown>; // module-type-specific configuration
}

export interface TrackSurface {
  modules: SurfaceModule[];
  thumbprint: ThumbprintConfig;
}

/**
 * A transient control module proposed by the AI during conversation.
 * Displayed in the Live Controls panel (right side of Chat tab).
 * Untouched modules are cleared when the next AI turn begins.
 */
export interface LiveControlModule {
  id: string;
  /** The track this module is bound to (explicit trackId). */
  trackId: string;
  /** True if the user has interacted with any control in this module. */
  touched: boolean;
  /** Reuses the existing SurfaceModule type for module definition. */
  module: SurfaceModule;
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
  /** @deprecated Agency field removed in #926. Kept temporarily for persistence migration. */
  agency?: 'OFF' | 'ON';
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
  /** Per-track swing override (0.0–1.0). When set, overrides global transport swing for this track.
   *  null or undefined = inherit global transport swing. */
  swing?: number | null;
  /** Portamento (pitch glide) time, normalised 0.0–1.0 mapping to 0–500ms. Default 0 (off). */
  portamentoTime?: number;
  /** Portamento mode: 'off' (no glide), 'always' (glide every note), 'legato' (glide only on overlapping notes). */
  portamentoMode?: 'off' | 'always' | 'legato';
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
  /** Visual identity for Surface rendering. AI-set, human-overridable. */
  visualIdentity?: TrackVisualIdentity;
  /** Drum rack configuration. Present only when engine === 'drum-rack'. */
  drumRack?: DrumRackConfig;
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

// --- Project Memory ---

/** Canonical list of memory type discriminators (single source of truth). */
export const PROJECT_MEMORY_TYPES = ['direction', 'track-narrative', 'decision'] as const;

/** Memory type discriminator for per-project AI memories. */
export type ProjectMemoryType = (typeof PROJECT_MEMORY_TYPES)[number];

/** A single AI memory scoped to a project. */
export interface ProjectMemory {
  id: string;
  type: ProjectMemoryType;
  content: string;          // natural language, 1-3 sentences, max 500 chars
  confidence: number;       // 0.0-1.0
  evidence: string;         // what produced this memory
  trackId?: string;         // if about a specific track
  createdAt: number;
  updatedAt: number;
}

/** Maximum number of memories per project. */
export const MAX_PROJECT_MEMORIES = 30;

/** Maximum character length for a memory's content field. */
export const MAX_MEMORY_CONTENT_LENGTH = 500;

/** Check whether a string is a valid ProjectMemoryType. */
export function isValidMemoryType(type: string): type is ProjectMemoryType {
  return (PROJECT_MEMORY_TYPES as readonly string[]).includes(type);
}

/** Check whether a number is a valid confidence value (0.0–1.0). */
export function isValidConfidence(value: number): boolean {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

/** Check whether a string is valid memory content (non-empty, max 500 chars). */
export function isValidMemoryContent(content: string): boolean {
  return typeof content === 'string' && content.length > 0 && content.length <= MAX_MEMORY_CONTENT_LENGTH;
}

/** Soft cap on the number of tracks in a session. */
export const MAX_TRACKS = 16;

/** Well-known ID for the master bus track. */
export const MASTER_BUS_ID = 'master-bus';

/** Supported scale mode names. */
export type ScaleMode =
  | 'major' | 'minor' | 'dorian' | 'phrygian' | 'lydian'
  | 'mixolydian' | 'aeolian' | 'locrian'
  | 'harmonic-minor' | 'melodic-minor'
  | 'pentatonic' | 'minor-pentatonic' | 'blues'
  | 'chromatic' | 'whole-tone';

/**
 * Global scale/key constraint. When set, sketch note pitches are
 * auto-quantized to the nearest in-scale degree.
 */
export interface ScaleConstraint {
  /** Root note as pitch class (0 = C, 1 = C#, ... 11 = B). */
  root: number;
  /** Scale mode. */
  mode: ScaleMode;
}

/** Bar-indexed harmonic cue for chord-aware generation. */
export interface ChordProgressionEntry {
  /** 1-based bar index. */
  bar: number;
  /** Chord symbol, e.g. "Fm", "Eb", "Db", "C7". */
  chord: string;
}

/**
 * UI selection context from the Tracker view.
 * When the human has an active selection, this describes what they're pointing at
 * so the AI can scope operations to the selection.
 */
export interface UserSelection {
  trackId: string;
  /** Inclusive step range [start, end] of the selected rows. */
  stepRange: [number, number];
  /** Flat indices into the pattern's events array for selected events. */
  eventIndices: number[];
}

/** Session-level creative intent — genre, references, mood, constraints. Survives context window rotation. */
export interface SessionIntent {
  genre?: string[];           // ["dubstep", "hyperdub", "uk bass"]
  references?: string[];      // ["Kode9", "Burial"]
  mood?: string[];            // ["dark", "sparse", "roomy"]
  avoid?: string[];           // ["busy hats", "four-on-floor"]
  currentGoal?: string;       // "build a half-step beat"
}

/** Section-level metadata — what part of the arrangement we're working in and its character. */
export interface SectionMeta {
  name?: string;              // "intro", "groove", "breakdown", "drop"
  intent?: string;            // "sparse and tense", "peak energy"
  targetEnergy?: number;      // 0-1
  targetDensity?: number;     // 0-1
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
  /** Canonical events before the sketch was applied (for full undo). */
  prevEvents: CanonicalMusicalEvent[];
  /** Hidden events before the sketch was applied (for length undo). */
  prevHiddenEvents?: CanonicalMusicalEvent[];
  /** Previous pattern length, if changed by the sketch. */
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
  /** The activeTrackId before the add, so undo can restore it. */
  prevActiveTrackId?: string;
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
  /** Compressor sidechain references that pointed at the removed track, captured before clearing. */
  affectedSidechains?: Array<{ trackId: string; processorId: string; prevSourceId: string }>;
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

export interface SidechainSnapshot {
  kind: 'sidechain';
  targetTrackId: string;
  processorId: string;
  prevSourceId: string | undefined;
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

/** Snapshot for drum rack pad mutations (add/remove/param change/model change/choke group). */
export interface DrumPadSnapshot {
  kind: 'drum-pad';
  trackId: string;
  prevPads: DrumPad[];
  /** Previous patterns snapshot — set when removing a pad so orphaned trigger events can be restored on undo. */
  prevPatterns?: import('./canonical-types').Pattern[];
  timestamp: number;
  description: string;
}

/** Snapshot for memory save/forget operations (captures previous memories array for undo). */
export interface MemorySnapshot {
  kind: 'memory';
  prevMemories: ProjectMemory[];
  timestamp: number;
  description: string;
}

/** Snapshot for discrete track-level property changes (mute, solo, volume, pan, name). */
export interface TrackPropertySnapshot {
  kind: 'track-property';
  trackId: string;
  prevProps: Partial<Track>;
  timestamp: number;
  description: string;
}

/** Snapshot for sequence (arrangement) edits — add, remove, reorder refs. */
export interface SequenceEditSnapshot {
  kind: 'sequence-edit';
  trackId: string;
  prevSequence: import('./sequencer-types').PatternRef[];
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

export interface ScaleSnapshot {
  kind: 'scale';
  prevScale: ScaleConstraint | null | undefined;
  timestamp: number;
  description: string;
}

export interface ChordProgressionSnapshot {
  kind: 'chord-progression';
  prevChordProgression: ChordProgressionEntry[] | null | undefined;
  timestamp: number;
  description: string;
}

export type Snapshot = ParamSnapshot | PatternSnapshot | TransportSnapshot | ModelSnapshot | PatternEditSnapshot | ViewSnapshot | ProcessorSnapshot | ProcessorStateSnapshot | ModulatorSnapshot | ModulatorStateSnapshot | ModulationRoutingSnapshot | MasterSnapshot | SurfaceSnapshot | ApprovalSnapshot | TrackAddSnapshot | TrackRemoveSnapshot | SendSnapshot | SidechainSnapshot | PatternCrudSnapshot | TrackPropertySnapshot | SequenceEditSnapshot | ABRestoreSnapshot | ScaleSnapshot | ChordProgressionSnapshot | DrumPadSnapshot | MemorySnapshot;

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
  /** Drum rack kit: record of padId -> grid string. Parsed into TriggerEvents with padId set. */
  kit?: Record<string, string>;
  /** Humanize amount (0.0-1.0). When set, applies velocity/timing jitter to events. */
  humanize?: number;
  /** Groove template name. Applied after note generation, before humanize. */
  groove?: string;
  /** Groove intensity 0.0-1.0. Default 0.7. */
  grooveAmount?: number;
  /** Dynamic shape name. Applied as velocity post-processing after groove/humanize. */
  dynamic?: string;
  /** Inline parameter shapes — per-pattern parameter functions (ramps, triangles, etc.)
   *  that expand to ParameterEvent p-locks. Keys are controlIds. */
  paramShapes?: ParamShapes;
}

export interface AITransportAction {
  type: 'set_transport';
  bpm?: number;
  swing?: number;
  mode?: 'pattern' | 'song';
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
  /** When present, changes a drum pad's model instead of the track's synthesis engine */
  pad?: string;
  model: string;  // Engine ID from the instrument registry (e.g. "analog-bass-drum" for track, "modal" for Rings)
}

export interface AITransformAction {
  type: 'transform';
  trackId: string;
  /** For drum rack tracks: scope transform to a single pad's events. */
  pad?: string;
  operation: 'rotate' | 'transpose' | 'reverse' | 'duplicate' | 'humanize' | 'euclidean' | 'ghost_notes' | 'swing' | 'thin' | 'densify';
  steps?: number;
  semitones?: number;
  /** Velocity jitter amount for humanize (0-1). */
  velocity_amount?: number;
  /** Timing jitter amount for humanize (0-1). */
  timing_amount?: number;
  /** Number of hits for euclidean. */
  hits?: number;
  /** Rotation offset for euclidean (0 to steps-1). */
  rotation?: number;
  /** Velocity for euclidean/ghost_notes/densify (0-1). */
  velocity?: number;
  /** Probability for ghost_notes/thin/densify (0-1). */
  probability?: number;
  /** Swing amount (0-1). */
  amount?: number;
  description: string;
}

export interface PatternEditOp {
  action: 'add' | 'remove' | 'modify';
  step: number;
  /** AI-only disambiguator for targeting one existing stacked gate event at a step. */
  match?: {
    type: 'trigger' | 'note';
    pitch?: number;      // match an existing note at this step
  };
  event?: {
    type: 'trigger' | 'note';
    pitch?: number;      // 0-127 for notes
    velocity?: number;   // 0-1
    accent?: boolean;
    duration?: number;   // in steps
  };
  params?: { controlId: string; value: number }[];  // parameter locks
}

export interface AIEditPatternAction {
  type: 'edit_pattern';
  trackId: string;
  patternId?: string;
  /** For drum rack tracks: scope operations to a single pad's events. */
  pad?: string;
  operations: PatternEditOp[];
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

export interface AISetMuteSoloAction {
  type: 'set_mute_solo';
  trackId: string;
  muted?: boolean;
  solo?: boolean;
}

export interface AISetTrackMixAction {
  type: 'set_track_mix';
  trackId: string;
  volume?: number;  // 0.0–1.0
  pan?: number;     // -1.0 to 1.0
  swing?: number | null;  // 0.0–1.0 per-track override, null = inherit global
}

export interface AIManageSendAction {
  type: 'manage_send';
  action: 'add' | 'remove' | 'set_level';
  trackId: string;
  busId: string;
  level?: number;  // 0.0–1.0
}

export interface AISetSidechainAction {
  type: 'set_sidechain';
  /** Source track whose audio feeds the compressor's detector. Use null/undefined to remove. */
  sourceTrackId: string | null;
  /** Target track containing the compressor. */
  targetTrackId: string;
  /** Specific compressor processor ID. When omitted, auto-detects. */
  processorId?: string;
  description: string;
}

export interface AIManagePatternAction {
  type: 'manage_pattern';
  action: 'add' | 'remove' | 'duplicate' | 'rename' | 'set_active' | 'set_length' | 'clear';
  trackId: string;
  patternId?: string;
  name?: string;
  length?: number;
  description: string;
}

export interface AIManageSequenceAction {
  type: 'manage_sequence';
  action: 'append' | 'remove' | 'reorder' | 'set_automation' | 'clear_automation';
  trackId: string;
  patternId?: string;
  sequenceIndex?: number;
  toIndex?: number;
  controlId?: string;
  points?: import('./sequencer-types').SequenceAutomationPoint[];
  description: string;
}

export interface AISetSurfaceAction {
  type: 'set_surface';
  trackId: string;
  modules: SurfaceModule[];
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

export interface AISetIntentAction {
  type: 'set_intent';
  intent: SessionIntent;
}

export interface AISetSectionAction {
  type: 'set_section';
  section: SectionMeta;
}

export interface AISetScaleAction {
  type: 'set_scale';
  scale: ScaleConstraint | null;
}

export interface AISetChordProgressionAction {
  type: 'set_chord_progression';
  chordProgression: ChordProgressionEntry[] | null;
}

export interface AIAssignSpectralSlotAction {
  type: 'assign_spectral_slot';
  trackId: string;
  bands: string[];
  priority: number;
}

export interface AIManageMotifAction {
  type: 'manage_motif';
  action: 'register' | 'develop' | 'list' | 'recall';
  /** For register: extracted motif data. For develop: the developed motif result. */
  motifId?: string;
  motifName?: string;
  /** Source track + step range for register. */
  trackId?: string;
  stepRange?: [number, number];
  /** Development operations for develop action. */
  operations?: import('./motif-development').DevelopmentOp[];
  /** Target track for develop action (where to write the result). */
  targetTrackId?: string;
  description: string;
}

export interface AISetTensionAction {
  type: 'set_tension';
  /** Tension curve points to set (replaces existing points). */
  points: TensionPoint[];
  /** Optional track mappings to set or update. */
  trackMappings?: TrackTensionMapping[];
}

export interface AIReportBugAction {
  type: 'report_bug';
  bugId: string;
  summary: string;
  category: BugCategory;
  details: string;
  severity: BugSeverity;
  context?: string;
}

export interface AIAddTrackAction {
  type: 'add_track';
  kind: TrackKind;
  label?: string;
  description: string;
}

export interface AIRemoveTrackAction {
  type: 'remove_track';
  trackId: string;
  description: string;
}

export interface AIRenameTrackAction {
  type: 'rename_track';
  trackId: string;
  name: string;
}

export interface AISetPortamentoAction {
  type: 'set_portamento';
  trackId: string;
  time?: number;  // 0.0–1.0 (normalised)
  mode?: 'off' | 'always' | 'legato';
}

export interface AISetTrackIdentityAction {
  type: 'set_track_identity';
  trackId: string;
  identity: Partial<TrackVisualIdentity>;
}

export interface AIManageDrumPadAction {
  type: 'manage_drum_pad';
  trackId: string;
  action: 'add' | 'remove' | 'rename' | 'set_choke_group';
  padId: string;
  name?: string;
  model?: string;
  chokeGroup?: number | null;
  description: string;
}

export interface AISaveMemoryAction {
  type: 'save_memory';
  memoryType: ProjectMemoryType;
  content: string;
  evidence: string;
  trackId?: string;
  supersedes?: string;
}

export interface AIRecallMemoriesAction {
  type: 'recall_memories';
  trackId?: string;
  memoryType?: ProjectMemoryType;
}

export interface AIForgetMemoryAction {
  type: 'forget_memory';
  memoryId: string;
  reason: string;
}

export type AIAction = AIMoveAction | AISayAction | AISketchAction | AITransportAction | AISetModelAction | AITransformAction | AIEditPatternAction | AIAddViewAction | AIRemoveViewAction | AIAddProcessorAction | AIRemoveProcessorAction | AIReplaceProcessorAction | AIBypassProcessorAction | AIAddModulatorAction | AIRemoveModulatorAction | AIConnectModulatorAction | AIDisconnectModulatorAction | AISetMasterAction | AISetMuteSoloAction | AISetTrackMixAction | AIManageSendAction | AISetSidechainAction | AIManagePatternAction | AIManageSequenceAction | AISetSurfaceAction | AIPinAction | AIUnpinAction | AILabelAxesAction | AISetImportanceAction | AIRaiseDecisionAction | AIMarkApprovedAction | AIReportBugAction | AIAddTrackAction | AIRemoveTrackAction | AIRenameTrackAction | AISetPortamentoAction | AISetTrackIdentityAction | AISetIntentAction | AISetSectionAction | AISetScaleAction | AISetChordProgressionAction | AIAssignSpectralSlotAction | AIManageMotifAction | AISetTensionAction | AIManageDrumPadAction | AISaveMemoryAction | AIRecallMemoriesAction | AIForgetMemoryAction;

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

// --- Bug Reports ---

export type BugCategory = 'audio' | 'state' | 'tool' | 'ui' | 'other';
export type BugSeverity = 'low' | 'medium' | 'high';

export interface BugReport {
  id: string;
  summary: string;
  category: BugCategory;
  details: string;
  severity: BugSeverity;
  context?: string;
  timestamp: number;
}

// --- Permission Requests ---

/**
 * Permission request returned when the AI tries to change a protected
 * parameter (e.g. master bus volume). The operation is deferred until
 * the human approves or denies it.
 */
export interface PermissionRequest {
  id: string;
  description: string;
  operation: AIAction;
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

export interface HumanParamAction {
  kind: 'param';
  trackId: string;
  param: string;
  from: number;
  to: number;
  timestamp: number;
}

export interface HumanUndoRedoAction {
  kind: 'undo' | 'redo';
  description: string;
  timestamp: number;
}

export type HumanAction = HumanParamAction | HumanUndoRedoAction;

export interface Session {
  tracks: Track[];
  activeTrackId: string;
  transport: Transport;
  transportCommand?: TransportCommand;
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
  /** Bug reports filed by the AI during this session */
  bugReports?: BugReport[];
  /** IDs of tracks whose sidebar rows are expanded (accordion-style, independent of selection). */
  expandedTrackIds?: string[];
  /** Session-level creative intent (genre, mood, references, constraints). Survives context rotation. */
  intent?: SessionIntent;
  /** Current section metadata (name, energy, density targets). */
  section?: SectionMeta;
  /** Global scale/key constraint. When set, sketch pitches are auto-quantized. Null = chromatic/atonal. */
  scale?: ScaleConstraint | null;
  /** Bar-indexed harmonic cues for chord-aware generation. Null = explicitly cleared. */
  chordProgression?: ChordProgressionEntry[] | null;
  /** Tension/energy curve over the arrangement timeline. Metadata for AI compositional decisions. */
  tensionCurve?: TensionCurve;
  /** Per-project AI memories — persisted direction, track narratives, and decisions. */
  memories?: ProjectMemory[];
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
  /** Discriminator for special entry types (e.g. bug reports vs normal actions). */
  kind?: 'action' | 'bug-report';
}

/** A listen event — rendered audio the AI evaluated, exposed for human playback. */
export interface ListenEvent {
  /** Blob URL for playback (created via URL.createObjectURL). */
  audioUrl: string;
  /** Duration in seconds. */
  duration?: number;
  /** The listener model's evaluation summary. */
  evaluation?: string;
  /** Whether this is a before/after comparison. */
  isDiff?: boolean;
  /** Label (e.g. "before", "after", track name). */
  label?: string;
  /** Scope of what was rendered (track IDs or "full mix"). */
  scope?: string;
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
  /** Listen events — rendered audio the AI evaluated, with playback URLs. */
  listenEvents?: ListenEvent[];
  /** Range of undo stack entries produced by this AI turn.
   *  After collapse (batch path), start === end (single group).
   *  In streaming path with per-step groups, start..end spans multiple entries.
   *  The "undo this message" button is only available when end === undoStack.length - 1. */
  undoStackRange?: { start: number; end: number };
  /** Tracks the AI targeted during this turn.
   *  Populated when the message is finalised so the scope badge persists. */
  scopeTracks?: Array<{ trackId: string; name: string }>;
  /** AI-suggested contextual reaction chips (e.g. "more tense", "brighter").
   *  Generated per-turn by the planner via the suggest_reactions tool. */
  suggestedReactions?: string[];
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
