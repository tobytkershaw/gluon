// src/engine/operation-executor.ts
import type { Session, AIAction, AITransformAction, ActionGroupSnapshot, Snapshot, TransportSnapshot, ModelSnapshot, PatternEditSnapshot, ViewSnapshot, ProcessorSnapshot, ProcessorStateSnapshot, ProcessorConfig, ModulatorConfig, ModulationRouting, ModulatorSnapshot, ModulatorStateSnapshot, ModulationRoutingSnapshot, MasterSnapshot, SurfaceSnapshot, ClaimSnapshot, ActionDiff, TrackSurface, PreservationReport, OpenDecision, ToolCallEntry, ListenEvent, TrackPropertySnapshot, BugReport, ScaleSnapshot, ChordProgressionSnapshot, Track, TrackVisualIdentity, DrumPadSnapshot, DrumPad, MemorySnapshot, ProjectMemory } from './types';
import { MAX_DRUM_PADS, isValidMemoryType, isValidMemoryContent, MAX_PROJECT_MEMORIES } from './types';
import { getDefaultVisualIdentity } from './visual-identity';
import { kitToEvents, gridLength } from './drum-grid';

/**
 * Prefix used by prevalidateAction to distinguish master-volume permission
 * requests from other validation errors. The AI/UI layer detects this prefix
 * and shows a permission toast.
 */
export const MASTER_PERMISSION_PREFIX = 'Permission:';
import { applySurfaceTemplate, validateSurface, maybeApplySurfaceTemplate } from './surface-templates';
import type { ControlState, SourceAdapter, ExecutionReportLogEntry, MusicalEvent, MoveOp } from './canonical-types';
import type { Arbitrator } from './arbitration';
import { getTrack, getActivePattern, updateTrack, getTrackKind } from './types';
import { applyMove, applySketch, clampParam } from './primitives';
import { generateSemanticDiff } from './semantic-diff';
import { rotate, transpose, reverse, duplicate } from './transformations';
import {
  humanize,
  euclidean,
  ghostNotes,
  swing as swingTransform,
  thin,
  densify,
} from './musical-helpers';
import { applyGroove, GROOVE_TEMPLATES } from './groove-templates';
import { projectPatternToStepGrid } from './region-projection';
import { normalizePatternEvents, validatePattern } from './region-helpers';
import { editPatternEvents, validatePatternEditOps } from './pattern-primitives';
import { getTrackLabel } from './track-labels';
import { getEngineById, plaitsInstrument, getProcessorEngineByName, getModulatorEngineByName, getProcessorControlSchema, getProcessorDefaultParams, getModulatorDefaultParams } from '../audio/instrument-registry';
import { validateChainMutation, validateProcessorTarget, validateModulatorMutation, validateModulationTarget, validateModulatorTarget } from './chain-validation';
import { addTrack, removeTrack, addSend, removeSend, setSendLevel, addPattern, removePattern, duplicatePattern, renamePattern, setActivePatternOnTrack, addPatternRef, removePatternRef, reorderPatternRef, setSequenceAutomation, clearSequenceAutomation } from './session';
import { setPatternLength, clearPattern } from './pattern-primitives';
import { quantizePitch, scaleToString } from './scale';
import { normalizeChordProgression } from './chords';
import { applyDynamicShape } from './dynamic-shapes';

/** Clamp a number to a [min, max] range. */
function clampNum(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Extract sorted rhythm positions (the `at` values of note and trigger events)
 * from a list of musical events. Parameter events are excluded because they
 * don't define rhythm.
 */
export function extractRhythmPositions(events: MusicalEvent[]): number[] {
  return events
    .filter(e => e.kind === 'note' || e.kind === 'trigger')
    .map(e => e.at)
    .sort((a, b) => a - b);
}

/**
 * Compare two rhythm position arrays for exact equality within a small
 * tolerance (0.001 beats, matching the duplicate-event tolerance in
 * region-helpers).
 */
export function rhythmsMatch(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const TOLERANCE = 0.001;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > TOLERANCE) return false;
  }
  return true;
}

/**
 * Check whether a mutation would violate claim constraints on a track.
 * Returns null if the mutation is allowed, or a rejection reason string.
 *
 * Rules:
 * - Claimed tracks block all event mutations (sketch, transform).
 *   The AI must ask permission first.
 * - Unclaimed tracks are unrestricted.
 * - 'move' (parameter) actions are never blocked by claims.
 */
function checkClaimForSketch(
  session: Session,
  trackId: string,
  _newEvents?: MusicalEvent[],
): string | null {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return null; // track-not-found is handled elsewhere
  const claimed = track.claimed ?? false;
  if (!claimed) return null;

  const trackLabel = getTrackLabel(track).toUpperCase();
  return `Claimed: track ${trackLabel} (${trackId}) is claimed by the human — ask permission before modifying. Unclaim it first with set_track_meta.`;
}

function checkClaimForTransform(
  session: Session,
  trackId: string,
  _operation: string,
): string | null {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return null;
  const claimed = track.claimed ?? false;
  if (!claimed) return null;

  const trackLabel = getTrackLabel(track).toUpperCase();
  return `Claimed: track ${trackLabel} (${trackId}) is claimed by the human — ask permission before modifying. Unclaim it first with set_track_meta.`;
}

export interface OperationExecutionReport {
  session: Session;
  accepted: AIAction[];
  rejected: { op: AIAction; reason: string }[];
  log: ExecutionReportLogEntry[];
  /** For accepted move actions, maps action index → resolved runtime param key */
  resolvedParams: Map<number, string>;
  /** Preservation reports for sketch edits on tracks with approval >= 'liked' */
  preservationReports: PreservationReport[];
}

/** Result of resolving a move action's param through the adapter */
interface ResolvedMoveParam {
  runtimeParam: string;
  controlId: string;
}

/**
 * Resolve a move action's param key through the adapter.
 * Returns the runtime param key and canonical control ID, or null if unresolvable.
 */
function resolveMoveParam(param: string, adapter: SourceAdapter): ResolvedMoveParam | null {
  // Try as runtime param key first (runtime → canonical)
  const mappedCanonical = adapter.mapRuntimeParamKey(param);
  if (mappedCanonical) {
    return { runtimeParam: param, controlId: mappedCanonical };
  }

  // Try as controlId (canonical → runtime)
  const binding = adapter.mapControl(param);
  const pathParts = binding?.path.split('.');
  const candidate = pathParts?.[pathParts.length - 1];
  if (candidate && candidate !== param && adapter.mapRuntimeParamKey(candidate)) {
    return { runtimeParam: candidate, controlId: param };
  }

  return null;
}

/**
 * Pre-validate an action against session state without applying it.
 * Returns null if the action would be accepted, or a rejection reason.
 * Used by the tool loop to give honest function responses, and by
 * executeOperations as its single source of truth for rejection logic.
 */
export function prevalidateAction(
  session: Session,
  action: AIAction,
  adapter: SourceAdapter,
  arbitrator: Arbitrator,
): string | null {
  switch (action.type) {
    case 'move': {
      const trackId = action.trackId ?? session.activeTrackId;
      const track = session.tracks.find(v => v.id === trackId);
      if (!track) return `Track not found: ${trackId}`;


      // Modulator path: validate against modulator registry
      if (action.modulatorId) {
        if (action.over) return `Timed moves (over) are not supported for modulator controls`;
        const targetResult = validateModulatorTarget(track, action.modulatorId, { param: action.param });
        if (!targetResult.valid) return targetResult.errors[0];
        if (!arbitrator.canAIAct(trackId, `modulator:${action.modulatorId}:${action.param}`)) {
          return `Arbitration: human is currently interacting with ${action.modulatorId}:${action.param} on ${trackId}`;
        }
        return null;
      }

      // Processor path: validate against processor registry via chain-validation
      if (action.processorId) {
        if (action.over) return `Timed moves (over) are not supported for processor controls`;
        const targetResult = validateProcessorTarget(track, action.processorId, { param: action.param });
        if (!targetResult.valid) return targetResult.errors[0];
        if (!arbitrator.canAIAct(trackId, `processor:${action.processorId}:${action.param}`)) {
          return `Arbitration: human is currently interacting with ${action.processorId}:${action.param} on ${trackId}`;
        }
        return null;
      }

      // Drum rack per-pad param path: "padId.param"
      if (action.param.includes('.') && track.engine === 'drum-rack' && track.drumRack) {
        const dotIdx = action.param.indexOf('.');
        const padId = action.param.slice(0, dotIdx);
        const padParam = action.param.slice(dotIdx + 1);
        const pad = track.drumRack.pads.find(p => p.id === padId);
        if (!pad) return `Drum pad not found: ${padId}`;
        if (padParam !== 'level' && padParam !== 'pan' && !(padParam in pad.source.params)) {
          return `Unknown drum pad control: ${padParam} on pad ${padId}`;
        }
        if (!arbitrator.canAIActOnTrack(trackId)) {
          return `Arbitration: human is currently interacting with track ${trackId}`;
        }
        return null;
      }

      // Source path: resolve through adapter
      const resolved = resolveMoveParam(action.param, adapter);
      if (!resolved) return `Unknown control: ${action.param}`;

      const validationMove: MoveOp = {
        type: 'move',
        trackId,
        controlId: resolved.controlId,
        target: 'absolute' in action.target
          ? { absolute: action.target.absolute }
          : { relative: action.target.relative },
        ...(action.over ? { overMs: action.over } : {}),
      };
      const validation = adapter.validateOperation(validationMove);
      if (!validation.valid) return validation.reason ?? `Validation failed for ${action.param}`;

      if (!arbitrator.canAIAct(trackId, resolved.runtimeParam)) {
        return `Arbitration: human is currently holding ${resolved.runtimeParam} on ${trackId}`;
      }
      return null;
    }

    case 'sketch': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      // Drum rack validation
      if (track.engine === 'drum-rack' && track.drumRack) {
        const pads = track.drumRack.pads;
        const padIdSet = new Set(pads.map(p => p.id));
        if (action.events) {
          for (const ev of action.events) {
            if (ev.kind === 'trigger') {
              const trigger = ev as { padId?: string };
              if (!trigger.padId) return `Drum rack triggers must have padId`;
              if (!padIdSet.has(trigger.padId)) return `Pad not found: ${trigger.padId}`;
            }
          }
        }
        if (action.kit) {
          const activeReg = track.patterns.length > 0 ? getActivePattern(track) : undefined;
          if (!activeReg) return `No active pattern on drum rack track`;
          for (const [padId, grid] of Object.entries(action.kit)) {
            if (!padIdSet.has(padId)) return `Pad not found: ${padId}`;
            const len = gridLength(grid);
            if (len !== activeReg.duration) return `Grid length for pad "${padId}" (${len}) does not match pattern duration (${activeReg.duration})`;
          }
        }
      }

      const sketchPreservation = checkClaimForSketch(session, action.trackId, action.events);
      if (sketchPreservation) return sketchPreservation;
      return null;
    }

    case 'set_model': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      // Drum rack pad path
      if (action.pad) {
        if (track.engine !== 'drum-rack' || !track.drumRack) return `Track ${action.trackId} is not a drum rack`;
        const pad = track.drumRack.pads.find(p => p.id === action.pad);
        if (!pad) return `Pad not found: ${action.pad}`;
        const padEngine = getEngineById(action.model);
        if (!padEngine) return `Unknown model: ${action.model}`;
        if (!arbitrator.canAIActOnTrack(action.trackId)) {
          return `Arbitration: human is currently interacting with track ${action.trackId}`;
        }
        return null;
      }

      // Modulator path: resolve model against modulator type's engine list
      if (action.modulatorId) {
        const targetResult = validateModulatorTarget(track, action.modulatorId, { model: action.model });
        if (!targetResult.valid) return targetResult.errors[0];
        if (!arbitrator.canAIActOnTrack(action.trackId)) {
          return `Arbitration: human is currently interacting with track ${action.trackId}`;
        }
        return null;
      }

      // Processor path: resolve model against processor type's engine list via chain-validation
      if (action.processorId) {
        const targetResult = validateProcessorTarget(track, action.processorId, { model: action.model });
        if (!targetResult.valid) return targetResult.errors[0];
        if (!arbitrator.canAIActOnTrack(action.trackId)) {
          return `Arbitration: human is currently interacting with track ${action.trackId}`;
        }
        return null;
      }

      // Source path: resolve against Plaits engines
      const engine = getEngineById(action.model);
      if (!engine) return `Unknown model: ${action.model}`;
      if (!arbitrator.canAIActOnTrack(action.trackId)) {
        return `Arbitration: human is currently interacting with track ${action.trackId}`;
      }
      return null;
    }

    case 'edit_pattern': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      if (track.patterns.length === 0) return `Track ${action.trackId} has no patterns`;
      // Resolve pattern
      const targetPattern = action.patternId
        ? track.patterns.find(p => p.id === action.patternId)
        : getActivePattern(track);
      if (!targetPattern) return `Pattern not found: ${action.patternId}`;
      // Validate operations against pattern
      const opErrors = validatePatternEditOps(targetPattern, action.operations);
      if (opErrors.length > 0) return opErrors[0];
      // Check preservation
      const editPreservation = checkClaimForSketch(session, action.trackId, undefined);
      if (editPreservation) return editPreservation;
      if (!arbitrator.canAIActOnTrack(action.trackId)) {
        return `Arbitration: human is currently interacting with track ${action.trackId}`;
      }
      return null;
    }

    case 'transform': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      if (action.pad && action.operation === 'duplicate') {
        return `Cannot duplicate a single pad's events — duplicate applies to the full pattern.`;
      }

      const transformPreservation = checkClaimForTransform(session, action.trackId, action.operation);
      if (transformPreservation) return transformPreservation;
      return null;
    }

    case 'add_view': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      // No agency check — view ops are UI curation, not musical mutation
      return null;
    }

    case 'remove_view': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      // No agency check
      const views = track.views ?? [];
      if (!views.some(v => v.id === action.viewId)) return `View not found: ${action.viewId}`;
      return null;
    }

    case 'add_processor': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      const chainResult = validateChainMutation(track, { kind: 'add', type: action.moduleType });
      if (!chainResult.valid) return chainResult.errors[0];
      if (!arbitrator.canAIActOnTrack(action.trackId)) {
        return `Arbitration: human is currently interacting with track ${action.trackId}`;
      }
      return null;
    }

    case 'remove_processor': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      const chainResult = validateChainMutation(track, { kind: 'remove', processorId: action.processorId });
      if (!chainResult.valid) return chainResult.errors[0];
      if (!arbitrator.canAIActOnTrack(action.trackId)) {
        return `Arbitration: human is currently interacting with track ${action.trackId}`;
      }
      return null;
    }

    case 'replace_processor': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      // Validate old processor exists
      const removeResult = validateChainMutation(track, { kind: 'remove', processorId: action.processorId });
      if (!removeResult.valid) return removeResult.errors[0];
      // Validate new type is valid (use a simulated chain without the old one for the add check)
      const filteredProcessors = (track.processors ?? []).filter(p => p.id !== action.processorId);
      const simulatedTrack = { ...track, processors: filteredProcessors };
      const addResult = validateChainMutation(simulatedTrack, { kind: 'add', type: action.newModuleType });
      if (!addResult.valid) return addResult.errors[0];
      if (!arbitrator.canAIActOnTrack(action.trackId)) {
        return `Arbitration: human is currently interacting with track ${action.trackId}`;
      }
      return null;
    }

    case 'bypass_processor': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      const proc = (track.processors ?? []).find(p => p.id === action.processorId);
      if (!proc) return `Processor not found: ${action.processorId}`;
      if (!arbitrator.canAIActOnTrack(action.trackId)) {
        return `Arbitration: human is currently interacting with track ${action.trackId}`;
      }
      return null;
    }

    case 'add_modulator': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      const modResult = validateModulatorMutation(track, { kind: 'add', type: action.moduleType });
      if (!modResult.valid) return modResult.errors[0];
      if (!arbitrator.canAIActOnTrack(action.trackId)) {
        return `Arbitration: human is currently interacting with track ${action.trackId}`;
      }
      return null;
    }

    case 'remove_modulator': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      const modResult = validateModulatorMutation(track, { kind: 'remove', modulatorId: action.modulatorId });
      if (!modResult.valid) return modResult.errors[0];
      if (!arbitrator.canAIActOnTrack(action.trackId)) {
        return `Arbitration: human is currently interacting with track ${action.trackId}`;
      }
      return null;
    }

    case 'connect_modulator': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      const routeResult = validateModulationTarget(track, { modulatorId: action.modulatorId, target: action.target, depth: action.depth });
      if (!routeResult.valid) return routeResult.errors[0];
      if (!arbitrator.canAIActOnTrack(action.trackId)) {
        return `Arbitration: human is currently interacting with track ${action.trackId}`;
      }
      return null;
    }

    case 'disconnect_modulator': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      const modulations = track.modulations ?? [];
      if (!modulations.some(m => m.id === action.modulationId)) return `Modulation routing not found: ${action.modulationId}`;
      if (!arbitrator.canAIActOnTrack(action.trackId)) {
        return `Arbitration: human is currently interacting with track ${action.trackId}`;
      }
      return null;
    }

    case 'set_surface': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      // No agency check — surface ops are UI curation, not musical mutation
      const candidateSurface: TrackSurface = {
        ...track.surface,
        modules: action.modules,
      };
      const surfaceError = validateSurface(candidateSurface, track);
      if (surfaceError) return surfaceError;
      return null;
    }

    case 'pin': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      const MAX_PINS = 4;
      const pinnedCount = track.surface.modules.filter(m => m.config.pinned === true).length;
      if (pinnedCount >= MAX_PINS) {
        return `Maximum ${MAX_PINS} pinned controls per track`;
      }
      // Validate module exists
      const validModuleIds = new Set<string>(['source']);
      for (const proc of track.processors ?? []) validModuleIds.add(proc.id);
      if (!validModuleIds.has(action.moduleId)) return `Unknown module: ${action.moduleId}`;
      return null;
    }

    case 'unpin': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      const pinModule = track.surface.modules.find(
        m => m.config.pinned === true && m.bindings.some(b => b.target === `${action.moduleId}:${action.controlId}`),
      );
      if (!pinModule) return `Pin not found: ${action.moduleId}:${action.controlId}`;
      return null;
    }

    case 'label_axes': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      const hasXYPad = track.surface.modules.some(m => m.type === 'xy-pad');
      if (!hasXYPad) return `No XY Pad module on track ${action.trackId} — use set_surface to add one`;
      return null;
    }

    case 'set_importance': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      // No agency check — importance is AI metadata, not musical mutation
      return null;
    }

    case 'set_track_identity': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      // No agency check — visual identity is AI metadata, not musical mutation
      return null;
    }

    case 'set_claim': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      if (typeof action.claimed !== 'boolean') return `Invalid claim value: ${action.claimed}`;
      return null;
    }

    case 'mark_approved': {
      // Legacy — kept for backwards compatibility
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      return null;
    }

    case 'raise_decision':
      // No side-effect guards needed — raise_decision only appends to openDecisions
      return null;

    case 'add_track':
      // No agency check — adding a new track doesn't mutate existing state
      return null;

    case 'remove_track': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      if (track.claimed) return `Track ${action.trackId} is claimed — cannot remove without unclaiming first`;
      return null;
    }

    case 'report_bug':
      // No side-effect guards needed — report_bug only appends to bugReports
      return null;

    case 'set_intent':
      // No side-effect guards — session metadata, not musical mutation
      return null;

    case 'set_section':
      // No side-effect guards — session metadata, not musical mutation
      return null;

    case 'set_scale':
      // No side-effect guards — session metadata, not musical mutation
      return null;

    case 'set_chord_progression':
      // No side-effect guards — session metadata, not musical mutation
      return null;

    case 'set_mute_solo': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      return null;
    }

    case 'set_track_mix': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      return null;
    }

    case 'set_portamento': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      if (action.time !== undefined) {
        if (!Number.isFinite(action.time)) return `Non-finite portamento time: ${action.time}`;
        if (action.time < 0 || action.time > 1) return `Portamento time out of range (0.0-1.0): ${action.time}`;
      }
      if (action.mode !== undefined && !['off', 'always', 'legato'].includes(action.mode)) {
        return `Invalid portamento mode: ${action.mode}`;
      }
      return null;
    }

    case 'rename_track': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      return null;
    }

    case 'manage_send': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      return null;
    }

    case 'manage_pattern': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      return null;
    }

    case 'manage_sequence': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;

      return null;
    }

    case 'set_sidechain': {
      const targetTrack = session.tracks.find(v => v.id === action.targetTrackId);
      if (!targetTrack) return `Track not found: ${action.targetTrackId}`;

      if (action.sourceTrackId !== null) {
        const sourceTrack = session.tracks.find(v => v.id === action.sourceTrackId);
        if (!sourceTrack) return `Source track not found: ${action.sourceTrackId}`;
        if (action.sourceTrackId === action.targetTrackId) return `Sidechain source and target must be different tracks`;
        // Multi-hop cycle detection: walk from sourceTrackId following sidechain links
        // to see if we can reach targetTrackId (which would create a cycle)
        const visited = new Set<string>();
        let current = action.sourceTrackId;
        while (current && !visited.has(current)) {
          visited.add(current);
          const t = session.tracks.find(v => v.id === current);
          if (!t) break;
          // Find sidechain sources pointing at this track (i.e. this track's compressors
          // use some other track as sidechain source — follow that chain)
          let next: string | undefined;
          for (const p of t.processors ?? []) {
            if (p.type === 'compressor' && p.sidechainSourceId) {
              if (p.sidechainSourceId === action.targetTrackId) {
                return `Circular sidechain routing detected`;
              }
              // Continue walking from the sidechain source
              next = p.sidechainSourceId;
            }
          }
          current = next!;
        }
      }
      return null;
    }

    case 'manage_drum_pad': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      if (track.engine !== 'drum-rack' || !track.drumRack) {
        // Auto-promote: allow adding the first pad to an empty audio track
        const canAutoPromote = action.action === 'add'
          && getTrackKind(track) === 'audio'
          && track.engine === ''
          && track.model === -1
          && !track.drumRack;
        if (!canAutoPromote) {
          return `Track ${action.trackId} is not a drum rack`;
        }
      }
      const pads = track.drumRack?.pads ?? [];
      switch (action.action) {
        case 'add': {
          if (pads.length >= MAX_DRUM_PADS) return `Maximum ${MAX_DRUM_PADS} pads per drum rack`;
          if (pads.some(p => p.id === action.padId)) return `Pad ID already exists: ${action.padId}`;
          if (!action.model) return `action=add requires model`;
          const padEngine = getEngineById(action.model);
          if (!padEngine) return `Unknown model: ${action.model}`;
          break;
        }
        case 'remove':
          if (!pads.some(p => p.id === action.padId)) return `Pad not found: ${action.padId}`;
          break;
        case 'rename':
          if (!pads.some(p => p.id === action.padId)) return `Pad not found: ${action.padId}`;
          if (!action.name) return `action=rename requires name`;
          break;
        case 'set_choke_group':
          if (!pads.some(p => p.id === action.padId)) return `Pad not found: ${action.padId}`;
          if (action.chokeGroup !== null && action.chokeGroup !== undefined && (typeof action.chokeGroup !== 'number' || action.chokeGroup < 1)) {
            return `chokeGroup must be an integer >= 1 or null`;
          }
          break;
        default:
          return `Unknown manage_drum_pad action: ${action.action}`;
      }
      if (!arbitrator.canAIActOnTrack(action.trackId)) {
        return `Arbitration: human is currently interacting with track ${action.trackId}`;
      }
      return null;
    }

    case 'save_memory': {
      if (!isValidMemoryType(action.memoryType)) return `Invalid memory type: ${action.memoryType}`;
      if (!isValidMemoryContent(action.content)) return `Invalid memory content: must be non-empty and max 500 characters`;
      if (typeof action.evidence !== 'string' || !action.evidence) return `Missing required field: evidence`;
      if (action.trackId !== undefined) {
        const track = session.tracks.find(v => v.id === action.trackId);
        if (!track) return `Track not found: ${action.trackId}`;
      }
      const memories = session.memories ?? [];
      if (action.supersedes !== undefined) {
        if (!memories.some(m => m.id === action.supersedes)) return `Memory not found for supersedes: ${action.supersedes}`;
      } else if (memories.length >= MAX_PROJECT_MEMORIES) {
        return `Memory cap reached: ${MAX_PROJECT_MEMORIES} memories maximum. Use supersedes to replace an existing memory.`;
      }
      return null;
    }

    case 'recall_memories': {
      // Read-only: validate optional filters
      if (action.trackId) {
        const track = session.tracks.find(v => v.id === action.trackId);
        if (!track) return `Track not found: ${action.trackId}`;
      }
      if (action.memoryType) {
        if (!isValidMemoryType(action.memoryType)) return `Invalid memory type: ${action.memoryType}. Must be one of: direction, track-narrative, decision`;
      }
      return null;
    }

    case 'forget_memory': {
      if (!action.memoryId) return `Missing required parameter: memoryId`;
      if (!action.reason || action.reason.trim().length === 0) return `Missing required parameter: reason`;
      const memories = session.memories ?? [];
      if (!memories.some(m => m.id === action.memoryId)) return `Memory not found: ${action.memoryId}`;
      return null;
    }

    case 'set_transport':
    case 'say':
      return null;

    case 'set_master': {
      // Master volume/pan changes require human permission
      if (action.volume !== undefined || action.pan !== undefined) {
        return `${MASTER_PERMISSION_PREFIX} AI wants to adjust master ${action.volume !== undefined ? 'volume' : 'pan'}`;
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Preservation report generation
// ---------------------------------------------------------------------------

/**
 * Generate a PreservationReport comparing old and new events for a track.
 * Only called for claimed tracks.
 */
export function generatePreservationReport(
  trackId: string,
  claimed: boolean,
  oldEvents: MusicalEvent[],
  newEvents: MusicalEvent[],
): PreservationReport {
  // Extract rhythm positions (the 'at' values of sound events: triggers and notes)
  const getSoundPositions = (events: MusicalEvent[]): number[] =>
    events
      .filter(e => e.kind === 'trigger' || e.kind === 'note')
      .map(e => Math.round(e.at * 1000) / 1000)
      .sort((a, b) => a - b);

  const oldPositions = getSoundPositions(oldEvents);
  const newPositions = getSoundPositions(newEvents);

  // Rhythm preserved if the same set of time positions
  const rhythmPositions =
    oldPositions.length === newPositions.length &&
    oldPositions.every((pos, i) => Math.abs(pos - newPositions[i]) < 0.001);

  // Event count preserved
  const eventCount = oldEvents.length === newEvents.length;

  // Pitch contour: compare relative pitch relationships of note events
  const getPitches = (events: MusicalEvent[]): number[] =>
    events
      .filter((e): e is import('./canonical-types').NoteEvent => e.kind === 'note')
      .sort((a, b) => a.at - b.at)
      .map(e => e.pitch);

  const oldPitches = getPitches(oldEvents);
  const newPitches = getPitches(newEvents);

  let pitchContour = true;
  if (oldPitches.length !== newPitches.length || oldPitches.length === 0) {
    // If no notes or different count, contour can't be compared
    pitchContour = oldPitches.length === newPitches.length;
  } else if (oldPitches.length > 1) {
    // Compare relative intervals (contour shape)
    const getIntervals = (pitches: number[]) =>
      pitches.slice(1).map((p, i) => Math.sign(p - pitches[i]));
    const oldIntervals = getIntervals(oldPitches);
    const newIntervals = getIntervals(newPitches);
    pitchContour = oldIntervals.every((dir, i) => dir === newIntervals[i]);
  }

  // Run semantic diff for richer descriptions
  const semanticDiff = generateSemanticDiff(oldEvents, newEvents, {
    trackId,
    stepsPerBeat: 4,
  });
  const dimByKind = new Map(semanticDiff.dimensions.map(d => [d.kind, d]));

  // Build changed list — use semantic diff descriptions where available, fallback otherwise
  const changed: string[] = [];

  if (!rhythmPositions) {
    const rhythmDim = dimByKind.get('rhythm_placement') ?? dimByKind.get('density');
    if (rhythmDim) {
      changed.push(rhythmDim.description);
    } else {
      const added = newPositions.length - oldPositions.length;
      if (added > 0) changed.push(`${added} rhythm position${added !== 1 ? 's' : ''} added`);
      else if (added < 0) changed.push(`${-added} rhythm position${added !== -1 ? 's' : ''} removed`);
      else changed.push('rhythm positions shifted');
    }
  }

  if (!eventCount) {
    const densityDim = dimByKind.get('density');
    if (densityDim && !changed.includes(densityDim.description)) {
      changed.push(densityDim.description);
    } else if (!densityDim) {
      const diff = newEvents.length - oldEvents.length;
      if (diff > 0) changed.push(`${diff} event${diff !== 1 ? 's' : ''} added`);
      else changed.push(`${-diff} event${-diff !== 1 ? 's' : ''} removed`);
    }
  }

  if (!pitchContour && oldPitches.length > 0) {
    const contourDim = dimByKind.get('contour') ?? dimByKind.get('transposition');
    changed.push(contourDim ? contourDim.description : 'pitch contour modified');
  }

  // Detect velocity changes on sound events
  const getVelocities = (events: MusicalEvent[]): number[] =>
    events
      .filter(e => e.kind === 'trigger' || e.kind === 'note')
      .sort((a, b) => a.at - b.at)
      .map(e => (e as { velocity?: number }).velocity ?? 1.0);

  const oldVels = getVelocities(oldEvents);
  const newVels = getVelocities(newEvents);
  if (oldVels.length === newVels.length) {
    const velChanges = oldVels.filter((v, i) => Math.abs(v - newVels[i]) > 0.001).length;
    if (velChanges > 0) {
      changed.push(`${velChanges} velocity value${velChanges !== 1 ? 's' : ''} modified`);
    }
  }

  // Detect parameter event changes
  const getParamEvents = (events: MusicalEvent[]) =>
    events.filter(e => e.kind === 'parameter');
  const oldParams = getParamEvents(oldEvents);
  const newParams = getParamEvents(newEvents);
  if (oldParams.length !== newParams.length) {
    const diff = newParams.length - oldParams.length;
    if (diff > 0) changed.push(`${diff} parameter event${diff !== 1 ? 's' : ''} added`);
    else changed.push(`${-diff} parameter event${-diff !== 1 ? 's' : ''} removed`);
  }

  return {
    trackId,
    preserved: { rhythmPositions, eventCount, pitchContour },
    changed,
    claimed,
  };
}

// ---------------------------------------------------------------------------
// Step-level execution (#945) — shared internal helper + public wrappers
// ---------------------------------------------------------------------------

/** Lightweight report from step-level execution (no undo grouping, no message). */
export interface StepExecutionReport {
  session: Session;
  accepted: AIAction[];
  rejected: Array<{ op: AIAction; reason: string }>;
  log: ExecutionReportLogEntry[];
  resolvedParams: Map<number, string>;
  preservationReports: PreservationReport[];
  /** Say texts collected from 'say' actions in this step. */
  sayTexts: string[];
}

/**
 * Execute a batch of AI actions without undo grouping or ChatMessage creation.
 * Used by the step-based agentic loop (#945) where grouping and finalization
 * happen across multiple steps at the end of the turn.
 */
export function executeStepActions(
  session: Session,
  actions: AIAction[],
  adapter: SourceAdapter,
  arbitrator: Arbitrator,
): StepExecutionReport {
  return executeActionsInternal(session, actions, adapter, arbitrator);
}

/**
 * Collapse undo entries above `baseline` into a single ActionGroupSnapshot.
 * Handles nested groups (e.g. remove_processor cascades) by flattening.
 * Returns the stack unchanged if there are 0 or 1 new entries.
 */
export function groupSnapshots(
  undoStack: UndoEntry[],
  baseline: number,
  description: string,
): UndoEntry[] {
  const newEntries = undoStack.slice(baseline);
  if (newEntries.length <= 1) return undoStack;
  const flatSnaps: Snapshot[] = [];
  for (const e of newEntries) {
    if (e.kind === 'group') flatSnaps.push(...e.snapshots);
    else flatSnaps.push(e);
  }
  const group: ActionGroupSnapshot = {
    kind: 'group',
    snapshots: flatSnaps,
    timestamp: Date.now(),
    description,
  };
  return [...undoStack.slice(0, baseline), group];
}

/**
 * Finalize an AI turn: optionally collapse undo snapshots above `undoBaseline`
 * into a single ActionGroupSnapshot and append a ChatMessage with the combined
 * text, action log, and tool calls. Creates a ChatMessage whenever there is say
 * text or log entries (even when no undo entries exist).
 *
 * @param collapse  When true (default), collapses all snapshots above baseline
 *   into one group. When false, leaves per-step groups intact (streaming path).
 */
export function finalizeAITurn(
  session: Session,
  undoBaseline: number,
  sayTexts: string[],
  log: ExecutionReportLogEntry[],
  toolCalls?: ToolCallEntry[],
  collapse = true,
  suggestedReactions?: string[],
  listenEvents?: ListenEvent[],
): Session {
  let next = session;

  if (collapse) {
    // Collapse multiple snapshots into a single undo group
    const sayText = sayTexts.join(' ');
    const trackCount = new Set(log.map(e => e.trackId)).size;
    const undoDesc = sayText || `AI: ${log.length} changes across ${trackCount} track${trackCount !== 1 ? 's' : ''}`;
    next = { ...next, undoStack: groupSnapshots(next.undoStack, undoBaseline, undoDesc) };
  }

  // Add message
  const combinedSay = sayTexts.join(' ');
  if (combinedSay || log.length > 0 || (listenEvents && listenEvents.length > 0)) {
    const hasUndoEntries = next.undoStack.length > undoBaseline;
    // Derive scope tracks from log entries — deduplicate by trackId
    const scopeMap = new Map<string, { trackId: string; name: string }>();
    for (const entry of log) {
      if (!scopeMap.has(entry.trackId)) {
        const track = next.tracks.find(t => t.id === entry.trackId);
        scopeMap.set(entry.trackId, {
          trackId: entry.trackId,
          name: track?.name || entry.trackLabel || entry.trackId,
        });
      }
    }
    const scopeTracks = scopeMap.size > 0 ? [...scopeMap.values()] : undefined;
    next = {
      ...next,
      messages: [...next.messages, {
        role: 'ai' as const,
        text: combinedSay,
        timestamp: Date.now(),
        ...(log.length > 0 ? { actions: log } : {}),
        ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
        ...(listenEvents && listenEvents.length > 0 ? { listenEvents } : {}),
        ...(hasUndoEntries ? { undoStackRange: { start: undoBaseline, end: next.undoStack.length - 1 } } : {}),
        ...(scopeTracks ? { scopeTracks } : {}),
        ...(suggestedReactions && suggestedReactions.length > 0 ? { suggestedReactions } : {}),
      }],
    };
  }

  return next;
}

// ---------------------------------------------------------------------------
// executeOperations — backward-compatible wrapper
// ---------------------------------------------------------------------------

export function executeOperations(
  session: Session,
  actions: AIAction[],
  adapter: SourceAdapter,
  arbitrator: Arbitrator,
  toolCalls?: ToolCallEntry[],
): OperationExecutionReport {
  const undoBaseline = session.undoStack.length;
  const result = executeActionsInternal(session, actions, adapter, arbitrator);
  const finalized = finalizeAITurn(result.session, undoBaseline, result.sayTexts, result.log, toolCalls);
  return {
    session: finalized,
    accepted: result.accepted,
    rejected: result.rejected,
    log: result.log,
    resolvedParams: result.resolvedParams,
    preservationReports: result.preservationReports,
  };
}

// ---------------------------------------------------------------------------
// Internal action execution loop
// ---------------------------------------------------------------------------

function executeActionsInternal(
  session: Session,
  actions: AIAction[],
  adapter: SourceAdapter,
  arbitrator: Arbitrator,
): StepExecutionReport {
  const accepted: AIAction[] = [];
  const rejected: { op: AIAction; reason: string }[] = [];
  const log: ExecutionReportLogEntry[] = [];
  const sayTexts: string[] = [];
  const resolvedParams = new Map<number, string>();
  const preservationReports: PreservationReport[] = [];

  let next = session;

  for (const action of actions) {
    // Early rejection via shared validation (uses `next` so sequential
    // actions see the effects of prior ones)
    const rejection = prevalidateAction(next, action, adapter, arbitrator);
    if (rejection) {
      rejected.push({ op: action, reason: rejection });
      continue;
    }

    switch (action.type) {
      case 'move': {
        const trackId = action.trackId ?? next.activeTrackId;
        const track = getTrack(next, trackId);
        const vLabel = getTrackLabel(getTrack(next, trackId)).toUpperCase();

        // Modulator path: write directly to modulator.params
        if (action.modulatorId) {
          const modulators = track.modulators ?? [];
          const modIndex = modulators.findIndex(m => m.id === action.modulatorId);
          if (modIndex < 0) { rejected.push({ op: action, reason: `Internal: modulator ${action.modulatorId} not found at execution` }); break; }
          const mod = modulators[modIndex];
          const currentVal = mod.params[action.param] ?? 0;
          const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
          const clampedTarget = clampParam(rawTarget);
          if (clampedTarget === null) { rejected.push({ op: action, reason: `Non-finite parameter value: ${rawTarget} for modulator ${action.modulatorId}/${action.param}` }); break; }
          const targetVal = clampedTarget;

          const snapshot: ModulatorStateSnapshot = {
            kind: 'modulator-state',
            trackId,
            modulatorId: action.modulatorId,
            prevParams: { ...mod.params },
            prevModel: mod.model,
            timestamp: Date.now(),
            description: `AI modulator move: ${action.param} ${currentVal.toFixed(2)} -> ${targetVal.toFixed(2)}`,
          };

          const updatedMod = { ...mod, params: { ...mod.params, [action.param]: targetVal } };
          const newModulators = [...modulators];
          newModulators[modIndex] = updatedMod;

          next = {
            ...updateTrack(next, trackId, { modulators: newModulators }),
            undoStack: [...next.undoStack, snapshot],
          };

          log.push({ trackId, trackLabel: vLabel, description: `${mod.type}/${action.param} ${currentVal.toFixed(2)} → ${targetVal.toFixed(2)}`, diff: { kind: 'param-change', controlId: `${mod.type}/${action.param}`, from: currentVal, to: targetVal } });
          accepted.push(action);
          break;
        }

        // Processor path: write directly to processor.params
        if (action.processorId) {
          const processors = track.processors ?? [];
          const procIndex = processors.findIndex(p => p.id === action.processorId);
          if (procIndex < 0) { rejected.push({ op: action, reason: `Internal: processor ${action.processorId} not found at execution` }); break; }
          const proc = processors[procIndex];
          const currentVal = proc.params[action.param] ?? 0;
          const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
          if (!Number.isFinite(rawTarget)) { rejected.push({ op: action, reason: `Non-finite parameter value: ${rawTarget} for processor ${action.processorId}/${action.param}` }); break; }
          // Clamp to the control's declared range (discrete controls like polyphony use 1-4, not 0-1).
          // Boolean controls store 0/1 numerically. Default to 0-1 for unknown controls.
          const schema = getProcessorControlSchema(proc.type, action.param);
          const clampMin = schema?.range?.min ?? 0;
          const clampMax = schema?.range?.max ?? 1;
          let targetVal = Math.max(clampMin, Math.min(clampMax, rawTarget));
          // Round discrete controls to integers
          if (schema?.kind === 'discrete') targetVal = Math.round(targetVal);

          const snapshot: ProcessorStateSnapshot = {
            kind: 'processor-state',
            trackId,
            processorId: action.processorId,
            prevParams: { ...proc.params },
            prevModel: proc.model,
            timestamp: Date.now(),
            description: `AI processor move: ${action.param} ${currentVal.toFixed(2)} -> ${targetVal.toFixed(2)}`,
          };

          const updatedProc = { ...proc, params: { ...proc.params, [action.param]: targetVal } };
          const newProcessors = [...processors];
          newProcessors[procIndex] = updatedProc;

          next = {
            ...updateTrack(next, trackId, { processors: newProcessors }),
            undoStack: [...next.undoStack, snapshot],
          };

          log.push({ trackId, trackLabel: vLabel, description: `${proc.type}/${action.param} ${currentVal.toFixed(2)} → ${targetVal.toFixed(2)}`, diff: { kind: 'param-change', controlId: `${proc.type}/${action.param}`, from: currentVal, to: targetVal } });
          accepted.push(action);
          break;
        }

        // Drum rack per-pad param path: "padId.param"
        if (action.param.includes('.') && track.engine === 'drum-rack' && track.drumRack) {
          const dotIdx = action.param.indexOf('.');
          const padId = action.param.slice(0, dotIdx);
          const padParam = action.param.slice(dotIdx + 1);
          const pad = track.drumRack.pads.find(p => p.id === padId);
          if (!pad) { rejected.push({ op: action, reason: `Drum pad not found: ${padId}` }); break; }

          const prevPads = track.drumRack.pads.map(p => ({ ...p, source: { ...p.source, params: { ...p.source.params } } }));
          const currentVal = padParam === 'level' ? pad.level : padParam === 'pan' ? pad.pan : pad.source.params[padParam] ?? 0;
          const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
          const clampedVal = clampParam(rawTarget);
          if (clampedVal === null) { rejected.push({ op: action, reason: `Non-finite parameter value for ${action.param}` }); break; }

          const snapshot: DrumPadSnapshot = { kind: 'drum-pad', trackId, prevPads, timestamp: Date.now(), description: `AI drum pad move: ${action.param} ${currentVal.toFixed(2)} -> ${clampedVal.toFixed(2)}` };
          const newPads = track.drumRack.pads.map(p => {
            if (p.id !== padId) return p;
            if (padParam === 'level') return { ...p, level: clampedVal };
            if (padParam === 'pan') return { ...p, pan: clampedVal };
            return { ...p, source: { ...p.source, params: { ...p.source.params, [padParam]: clampedVal } } };
          });
          next = { ...updateTrack(next, trackId, { drumRack: { ...track.drumRack, pads: newPads } }), undoStack: [...next.undoStack, snapshot] };
          log.push({ trackId, trackLabel: vLabel, description: `${action.param} ${currentVal.toFixed(2)} → ${clampedVal.toFixed(2)}`, diff: { kind: 'param-change', controlId: action.param, from: currentVal, to: clampedVal } });
          accepted.push(action);
          break;
        }

        // Source path: resolve through adapter
        const resolved = resolveMoveParam(action.param, adapter);
        if (!resolved) { rejected.push({ op: action, reason: 'Internal: param unresolvable at execution' }); break; }
        const { runtimeParam, controlId } = resolved;

        if (action.over) {
          // Drift move: record snapshot + provenance, but actual animation is handled by caller
          const currentVal = track.params[runtimeParam] ?? 0;
          const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
          const clampedDrift = clampParam(rawTarget);
          if (clampedDrift === null) { rejected.push({ op: action, reason: `Non-finite parameter value: ${rawTarget} for ${controlId}` }); break; }
          const targetVal = clampedDrift;

          const prevProvenance: Partial<ControlState> = {};
          if (track.controlProvenance?.[controlId]) {
            prevProvenance[controlId] = { ...track.controlProvenance[controlId] };
          }

          next = {
            ...next,
            undoStack: [...next.undoStack, {
              kind: 'param' as const,
              trackId,
              prevValues: { [runtimeParam]: currentVal },
              aiTargetValues: { [runtimeParam]: targetVal },
              prevProvenance,
              timestamp: Date.now(),
              description: `AI drift: ${controlId} ${currentVal.toFixed(2)} -> ${targetVal.toFixed(2)} over ${action.over}ms`,
            }],
          };

          if (track.controlProvenance) {
            next = updateTrack(next, trackId, {
              controlProvenance: {
                ...track.controlProvenance,
                [controlId]: { value: targetVal, source: 'ai', updatedAt: Date.now() },
              },
            });
          }

          log.push({ trackId, trackLabel: vLabel, description: `${controlId} ${currentVal.toFixed(2)} → ${targetVal.toFixed(2)} (drift ${action.over}ms)`, diff: { kind: 'param-change', controlId, from: currentVal, to: targetVal } });
          resolvedParams.set(accepted.length, runtimeParam);
          accepted.push(action);
        } else {
          // Immediate move
          const currentTrack = getTrack(next, trackId);
          const beforeVal = currentTrack.params[runtimeParam] ?? 0;

          const prevProvenance: Partial<ControlState> = {};
          if (currentTrack.controlProvenance?.[controlId]) {
            prevProvenance[controlId] = { ...currentTrack.controlProvenance[controlId] };
          }

          const moveResult = applyMove(next, trackId, runtimeParam, action.target);
          if (moveResult === null) { rejected.push({ op: action, reason: `Non-finite parameter value for ${controlId}` }); break; }
          next = moveResult;

          // Patch the last snapshot with prevProvenance
          const lastIdx = next.undoStack.length - 1;
          const lastSnapshot = next.undoStack[lastIdx];
          if (lastSnapshot && lastSnapshot.kind === 'param') {
            const patched = { ...lastSnapshot, prevProvenance };
            next = { ...next, undoStack: [...next.undoStack.slice(0, lastIdx), patched] };
          }

          // Update provenance
          const afterTrack = getTrack(next, trackId);
          const afterVal = afterTrack.params[runtimeParam] ?? 0;
          if (afterTrack.controlProvenance) {
            next = updateTrack(next, trackId, {
              controlProvenance: {
                ...afterTrack.controlProvenance,
                [controlId]: { value: afterVal, source: 'ai', updatedAt: Date.now() },
              },
            });
          }

          log.push({ trackId, trackLabel: vLabel, description: `${controlId} ${beforeVal.toFixed(2)} → ${afterVal.toFixed(2)}`, diff: { kind: 'param-change', controlId, from: beforeVal, to: afterVal } });
          resolvedParams.set(accepted.length, runtimeParam);
          accepted.push(action);
        }
        break;
      }

      case 'sketch': {
        const track = getTrack(next, action.trackId);
        const activeReg = track.patterns.length > 0 ? getActivePattern(track) : undefined;
        const eventsBefore = activeReg?.events?.length ?? 0;
        const oldEventsForReport = activeReg?.events ?? [];
        const trackClaimed = track.claimed ?? false;
        let eventsAfter = eventsBefore;
        let newEventsForReport: MusicalEvent[] | undefined;

        if (action.kit && track.engine === 'drum-rack' && track.drumRack) {
          // Kit-based sketch: parse grid strings into events, merge with existing pad events
          if (!activeReg) { rejected.push({ op: action, reason: 'No active pattern on drum rack track' }); break; }
          const sketchRegion = activeReg;
          const prevEvents = sketchRegion.events;

          // Parse kit grid strings into events
          let kitEvents = kitToEvents(action.kit) as MusicalEvent[];

          // Apply groove/humanize/dynamic
          if (action.groove && action.groove in GROOVE_TEMPLATES) {
            kitEvents = applyGroove(kitEvents, GROOVE_TEMPLATES[action.groove], action.grooveAmount ?? 0.7, undefined, sketchRegion.duration);
          }
          if (action.humanize != null && action.humanize > 0) {
            kitEvents = humanize(kitEvents, sketchRegion.duration, { velocityAmount: action.humanize, timingAmount: action.humanize * 0.33 });
          }
          if (action.dynamic) {
            kitEvents = applyDynamicShape(action.dynamic, kitEvents, sketchRegion.duration);
          }

          // Merge: keep events for pads NOT mentioned in kit, replace events for mentioned pads
          const mentionedPadIds = new Set(Object.keys(action.kit));
          const keptEvents = prevEvents.filter(e =>
            e.kind !== 'trigger' || !('padId' in e) || !mentionedPadIds.has((e as { padId?: string }).padId ?? ''),
          );
          const mergedEvents = [...keptEvents, ...kitEvents];

          const updatedRegion = normalizePatternEvents({ ...sketchRegion, events: mergedEvents });
          const validation = validatePattern(updatedRegion);
          if (!validation.valid) { rejected.push({ op: action, reason: `Invalid region: ${validation.errors.join('; ')}` }); break; }

          const newRegions = track.patterns.map(r => r.id === sketchRegion.id ? updatedRegion : r);
          const inverseOpts = {
            midiToPitch: adapter.midiToNormalisedPitch.bind(adapter),
            canonicalToRuntime: (id: string) => { const binding = adapter.mapControl(id); const parts = binding.path.split('.'); return parts[parts.length - 1]; },
          };
          const pattern = projectPatternToStepGrid(updatedRegion, updatedRegion.duration, inverseOpts);
          const snapshot: PatternEditSnapshot = { kind: 'pattern-edit', trackId: action.trackId, patternId: sketchRegion.id, prevEvents: [...prevEvents], timestamp: Date.now(), description: action.description };
          next = { ...updateTrack(next, action.trackId, { patterns: newRegions, stepGrid: pattern, _patternDirty: true }), undoStack: [...next.undoStack, snapshot] };
          eventsAfter = updatedRegion.events.length;
          newEventsForReport = updatedRegion.events;
        } else if (action.events) {
          // Canonical sketch: write events to region first (source of truth),
          // then project to pattern (derived cache).
          const sketchRegion = activeReg!;
          const prevEvents = sketchRegion.events;
          const prevDuration = sketchRegion.duration;

          // Apply groove template (before humanize — groove is systematic, humanize is random)
          let sketchEvents = action.events;
          if (action.groove && action.groove in GROOVE_TEMPLATES) {
            const grooveAmount = action.grooveAmount ?? 0.7;
            sketchEvents = applyGroove(sketchEvents, GROOVE_TEMPLATES[action.groove], grooveAmount, undefined, sketchRegion.duration);
          }

          // Apply humanization if requested
          if (action.humanize != null && action.humanize > 0) {
            sketchEvents = humanize(sketchEvents, sketchRegion.duration, {
              velocityAmount: action.humanize,
              timingAmount: action.humanize * 0.33,
            });
          }

          // Apply dynamic shape (velocity contour post-processing)
          if (action.dynamic) {
            const stepsPerBar = sketchRegion.duration;
            sketchEvents = applyDynamicShape(action.dynamic, sketchEvents, stepsPerBar);
          }

          // Auto-quantize note pitches to the session scale when set
          if (next.scale) {
            sketchEvents = sketchEvents.map(e => {
              if (e.kind === 'note' && 'pitch' in e) {
                const quantized = quantizePitch(e.pitch, next.scale!);
                if (quantized !== e.pitch) return { ...e, pitch: quantized };
              }
              return e;
            });
          }

          // Build updated region with new events
          const updatedRegion = normalizePatternEvents({
            ...sketchRegion,
            events: sketchEvents,
          });

          // Enforce region invariants on the canonical write path
          const validation = validatePattern(updatedRegion);
          if (!validation.valid) {
            rejected.push({ op: action, reason: `Invalid region: ${validation.errors.join('; ')}` });
            break;
          }

          const newRegions = track.patterns.map(r => r.id === sketchRegion.id ? updatedRegion : r);

          // Project region to pattern (derived)
          const inverseOpts = {
            midiToPitch: adapter.midiToNormalisedPitch.bind(adapter),
            canonicalToRuntime: (id: string) => {
              const binding = adapter.mapControl(id);
              const parts = binding.path.split('.');
              return parts[parts.length - 1];
            },
          };
          const pattern = projectPatternToStepGrid(updatedRegion, updatedRegion.duration, inverseOpts);

          // Create PatternEditSnapshot for undo
          const snapshot: PatternEditSnapshot = {
            kind: 'pattern-edit',
            trackId: action.trackId,
            patternId: sketchRegion.id,
            prevEvents: [...prevEvents],
            prevDuration: prevDuration !== updatedRegion.duration ? prevDuration : undefined,
            timestamp: Date.now(),
            description: action.description,
          };

          next = {
            ...updateTrack(next, action.trackId, { patterns: newRegions, stepGrid: pattern, _patternDirty: true }),
            undoStack: [...next.undoStack, snapshot],
          };
          eventsAfter = updatedRegion.events.length;
          newEventsForReport = updatedRegion.events;
        } else if (action.pattern) {
          // Legacy sketch: pass through directly (writes only to pattern, not regions)
          next = applySketch(next, action.trackId, action.description, action.pattern);
          eventsAfter = action.pattern.steps?.filter(s => s.gate).length ?? eventsBefore;
        } else {
          rejected.push({ op: action, reason: 'Sketch has neither events nor pattern' });
          break;
        }

        // Generate preservation report for claimed tracks
        if (trackClaimed && newEventsForReport) {
          preservationReports.push(
            generatePreservationReport(action.trackId, trackClaimed, oldEventsForReport, newEventsForReport),
          );
        }

        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `pattern: ${action.description}`, diff: { kind: 'pattern-change', eventsBefore, eventsAfter, description: action.description } });
        accepted.push(action);
        break;
      }

      case 'set_transport': {
        const prev = next.transport;
        const newTransport = { ...prev };
        if (action.bpm !== undefined) {
          if (!Number.isFinite(action.bpm)) { rejected.push({ op: action, reason: `Non-finite transport value: bpm=${action.bpm}` }); break; }
          newTransport.bpm = Math.max(20, Math.min(300, action.bpm));
        }
        if (action.swing !== undefined) {
          if (!Number.isFinite(action.swing)) { rejected.push({ op: action, reason: `Non-finite transport value: swing=${action.swing}` }); break; }
          newTransport.swing = Math.max(0, Math.min(1, action.swing));
        }
        if (action.mode !== undefined) newTransport.mode = action.mode;
        if (action.playing !== undefined) newTransport.status = action.playing ? 'playing' : 'stopped';
        if (action.timeSignatureNumerator !== undefined || action.timeSignatureDenominator !== undefined) {
          const prevTs = prev.timeSignature ?? { numerator: 4, denominator: 4 };
          const validDenominators = [2, 4, 8, 16];
          const newNum = action.timeSignatureNumerator !== undefined
            ? Math.max(1, Math.min(16, Math.round(action.timeSignatureNumerator)))
            : prevTs.numerator;
          const newDen = action.timeSignatureDenominator !== undefined
            ? (validDenominators.includes(action.timeSignatureDenominator) ? action.timeSignatureDenominator : prevTs.denominator)
            : prevTs.denominator;
          newTransport.timeSignature = { numerator: newNum, denominator: newDen };
        }

        const parts: string[] = [];
        if (action.bpm !== undefined && newTransport.bpm !== prev.bpm) parts.push(`bpm ${prev.bpm} → ${newTransport.bpm}`);
        if (action.swing !== undefined && newTransport.swing !== prev.swing) parts.push(`swing ${prev.swing.toFixed(2)} → ${newTransport.swing.toFixed(2)}`);
        if (action.timeSignatureNumerator !== undefined || action.timeSignatureDenominator !== undefined) {
          const prevTs = prev.timeSignature ?? { numerator: 4, denominator: 4 };
          parts.push(`time sig ${prevTs.numerator}/${prevTs.denominator} → ${newTransport.timeSignature.numerator}/${newTransport.timeSignature.denominator}`);
        }
        if (action.mode !== undefined && newTransport.mode !== (prev.mode ?? 'pattern')) parts.push(`mode ${prev.mode ?? 'pattern'} → ${action.mode}`);
        if (action.playing !== undefined && newTransport.status !== prev.status) parts.push(`playback ${prev.status} → ${newTransport.status}`);

        const snapshot: TransportSnapshot = {
          kind: 'transport',
          prevTransport: prev,
          timestamp: Date.now(),
          description: `AI transport: ${parts.join(', ') || 'no change'}`,
        };
        next = { ...next, transport: newTransport, undoStack: [...next.undoStack, snapshot] };

        // Build transport diff from the first changed field
        let transportDiff: ActionDiff | undefined;
        if (action.bpm !== undefined && newTransport.bpm !== prev.bpm) {
          transportDiff = { kind: 'transport-change', field: 'bpm', from: prev.bpm, to: newTransport.bpm };
        } else if (action.swing !== undefined && newTransport.swing !== prev.swing) {
          transportDiff = { kind: 'transport-change', field: 'swing', from: prev.swing, to: newTransport.swing };
        }
        log.push({ trackId: '', trackLabel: 'TRANSPORT', description: snapshot.description, diff: transportDiff });
        accepted.push(action);
        break;
      }

      case 'set_model': {
        const track = getTrack(next, action.trackId);
        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();

        // Modulator path: switch modulator mode
        if (action.modulatorId) {
          const modulators = track.modulators ?? [];
          const modIndex = modulators.findIndex(m => m.id === action.modulatorId);
          const mod = modulators[modIndex];
          const result = getModulatorEngineByName(mod.type, action.model)!;

          const snapshot: ModulatorStateSnapshot = {
            kind: 'modulator-state',
            trackId: action.trackId,
            modulatorId: action.modulatorId,
            prevParams: { ...mod.params },
            prevModel: mod.model,
            timestamp: Date.now(),
            description: `AI modulator model: ${mod.type} mode → ${result.engine.label}`,
          };

          const updatedMod = { ...mod, model: result.index };
          const newModulators = [...modulators];
          newModulators[modIndex] = updatedMod;

          next = {
            ...updateTrack(next, action.trackId, { modulators: newModulators }),
            undoStack: [...next.undoStack, snapshot],
          };

          log.push({ trackId: action.trackId, trackLabel: vLabel, description: `${mod.type} mode → ${result.engine.label}`, diff: { kind: 'model-change', from: mod.type, to: result.engine.label } });
          accepted.push(action);
          break;
        }

        // Drum rack pad path: switch a pad's Plaits model
        if (action.pad && track.drumRack) {
          const prevPads = track.drumRack.pads.map(p => ({ ...p, source: { ...p.source, params: { ...p.source.params } } }));
          const pad = track.drumRack.pads.find(p => p.id === action.pad);
          if (!pad) { rejected.push({ op: action, reason: `Pad not found: ${action.pad}` }); break; }
          const engineIndex = plaitsInstrument.engines.findIndex(e => e.id === action.model);
          if (engineIndex < 0) { rejected.push({ op: action, reason: `Unknown model: ${action.model}` }); break; }
          const defaultParams: Record<string, number> = {};
          for (const ctrl of plaitsInstrument.engines[engineIndex].controls) { if (ctrl.binding?.path?.startsWith('track.')) continue; defaultParams[ctrl.id] = ctrl.range?.default ?? 0.5; }
          const padSnapshot: DrumPadSnapshot = { kind: 'drum-pad', trackId: action.trackId, prevPads, timestamp: Date.now(), description: `AI drum pad model: ${action.pad} → ${plaitsInstrument.engines[engineIndex].label}` };
          const newPads = track.drumRack.pads.map(p => p.id === action.pad ? { ...p, source: { ...p.source, model: engineIndex, params: defaultParams } } : p);
          next = { ...updateTrack(next, action.trackId, { drumRack: { ...track.drumRack, pads: newPads } }), undoStack: [...next.undoStack, padSnapshot] };
          log.push({ trackId: action.trackId, trackLabel: vLabel, description: `pad ${action.pad} model → ${plaitsInstrument.engines[engineIndex].label}`, diff: { kind: 'model-change', from: String(pad.source.model), to: plaitsInstrument.engines[engineIndex].label } });
          accepted.push(action);
          break;
        }

        // Processor path: switch processor mode
        if (action.processorId) {
          const processors = track.processors ?? [];
          const procIndex = processors.findIndex(p => p.id === action.processorId);
          const proc = processors[procIndex];
          const result = getProcessorEngineByName(proc.type, action.model)!;

          const snapshot: ProcessorStateSnapshot = {
            kind: 'processor-state',
            trackId: action.trackId,
            processorId: action.processorId,
            prevParams: { ...proc.params },
            prevModel: proc.model,
            timestamp: Date.now(),
            description: `AI processor model: ${proc.type} mode → ${result.engine.label}`,
          };

          const updatedProc = { ...proc, model: result.index };
          const newProcessors = [...processors];
          newProcessors[procIndex] = updatedProc;

          next = {
            ...updateTrack(next, action.trackId, { processors: newProcessors }),
            undoStack: [...next.undoStack, snapshot],
          };

          log.push({ trackId: action.trackId, trackLabel: vLabel, description: `${proc.type} mode → ${result.engine.label}`, diff: { kind: 'model-change', from: proc.type, to: result.engine.label } });
          accepted.push(action);
          break;
        }

        // Source path: switch track synthesis engine
        const engineIndex = plaitsInstrument.engines.findIndex(e => e.id === action.model);
        const engineDef = plaitsInstrument.engines[engineIndex];
        const prevModel = track.model;
        const prevEngine = track.engine;

        // Derive engine name the same way as session.ts:setModel
        const engineName = `plaits:${engineDef.label.toLowerCase().replace(/[\s/]+/g, '_')}`;

        const snapshot: ModelSnapshot = {
          kind: 'model',
          trackId: action.trackId,
          prevModel,
          prevEngine,
          timestamp: Date.now(),
          description: `AI model: ${plaitsInstrument.engines[prevModel]?.label ?? prevModel} → ${engineDef.label}`,
        };

        next = {
          ...updateTrack(next, action.trackId, { model: engineIndex, engine: engineName }),
          undoStack: [...next.undoStack, snapshot],
        };

        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `model → ${engineDef.label}`, diff: { kind: 'model-change', from: plaitsInstrument.engines[prevModel]?.label ?? String(prevModel), to: engineDef.label } });
        accepted.push(action);
        break;
      }

      case 'edit_pattern': {
        const track = getTrack(next, action.trackId);
        if (track.patterns.length === 0) {
          rejected.push({ op: action, reason: 'No patterns on track' });
          break;
        }
        const targetPattern = action.patternId
          ? track.patterns.find(p => p.id === action.patternId)
          : getActivePattern(track);
        if (!targetPattern) {
          rejected.push({ op: action, reason: `Pattern not found: ${action.patternId}` });
          break;
        }

        const eventsBefore = targetPattern.events.length;

        // Auto-quantize note pitches in add/modify operations when scale is set
        let editOps = action.operations;
        if (next.scale) {
          editOps = editOps.map(op => {
            if (op.event?.pitch !== undefined) {
              const quantized = quantizePitch(op.event.pitch, next.scale!);
              if (quantized !== op.event.pitch) {
                return { ...op, event: { ...op.event, pitch: quantized } };
              }
            }
            return op;
          });
        }

        // Pad-scoped edit_pattern for drum rack tracks
        if (action.pad && track.engine === 'drum-rack' && track.drumRack) {
          const padId = action.pad;
          const patternEvents = [...targetPattern.events];
          const prevEvents = [...patternEvents];

          for (const op of editOps) {
            switch (op.action) {
              case 'add': {
                if (op.event?.type === 'trigger') {
                  const newTrigger: MusicalEvent = {
                    kind: 'trigger',
                    at: op.step,
                    velocity: op.event.velocity ?? 0.8,
                    accent: op.event.accent ?? false,
                    padId,
                  } as MusicalEvent;
                  // Check for existing trigger at this step for this pad
                  const existingIdx = patternEvents.findIndex(
                    e => e.kind === 'trigger' && Math.abs(e.at - op.step) < 0.001 && 'padId' in e && (e as { padId?: string }).padId === padId,
                  );
                  if (existingIdx >= 0) {
                    patternEvents[existingIdx] = newTrigger;
                  } else {
                    const insertAt = patternEvents.findIndex(e => e.at > op.step);
                    if (insertAt === -1) patternEvents.push(newTrigger);
                    else patternEvents.splice(insertAt, 0, newTrigger);
                  }
                }
                break;
              }
              case 'remove': {
                // Only remove triggers matching this pad
                for (let i = patternEvents.length - 1; i >= 0; i--) {
                  const e = patternEvents[i];
                  if (e.kind === 'trigger' && Math.abs(e.at - op.step) < 0.001 && 'padId' in e && (e as { padId?: string }).padId === padId) {
                    patternEvents.splice(i, 1);
                    break; // remove one at a time
                  }
                }
                break;
              }
              case 'modify': {
                // Only modify triggers matching this pad
                const idx = patternEvents.findIndex(
                  e => e.kind === 'trigger' && Math.abs(e.at - op.step) < 0.001 && 'padId' in e && (e as { padId?: string }).padId === padId,
                );
                if (idx >= 0 && op.event) {
                  const existing = patternEvents[idx] as MusicalEvent & { velocity?: number; accent?: boolean };
                  patternEvents[idx] = {
                    ...existing,
                    ...(op.event.velocity !== undefined ? { velocity: op.event.velocity } : {}),
                    ...(op.event.accent !== undefined ? { accent: op.event.accent } : {}),
                  } as MusicalEvent;
                }
                break;
              }
            }
          }

          // Update the pattern with scoped edits
          const updatedRegion = normalizePatternEvents({ ...targetPattern, events: patternEvents });
          const newRegions = track.patterns.map(r => r.id === targetPattern.id ? updatedRegion : r);
          const inverseOpts = {
            midiToPitch: adapter.midiToNormalisedPitch.bind(adapter),
            canonicalToRuntime: (id: string) => { const binding = adapter.mapControl(id); const parts = binding.path.split('.'); return parts[parts.length - 1]; },
          };
          const pattern = projectPatternToStepGrid(updatedRegion, updatedRegion.duration, inverseOpts);
          const snapshot: PatternEditSnapshot = { kind: 'pattern-edit', trackId: action.trackId, patternId: targetPattern.id, prevEvents, timestamp: Date.now(), description: action.description };
          next = { ...updateTrack(next, action.trackId, { patterns: newRegions, stepGrid: pattern, _patternDirty: true }), undoStack: [...next.undoStack, snapshot] };
        } else {
          // Apply edits via pattern-primitives (includes undo snapshot)
          next = editPatternEvents(next, action.trackId, action.patternId, editOps, action.description);
        }

        const updatedTrack = getTrack(next, action.trackId);
        const updatedPattern = action.patternId
          ? updatedTrack.patterns.find(p => p.id === action.patternId)
          : getActivePattern(updatedTrack);
        const eventsAfter = updatedPattern?.events.length ?? eventsBefore;

        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({
          trackId: action.trackId,
          trackLabel: vLabel,
          description: `edit_pattern: ${action.description}`,
          diff: { kind: 'pattern-change', eventsBefore, eventsAfter, description: action.description },
        });
        accepted.push(action);
        break;
      }

      case 'transform': {
        const track = getTrack(next, action.trackId);
        const region = track.patterns.length > 0 ? getActivePattern(track) : undefined;
        if (!region) {
          rejected.push({ op: action, reason: 'No region on track' });
          break;
        }

        const prevEvents = [...region.events];
        const prevDuration = region.duration;
        const padScope = action.pad;
        const sourceEvents = padScope
          ? region.events.filter(e => e.kind === 'trigger' && 'padId' in e && (e as { padId?: string }).padId === padScope)
          : region.events;
        const otherEvents = padScope
          ? region.events.filter(e => !(e.kind === 'trigger' && 'padId' in e && (e as { padId?: string }).padId === padScope))
          : [];

        let newEvents: MusicalEvent[];
        let newDuration = region.duration;

        switch (action.operation) {
          case 'rotate':
            newEvents = rotate(sourceEvents, action.steps ?? 0, region.duration);
            break;
          case 'transpose':
            newEvents = transpose(sourceEvents, action.semitones ?? 0);
            break;
          case 'reverse':
            newEvents = reverse(sourceEvents, region.duration);
            break;
          case 'duplicate': {
            const dup = duplicate(sourceEvents, region.duration);
            newEvents = dup.events;
            if (!padScope) newDuration = dup.duration;
            break;
          }
          case 'humanize':
            newEvents = humanize(sourceEvents, region.duration, {
              velocityAmount: action.velocity_amount ?? 0.3,
              timingAmount: action.timing_amount ?? 0.1,
            });
            break;
          case 'euclidean': {
            let eucEvents = euclidean({ hits: action.hits ?? 4, steps: region.duration, rotation: action.rotation ?? 0, velocity: action.velocity ?? 0.8 });
            if (padScope) { eucEvents = eucEvents.map(e => e.kind === 'trigger' ? { ...e, padId: padScope } : e); }
            newEvents = eucEvents;
            break;
          }
          case 'ghost_notes':
            newEvents = ghostNotes(sourceEvents, region.duration, { velocity: action.velocity ?? 0.3, probability: action.probability ?? 0.5 });
            break;
          case 'swing':
            newEvents = swingTransform(sourceEvents, region.duration, { amount: action.amount ?? 0.5 });
            break;
          case 'thin':
            newEvents = thin(sourceEvents, { probability: action.probability ?? 0.5 });
            break;
          case 'densify':
            newEvents = densify(sourceEvents, region.duration, { probability: action.probability ?? 0.5, velocity: action.velocity ?? 0.6 });
            break;
          default:
            rejected.push({ op: action, reason: `Unknown transform operation: ${(action as AITransformAction).operation}` });
            continue;
        }

        // Merge back with other events when pad-scoped
        const finalEvents = padScope ? [...otherEvents, ...newEvents] : newEvents;

        const updatedRegion = normalizePatternEvents({
          ...region,
          events: finalEvents,
          duration: newDuration,
        });

        const validation = validatePattern(updatedRegion);
        if (!validation.valid) {
          rejected.push({ op: action, reason: `Invalid region after transform: ${validation.errors.join('; ')}` });
          break;
        }

        const newRegions = track.patterns.map(r => r.id === region.id ? updatedRegion : r);

        const inverseOpts = {
          midiToPitch: adapter.midiToNormalisedPitch.bind(adapter),
          canonicalToRuntime: (id: string) => {
            const binding = adapter.mapControl(id);
            const parts = binding.path.split('.');
            return parts[parts.length - 1];
          },
        };
        const pattern = projectPatternToStepGrid(updatedRegion, updatedRegion.duration, inverseOpts);

        const snapshot: PatternEditSnapshot = {
          kind: 'pattern-edit',
          trackId: action.trackId,
          patternId: region.id,
          prevEvents,
          prevDuration: prevDuration !== newDuration ? prevDuration : undefined,
          timestamp: Date.now(),
          description: action.description,
        };

        next = {
          ...updateTrack(next, action.trackId, { patterns: newRegions, stepGrid: pattern, _patternDirty: true }),
          undoStack: [...next.undoStack, snapshot],
        };

        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `transform ${action.operation}: ${action.description}`, diff: { kind: 'transform', operation: action.operation, description: action.description } });
        accepted.push(action);
        break;
      }

      case 'add_view': {
        const track = getTrack(next, action.trackId);
        const prevViews = [...(track.views ?? [])];
        const newView = { kind: action.viewKind, id: `${action.viewKind}-ai-${Date.now()}` };
        const snapshot: ViewSnapshot = {
          kind: 'view',
          trackId: action.trackId,
          prevViews,
          timestamp: Date.now(),
          description: action.description,
        };
        next = {
          ...updateTrack(next, action.trackId, { views: [...prevViews, newView] }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `added ${action.viewKind} view` });
        accepted.push(action);
        break;
      }

      case 'remove_view': {
        const track = getTrack(next, action.trackId);
        const prevViews = [...(track.views ?? [])];
        const filtered = prevViews.filter(v => v.id !== action.viewId);
        if (filtered.length === prevViews.length) {
          rejected.push({ op: action, reason: `View not found: ${action.viewId}` });
          break;
        }
        const snapshot: ViewSnapshot = {
          kind: 'view',
          trackId: action.trackId,
          prevViews,
          timestamp: Date.now(),
          description: action.description,
        };
        next = {
          ...updateTrack(next, action.trackId, { views: filtered }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `removed view ${action.viewId}` });
        accepted.push(action);
        break;
      }

      case 'add_processor': {
        const track = getTrack(next, action.trackId);
        const prevProcessors = [...(track.processors ?? [])];
        const newProcessor: ProcessorConfig = {
          id: action.processorId,
          type: action.moduleType as ProcessorConfig['type'],
          model: 0,
          params: getProcessorDefaultParams(action.moduleType, 0),
        };
        const snapshot: ProcessorSnapshot = {
          kind: 'processor',
          trackId: action.trackId,
          prevProcessors,
          timestamp: Date.now(),
          description: action.description,
        };
        next = {
          ...updateTrack(next, action.trackId, { processors: [...prevProcessors, newProcessor] }),
          undoStack: [...next.undoStack, snapshot],
        };
        // Auto-apply surface template for the new chain configuration
        next = maybeApplySurfaceTemplate(next, action.trackId, action.description);
        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `added ${action.moduleType} processor (${action.processorId})`, diff: { kind: 'processor-add', processorType: action.moduleType } });
        accepted.push(action);
        break;
      }

      case 'remove_processor': {
        const track = getTrack(next, action.trackId);
        const prevProcessors = [...(track.processors ?? [])];
        const prevModulations = [...(track.modulations ?? [])];
        const filteredModulations = prevModulations.filter(
          route => route.target.kind !== 'processor' || route.target.processorId !== action.processorId,
        );
        const processorSnapshot: ProcessorSnapshot = {
          kind: 'processor',
          trackId: action.trackId,
          prevProcessors,
          timestamp: Date.now(),
          description: action.description,
        };
        const filtered = prevProcessors.filter(p => p.id !== action.processorId);
        const snapshots: (ProcessorSnapshot | ModulationRoutingSnapshot)[] = [processorSnapshot];
        if (filteredModulations.length !== prevModulations.length) {
          snapshots.push({
            kind: 'modulation-routing',
            trackId: action.trackId,
            prevModulations,
            timestamp: Date.now(),
            description: `${action.description} (clear dependent modulation routes)`,
          });
        }
        next = {
          ...updateTrack(next, action.trackId, { processors: filtered, modulations: filteredModulations }),
          undoStack: [...next.undoStack, snapshots.length === 1 ? snapshots[0] : {
            kind: 'group',
            snapshots,
            timestamp: Date.now(),
            description: action.description,
          }],
        };
        // Auto-apply surface template for the new chain configuration
        next = maybeApplySurfaceTemplate(next, action.trackId, action.description);
        const vLabel2 = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        const removedProc = prevProcessors.find(p => p.id === action.processorId);
        log.push({ trackId: action.trackId, trackLabel: vLabel2, description: `removed processor ${action.processorId}`, diff: { kind: 'processor-remove', processorType: removedProc?.type ?? action.processorId } });
        accepted.push(action);
        break;
      }

      case 'replace_processor': {
        const track = getTrack(next, action.trackId);
        const prevProcessors = [...(track.processors ?? [])];
        const prevModulations = [...(track.modulations ?? [])];
        const idx = prevProcessors.findIndex(p => p.id === action.processorId);
        if (idx === -1) break; // Should not happen after prevalidation
        const processorSnapshot: ProcessorSnapshot = {
          kind: 'processor',
          trackId: action.trackId,
          prevProcessors,
          timestamp: Date.now(),
          description: action.description,
        };
        const newProcessor: ProcessorConfig = {
          id: action.newProcessorId,
          type: action.newModuleType,
          model: 0,
          params: getProcessorDefaultParams(action.newModuleType, 0),
        };
        const newProcessors = [...prevProcessors];
        newProcessors[idx] = newProcessor;
        const filteredModulations = prevModulations.filter(
          route => route.target.kind !== 'processor' || route.target.processorId !== action.processorId,
        );
        const snapshots: (ProcessorSnapshot | ModulationRoutingSnapshot)[] = [processorSnapshot];
        if (filteredModulations.length !== prevModulations.length) {
          snapshots.push({
            kind: 'modulation-routing',
            trackId: action.trackId,
            prevModulations,
            timestamp: Date.now(),
            description: `${action.description} (clear dependent modulation routes)`,
          });
        }
        next = {
          ...updateTrack(next, action.trackId, { processors: newProcessors, modulations: filteredModulations }),
          undoStack: [...next.undoStack, snapshots.length === 1 ? snapshots[0] : {
            kind: 'group',
            snapshots,
            timestamp: Date.now(),
            description: action.description,
          }],
        };
        // Auto-apply surface template for the new chain configuration
        next = maybeApplySurfaceTemplate(next, action.trackId, action.description);
        const vLabel3 = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: vLabel3, description: `replaced ${prevProcessors[idx].type} with ${action.newModuleType}`, diff: { kind: 'processor-replace', fromType: prevProcessors[idx].type, toType: action.newModuleType } });
        accepted.push(action);
        break;
      }

      case 'bypass_processor': {
        const track = getTrack(next, action.trackId);
        const prevProcessors = [...(track.processors ?? [])].map(p => ({ ...p, params: { ...p.params } }));
        const newProcessors = prevProcessors.map(p =>
          p.id === action.processorId ? { ...p, enabled: action.enabled } : p,
        );
        const snapshot: ProcessorSnapshot = {
          kind: 'processor',
          trackId: action.trackId,
          prevProcessors,
          timestamp: Date.now(),
          description: action.description,
        };
        next = {
          ...updateTrack(next, action.trackId, { processors: newProcessors }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel4 = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: vLabel4, description: `${action.enabled ? 'enabled' : 'bypassed'} processor ${action.processorId}` });
        accepted.push(action);
        break;
      }

      case 'add_modulator': {
        const track = getTrack(next, action.trackId);
        const prevModulators = [...(track.modulators ?? [])];
        const prevModulations = [...(track.modulations ?? [])];
        const newModulator: ModulatorConfig = {
          id: action.modulatorId,
          type: action.moduleType,
          model: 1, // default to Looping mode
          params: getModulatorDefaultParams(action.moduleType, 1),
        };
        const snapshot: ModulatorSnapshot = {
          kind: 'modulator',
          trackId: action.trackId,
          prevModulators,
          prevModulations,
          timestamp: Date.now(),
          description: action.description,
        };
        next = {
          ...updateTrack(next, action.trackId, { modulators: [...prevModulators, newModulator] }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `added ${action.moduleType} modulator (${action.modulatorId})`, diff: { kind: 'modulator-add', modulatorType: action.moduleType } });
        accepted.push(action);
        break;
      }

      case 'remove_modulator': {
        const track = getTrack(next, action.trackId);
        const prevModulators = [...(track.modulators ?? [])];
        const prevModulations = [...(track.modulations ?? [])];
        const snapshot: ModulatorSnapshot = {
          kind: 'modulator',
          trackId: action.trackId,
          prevModulators,
          prevModulations,
          timestamp: Date.now(),
          description: action.description,
        };
        // Cascade: remove modulator and all associated routings
        const filteredModulators = prevModulators.filter(m => m.id !== action.modulatorId);
        const filteredModulations = prevModulations.filter(r => r.modulatorId !== action.modulatorId);
        next = {
          ...updateTrack(next, action.trackId, { modulators: filteredModulators, modulations: filteredModulations }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        const removedMod = prevModulators.find(m => m.id === action.modulatorId);
        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `removed modulator ${action.modulatorId}`, diff: { kind: 'modulator-remove', modulatorType: removedMod?.type ?? action.modulatorId } });
        accepted.push(action);
        break;
      }

      case 'connect_modulator': {
        const track = getTrack(next, action.trackId);
        const prevModulations = [...(track.modulations ?? [])];
        const snapshot: ModulationRoutingSnapshot = {
          kind: 'modulation-routing',
          trackId: action.trackId,
          prevModulations,
          timestamp: Date.now(),
          description: action.description,
        };
        // Idempotent: check for existing route with same (modulatorId, target.kind, target.param, target.processorId)
        const existingIdx = prevModulations.findIndex(r =>
          r.modulatorId === action.modulatorId &&
          r.target.kind === action.target.kind &&
          r.target.param === action.target.param &&
          (action.target.kind === 'source' || (action.target.kind === 'processor' && r.target.kind === 'processor' && r.target.processorId === action.target.processorId))
        );
        let newModulations: ModulationRouting[];
        if (existingIdx >= 0) {
          // Update depth on existing route
          newModulations = [...prevModulations];
          newModulations[existingIdx] = { ...newModulations[existingIdx], depth: action.depth };
        } else {
          // Create new route
          const newRouting: ModulationRouting = {
            id: action.modulationId ?? `mod-${Date.now()}`,
            modulatorId: action.modulatorId,
            target: action.target,
            depth: action.depth,
          };
          newModulations = [...prevModulations, newRouting];
        }
        next = {
          ...updateTrack(next, action.trackId, { modulations: newModulations }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        const targetStr = action.target.kind === 'source' ? `source:${action.target.param}` : `${action.target.processorId}:${action.target.param}`;
        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `${existingIdx >= 0 ? 'updated' : 'connected'} modulation → ${targetStr} (${action.depth.toFixed(2)})`, diff: { kind: 'modulation-connect', modulatorId: action.modulatorId, target: targetStr, depth: action.depth } });
        accepted.push(action);
        break;
      }

      case 'disconnect_modulator': {
        const track = getTrack(next, action.trackId);
        const prevModulations = [...(track.modulations ?? [])];
        const snapshot: ModulationRoutingSnapshot = {
          kind: 'modulation-routing',
          trackId: action.trackId,
          prevModulations,
          timestamp: Date.now(),
          description: action.description,
        };
        const filteredModulations = prevModulations.filter(r => r.id !== action.modulationId);
        next = {
          ...updateTrack(next, action.trackId, { modulations: filteredModulations }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        const disconnectedRoute = prevModulations.find(r => r.id === action.modulationId);
        const disconnectTargetStr = disconnectedRoute
          ? (disconnectedRoute.target.kind === 'source' ? `source:${disconnectedRoute.target.param}` : `${disconnectedRoute.target.processorId}:${disconnectedRoute.target.param}`)
          : action.modulationId;
        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `disconnected modulation ${action.modulationId}`, diff: { kind: 'modulation-disconnect', target: disconnectTargetStr } });
        accepted.push(action);
        break;
      }

      case 'set_surface': {
        const track = getTrack(next, action.trackId);
        const prevSurface = {
          ...track.surface,
          modules: track.surface.modules.map(m => ({ ...m, bindings: [...m.bindings], position: { ...m.position }, config: structuredClone(m.config) })),
        };
        const newSurface: TrackSurface = {
          ...track.surface,
          modules: action.modules,
        };
        const snapshot: SurfaceSnapshot = {
          kind: 'surface',
          trackId: action.trackId,
          prevSurface,
          timestamp: Date.now(),
          description: action.description,
        };
        next = {
          ...updateTrack(next, action.trackId, { surface: newSurface }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `surface: ${action.description}`, diff: { kind: 'surface-set', controlCount: action.modules.length, description: action.description } });
        accepted.push(action);
        break;
      }

      case 'pin': {
        const track = getTrack(next, action.trackId);
        const prevSurface = {
          ...track.surface,
          modules: track.surface.modules.map(m => ({ ...m, bindings: [...m.bindings], position: { ...m.position }, config: structuredClone(m.config) })),
        };
        const newModule: SurfaceModule = {
          type: 'knob-group',
          id: `pinned-${action.moduleId}-${action.controlId}`,
          label: action.controlId,
          bindings: [{ role: 'control', trackId: action.trackId, target: `${action.moduleId}:${action.controlId}` }],
          position: { x: 0, y: 0, w: 2, h: 2 },
          config: { pinned: true },
        };
        const newSurface: TrackSurface = { ...track.surface, modules: [...track.surface.modules, newModule] };
        const snapshot: SurfaceSnapshot = {
          kind: 'surface',
          trackId: action.trackId,
          prevSurface,
          timestamp: Date.now(),
          description: action.description,
        };
        next = {
          ...updateTrack(next, action.trackId, { surface: newSurface }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `pinned ${action.moduleId}:${action.controlId}`, diff: { kind: 'surface-pin', moduleId: action.moduleId, controlId: action.controlId } });
        accepted.push(action);
        break;
      }

      case 'unpin': {
        const track = getTrack(next, action.trackId);
        const prevSurface = {
          ...track.surface,
          modules: track.surface.modules.map(m => ({ ...m, bindings: [...m.bindings], position: { ...m.position }, config: structuredClone(m.config) })),
        };
        const modules = track.surface.modules.filter(
          m => !(m.config.pinned === true && m.bindings.some(b => b.target === `${action.moduleId}:${action.controlId}`)),
        );
        const newSurface: TrackSurface = { ...track.surface, modules };
        const snapshot: SurfaceSnapshot = {
          kind: 'surface',
          trackId: action.trackId,
          prevSurface,
          timestamp: Date.now(),
          description: action.description,
        };
        next = {
          ...updateTrack(next, action.trackId, { surface: newSurface }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `unpinned ${action.moduleId}:${action.controlId}`, diff: { kind: 'surface-unpin', moduleId: action.moduleId, controlId: action.controlId } });
        accepted.push(action);
        break;
      }

      case 'label_axes': {
        const track = getTrack(next, action.trackId);
        const prevSurface = {
          ...track.surface,
          modules: track.surface.modules.map(m => ({ ...m, bindings: [...m.bindings], position: { ...m.position }, config: structuredClone(m.config) })),
        };
        const modules = track.surface.modules.map(m => {
          if (m.type !== 'xy-pad') return m;
          return {
            ...m,
            bindings: [
              { role: 'x-axis', trackId: action.trackId, target: action.x },
              { role: 'y-axis', trackId: action.trackId, target: action.y },
            ],
          };
        });
        const newSurface: TrackSurface = { ...track.surface, modules };
        const snapshot: SurfaceSnapshot = {
          kind: 'surface',
          trackId: action.trackId,
          prevSurface,
          timestamp: Date.now(),
          description: action.description,
        };
        next = {
          ...updateTrack(next, action.trackId, { surface: newSurface }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `axes: ${action.x} x ${action.y}`, diff: { kind: 'surface-label-axes', x: action.x, y: action.y } });
        accepted.push(action);
        break;
      }

      case 'set_claim': {
        const track = getTrack(next, action.trackId);
        const prevClaimed = track.claimed ?? false;
        const claimSnapshot: ClaimSnapshot = {
          kind: 'claim',
          trackId: action.trackId,
          prevClaimed,
          timestamp: Date.now(),
          description: `AI set_claim: ${prevClaimed} → ${action.claimed} (${action.reason})`,
        };
        next = {
          ...updateTrack(next, action.trackId, { claimed: action.claimed }),
          undoStack: [...next.undoStack, claimSnapshot],
        };
        const claimLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: claimLabel, description: `claim: ${prevClaimed} → ${action.claimed}`, diff: { kind: 'claim-change', from: prevClaimed, to: action.claimed } });
        accepted.push(action);
        break;
      }

      case 'mark_approved': {
        // Legacy support — convert to claim toggle
        const track = getTrack(next, action.trackId);
        const prevClaimed = track.claimed ?? false;
        const newClaimed = action.level !== 'exploratory';
        const claimSnapshot: ClaimSnapshot = {
          kind: 'claim',
          trackId: action.trackId,
          prevClaimed,
          timestamp: Date.now(),
          description: `AI mark_approved (legacy): ${action.level} (${action.reason})`,
        };
        next = {
          ...updateTrack(next, action.trackId, { claimed: newClaimed }),
          undoStack: [...next.undoStack, claimSnapshot],
        };
        const approvalLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: approvalLabel, description: `claim: ${prevClaimed} → ${newClaimed}`, diff: { kind: 'claim-change', from: prevClaimed, to: newClaimed } });
        accepted.push(action);
        break;
      }

      case 'set_master': {
        const prevMaster = { ...next.master };
        const newMaster = { ...prevMaster };
        if (action.volume !== undefined) {
          if (!Number.isFinite(action.volume)) { rejected.push({ op: action, reason: `Non-finite master value: volume=${action.volume}` }); break; }
          newMaster.volume = Math.max(0, Math.min(1, action.volume));
        }
        if (action.pan !== undefined) {
          if (!Number.isFinite(action.pan)) { rejected.push({ op: action, reason: `Non-finite master value: pan=${action.pan}` }); break; }
          newMaster.pan = Math.max(-1, Math.min(1, action.pan));
        }

        const masterParts: string[] = [];
        if (action.volume !== undefined && newMaster.volume !== prevMaster.volume) masterParts.push(`volume ${prevMaster.volume.toFixed(2)} → ${newMaster.volume.toFixed(2)}`);
        if (action.pan !== undefined && newMaster.pan !== prevMaster.pan) masterParts.push(`pan ${prevMaster.pan.toFixed(2)} → ${newMaster.pan.toFixed(2)}`);

        const masterSnapshot: MasterSnapshot = {
          kind: 'master',
          prevMaster,
          timestamp: Date.now(),
          description: `AI master: ${masterParts.join(', ') || 'no change'}`,
        };
        next = { ...next, master: newMaster, undoStack: [...next.undoStack, masterSnapshot] };

        let masterDiff: ActionDiff | undefined;
        if (action.volume !== undefined && newMaster.volume !== prevMaster.volume) {
          masterDiff = { kind: 'master-change', field: 'volume', from: prevMaster.volume, to: newMaster.volume };
        } else if (action.pan !== undefined && newMaster.pan !== prevMaster.pan) {
          masterDiff = { kind: 'master-change', field: 'pan', from: prevMaster.pan, to: newMaster.pan };
        }
        log.push({ trackId: '', trackLabel: 'MASTER', description: masterSnapshot.description, diff: masterDiff });
        accepted.push(action);
        break;
      }

      case 'set_importance': {
        const track = getTrack(next, action.trackId);
        const prevImportance = track.importance;
        const prevMusicalRole = track.musicalRole;
        if (!Number.isFinite(action.importance)) { rejected.push({ op: action, reason: `Non-finite importance value: ${action.importance}` }); break; }
        const clamped = Math.max(0, Math.min(1, action.importance));
        const metaSnapshot: TrackPropertySnapshot = {
          kind: 'track-property',
          trackId: action.trackId,
          prevProps: { importance: prevImportance, musicalRole: prevMusicalRole },
          timestamp: Date.now(),
          description: `AI set_importance: ${prevImportance ?? 'unset'} → ${clamped}${action.musicalRole ? ` (${action.musicalRole})` : ''}`,
        };
        next = {
          ...updateTrack(next, action.trackId, {
            importance: clamped,
            ...(action.musicalRole ? { musicalRole: action.musicalRole } : {}),
          }),
          undoStack: [...next.undoStack, metaSnapshot],
        };
        const iLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        const roleSuffix = action.musicalRole ? ` (${action.musicalRole})` : '';
        log.push({ trackId: action.trackId, trackLabel: iLabel, description: `importance: ${clamped.toFixed(2)}${roleSuffix}` });
        accepted.push(action);
        break;
      }

      case 'set_track_identity': {
        const track = getTrack(next, action.trackId);
        const prevIdentity = track.visualIdentity;
        const existing = prevIdentity ?? getDefaultVisualIdentity(next.tracks.indexOf(track));
        // Merge partial identity with existing
        const merged: TrackVisualIdentity = {
          colour: {
            hue: clampNum(action.identity.colour?.hue ?? existing.colour.hue, 0, 360),
            saturation: clampNum(action.identity.colour?.saturation ?? existing.colour.saturation, 0, 1),
            brightness: clampNum(action.identity.colour?.brightness ?? existing.colour.brightness, 0, 1),
          },
          weight: clampNum(action.identity.weight ?? existing.weight, 0, 1),
          edgeStyle: action.identity.edgeStyle ?? existing.edgeStyle,
          prominence: clampNum(action.identity.prominence ?? existing.prominence, 0, 1),
        };
        const identitySnapshot: TrackPropertySnapshot = {
          kind: 'track-property',
          trackId: action.trackId,
          prevProps: { visualIdentity: prevIdentity },
          timestamp: Date.now(),
          description: `AI set_track_identity on ${action.trackId}`,
        };
        next = {
          ...updateTrack(next, action.trackId, { visualIdentity: merged }),
          undoStack: [...next.undoStack, identitySnapshot],
        };
        const idLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: idLabel, description: `visual identity updated` });
        accepted.push(action);
        break;
      }

      case 'raise_decision': {
        const prevDecisions = next.openDecisions ?? [];
        // Prune resolved decisions, then append the new one (matching addDecision in session.ts)
        const unresolved = prevDecisions.filter(d => !d.resolved);
        const newDecision: OpenDecision = {
          id: action.decisionId,
          question: action.question,
          ...(action.context ? { context: action.context } : {}),
          ...(action.options ? { options: action.options } : {}),
          raisedAt: Date.now(),
          ...(action.trackIds ? { trackIds: action.trackIds } : {}),
        };
        next = { ...next, openDecisions: [...unresolved, newDecision].slice(-20) };
        log.push({ trackId: '', trackLabel: 'DECISION', description: `raised: ${action.question}` });
        accepted.push(action);
        break;
      }

      case 'set_intent': {
        const merged = { ...next.intent, ...action.intent };
        next = { ...next, intent: merged };
        const fields = Object.keys(action.intent).join(', ');
        log.push({ trackId: '', trackLabel: 'SESSION', description: `intent updated: ${fields}` });
        accepted.push(action);
        break;
      }

      case 'set_section': {
        const merged = { ...next.section, ...action.section };
        next = { ...next, section: merged };
        const sectionName = action.section.name ?? next.section?.name ?? 'unnamed';
        log.push({ trackId: '', trackLabel: 'SESSION', description: `section: ${sectionName}` });
        accepted.push(action);
        break;
      }

      case 'set_scale': {
        const prevScale = next.scale;
        const snapshot: ScaleSnapshot = {
          kind: 'scale',
          prevScale,
          timestamp: Date.now(),
          description: action.scale ? `Set scale: ${scaleToString(action.scale)}` : 'Clear scale constraint',
        };
        next = { ...next, scale: action.scale, undoStack: [...next.undoStack, snapshot] };
        const label = action.scale ? scaleToString(action.scale) : 'chromatic (no constraint)';
        log.push({ trackId: '', trackLabel: 'SESSION', description: `scale: ${label}` });
        accepted.push(action);
        break;
      }

      case 'set_chord_progression': {
        const prevChordProgression = next.chordProgression;
        const normalized = action.chordProgression ? normalizeChordProgression(action.chordProgression) : action.chordProgression;
        const snapshot: ChordProgressionSnapshot = {
          kind: 'chord-progression',
          prevChordProgression,
          timestamp: Date.now(),
          description: normalized
            ? `Set chord progression: ${normalized.map(entry => `${entry.bar}:${entry.chord}`).join(' · ')}`
            : 'Clear chord progression',
        };
        next = { ...next, chordProgression: normalized, undoStack: [...next.undoStack, snapshot] };
        const label = normalized
          ? normalized.map(entry => `${entry.bar}:${entry.chord}`).join(' · ')
          : 'cleared';
        log.push({ trackId: '', trackLabel: 'SESSION', description: `chord progression: ${label}` });
        accepted.push(action);
        break;
      }

      case 'add_track': {
        const result = addTrack(next, action.kind);
        if (!result) {
          rejected.push({ op: action, reason: 'Max track limit reached' });
          break;
        }
        next = result;
        // If a label was provided, set it on the newly created track
        if (action.label) {
          const newTrackId = result.activeTrackId;
          next = updateTrack(next, newTrackId, { label: action.label });
        }
        const addedTrackId = next.activeTrackId;
        const addedLabel = getTrackLabel(getTrack(next, addedTrackId)).toUpperCase();
        log.push({ trackId: addedTrackId, trackLabel: addedLabel, description: `added ${action.kind} track` });
        accepted.push(action);
        break;
      }

      case 'remove_track': {
        const result = removeTrack(next, action.trackId);
        if (!result) {
          rejected.push({ op: action, reason: `Cannot remove track ${action.trackId}` });
          break;
        }
        const removedLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        next = result;
        log.push({ trackId: action.trackId, trackLabel: removedLabel, description: 'removed track' });
        accepted.push(action);
        break;
      }

      case 'report_bug': {
        const existingBugs = next.bugReports ?? [];
        const newBug: BugReport = {
          id: action.bugId,
          summary: action.summary,
          category: action.category,
          details: action.details,
          severity: action.severity,
          ...(action.context ? { context: action.context } : {}),
          timestamp: Date.now(),
        };
        next = { ...next, bugReports: [...existingBugs, newBug].slice(-50) };
        log.push({ trackId: '', trackLabel: 'BUG', description: `[${action.severity}] ${action.summary}`, kind: 'bug-report' });
        accepted.push(action);
        break;
      }

      case 'set_mute_solo': {
        const update: Partial<Track> = {};
        if (action.muted !== undefined) update.muted = action.muted;
        if (action.solo !== undefined) update.solo = action.solo;

        next = updateTrack(next, action.trackId, update);

        const msLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        const msParts: string[] = [];
        if (action.muted !== undefined) msParts.push(`muted=${action.muted}`);
        if (action.solo !== undefined) msParts.push(`solo=${action.solo}`);
        log.push({ trackId: action.trackId, trackLabel: msLabel, description: msParts.join(', ') });
        accepted.push(action);
        break;
      }

      case 'set_track_mix': {
        const mixTrack = getTrack(next, action.trackId);
        const mixPrevProps: Partial<typeof mixTrack> = {};
        if (action.volume !== undefined) mixPrevProps.volume = mixTrack.volume;
        if (action.pan !== undefined) mixPrevProps.pan = mixTrack.pan;
        if (action.swing !== undefined) mixPrevProps.swing = mixTrack.swing;

        const mixSnapshot: TrackPropertySnapshot = {
          kind: 'track-property',
          trackId: action.trackId,
          prevProps: mixPrevProps,
          timestamp: Date.now(),
          description: `AI set_track_mix on ${action.trackId}`,
        };

        const mixUpdate: Partial<typeof mixTrack> = {};
        if (action.volume !== undefined) {
          if (!Number.isFinite(action.volume)) { rejected.push({ op: action, reason: `Non-finite track mix value: volume=${action.volume}` }); break; }
          mixUpdate.volume = Math.max(0, Math.min(1, action.volume));
        }
        if (action.pan !== undefined) {
          if (!Number.isFinite(action.pan)) { rejected.push({ op: action, reason: `Non-finite track mix value: pan=${action.pan}` }); break; }
          mixUpdate.pan = Math.max(-1, Math.min(1, action.pan));
        }
        if (action.swing !== undefined) {
          if (action.swing === null) {
            mixUpdate.swing = null;
          } else {
            if (!Number.isFinite(action.swing)) { rejected.push({ op: action, reason: `Non-finite track mix value: swing=${action.swing}` }); break; }
            mixUpdate.swing = Math.max(0, Math.min(1, action.swing));
          }
        }

        next = {
          ...updateTrack(next, action.trackId, mixUpdate),
          undoStack: [...next.undoStack, mixSnapshot],
        };

        const mixLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        const mixParts: string[] = [];
        if (action.volume !== undefined) mixParts.push(`volume=${action.volume.toFixed(2)}`);
        if (action.pan !== undefined) mixParts.push(`pan=${action.pan.toFixed(2)}`);
        if (action.swing !== undefined) mixParts.push(action.swing === null ? 'swing=inherit' : `swing=${action.swing.toFixed(2)}`);
        log.push({ trackId: action.trackId, trackLabel: mixLabel, description: mixParts.join(', ') });
        accepted.push(action);
        break;
      }

      case 'set_portamento': {
        const portaTrack = getTrack(next, action.trackId);
        const prevProps: Partial<Track> = {};
        if (action.time !== undefined) prevProps.portamentoTime = portaTrack.portamentoTime;
        if (action.mode !== undefined) prevProps.portamentoMode = portaTrack.portamentoMode;

        const portaSnapshot: TrackPropertySnapshot = {
          kind: 'track-property',
          trackId: action.trackId,
          prevProps,
          timestamp: Date.now(),
          description: `AI set_portamento on ${action.trackId}`,
        };

        const portaUpdate: Partial<Track> = {};
        if (action.time !== undefined) portaUpdate.portamentoTime = Math.max(0, Math.min(1, action.time));
        if (action.mode !== undefined) portaUpdate.portamentoMode = action.mode;

        next = {
          ...updateTrack(next, action.trackId, portaUpdate),
          undoStack: [...next.undoStack, portaSnapshot],
        };

        const portaLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        const portaParts: string[] = [];
        if (action.time !== undefined) portaParts.push(`time=${action.time.toFixed(2)}`);
        if (action.mode !== undefined) portaParts.push(`mode=${action.mode}`);
        log.push({ trackId: action.trackId, trackLabel: portaLabel, description: `portamento: ${portaParts.join(', ')}` });
        accepted.push(action);
        break;
      }

      case 'rename_track': {
        const renameTrack = getTrack(next, action.trackId);
        const renameSnapshot: TrackPropertySnapshot = {
          kind: 'track-property',
          trackId: action.trackId,
          prevProps: { name: renameTrack.name },
          timestamp: Date.now(),
          description: `AI rename_track on ${action.trackId}`,
        };

        next = {
          ...updateTrack(next, action.trackId, { name: action.name }),
          undoStack: [...next.undoStack, renameSnapshot],
        };

        const renameLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: renameLabel, description: `renamed to "${action.name}"` });
        accepted.push(action);
        break;
      }

      case 'manage_send': {
        let sendResult: Session | null = null;
        switch (action.action) {
          case 'add':
            sendResult = addSend(next, action.trackId, action.busId, action.level ?? 1.0);
            break;
          case 'remove':
            sendResult = removeSend(next, action.trackId, action.busId);
            break;
          case 'set_level':
            sendResult = action.level !== undefined ? setSendLevel(next, action.trackId, action.busId, action.level) : null;
            break;
        }
        if (!sendResult) {
          rejected.push({ op: action, reason: `manage_send ${action.action} failed for ${action.trackId} → ${action.busId}` });
          break;
        }
        next = sendResult;
        const sendLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: sendLabel, description: `send ${action.action}: ${action.trackId} → ${action.busId}` });
        accepted.push(action);
        break;
      }

      case 'set_sidechain': {
        const targetTrack = getTrack(next, action.targetTrackId);
        // Find the processor — auto-detect if not specified
        let procId = action.processorId;
        const compressors = (targetTrack.processors ?? []).filter(p => p.type === 'compressor');
        if (!procId) {
          if (compressors.length === 1) {
            procId = compressors[0].id;
          } else if (compressors.length === 0) {
            rejected.push({ op: action, reason: `No compressor found on track ${action.targetTrackId}` });
            break;
          } else {
            rejected.push({ op: action, reason: `Multiple compressors on track ${action.targetTrackId} — specify processorId` });
            break;
          }
        }
        const proc = (targetTrack.processors ?? []).find(p => p.id === procId);
        if (!proc || proc.type !== 'compressor') {
          rejected.push({ op: action, reason: `Processor ${procId} is not a compressor` });
          break;
        }

        const prevSourceId = proc.sidechainSourceId;
        const newSourceId = action.sourceTrackId ?? undefined;

        const sidechainSnapshot: import('./types').SidechainSnapshot = {
          kind: 'sidechain',
          targetTrackId: action.targetTrackId,
          processorId: procId,
          prevSourceId,
          timestamp: Date.now(),
          description: action.description,
        };

        // Update the processor config with the new sidechain source
        const updatedProcessors = (targetTrack.processors ?? []).map(p =>
          p.id === procId ? { ...p, sidechainSourceId: newSourceId } : p,
        );

        next = {
          ...updateTrack(next, action.targetTrackId, { processors: updatedProcessors }),
          undoStack: [...next.undoStack, sidechainSnapshot],
        };

        const scLabel = getTrackLabel(getTrack(next, action.targetTrackId)).toUpperCase();
        const sourceLabel = action.sourceTrackId
          ? getTrackLabel(getTrack(next, action.sourceTrackId)).toUpperCase()
          : 'none';
        log.push({
          trackId: action.targetTrackId,
          trackLabel: scLabel,
          description: `sidechain: ${sourceLabel} → ${scLabel} (${procId})`,
        });
        accepted.push(action);
        break;
      }

      case 'manage_pattern': {
        let patResult: Session | null = null;
        switch (action.action) {
          case 'add':
            patResult = addPattern(next, action.trackId);
            break;
          case 'remove':
            patResult = action.patternId ? removePattern(next, action.trackId, action.patternId) : null;
            break;
          case 'duplicate':
            patResult = action.patternId ? duplicatePattern(next, action.trackId, action.patternId) : null;
            break;
          case 'rename':
            patResult = (action.patternId && action.name !== undefined)
              ? renamePattern(next, action.trackId, action.patternId, action.name)
              : null;
            break;
          case 'set_active':
            patResult = action.patternId ? setActivePatternOnTrack(next, action.trackId, action.patternId) : null;
            break;
          case 'set_length':
            patResult = action.length !== undefined ? setPatternLength(next, action.trackId, action.length) : null;
            break;
          case 'clear':
            patResult = clearPattern(next, action.trackId);
            break;
        }
        if (!patResult) {
          rejected.push({ op: action, reason: `manage_pattern ${action.action} failed for ${action.trackId}` });
          break;
        }
        next = patResult;
        const patLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: patLabel, description: `pattern ${action.action}: ${action.description}` });
        accepted.push(action);
        break;
      }

      case 'manage_sequence': {
        let seqResult: Session = next;
        switch (action.action) {
          case 'append':
            seqResult = action.patternId ? addPatternRef(next, action.trackId, action.patternId) : next;
            break;
          case 'remove':
            seqResult = action.sequenceIndex !== undefined ? removePatternRef(next, action.trackId, action.sequenceIndex) : next;
            break;
          case 'reorder':
            seqResult = (action.sequenceIndex !== undefined && action.toIndex !== undefined)
              ? reorderPatternRef(next, action.trackId, action.sequenceIndex, action.toIndex)
              : next;
            break;
          case 'set_automation':
            seqResult = (action.controlId && action.points)
              ? setSequenceAutomation(next, action.trackId, action.controlId, action.points)
              : next;
            break;
          case 'clear_automation':
            seqResult = action.controlId
              ? clearSequenceAutomation(next, action.trackId, action.controlId)
              : next;
            break;
        }
        if (seqResult === next && action.action !== 'append') {
          // No change happened — but append returning same session means the patternId didn't exist
          rejected.push({ op: action, reason: `manage_sequence ${action.action} had no effect on ${action.trackId}` });
          break;
        }
        next = seqResult;
        const seqLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: seqLabel, description: `sequence ${action.action}: ${action.description}` });
        accepted.push(action);
        break;
      }

      case 'manage_drum_pad': {
        const track = getTrack(next, action.trackId);
        const isAutoPromote = track.engine !== 'drum-rack';
        const prevPads = [...(track.drumRack?.pads ?? [])].map(p => ({ ...p, source: { ...p.source, params: { ...p.source.params } } }));
        const drumPadSnapshot: DrumPadSnapshot = {
          kind: 'drum-pad', trackId: action.trackId, prevPads, timestamp: Date.now(),
          description: `manage_drum_pad ${action.action}: ${action.description}`,
          // Capture pre-promotion state so undo can revert the engine change
          ...(isAutoPromote ? { prevEngine: track.engine, prevModel: track.model } : {}),
        };

        let newPads: DrumPad[];
        switch (action.action) {
          case 'add': {
            const engineIndex = plaitsInstrument.engines.findIndex(e => e.id === action.model);
            const defaultParams: Record<string, number> = {};
            if (engineIndex >= 0) { for (const ctrl of plaitsInstrument.engines[engineIndex].controls) { if (ctrl.binding?.path?.startsWith('track.')) continue; defaultParams[ctrl.id] = ctrl.range?.default ?? 0.5; } }
            const newPad: DrumPad = { id: action.padId, name: action.name ?? action.padId, source: { engine: 'plaits', model: engineIndex >= 0 ? engineIndex : 0, params: defaultParams }, level: 0.8, pan: 0.5 };
            if (action.chokeGroup != null) (newPad as DrumPad).chokeGroup = action.chokeGroup as number;
            newPads = [...prevPads, newPad];
            break;
          }
          case 'remove': {
            newPads = prevPads.filter(p => p.id !== action.padId);
            // Snapshot patterns before scrubbing orphaned trigger events so undo can restore them
            const hasEvents = track.patterns.some(p => p.events.some(e => e.kind === 'trigger' && 'padId' in e && (e as { padId?: string }).padId === action.padId));
            if (hasEvents) {
              drumPadSnapshot.prevPatterns = track.patterns.map(p => ({ ...p, events: [...p.events] }));
            }
            break;
          }
          case 'rename':
            newPads = prevPads.map(p => p.id === action.padId ? { ...p, name: action.name! } : p);
            break;
          case 'set_choke_group':
            newPads = prevPads.map(p => {
              if (p.id !== action.padId) return p;
              if (action.chokeGroup === null || action.chokeGroup === undefined) { const { chokeGroup: _, ...rest } = p; return rest as DrumPad; }
              return { ...p, chokeGroup: action.chokeGroup };
            });
            break;
          default:
            rejected.push({ op: action, reason: `Unknown manage_drum_pad action: ${(action as { action: string }).action}` });
            continue;
        }
        // Build the track update: always update pads, and scrub orphaned events when removing a pad
        const trackUpdate: Parameters<typeof updateTrack>[2] = {
          drumRack: { ...(track.drumRack ?? { pads: [] }), pads: newPads },
          // Auto-promote: set engine to drum-rack on first pad add
          ...(isAutoPromote ? { engine: 'drum-rack' as const, model: -1 } : {}),
        };
        if (action.action === 'remove' && drumPadSnapshot.prevPatterns) {
          trackUpdate.patterns = track.patterns.map(p => ({
            ...p,
            events: p.events.filter(e => !(e.kind === 'trigger' && 'padId' in e && (e as { padId?: string }).padId === action.padId)),
          }));
        }
        next = { ...updateTrack(next, action.trackId, trackUpdate), undoStack: [...next.undoStack, drumPadSnapshot] };
        const padLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: padLabel, description: `drum pad ${action.action}: ${action.padId}` });
        accepted.push(action);
        break;
      }

      case 'save_memory': {
        const prevMemories = [...(next.memories ?? [])];
        const memorySnapshot: MemorySnapshot = { kind: 'memory', prevMemories, timestamp: Date.now(), description: `save_memory (${action.memoryType}): ${action.content.slice(0, 60)}` };

        const newMemory: ProjectMemory = {
          id: `mem-${Date.now()}`,
          type: action.memoryType,
          content: action.content,
          confidence: 1.0,
          evidence: action.evidence,
          ...(action.trackId ? { trackId: action.trackId } : {}),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        let newMemories: ProjectMemory[];
        if (action.supersedes) {
          newMemories = prevMemories.map(m => m.id === action.supersedes ? newMemory : m);
        } else {
          newMemories = [...prevMemories, newMemory];
        }

        next = { ...next, memories: newMemories, undoStack: [...next.undoStack, memorySnapshot] };
        log.push({ trackId: action.trackId ?? '', trackLabel: '', description: `memory saved (${action.memoryType}): ${action.content.slice(0, 80)}` });
        accepted.push(action);
        break;
      }

      case 'recall_memories':
        // Read-only — no state mutation, no snapshot, no log entry.
        // The actual recall is handled in api.ts tool dispatch.
        accepted.push(action);
        break;

      case 'forget_memory': {
        const memories = next.memories ?? [];
        const memorySnapshot: MemorySnapshot = {
          kind: 'memory',
          prevMemories: [...memories],
          timestamp: Date.now(),
          description: `forget memory: ${action.memoryId} — ${action.reason}`,
        };
        const newMemories = memories.filter(m => m.id !== action.memoryId);
        next = { ...next, memories: newMemories, undoStack: [...next.undoStack, memorySnapshot] };
        log.push({ trackId: '', trackLabel: 'PROJECT', description: `forgot memory: ${action.memoryId}` });
        accepted.push(action);
        break;
      }

      case 'say':
        sayTexts.push(action.text);
        accepted.push(action);
        break;
    }
  }

  return { session: next, accepted, rejected, log, sayTexts, resolvedParams, preservationReports };
}
