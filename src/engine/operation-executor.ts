// src/engine/operation-executor.ts
import type { Session, AIAction, AITransformAction, ActionGroupSnapshot, Snapshot, TransportSnapshot, ModelSnapshot, RegionSnapshot, ViewSnapshot, ProcessorSnapshot, ProcessorStateSnapshot, ProcessorConfig, ModulatorConfig, ModulationRouting, ModulatorSnapshot, ModulatorStateSnapshot, ModulationRoutingSnapshot, MasterSnapshot, SurfaceSnapshot, ApprovalSnapshot, ApprovalLevel, ActionDiff, TrackSurface, PreservationReport, OpenDecision, ToolCallEntry } from './types';
import { applySurfaceTemplate, validateSurface } from './surface-templates';
import type { ControlState, SourceAdapter, ExecutionReportLogEntry, MusicalEvent, MoveOp } from './canonical-types';
import type { Arbitrator } from './arbitration';
import { getTrack, updateTrack } from './types';
import { applyMove, applySketch } from './primitives';
import { rotate, transpose, reverse, duplicate } from './transformations';
import { projectRegionToPattern } from './region-projection';
import { normalizeRegionEvents, validateRegion } from './region-helpers';
import { getTrackLabel } from './track-labels';
import { getEngineById, plaitsInstrument, getProcessorEngineByName, getModulatorEngineByName, getProcessorControlSchema } from '../audio/instrument-registry';
import { validateChainMutation, validateProcessorTarget, validateModulatorMutation, validateModulationTarget, validateModulatorTarget } from './chain-validation';

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
 * Check whether a mutation would violate preservation constraints on a track.
 * Returns null if the mutation is allowed, or a rejection reason string.
 *
 * Rules:
 * - 'anchor' tracks block all rhythm/event mutations (sketch, transform).
 * - 'approved' tracks with preserve_exact intent allow parameter-only changes
 *   but block rhythm changes (different `at` positions for note/trigger events).
 * - 'exploratory' and 'liked' tracks are unrestricted.
 * - 'move' (parameter) actions are never blocked by preservation.
 */
function checkPreservationForSketch(
  session: Session,
  trackId: string,
  newEvents?: MusicalEvent[],
): string | null {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return null; // track-not-found is handled elsewhere
  const approval = track.approval ?? 'exploratory';
  if (approval !== 'approved' && approval !== 'anchor') return null;

  const trackLabel = getTrackLabel(track).toUpperCase();

  if (approval === 'anchor') {
    return `Preservation: track ${trackLabel} (${trackId}) is anchored — all event mutations are blocked. Change its approval level first.`;
  }

  // approval === 'approved': check rhythm preservation
  if (!newEvents) {
    // Legacy pattern sketch — we can't reliably diff rhythm, so block
    return `Preservation: track ${trackLabel} (${trackId}) is approved — legacy pattern sketches are blocked. Use canonical events instead.`;
  }

  const existingEvents = track.regions[0]?.events ?? [];
  const existingRhythm = extractRhythmPositions(existingEvents);
  const newRhythm = extractRhythmPositions(newEvents);

  if (!rhythmsMatch(existingRhythm, newRhythm)) {
    return `Preservation: track ${trackLabel} (${trackId}) is approved with preserve_exact rhythm — the proposed sketch changes rhythm positions. Change its approval level first, or preserve the same rhythm.`;
  }

  return null;
}

function checkPreservationForTransform(
  session: Session,
  trackId: string,
  operation: string,
): string | null {
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) return null;
  const approval = track.approval ?? 'exploratory';
  if (approval !== 'approved' && approval !== 'anchor') return null;

  const trackLabel = getTrackLabel(track).toUpperCase();

  if (approval === 'anchor') {
    return `Preservation: track ${trackLabel} (${trackId}) is anchored — all transforms are blocked. Change its approval level first.`;
  }

  // approval === 'approved': transpose is allowed (pitch-only), others change rhythm
  if (operation === 'transpose') return null;

  return `Preservation: track ${trackLabel} (${trackId}) is approved with preserve_exact rhythm — '${operation}' would change rhythm positions. Only 'transpose' is allowed on approved tracks.`;
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
      if (track.agency !== 'ON') return `Track ${trackId} has agency OFF`;

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
      if (track.agency !== 'ON') return `Track ${action.trackId} has agency OFF`;
      const sketchPreservation = checkPreservationForSketch(session, action.trackId, action.events);
      if (sketchPreservation) return sketchPreservation;
      return null;
    }

    case 'set_model': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      if (track.agency !== 'ON') return `Track ${action.trackId} has agency OFF`;

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

    case 'transform': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      if (track.agency !== 'ON') return `Track ${action.trackId} has agency OFF`;
      const transformPreservation = checkPreservationForTransform(session, action.trackId, action.operation);
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
      if (track.agency !== 'ON') return `Track ${action.trackId} has agency OFF`;
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
      if (track.agency !== 'ON') return `Track ${action.trackId} has agency OFF`;
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
      if (track.agency !== 'ON') return `Track ${action.trackId} has agency OFF`;
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

    case 'add_modulator': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      if (track.agency !== 'ON') return `Track ${action.trackId} has agency OFF`;
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
      if (track.agency !== 'ON') return `Track ${action.trackId} has agency OFF`;
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
      if (track.agency !== 'ON') return `Track ${action.trackId} has agency OFF`;
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
      if (track.agency !== 'ON') return `Track ${action.trackId} has agency OFF`;
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
      // Build a candidate surface for validation
      const candidateSurface: TrackSurface = {
        ...track.surface,
        semanticControls: action.semanticControls,
        ...(action.xyAxes ? { xyAxes: action.xyAxes } : {}),
      };
      const surfaceError = validateSurface(candidateSurface, track);
      if (surfaceError) return surfaceError;
      return null;
    }

    case 'pin': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      // No agency check
      const MAX_PINS = 4;
      if (track.surface.pinnedControls.length >= MAX_PINS) {
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
      // No agency check
      const pinExists = track.surface.pinnedControls.some(
        p => p.moduleId === action.moduleId && p.controlId === action.controlId,
      );
      if (!pinExists) return `Pin not found: ${action.moduleId}:${action.controlId}`;
      return null;
    }

    case 'label_axes': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      // No agency check
      return null;
    }

    case 'set_importance': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      // No agency check — importance is AI metadata, not musical mutation
      return null;
    }

    case 'mark_approved': {
      const track = session.tracks.find(v => v.id === action.trackId);
      if (!track) return `Track not found: ${action.trackId}`;
      if (track.agency !== 'ON') return `Track ${action.trackId} has agency OFF`;
      const validLevels: ApprovalLevel[] = ['exploratory', 'liked', 'approved', 'anchor'];
      if (!validLevels.includes(action.level)) return `Invalid approval level: ${action.level}`;
      return null;
    }

    case 'raise_decision':
      // No side-effect guards needed — raise_decision only appends to openDecisions
      return null;

    case 'set_transport':
    case 'set_master':
    case 'say':
      return null;
  }
}

/**
 * Auto-apply a surface template after a chain mutation.
 * If a template matches the track's new chain, applies it and pushes a SurfaceSnapshot.
 * The snapshot is grouped with the preceding chain mutation on undo.
 */
function maybeApplySurfaceTemplate(session: Session, trackId: string, description: string): Session {
  const track = getTrack(session, trackId);
  const newSurface = applySurfaceTemplate(track);
  if (!newSurface) return session;

  const surfaceSnapshot: SurfaceSnapshot = {
    kind: 'surface',
    trackId,
    prevSurface: track.surface,
    timestamp: Date.now(),
    description: `${description} (auto-apply surface template)`,
  };

  // Group the surface snapshot with the most recent undo entry
  const undoStack = [...session.undoStack];
  const lastEntry = undoStack[undoStack.length - 1];
  if (lastEntry) {
    const existingSnapshots: Snapshot[] = lastEntry.kind === 'group'
      ? lastEntry.snapshots
      : [lastEntry as Snapshot];
    undoStack[undoStack.length - 1] = {
      kind: 'group',
      snapshots: [...existingSnapshots, surfaceSnapshot],
      timestamp: Date.now(),
      description,
    };
  } else {
    undoStack.push(surfaceSnapshot);
  }

  return {
    ...updateTrack(session, trackId, { surface: newSurface }),
    undoStack,
  };
}

// ---------------------------------------------------------------------------
// Preservation report generation
// ---------------------------------------------------------------------------

/** Approval levels that trigger preservation report generation. */
const PRESERVATION_LEVELS: ReadonlySet<ApprovalLevel> = new Set(['liked', 'approved', 'anchor']);

/**
 * Generate a PreservationReport comparing old and new events for a track.
 * Only called for tracks with approval >= 'liked'.
 */
export function generatePreservationReport(
  trackId: string,
  approvalLevel: ApprovalLevel,
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

  // Build changed list
  const changed: string[] = [];

  if (!rhythmPositions) {
    const added = newPositions.length - oldPositions.length;
    if (added > 0) changed.push(`${added} rhythm position${added !== 1 ? 's' : ''} added`);
    else if (added < 0) changed.push(`${-added} rhythm position${added !== -1 ? 's' : ''} removed`);
    else changed.push('rhythm positions shifted');
  }

  if (!eventCount) {
    const diff = newEvents.length - oldEvents.length;
    if (diff > 0) changed.push(`${diff} event${diff !== 1 ? 's' : ''} added`);
    else changed.push(`${-diff} event${-diff !== 1 ? 's' : ''} removed`);
  }

  if (!pitchContour && oldPitches.length > 0) {
    changed.push('pitch contour modified');
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
    approvalLevel,
  };
}

export function executeOperations(
  session: Session,
  actions: AIAction[],
  adapter: SourceAdapter,
  arbitrator: Arbitrator,
  toolCalls?: ToolCallEntry[],
): OperationExecutionReport {
  const accepted: AIAction[] = [];
  const rejected: { op: AIAction; reason: string }[] = [];
  const log: ExecutionReportLogEntry[] = [];
  const sayTexts: string[] = [];
  const resolvedParams = new Map<number, string>();
  const preservationReports: PreservationReport[] = [];

  let next = session;
  const undoBaseline = session.undoStack.length;

  for (const action of actions) {
    // Early rejection via shared validation (uses `next` so sequential
    // actions see the effects of prior ones, e.g. agency changes)
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
          const targetVal = Math.max(0, Math.min(1, rawTarget));

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

        // Source path: resolve through adapter
        const resolved = resolveMoveParam(action.param, adapter);
        if (!resolved) { rejected.push({ op: action, reason: 'Internal: param unresolvable at execution' }); break; }
        const { runtimeParam, controlId } = resolved;

        if (action.over) {
          // Drift move: record snapshot + provenance, but actual animation is handled by caller
          const currentVal = track.params[runtimeParam] ?? 0;
          const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
          const targetVal = Math.max(0, Math.min(1, rawTarget));

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

          next = applyMove(next, trackId, runtimeParam, action.target);

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
        const eventsBefore = track.regions[0]?.events?.length ?? 0;
        const oldEventsForReport = track.regions[0]?.events ?? [];
        const trackApproval = track.approval ?? 'exploratory';
        let eventsAfter = eventsBefore;
        let newEventsForReport: MusicalEvent[] | undefined;

        if (action.events) {
          // Canonical sketch: write events to region first (source of truth),
          // then project to pattern (derived cache).
          const prevEvents = track.regions[0]?.events ?? [];
          const prevDuration = track.regions[0]?.duration;

          // Build updated region with new events
          const updatedRegion = normalizeRegionEvents({
            ...track.regions[0],
            events: action.events,
          });

          // Enforce region invariants on the canonical write path
          const validation = validateRegion(updatedRegion);
          if (!validation.valid) {
            rejected.push({ op: action, reason: `Invalid region: ${validation.errors.join('; ')}` });
            break;
          }

          const newRegions = [updatedRegion, ...track.regions.slice(1)];

          // Project region to pattern (derived)
          const inverseOpts = {
            midiToPitch: adapter.midiToNormalisedPitch.bind(adapter),
            canonicalToRuntime: (id: string) => {
              const binding = adapter.mapControl(id);
              const parts = binding.path.split('.');
              return parts[parts.length - 1];
            },
          };
          const pattern = projectRegionToPattern(updatedRegion, updatedRegion.duration, inverseOpts);

          // Create RegionSnapshot for undo
          const snapshot: RegionSnapshot = {
            kind: 'region',
            trackId: action.trackId,
            prevEvents: [...prevEvents],
            prevDuration: prevDuration !== updatedRegion.duration ? prevDuration : undefined,
            timestamp: Date.now(),
            description: action.description,
          };

          next = {
            ...updateTrack(next, action.trackId, { regions: newRegions, pattern, _regionDirty: true }),
            undoStack: [...next.undoStack, snapshot],
          };
          eventsAfter = updatedRegion.events.length;
          newEventsForReport = updatedRegion.events;
        } else if (action.pattern) {
          // Legacy sketch: pass through directly (writes only to pattern, not regions)
          next = applySketch(next, action.trackId, action.description, action.pattern);
          eventsAfter = action.pattern.steps?.filter(s => s.on).length ?? eventsBefore;
        } else {
          rejected.push({ op: action, reason: 'Sketch has neither events nor pattern' });
          break;
        }

        // Generate preservation report for tracks with approval >= 'liked'
        if (PRESERVATION_LEVELS.has(trackApproval) && newEventsForReport) {
          preservationReports.push(
            generatePreservationReport(action.trackId, trackApproval, oldEventsForReport, newEventsForReport),
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
        if (action.bpm !== undefined) newTransport.bpm = Math.max(20, Math.min(300, action.bpm));
        if (action.swing !== undefined) newTransport.swing = Math.max(0, Math.min(1, action.swing));
        if (action.playing !== undefined) {
          newTransport.playing = action.playing;
          newTransport.status = action.playing ? 'playing' : 'stopped';
        }

        const parts: string[] = [];
        if (action.bpm !== undefined && newTransport.bpm !== prev.bpm) parts.push(`bpm ${prev.bpm} → ${newTransport.bpm}`);
        if (action.swing !== undefined && newTransport.swing !== prev.swing) parts.push(`swing ${prev.swing.toFixed(2)} → ${newTransport.swing.toFixed(2)}`);
        if (action.playing !== undefined && newTransport.playing !== prev.playing) parts.push(newTransport.playing ? 'play' : 'stop');

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
        } else if (action.playing !== undefined && newTransport.playing !== prev.playing) {
          transportDiff = {
            kind: 'transport-change',
            field: 'status',
            from: prev.status ?? (prev.playing ? 'playing' : 'stopped'),
            to: newTransport.status ?? (newTransport.playing ? 'playing' : 'stopped'),
          };
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

      case 'transform': {
        const track = getTrack(next, action.trackId);
        const region = track.regions[0];
        if (!region) {
          rejected.push({ op: action, reason: 'No region on track' });
          break;
        }

        const prevEvents = [...region.events];
        const prevDuration = region.duration;
        let newEvents: MusicalEvent[];
        let newDuration = region.duration;

        switch (action.operation) {
          case 'rotate':
            newEvents = rotate(region.events, action.steps ?? 0, region.duration);
            break;
          case 'transpose':
            newEvents = transpose(region.events, action.semitones ?? 0);
            break;
          case 'reverse':
            newEvents = reverse(region.events, region.duration);
            break;
          case 'duplicate': {
            const dup = duplicate(region.events, region.duration);
            newEvents = dup.events;
            newDuration = dup.duration;
            break;
          }
          default:
            rejected.push({ op: action, reason: `Unknown transform operation: ${(action as AITransformAction).operation}` });
            continue;
        }

        const updatedRegion = normalizeRegionEvents({
          ...region,
          events: newEvents,
          duration: newDuration,
        });

        const validation = validateRegion(updatedRegion);
        if (!validation.valid) {
          rejected.push({ op: action, reason: `Invalid region after transform: ${validation.errors.join('; ')}` });
          break;
        }

        const newRegions = [updatedRegion, ...track.regions.slice(1)];

        const inverseOpts = {
          midiToPitch: adapter.midiToNormalisedPitch.bind(adapter),
          canonicalToRuntime: (id: string) => {
            const binding = adapter.mapControl(id);
            const parts = binding.path.split('.');
            return parts[parts.length - 1];
          },
        };
        const pattern = projectRegionToPattern(updatedRegion, updatedRegion.duration, inverseOpts);

        const snapshot: RegionSnapshot = {
          kind: 'region',
          trackId: action.trackId,
          prevEvents,
          prevDuration: prevDuration !== newDuration ? prevDuration : undefined,
          timestamp: Date.now(),
          description: action.description,
        };

        next = {
          ...updateTrack(next, action.trackId, { regions: newRegions, pattern, _regionDirty: true }),
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
          params: {},
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
          params: {},
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

      case 'add_modulator': {
        const track = getTrack(next, action.trackId);
        const prevModulators = [...(track.modulators ?? [])];
        const prevModulations = [...(track.modulations ?? [])];
        const newModulator: ModulatorConfig = {
          id: action.modulatorId,
          type: action.moduleType,
          model: 1, // default to Looping mode
          params: {},
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
        const prevSurface = { ...track.surface, semanticControls: [...track.surface.semanticControls], pinnedControls: [...track.surface.pinnedControls] };
        const newSurface: TrackSurface = {
          ...track.surface,
          semanticControls: action.semanticControls,
          ...(action.xyAxes ? { xyAxes: action.xyAxes } : {}),
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
        log.push({ trackId: action.trackId, trackLabel: vLabel, description: `surface: ${action.description}`, diff: { kind: 'surface-set', controlCount: action.semanticControls.length, description: action.description } });
        accepted.push(action);
        break;
      }

      case 'pin': {
        const track = getTrack(next, action.trackId);
        const prevSurface = { ...track.surface, semanticControls: [...track.surface.semanticControls], pinnedControls: [...track.surface.pinnedControls] };
        const newPinnedControls = [...track.surface.pinnedControls, { moduleId: action.moduleId, controlId: action.controlId }];
        const newSurface: TrackSurface = { ...track.surface, pinnedControls: newPinnedControls };
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
        const prevSurface = { ...track.surface, semanticControls: [...track.surface.semanticControls], pinnedControls: [...track.surface.pinnedControls] };
        const newPinnedControls = track.surface.pinnedControls.filter(
          p => !(p.moduleId === action.moduleId && p.controlId === action.controlId),
        );
        const newSurface: TrackSurface = { ...track.surface, pinnedControls: newPinnedControls };
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
        const prevSurface = { ...track.surface, semanticControls: [...track.surface.semanticControls], pinnedControls: [...track.surface.pinnedControls] };
        const newSurface: TrackSurface = { ...track.surface, xyAxes: { x: action.x, y: action.y } };
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

      case 'mark_approved': {
        const track = getTrack(next, action.trackId);
        const prevApproval = track.approval ?? 'exploratory';
        const approvalSnapshot: ApprovalSnapshot = {
          kind: 'approval',
          trackId: action.trackId,
          prevApproval,
          timestamp: Date.now(),
          description: `AI mark_approved: ${prevApproval} → ${action.level} (${action.reason})`,
        };
        next = {
          ...updateTrack(next, action.trackId, { approval: action.level }),
          undoStack: [...next.undoStack, approvalSnapshot],
        };
        const approvalLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        log.push({ trackId: action.trackId, trackLabel: approvalLabel, description: `approval: ${prevApproval} → ${action.level}`, diff: { kind: 'approval-change', from: prevApproval, to: action.level } });
        accepted.push(action);
        break;
      }

      case 'set_master': {
        const prevMaster = { ...next.master };
        const newMaster = { ...prevMaster };
        if (action.volume !== undefined) newMaster.volume = Math.max(0, Math.min(1, action.volume));
        if (action.pan !== undefined) newMaster.pan = Math.max(-1, Math.min(1, action.pan));

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
        const clamped = Math.max(0, Math.min(1, action.importance));
        next = updateTrack(next, action.trackId, {
          importance: clamped,
          ...(action.musicalRole ? { musicalRole: action.musicalRole } : {}),
        });
        const iLabel = getTrackLabel(getTrack(next, action.trackId)).toUpperCase();
        const roleSuffix = action.musicalRole ? ` (${action.musicalRole})` : '';
        log.push({ trackId: action.trackId, trackLabel: iLabel, description: `importance: ${clamped.toFixed(2)}${roleSuffix}` });
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

      case 'say':
        sayTexts.push(action.text);
        accepted.push(action);
        break;
    }
  }

  // Collapse multiple snapshots into a single undo group.
  // Flatten nested groups one level deep so that sub-groups pushed by
  // cascading operations (e.g. remove_processor clearing modulation routes)
  // are preserved instead of silently dropped.
  const newSnapshots = next.undoStack.slice(undoBaseline);
  if (newSnapshots.length > 1) {
    const sayText = sayTexts.join(' ');
    const trackCount = new Set(log.map(e => e.trackId)).size;
    const undoDesc = sayText || `AI: ${log.length} changes across ${trackCount} track${trackCount !== 1 ? 's' : ''}`;
    const flatSnaps: Snapshot[] = [];
    for (const e of newSnapshots) {
      if (e.kind === 'group') flatSnaps.push(...e.snapshots);
      else flatSnaps.push(e);
    }
    const group: ActionGroupSnapshot = {
      kind: 'group',
      snapshots: flatSnaps,
      timestamp: Date.now(),
      description: undoDesc,
    };
    next = { ...next, undoStack: [...next.undoStack.slice(0, undoBaseline), group] };
  }

  // Add message
  const combinedSay = sayTexts.join(' ');
  if (combinedSay || log.length > 0) {
    next = {
      ...next,
      messages: [...next.messages, {
        role: 'ai' as const,
        text: combinedSay,
        timestamp: Date.now(),
        ...(log.length > 0 ? { actions: log } : {}),
        ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
      }],
    };
  }

  return { session: next, accepted, rejected, log, resolvedParams, preservationReports };
}
