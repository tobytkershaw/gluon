// src/ai/api.ts — Provider-agnostic orchestrator.

import type { Session, AIAction, AIMoveAction, AISketchAction, AITransportAction, AISetModelAction, AITransformAction, AIEditPatternAction, PatternEditOp, AIAddViewAction, AIRemoveViewAction, AIAddProcessorAction, AIRemoveProcessorAction, AIReplaceProcessorAction, AIBypassProcessorAction, AIAddModulatorAction, AIRemoveModulatorAction, AIConnectModulatorAction, AIDisconnectModulatorAction, AISetMasterAction, AISetMuteSoloAction, AISetTrackMixAction, AIManageSendAction, AIManagePatternAction, AIManageSequenceAction, AISetSurfaceAction, AIPinAction, AIUnpinAction, AILabelAxesAction, AISetImportanceAction, AIRaiseDecisionAction, AIMarkApprovedAction, AIReportBugAction, AIAddTrackAction, AIRemoveTrackAction, AIRenameTrackAction, AISetIntentAction, AISetSectionAction, AISetScaleAction, AIAssignSpectralSlotAction, AIManageMotifAction, AISetTensionAction, ApprovalLevel, PreservationReport, ProcessorConfig, ModulatorConfig, ModulationTarget, SemanticControlDef, SemanticControlWeight, TrackSurface, Track, BugReport, BugCategory, BugSeverity, TrackKind, ChatMessage, SessionIntent, SectionMeta, ScaleConstraint, ScaleMode, UserSelection, AgencyApprovalRequest } from '../engine/types';
import { getTrack, getActivePattern, updateTrack, getTrackKind, AGENCY_REJECTION_PREFIX } from '../engine/types';
import { controlIdToRuntimeParam, plaitsInstrument, getProcessorEngineByName, getModulatorEngineByName, getModelName, getProcessorInstrument, getModulatorInstrument, getProcessorEngineName, getModulatorEngineName } from '../audio/instrument-registry';
import { validateChainMutation, validateModulatorMutation } from '../engine/chain-validation';
import { resolveTrackId, getTrackLabel } from '../engine/track-labels';
import { normalizePatternEvents } from '../engine/region-helpers';
import { projectPatternToStepGrid } from '../engine/region-projection';
import { editPatternEvents } from '../engine/pattern-primitives';
import { generatePreservationReport } from '../engine/operation-executor';
import { addTrack, removeTrack } from '../engine/session';
import { SCALE_MODES, scaleToString, scaleNoteNames } from '../engine/scale';
import { MotifLibrary } from '../engine/motif';
import type { Motif } from '../engine/motif';
import { applyDevelopmentOps } from '../engine/motif-development';
import type { DevelopmentOp } from '../engine/motif-development';
import { rotate, transpose, reverse, duplicate } from '../engine/transformations';
import { humanize as humanizeEvents } from '../engine/musical-helpers';
import { applyGroove, GROOVE_TEMPLATES } from '../engine/groove-templates';
import type { InstrumentHint } from '../engine/groove-templates';
import { generateArchetypeEvents, getArchetype } from '../engine/pattern-archetypes';
import { generateFromGenerator } from '../engine/pattern-generator';
import type { PatternGenerator, GeneratorBase, GeneratorLayer } from '../engine/pattern-generator';
import { applyDynamicShape } from '../engine/dynamic-shapes';
import { setTensionPoints, setTrackTensionMapping, createTensionCurve } from '../engine/tension-curve';
import type { TensionPoint, TrackTensionMapping } from '../engine/tension-curve';
import { compressState } from './state-compression';
import { buildSystemPrompt } from './system-prompt';
import { buildListenPromptWithLens, buildComparePrompt } from './listen-prompt';
import type { ListenLens } from './listen-prompt';
import { GLUON_TOOLS } from './tool-schemas';
import type { PlannerProvider, ListenerProvider, NeutralFunctionCall, FunctionResponse, StreamTextCallback } from './types';
import { ProviderError } from './types';
import { analyzeSpectral, analyzeDynamics, analyzeRhythm, analyzeMasking, analyzeDiff, computeBandEnergies } from '../audio/audio-analysis';
import type { TrackAudio } from '../audio/audio-analysis';
import { getProfile, compareToProfile } from '../engine/reference-profiles';
import { getSnapshot, storeSnapshot, nextSnapshotId } from '../audio/snapshot-store';
import type { PcmRenderResult } from '../audio/render-offline';
import { resolveSketchPositions, resolveEditPatternPositions } from './bar-beat-sixteenth';
import { getChainRecipe } from '../engine/chain-recipes';
import { getMixRole } from '../engine/mix-roles';
import { getModulationRecipe } from '../engine/modulation-recipes';
import { resolveTimbralMove, getProcessorTimbralVector } from '../engine/timbral-vocabulary';
import { SpectralSlotManager, FREQUENCY_BANDS } from '../engine/spectral-slots';
import type { FrequencyBand } from '../engine/spectral-slots';
import type { TimbralDirection } from '../engine/timbral-vocabulary';
import { RUBRIC_CRITERIA, parseRubricResponse } from './listen-rubric';

/**
 * Lightweight projection of an action onto session state.
 * No undo entries or messages — just updates the values so later
 * tool calls in the same turn can validate against current state.
 */
function projectAction(session: Session, action: AIAction): Session {
  switch (action.type) {
    case 'move': {
      const trackId = action.trackId ?? session.activeTrackId;
      const track = getTrack(session, trackId);

      // Modulator path: update modulator.params directly
      if (action.modulatorId) {
        const modulators = track.modulators ?? [];
        const modIndex = modulators.findIndex(m => m.id === action.modulatorId);
        if (modIndex < 0) return session;
        const mod = modulators[modIndex];
        const currentVal = mod.params[action.param] ?? 0;
        const rawTarget = 'absolute' in action.target
          ? action.target.absolute
          : currentVal + action.target.relative;
        const value = Math.max(0, Math.min(1, rawTarget));
        const updatedMod = { ...mod, params: { ...mod.params, [action.param]: value } };
        const newModulators = [...modulators];
        newModulators[modIndex] = updatedMod;
        return updateTrack(session, trackId, { modulators: newModulators });
      }

      // Processor path: update processor.params directly
      if (action.processorId) {
        const processors = track.processors ?? [];
        const procIndex = processors.findIndex(p => p.id === action.processorId);
        if (procIndex < 0) return session;
        const proc = processors[procIndex];
        const currentVal = proc.params[action.param] ?? 0;
        const rawTarget = 'absolute' in action.target
          ? action.target.absolute
          : currentVal + action.target.relative;
        const value = Math.max(0, Math.min(1, rawTarget));
        const updatedProc = { ...proc, params: { ...proc.params, [action.param]: value } };
        const newProcessors = [...processors];
        newProcessors[procIndex] = updatedProc;
        return updateTrack(session, trackId, { processors: newProcessors });
      }

      // Source path
      const runtimeKey = controlIdToRuntimeParam[action.param] ?? action.param;
      const currentVal = track.params[runtimeKey] ?? 0;
      const rawTarget = 'absolute' in action.target
        ? action.target.absolute
        : currentVal + action.target.relative;
      const value = Math.max(0, Math.min(1, rawTarget));
      return updateTrack(session, trackId, {
        params: { ...track.params, [runtimeKey]: value },
      });
    }
    case 'set_transport': {
      const t = { ...session.transport };
      if (action.bpm !== undefined) t.bpm = Math.max(20, Math.min(300, action.bpm));
      if (action.swing !== undefined) t.swing = Math.max(0, Math.min(1, action.swing));
      if (action.mode !== undefined) t.mode = action.mode;
      return { ...session, transport: t };
    }
    case 'sketch': {
      const track = getTrack(session, action.trackId);
      if (!action.events || track.patterns.length === 0) return session;
      const activeReg = getActivePattern(track);
      // Apply groove template (before humanize)
      let sketchEvents = action.events;
      if (action.groove && action.groove in GROOVE_TEMPLATES) {
        const grooveAmount = action.grooveAmount ?? 0.7;
        sketchEvents = applyGroove(sketchEvents, GROOVE_TEMPLATES[action.groove], grooveAmount, undefined, activeReg.duration);
      }
      // Apply humanization if requested
      if (action.humanize != null && action.humanize > 0) {
        sketchEvents = humanizeEvents(sketchEvents, activeReg.duration, {
          velocityAmount: action.humanize,
          timingAmount: action.humanize * 0.33,
        });
      }
      // Apply dynamic shape (velocity contour post-processing)
      if (action.dynamic) {
        sketchEvents = applyDynamicShape(action.dynamic, sketchEvents, activeReg.duration);
      }
      const updatedRegion = normalizePatternEvents({
        ...activeReg,
        events: sketchEvents,
      });
      const inverseOpts = {
        midiToPitch: (midi: number) => midi / 127,
        canonicalToRuntime: (id: string) => controlIdToRuntimeParam[id] ?? id,
      };
      const pattern = projectPatternToStepGrid(updatedRegion, updatedRegion.duration, inverseOpts);
      const newRegions = track.patterns.map(r => r.id === activeReg.id ? updatedRegion : r);
      return updateTrack(session, action.trackId, { patterns: newRegions, stepGrid: pattern });
    }
    case 'edit_pattern': {
      // Projection: apply edits to session for mid-turn state validation
      return editPatternEvents(session, action.trackId, action.patternId, action.operations, action.description);
    }
    case 'transform': {
      const track = getTrack(session, action.trackId);
      if (track.patterns.length === 0) return session;
      const region = getActivePattern(track);
      let newEvents = region.events;
      let newDuration = region.duration;
      switch (action.operation) {
        case 'rotate': newEvents = rotate(newEvents, action.steps ?? 0, newDuration); break;
        case 'transpose': newEvents = transpose(newEvents, action.semitones ?? 0); break;
        case 'reverse': newEvents = reverse(newEvents, newDuration); break;
        case 'duplicate': {
          const result = duplicate(newEvents, newDuration);
          newEvents = result.events;
          newDuration = result.duration;
          break;
        }
      }
      const updatedRegion = normalizePatternEvents({ ...region, events: newEvents, duration: newDuration });
      const inverseOpts = {
        midiToPitch: (midi: number) => midi / 127,
        canonicalToRuntime: (id: string) => controlIdToRuntimeParam[id] ?? id,
      };
      const pattern = projectPatternToStepGrid(updatedRegion, updatedRegion.duration, inverseOpts);
      const newRegions = track.patterns.map(r => r.id === region.id ? updatedRegion : r);
      return updateTrack(session, action.trackId, { patterns: newRegions, stepGrid: pattern });
    }
    case 'set_model': {
      // Modulator path: update modulator model
      if (action.modulatorId) {
        const track = getTrack(session, action.trackId);
        const modulators = track.modulators ?? [];
        const modIndex = modulators.findIndex(m => m.id === action.modulatorId);
        if (modIndex < 0) return session;
        const mod = modulators[modIndex];
        const result = getModulatorEngineByName(mod.type, action.model);
        if (!result) return session;
        const updatedMod = { ...mod, model: result.index };
        const newModulators = [...modulators];
        newModulators[modIndex] = updatedMod;
        return updateTrack(session, action.trackId, { modulators: newModulators });
      }

      // Processor path: update processor model
      if (action.processorId) {
        const track = getTrack(session, action.trackId);
        const processors = track.processors ?? [];
        const procIndex = processors.findIndex(p => p.id === action.processorId);
        if (procIndex < 0) return session;
        const proc = processors[procIndex];
        const result = getProcessorEngineByName(proc.type, action.model);
        if (!result) return session;
        const updatedProc = { ...proc, model: result.index };
        const newProcessors = [...processors];
        newProcessors[procIndex] = updatedProc;
        return updateTrack(session, action.trackId, { processors: newProcessors });
      }

      // Source path
      const engineIndex = plaitsInstrument.engines.findIndex(e => e.id === action.model);
      if (engineIndex < 0) return session;
      const engineDef = plaitsInstrument.engines[engineIndex];
      const engineName = `plaits:${engineDef.label.toLowerCase().replace(/[\s/]+/g, '_')}`;
      return updateTrack(session, action.trackId, { model: engineIndex, engine: engineName });
    }
    case 'add_view': {
      const track = getTrack(session, action.trackId);
      const views = [...(track.views ?? [])];
      views.push({ kind: action.viewKind, id: `${action.viewKind}-proj-${Date.now()}` });
      return updateTrack(session, action.trackId, { views });
    }
    case 'remove_view': {
      const track = getTrack(session, action.trackId);
      const views = (track.views ?? []).filter(v => v.id !== action.viewId);
      return updateTrack(session, action.trackId, { views });
    }
    case 'add_processor': {
      const track = getTrack(session, action.trackId);
      const processors = [...(track.processors ?? [])];
      const newProc: ProcessorConfig = {
        id: action.processorId,
        type: action.moduleType as ProcessorConfig['type'],
        model: 0,
        params: {},
      };
      processors.push(newProc);
      return updateTrack(session, action.trackId, { processors });
    }
    case 'remove_processor': {
      const track = getTrack(session, action.trackId);
      const processors = (track.processors ?? []).filter(p => p.id !== action.processorId);
      return updateTrack(session, action.trackId, { processors });
    }
    case 'replace_processor': {
      const track = getTrack(session, action.trackId);
      const processors = (track.processors ?? []).map(p =>
        p.id === action.processorId
          ? { id: action.newProcessorId, type: action.newModuleType, model: 0, params: {} }
          : p,
      );
      return updateTrack(session, action.trackId, { processors });
    }
    case 'add_modulator': {
      const track = getTrack(session, action.trackId);
      const modulators = [...(track.modulators ?? [])];
      const newMod: ModulatorConfig = {
        id: action.modulatorId,
        type: action.moduleType,
        model: 1, // default Looping
        params: {},
      };
      modulators.push(newMod);
      return updateTrack(session, action.trackId, { modulators });
    }
    case 'remove_modulator': {
      const track = getTrack(session, action.trackId);
      const modulators = (track.modulators ?? []).filter(m => m.id !== action.modulatorId);
      const modulations = (track.modulations ?? []).filter(r => r.modulatorId !== action.modulatorId);
      return updateTrack(session, action.trackId, { modulators, modulations });
    }
    case 'connect_modulator': {
      const track = getTrack(session, action.trackId);
      const modulations = [...(track.modulations ?? [])];
      const existingIdx = modulations.findIndex(r =>
        r.modulatorId === action.modulatorId &&
        r.target.kind === action.target.kind &&
        r.target.param === action.target.param &&
        (action.target.kind === 'source' || (action.target.kind === 'processor' && r.target.kind === 'processor' && r.target.processorId === action.target.processorId))
      );
      if (existingIdx >= 0) {
        modulations[existingIdx] = { ...modulations[existingIdx], depth: action.depth };
      } else {
        modulations.push({
          id: action.modulationId ?? `mod-proj-${Date.now()}`,
          modulatorId: action.modulatorId,
          target: action.target,
          depth: action.depth,
        });
      }
      return updateTrack(session, action.trackId, { modulations });
    }
    case 'disconnect_modulator': {
      const track = getTrack(session, action.trackId);
      const modulations = (track.modulations ?? []).filter(r => r.id !== action.modulationId);
      return updateTrack(session, action.trackId, { modulations });
    }
    case 'set_surface': {
      const track = getTrack(session, action.trackId);
      const newSurface: TrackSurface = {
        ...track.surface,
        semanticControls: action.semanticControls,
        ...(action.xyAxes ? { xyAxes: action.xyAxes } : {}),
      };
      return updateTrack(session, action.trackId, { surface: newSurface });
    }
    case 'pin': {
      const track = getTrack(session, action.trackId);
      const pinnedControls = [...track.surface.pinnedControls, { moduleId: action.moduleId, controlId: action.controlId }];
      return updateTrack(session, action.trackId, { surface: { ...track.surface, pinnedControls } });
    }
    case 'unpin': {
      const track = getTrack(session, action.trackId);
      const pinnedControls = track.surface.pinnedControls.filter(
        p => !(p.moduleId === action.moduleId && p.controlId === action.controlId),
      );
      return updateTrack(session, action.trackId, { surface: { ...track.surface, pinnedControls } });
    }
    case 'label_axes': {
      const track = getTrack(session, action.trackId);
      return updateTrack(session, action.trackId, { surface: { ...track.surface, xyAxes: { x: action.x, y: action.y } } });
    }
    case 'set_importance': {
      const clamped = Math.max(0, Math.min(1, action.importance));
      return updateTrack(session, action.trackId, {
        importance: clamped,
        ...(action.musicalRole ? { musicalRole: action.musicalRole } : {}),
      });
    }
    case 'raise_decision': {
      const decisions = (session.openDecisions ?? []).filter(d => !d.resolved);
      const newDecision = {
        id: action.decisionId,
        question: action.question,
        ...(action.context ? { context: action.context } : {}),
        ...(action.options ? { options: action.options } : {}),
        raisedAt: Date.now(),
        ...(action.trackIds ? { trackIds: action.trackIds } : {}),
      };
      return { ...session, openDecisions: [...decisions, newDecision].slice(-20) };
    }
    case 'mark_approved': {
      return updateTrack(session, action.trackId, { approval: action.level });
    }
    case 'report_bug': {
      const existing = session.bugReports ?? [];
      const report: BugReport = {
        id: action.bugId,
        summary: action.summary,
        category: action.category,
        details: action.details,
        severity: action.severity,
        ...(action.context ? { context: action.context } : {}),
        timestamp: Date.now(),
      };
      return { ...session, bugReports: [...existing, report].slice(-50) };
    }
    case 'add_track': {
      const result = addTrack(session, action.kind);
      return result ?? session;
    }
    case 'remove_track': {
      const result = removeTrack(session, action.trackId);
      return result ?? session;
    }
    case 'set_mute_solo': {
      const update: Partial<Track> = {};
      if (action.muted !== undefined) update.muted = action.muted;
      if (action.solo !== undefined) update.solo = action.solo;
      return updateTrack(session, action.trackId, update);
    }
    case 'manage_send': {
      const track = session.tracks.find(t => t.id === action.trackId);
      if (!track) return session;
      const sends = [...(track.sends ?? [])];
      switch (action.action) {
        case 'add':
          sends.push({ busId: action.busId, level: action.level ?? 1.0 });
          return updateTrack(session, action.trackId, { sends });
        case 'remove':
          return updateTrack(session, action.trackId, { sends: sends.filter(s => s.busId !== action.busId) });
        case 'set_level': {
          const idx = sends.findIndex(s => s.busId === action.busId);
          if (idx >= 0 && action.level !== undefined) sends[idx] = { ...sends[idx], level: action.level };
          return updateTrack(session, action.trackId, { sends });
        }
      }
      return session;
    }
    case 'manage_pattern':
    case 'manage_sequence':
      // These are complex operations executed by session.ts helpers at execution time.
      // For projection purposes, return session unchanged — the state will be fully
      // updated during executeOperations.
      return session;
    case 'set_track_mix': {
      const update: Partial<Track> = {};
      if (action.volume !== undefined) update.volume = Math.max(0, Math.min(1, action.volume));
      if (action.pan !== undefined) update.pan = Math.max(-1, Math.min(1, action.pan));
      return updateTrack(session, action.trackId, update);
    }
    case 'set_intent': {
      const merged: SessionIntent = { ...session.intent, ...action.intent };
      return { ...session, intent: merged };
    }
    case 'set_section': {
      const merged: SectionMeta = { ...session.section, ...action.section };
      return { ...session, section: merged };
    }
    case 'set_scale':
      return { ...session, scale: action.scale };
    case 'manage_motif':
      // Motif operations are handled in the tool handler; no session state mutation needed.
      return session;
    case 'set_tension': {
      let curve = session.tensionCurve ?? createTensionCurve();
      curve = setTensionPoints(curve, action.points);
      if (action.trackMappings) {
        for (const m of action.trackMappings) {
          curve = setTrackTensionMapping(curve, m);
        }
      }
      return { ...session, tensionCurve: curve };
    }
    case 'say':
    default:
      return session;
  }
}

/** Build an error function response payload */
function errorPayload(message: string): Record<string, unknown> {
  return { error: message };
}

/**
 * Check whether a rejection string is an agency-OFF block.
 * If so, return the track ID extracted from the message; otherwise null.
 */
export function isAgencyRejection(rejection: string): string | null {
  if (!rejection.startsWith(AGENCY_REJECTION_PREFIX)) return null;
  // Format: "Agency: Track <trackId> has agency OFF"
  const match = rejection.match(/Track\s+(\S+)\s+has agency OFF/);
  return match ? match[1] : null;
}

/**
 * Build a structured agency-approval response and a raise_decision action
 * instead of a hard error when the AI tries to modify an agency-OFF track.
 */
export function buildAgencyApproval(
  session: Session,
  blockedAction: AIAction,
  trackId: string,
): { actions: AIAction[]; response: Record<string, unknown> } {
  const track = session.tracks.find(t => t.id === trackId);
  const label = track ? getTrackLabel(track) : trackId;
  const decisionId = `agency-approval-${Date.now()}`;

  const raiseAction: AIRaiseDecisionAction = {
    type: 'raise_decision',
    decisionId,
    question: `The AI wants to modify ${label} which has agency OFF. Allow this change?`,
    context: `Action: ${blockedAction.type}`,
    options: ['Allow', 'Deny'],
    trackIds: [trackId],
  };

  const approval: AgencyApprovalRequest = {
    blocked: true,
    reason: 'agency_off',
    trackId,
    trackLabel: label,
    pendingAction: blockedAction,
    decisionId,
    message: `Track ${label} has agency OFF. A decision has been raised asking the human to allow this change. Wait for their response before retrying.`,
  };

  return {
    actions: [raiseAction],
    response: approval as unknown as Record<string, unknown>,
  };
}

/**
 * Handle a validation rejection: if it's an agency-OFF block, convert to an
 * approval prompt instead of a hard error. Returns null if there's no rejection.
 */
function handleRejection(
  rejection: string | null | undefined,
  session: Session,
  action: AIAction,
): { actions: AIAction[]; response: Record<string, unknown> } | null {
  if (!rejection) return null;
  const agencyTrackId = isAgencyRejection(rejection);
  if (agencyTrackId) return buildAgencyApproval(session, action, agencyTrackId);
  return { actions: [], response: errorPayload(rejection) };
}

/** Context for the listen tool — audio capture and eval plumbing */
export interface ListenContext {
  /** Render audio offline — no transport or AudioContext needed. Returns WAV Blob. */
  renderOffline: (session: Session, trackIds?: string[], bars?: number) => Promise<Blob>;
  /** Render audio offline — returns raw PCM + sample rate for analysis tools. */
  renderOfflinePcm?: (session: Session, trackIds?: string[], bars?: number) => Promise<PcmRenderResult>;
  onListening?: (active: boolean) => void;
}

/**
 * Pre-validate an action against current session state.
 * Returns null if the action will be accepted, or a rejection reason string.
 */
export type ActionValidator = (action: AIAction) => string | null;

/** Callback fired when the AI invokes a tool during a turn. */
export type ToolCallCallback = (name: string, args: Record<string, unknown>) => void;

/** Context passed to ask() for listen support and cancellation */
export interface AskContext {
  listen?: ListenContext;
  isStale?: () => boolean;
  validateAction?: ActionValidator;
  /** Called with each text chunk as it arrives during streaming generation. */
  onStreamText?: StreamTextCallback;
  /** Called each time the AI invokes a tool (for transparency display). */
  onToolCall?: ToolCallCallback;
  /** Current UI selection in the Tracker (if any). Included in compressed state so the AI knows what the human is pointing at. */
  userSelection?: UserSelection;
}

export type ListenerMode = 'gemini' | 'openai' | 'both';

export class GluonAI {
  /** Fallback exchange cap for providers without token counting. */
  private static FALLBACK_MAX_EXCHANGES = 12;
  private static MAX_PLANNER_INVOCATIONS = 5;

  /** Spectral slot manager — persists across tool calls within a session. */
  private spectralSlots = new SpectralSlotManager();

  /** Session-level motif registry. */
  readonly motifLibrary = new MotifLibrary();

  constructor(
    private planner: PlannerProvider,
    private listener: ListenerProvider,
    private listeners: ListenerProvider[] = [listener],
  ) {}

  isConfigured(): boolean {
    return this.planner.isConfigured() && this.listeners.some(l => l.isConfigured());
  }

  async ask(session: Session, humanMessage: string, ctx?: AskContext): Promise<AIAction[]> {
    await this.trimToTokenBudget(session, ctx);

    const systemPrompt = buildSystemPrompt(session);
    const state = compressState(session, undefined, ctx?.userSelection);
    // If the provider has restored conversation context (e.g. after reload),
    // prepend it to the first user message so the AI has continuity.
    const contextPrefix = this.planner.consumeConversationContext?.() ?? null;
    const contextBlock = contextPrefix ? `${contextPrefix}\n\n` : '';
    const userMessage = `${contextBlock}Project state:\n${JSON.stringify(state)}\n\nHuman says: ${humanMessage}`;
    const collectedActions: AIAction[] = [];
    let projectedSession = session;
    let hadError = false;
    let hadModelContent = false;

    try {
      if (ctx?.isStale?.()) {
        this.planner.discardTurn();
        return [];
      }

      // Only stream on the first planner invocation — subsequent continueTurn
      // calls are tool-call loops where streaming text is less useful and the
      // callback reference would emit interleaved fragments.
      const onStreamText = ctx?.onStreamText;

      let invocationCount = 1;
      let result = await this.planner.startTurn({
        systemPrompt,
        userMessage,
        tools: GLUON_TOOLS,
        onStreamText,
      });

      while (invocationCount <= GluonAI.MAX_PLANNER_INVOCATIONS) {
        if (result.textParts.length > 0 || result.functionCalls.length > 0) {
          hadModelContent = true;
        }

        for (const text of result.textParts) {
          collectedActions.push({ type: 'say', text });
        }

        if (result.truncated) {
          collectedActions.push({ type: 'say', text: '(Response was truncated due to length limits.)' });
        }

        if (result.functionCalls.length === 0) break;

        const responses: FunctionResponse[] = [];
        for (const fc of result.functionCalls) {
          ctx?.onToolCall?.(fc.name, fc.args);
          const execResult = await this.executeFunctionCall(fc, projectedSession, ctx);
          collectedActions.push(...execResult.actions);
          responses.push({ id: fc.id, name: fc.name, result: execResult.response });
          for (const action of execResult.actions) {
            projectedSession = projectAction(projectedSession, action);
          }
        }

        invocationCount++;
        if (invocationCount > GluonAI.MAX_PLANNER_INVOCATIONS || ctx?.isStale?.()) break;

        result = await this.planner.continueTurn({
          systemPrompt,
          tools: GLUON_TOOLS,
          functionResponses: responses,
          // Don't stream on continueTurn — tool loop text would interleave
        });
      }
    } catch (error) {
      hadError = true;
      collectedActions.push(...this.handleError(error));
    }

    if (!ctx?.isStale?.() && !hadError && hadModelContent) {
      this.planner.commitTurn();
    } else {
      this.planner.discardTurn();
    }

    return collectedActions;
  }

  private async executeFunctionCall(
    fc: NeutralFunctionCall,
    session: Session,
    ctx?: AskContext,
  ): Promise<{ actions: AIAction[]; response: Record<string, unknown> }> {
    const { name, args, id } = fc;

    // Resolve ordinal track references (e.g. "Track 1") to internal IDs
    if (typeof args.trackId === 'string' && args.trackId) {
      const resolved = resolveTrackId(args.trackId, session);
      if (resolved) {
        args.trackId = resolved;
      } else {
        return { actions: [], response: errorPayload(`Unknown track: "${fc.args.trackId}". Use "Track N" (1-indexed) or an internal track ID.`) };
      }
    }

    // Also resolve trackIds arrays (used by listen)
    if (Array.isArray(args.trackIds)) {
      const resolvedIds: string[] = [];
      for (const ref of args.trackIds) {
        if (typeof ref !== 'string') continue;
        const resolved = resolveTrackId(ref, session);
        if (resolved) {
          resolvedIds.push(resolved);
        } else {
          return { actions: [], response: errorPayload(`Unknown track in trackIds: "${ref}". Use "Track N" (1-indexed) or an internal track ID.`) };
        }
      }
      args.trackIds = resolvedIds;
    }

    // Resolve scope field (used by render — can be string or string[])
    if (typeof args.scope === 'string') {
      const resolved = resolveTrackId(args.scope, session);
      if (resolved) {
        args.scope = resolved;
      } else {
        return { actions: [], response: errorPayload(`Unknown track in scope: "${args.scope}". Use "Track N" (1-indexed) or an internal track ID.`) };
      }
    } else if (Array.isArray(args.scope)) {
      const resolvedScope: string[] = [];
      for (const ref of args.scope) {
        if (typeof ref !== 'string') continue;
        const resolved = resolveTrackId(ref, session);
        if (resolved) {
          resolvedScope.push(resolved);
        } else {
          return { actions: [], response: errorPayload(`Unknown track in scope: "${ref}". Use "Track N" (1-indexed) or an internal track ID.`) };
        }
      }
      args.scope = resolvedScope;
    }

    switch (name) {
      case 'move': {
        if (typeof args.param !== 'string' || !args.param) {
          return { actions: [], response: errorPayload('Missing required parameter: param') };
        }
        const target = args.target as Record<string, unknown> | undefined;
        if (!target || (typeof target.absolute !== 'number' && typeof target.relative !== 'number')) {
          return { actions: [], response: errorPayload('Missing required parameter: target (needs absolute or relative number)') };
        }

        const targetValue = typeof target.absolute === 'number'
          ? { absolute: target.absolute }
          : { relative: target.relative as number };

        const action: AIMoveAction = {
          type: 'move',
          param: args.param as string,
          target: targetValue,
          ...(args.trackId ? { trackId: args.trackId as string } : {}),
          ...(args.processorId ? { processorId: args.processorId as string } : {}),
          ...(args.modulatorId ? { modulatorId: args.modulatorId as string } : {}),
          ...(args.over ? { over: args.over as number } : {}),
        };

        const rejection = ctx?.validateAction?.(action);
        const rejectionResult = handleRejection(rejection, session, action);
        if (rejectionResult) return rejectionResult;

        const trackId = action.trackId ?? session.activeTrackId;
        const track = session.tracks.find(v => v.id === trackId);
        let currentVal: number;
        if (action.modulatorId) {
          const mod = (track?.modulators ?? []).find(m => m.id === action.modulatorId);
          currentVal = mod?.params[action.param] ?? 0;
        } else if (action.processorId) {
          const proc = (track?.processors ?? []).find(p => p.id === action.processorId);
          currentVal = proc?.params[action.param] ?? 0;
        } else {
          const runtimeKey = controlIdToRuntimeParam[action.param] ?? action.param;
          currentVal = track?.params[runtimeKey] ?? 0;
        }
        const rawTarget = 'absolute' in action.target
          ? action.target.absolute
          : currentVal + (action.target as { relative: number }).relative;
        const resultValue = Math.max(0, Math.min(1, rawTarget));

        // Detect recent human touch on this parameter for conflict awareness
        const HUMAN_TOUCH_WINDOW_MS = 5000;
        const now = Date.now();
        const recentHumanTouch = session.recentHumanActions.some(
          ha => ha.trackId === trackId && ha.param === action.param &&
                (now - ha.timestamp) < HUMAN_TOUCH_WINDOW_MS,
        );

        return {
          actions: [action],
          response: {
            applied: true,
            param: action.param,
            trackId,
            ...(action.processorId ? { processorId: action.processorId } : {}),
            ...(action.modulatorId ? { modulatorId: action.modulatorId } : {}),
            from: Math.round(currentVal * 100) / 100,
            to: Math.round(resultValue * 100) / 100,
            ...(recentHumanTouch ? { recentHumanTouch: true } : {}),
          },
        };
      }

      case 'sketch': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.description !== 'string') {
          return { actions: [], response: errorPayload('Missing required parameter: description') };
        }

        // Resolve events from generator > archetype > explicit events
        let resolvedEvents: AISketchAction['events'] | undefined;
        let generatorUsed = false;
        let archetypeUsed = false;

        if (args.generator && typeof args.generator === 'object') {
          // Pattern generator takes priority
          const genArgs = args.generator as Record<string, unknown>;
          const base = genArgs.base as GeneratorBase;
          const layers = (genArgs.layers as GeneratorLayer[]) ?? [];
          const bars = typeof genArgs.bars === 'number' ? genArgs.bars : undefined;
          if (!base || typeof base.type !== 'string') {
            return { actions: [], response: errorPayload('Generator requires a base with a type field') };
          }
          const gen: PatternGenerator = { base, layers, bars };
          // Infer bar count from the track's active pattern duration when bars is not explicit
          const sketchTrackForGen = session.tracks.find(v => v.id === args.trackId);
          const patternDuration = sketchTrackForGen && sketchTrackForGen.patterns.length > 0
            ? getActivePattern(sketchTrackForGen).duration
            : undefined;
          resolvedEvents = generateFromGenerator(gen, 16, patternDuration);
          generatorUsed = true;
        } else if (typeof args.archetype === 'string') {
          // Archetype lookup
          const arch = getArchetype(args.archetype);
          if (!arch) {
            return { actions: [], response: errorPayload(`Unknown archetype: "${args.archetype}"`) };
          }
          resolvedEvents = generateArchetypeEvents(args.archetype);
          archetypeUsed = true;
        } else if (Array.isArray(args.events)) {
          resolvedEvents = args.events as AISketchAction['events'];
        } else {
          return { actions: [], response: errorPayload('Sketch requires one of: events array, archetype name, or generator object') };
        }

        // Resolve bar.beat.sixteenth strings to absolute step numbers
        if (resolvedEvents) {
          try {
            resolveSketchPositions(resolvedEvents as { at: number | string }[]);
          } catch (e) {
            return { actions: [], response: errorPayload((e as Error).message) };
          }
        }

        const action: AISketchAction = {
          type: 'sketch',
          trackId: args.trackId as string,
          description: args.description as string,
          events: resolvedEvents,
          ...(typeof args.humanize === 'number' ? { humanize: Math.max(0, Math.min(1, args.humanize)) } : {}),
          ...(typeof args.groove === 'string' && args.groove in GROOVE_TEMPLATES ? { groove: args.groove } : {}),
          ...(typeof args.groove_amount === 'number' ? { grooveAmount: Math.max(0, Math.min(1, args.groove_amount)) } : {}),
          ...(typeof args.dynamic === 'string' ? { dynamic: args.dynamic as string } : {}),
        };

        const rejection = ctx?.validateAction?.(action);
        const rejectionResult = handleRejection(rejection, session, action);
        if (rejectionResult) return rejectionResult;

        // Compute consequence details from the before/after state
        const sketchTrack = session.tracks.find(v => v.id === action.trackId);
        const prevEvents = sketchTrack && sketchTrack.patterns.length > 0 ? getActivePattern(sketchTrack).events : [];
        const newEvents = action.events ?? [];
        const eventsAdded = Math.max(0, newEvents.length - prevEvents.length);
        const eventsRemoved = Math.max(0, prevEvents.length - newEvents.length);
        const eventsModified = Math.min(prevEvents.length, newEvents.length);

        // Detect rhythm change: compare trigger/note onset positions
        const getOnsets = (events: typeof prevEvents) =>
          events.filter(e => e.kind === 'trigger' || e.kind === 'note').map(e => e.at);
        const prevOnsets = getOnsets(prevEvents);
        const newOnsets = getOnsets(newEvents);
        const rhythmChanged = prevOnsets.length !== newOnsets.length ||
          prevOnsets.some((t, i) => Math.abs(t - newOnsets[i]) > 0.001);

        // Check if track has approval above exploratory
        const approval = sketchTrack?.approval ?? 'exploratory';
        const hasApprovalLock = approval !== 'exploratory';

        // Generate preservation report for tracks with approval >= 'liked'
        const preservationLevels = new Set(['liked', 'approved', 'anchor']);
        let preservationReport: PreservationReport | undefined;
        if (preservationLevels.has(approval) && action.events && sketchTrack && sketchTrack.patterns.length > 0) {
          preservationReport = generatePreservationReport(
            action.trackId,
            approval,
            getActivePattern(sketchTrack).events,
            action.events,
          );
        }

        return {
          actions: [action],
          response: {
            applied: true,
            trackId: action.trackId,
            description: action.description,
            eventsAdded,
            eventsRemoved,
            eventsModified,
            rhythmChanged,
            ...(hasApprovalLock ? { approvalLevel: approval } : {}),
            ...(preservationReport ? { preservation: preservationReport } : {}),
            ...(generatorUsed ? { source: 'generator' } : {}),
            ...(archetypeUsed ? { source: 'archetype', archetype: args.archetype } : {}),
            ...(action.dynamic ? { dynamic: action.dynamic } : {}),
          },
        };
      }

      case 'edit_pattern': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.description !== 'string') {
          return { actions: [], response: errorPayload('Missing required parameter: description') };
        }
        if (!Array.isArray(args.operations) || args.operations.length === 0) {
          return { actions: [], response: errorPayload('Missing required parameter: operations (must be a non-empty array)') };
        }

        // Resolve bar.beat.sixteenth strings to absolute step numbers before validation
        try {
          resolveEditPatternPositions(args.operations as { step: number | string }[]);
        } catch (e) {
          return { actions: [], response: errorPayload((e as Error).message) };
        }

        // Validate operation shape
        const validActions = ['add', 'remove', 'modify'];
        for (let i = 0; i < (args.operations as PatternEditOp[]).length; i++) {
          const op = (args.operations as PatternEditOp[])[i];
          if (!validActions.includes(op.action)) {
            return { actions: [], response: errorPayload(`operations[${i}]: unknown action "${op.action}". Must be add, remove, or modify`) };
          }
          if (typeof op.step !== 'number' || op.step < 0) {
            return { actions: [], response: errorPayload(`operations[${i}]: step must be a non-negative number`) };
          }
        }

        const action: AIEditPatternAction = {
          type: 'edit_pattern',
          trackId: args.trackId as string,
          operations: args.operations as PatternEditOp[],
          description: args.description as string,
          ...(args.patternId ? { patternId: args.patternId as string } : {}),
        };

        const rejection = ctx?.validateAction?.(action);
        const rejectionResult = handleRejection(rejection, session, action);
        if (rejectionResult) return rejectionResult;

        // Summarize operations
        const adds = action.operations.filter(o => o.action === 'add').length;
        const removes = action.operations.filter(o => o.action === 'remove').length;
        const modifies = action.operations.filter(o => o.action === 'modify').length;

        return {
          actions: [action],
          response: {
            applied: true,
            trackId: action.trackId,
            description: action.description,
            added: adds,
            removed: removes,
            modified: modifies,
          },
        };
      }

      case 'set_transport': {
        const hasBpm = typeof args.bpm === 'number';
        const hasSwing = typeof args.swing === 'number';
        const hasMode = typeof args.mode === 'string' && ['pattern', 'song'].includes(args.mode as string);
        const hasTimeSig = typeof args.timeSignatureNumerator === 'number' || typeof args.timeSignatureDenominator === 'number';
        if (!hasBpm && !hasSwing && !hasMode && !hasTimeSig) {
          return { actions: [], response: errorPayload('At least one transport property must be provided') };
        }

        const action: AITransportAction = {
          type: 'set_transport',
          ...(hasBpm ? { bpm: args.bpm as number } : {}),
          ...(hasSwing ? { swing: args.swing as number } : {}),
          ...(hasMode ? { mode: args.mode as 'pattern' | 'song' } : {}),
          ...(typeof args.timeSignatureNumerator === 'number' ? { timeSignatureNumerator: args.timeSignatureNumerator as number } : {}),
          ...(typeof args.timeSignatureDenominator === 'number' ? { timeSignatureDenominator: args.timeSignatureDenominator as number } : {}),
        };

        const rejection = ctx?.validateAction?.(action);
        const rejectionResult = handleRejection(rejection, session, action);
        if (rejectionResult) return rejectionResult;

        const resultBpm = action.bpm !== undefined ? Math.max(20, Math.min(300, action.bpm)) : undefined;
        const resultSwing = action.swing !== undefined ? Math.max(0, Math.min(1, action.swing)) : undefined;

        return {
          actions: [action],
          response: {
            applied: true,
            ...(resultBpm !== undefined ? { bpm: resultBpm } : {}),
            ...(resultSwing !== undefined ? { swing: Math.round(resultSwing * 100) / 100 } : {}),
            ...(action.mode ? { mode: action.mode } : {}),
          },
        };
      }

      case 'set_model': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.model !== 'string' || !args.model) {
          return { actions: [], response: errorPayload('Missing required parameter: model') };
        }

        const action: AISetModelAction = {
          type: 'set_model',
          trackId: args.trackId as string,
          model: args.model as string,
          ...(args.processorId ? { processorId: args.processorId as string } : {}),
          ...(args.modulatorId ? { modulatorId: args.modulatorId as string } : {}),
        };

        const rejection = ctx?.validateAction?.(action);
        const rejectionResult = handleRejection(rejection, session, action);
        if (rejectionResult) return rejectionResult;

        return {
          actions: [action],
          response: {
            queued: true,
            trackId: action.trackId,
            model: action.model,
            ...(action.processorId ? { processorId: action.processorId } : {}),
          },
        };
      }

      case 'transform': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.operation !== 'string' || !args.operation) {
          return { actions: [], response: errorPayload('Missing required parameter: operation') };
        }
        if (typeof args.description !== 'string') {
          return { actions: [], response: errorPayload('Missing required parameter: description') };
        }

        const operation = args.operation as string;
        const validOps = ['rotate', 'transpose', 'reverse', 'duplicate', 'humanize', 'euclidean', 'ghost_notes', 'swing', 'thin', 'densify'];
        if (!validOps.includes(operation)) {
          return { actions: [], response: errorPayload(`Unknown operation: ${operation}. Must be one of: ${validOps.join(', ')}`) };
        }

        const hasSteps = typeof args.steps === 'number';
        const hasSemitones = typeof args.semitones === 'number';

        if (operation === 'rotate') {
          if (!hasSteps) return { actions: [], response: errorPayload('rotate requires steps parameter') };
          if (hasSemitones) return { actions: [], response: errorPayload('rotate does not accept semitones parameter') };
          if (args.steps === 0) return { actions: [], response: errorPayload('steps must be non-zero') };
        } else if (operation === 'transpose') {
          if (!hasSemitones) return { actions: [], response: errorPayload('transpose requires semitones parameter') };
          if (hasSteps) return { actions: [], response: errorPayload('transpose does not accept steps parameter') };
          if (args.semitones === 0) return { actions: [], response: errorPayload('semitones must be non-zero') };
        } else if (['humanize', 'euclidean', 'ghost_notes', 'swing', 'thin', 'densify'].includes(operation)) {
          // Helper operations accept their own specific params — no steps/semitones validation needed
        } else {
          if (hasSteps) return { actions: [], response: errorPayload(`${operation} does not accept steps parameter`) };
          if (hasSemitones) return { actions: [], response: errorPayload(`${operation} does not accept semitones parameter`) };
        }

        const action: AITransformAction = {
          type: 'transform',
          trackId: args.trackId as string,
          operation: operation as AITransformAction['operation'],
          description: args.description as string,
          ...(hasSteps ? { steps: args.steps as number } : {}),
          ...(hasSemitones ? { semitones: args.semitones as number } : {}),
          ...(typeof args.velocity_amount === 'number' ? { velocity_amount: args.velocity_amount } : {}),
          ...(typeof args.timing_amount === 'number' ? { timing_amount: args.timing_amount } : {}),
          ...(typeof args.hits === 'number' ? { hits: args.hits } : {}),
          ...(typeof args.rotation === 'number' ? { rotation: args.rotation } : {}),
          ...(typeof args.velocity === 'number' ? { velocity: args.velocity } : {}),
          ...(typeof args.probability === 'number' ? { probability: args.probability } : {}),
          ...(typeof args.amount === 'number' ? { amount: args.amount } : {}),
        };

        const rejection = ctx?.validateAction?.(action);
        const rejectionResult = handleRejection(rejection, session, action);
        if (rejectionResult) return rejectionResult;

        return {
          actions: [action],
          response: {
            applied: true,
            trackId: action.trackId,
            operation: action.operation,
            description: action.description,
          },
        };
      }

      case 'manage_view': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        const viewSubAction = args.action as string;
        if (!viewSubAction) return { actions: [], response: errorPayload('Missing required: action') };
        switch (viewSubAction) {
          case 'add': {
            if (typeof args.viewKind !== 'string' || !args.viewKind) {
              return { actions: [], response: errorPayload('action=add requires viewKind') };
            }
            const validKinds = ['step-grid'];
            if (!validKinds.includes(args.viewKind as string)) {
              return { actions: [], response: errorPayload(`Unknown viewKind: ${args.viewKind}. Must be one of: ${validKinds.join(', ')}`) };
            }
            if (typeof args.description !== 'string') {
              return { actions: [], response: errorPayload('Missing required parameter: description') };
            }

            const addViewAction: AIAddViewAction = {
              type: 'add_view',
              trackId: args.trackId as string,
              viewKind: args.viewKind as AIAddViewAction['viewKind'],
              description: args.description as string,
            };

            const addViewRejection = handleRejection(ctx?.validateAction?.(addViewAction), session, addViewAction);
            if (addViewRejection) return addViewRejection;

            return {
              actions: [addViewAction],
              response: {
                applied: true,
                trackId: addViewAction.trackId,
                viewKind: addViewAction.viewKind,
              },
            };
          }
          case 'remove': {
            if (typeof args.viewId !== 'string' || !args.viewId) {
              return { actions: [], response: errorPayload('action=remove requires viewId') };
            }
            if (typeof args.description !== 'string') {
              return { actions: [], response: errorPayload('Missing required parameter: description') };
            }

            const removeViewAction: AIRemoveViewAction = {
              type: 'remove_view',
              trackId: args.trackId as string,
              viewId: args.viewId as string,
              description: args.description as string,
            };

            const removeViewRejection = handleRejection(ctx?.validateAction?.(removeViewAction), session, removeViewAction);
            if (removeViewRejection) return removeViewRejection;

            return {
              actions: [removeViewAction],
              response: {
                applied: true,
                trackId: removeViewAction.trackId,
                viewId: removeViewAction.viewId,
              },
            };
          }
          default:
            return { actions: [], response: errorPayload(`Invalid action "${viewSubAction}". Use: add, remove`) };
        }
      }

      case 'manage_processor': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        const procSubAction = args.action as string;
        if (!procSubAction) return { actions: [], response: errorPayload('Missing required: action') };
        switch (procSubAction) {
          case 'add': {
            if (typeof args.moduleType !== 'string' || !args.moduleType) {
              return { actions: [], response: errorPayload('action=add requires moduleType') };
            }
            const track = session.tracks.find(v => v.id === args.trackId);
            if (track) {
              const chainResult = validateChainMutation(track, { kind: 'add', type: args.moduleType as string });
              if (!chainResult.valid) {
                return { actions: [], response: errorPayload(chainResult.errors[0]) };
              }
            }
            if (typeof args.description !== 'string') {
              return { actions: [], response: errorPayload('Missing required parameter: description') };
            }

            const assignedProcessorId = `${args.moduleType}-${Date.now()}`;

            const addProcAction: AIAddProcessorAction = {
              type: 'add_processor',
              trackId: args.trackId as string,
              moduleType: args.moduleType as string,
              processorId: assignedProcessorId,
              description: args.description as string,
            };

            const addProcRejection = handleRejection(ctx?.validateAction?.(addProcAction), session, addProcAction);
            if (addProcRejection) return addProcRejection;

            return {
              actions: [addProcAction],
              response: {
                applied: true,
                trackId: addProcAction.trackId,
                moduleType: addProcAction.moduleType,
                processorId: assignedProcessorId,
              },
            };
          }
          case 'remove': {
            if (typeof args.processorId !== 'string' || !args.processorId) {
              return { actions: [], response: errorPayload('action=remove requires processorId') };
            }
            if (typeof args.description !== 'string') {
              return { actions: [], response: errorPayload('Missing required parameter: description') };
            }

            const removeProcAction: AIRemoveProcessorAction = {
              type: 'remove_processor',
              trackId: args.trackId as string,
              processorId: args.processorId as string,
              description: args.description as string,
            };

            const removeProcRejection = handleRejection(ctx?.validateAction?.(removeProcAction), session, removeProcAction);
            if (removeProcRejection) return removeProcRejection;

            return {
              actions: [removeProcAction],
              response: {
                applied: true,
                trackId: removeProcAction.trackId,
                processorId: removeProcAction.processorId,
              },
            };
          }
          case 'replace': {
            if (typeof args.processorId !== 'string' || !args.processorId) {
              return { actions: [], response: errorPayload('action=replace requires processorId') };
            }
            if (typeof args.moduleType !== 'string' || !args.moduleType) {
              return { actions: [], response: errorPayload('action=replace requires moduleType') };
            }
            if (typeof args.description !== 'string') {
              return { actions: [], response: errorPayload('Missing required parameter: description') };
            }

            const newProcessorId = `${args.moduleType}-${Date.now()}`;

            const replaceAction: AIReplaceProcessorAction = {
              type: 'replace_processor',
              trackId: args.trackId as string,
              processorId: args.processorId as string,
              newModuleType: args.moduleType as string,
              newProcessorId,
              description: args.description as string,
            };

            const replaceRejection = handleRejection(ctx?.validateAction?.(replaceAction), session, replaceAction);
            if (replaceRejection) return replaceRejection;

            return {
              actions: [replaceAction],
              response: {
                applied: true,
                trackId: replaceAction.trackId,
                replacedProcessorId: replaceAction.processorId,
                newModuleType: replaceAction.newModuleType,
                newProcessorId,
              },
            };
          }
          case 'bypass': {
            if (typeof args.processorId !== 'string' || !args.processorId) {
              return { actions: [], response: errorPayload('action=bypass requires processorId') };
            }
            if (typeof args.description !== 'string') {
              return { actions: [], response: errorPayload('Missing required parameter: description') };
            }
            const bypassEnabled = args.enabled !== false; // default to re-enabling if not specified

            const bypassAction: AIBypassProcessorAction = {
              type: 'bypass_processor',
              trackId: args.trackId as string,
              processorId: args.processorId as string,
              enabled: bypassEnabled,
              description: args.description as string,
            };

            return {
              actions: [bypassAction],
              response: {
                applied: true,
                trackId: bypassAction.trackId,
                processorId: bypassAction.processorId,
                enabled: bypassEnabled,
              },
            };
          }
          default:
            return { actions: [], response: errorPayload(`Invalid action "${procSubAction}". Use: add, remove, replace, bypass`) };
        }
      }

      case 'manage_modulator': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        const modSubAction = args.action as string;
        if (!modSubAction) return { actions: [], response: errorPayload('Missing required: action') };
        switch (modSubAction) {
          case 'add': {
            if (typeof args.moduleType !== 'string' || !args.moduleType) {
              return { actions: [], response: errorPayload('action=add requires moduleType') };
            }
            const track = session.tracks.find(v => v.id === args.trackId);
            if (track) {
              const modResult = validateModulatorMutation(track, { kind: 'add', type: args.moduleType as string });
              if (!modResult.valid) {
                return { actions: [], response: errorPayload(modResult.errors[0]) };
              }
            }
            if (typeof args.description !== 'string') {
              return { actions: [], response: errorPayload('Missing required parameter: description') };
            }

            const assignedModulatorId = `${args.moduleType}-${Date.now()}`;

            const addModAction: AIAddModulatorAction = {
              type: 'add_modulator',
              trackId: args.trackId as string,
              moduleType: args.moduleType as string,
              modulatorId: assignedModulatorId,
              description: args.description as string,
            };

            const addModRejection = handleRejection(ctx?.validateAction?.(addModAction), session, addModAction);
            if (addModRejection) return addModRejection;

            return {
              actions: [addModAction],
              response: {
                queued: true,
                trackId: addModAction.trackId,
                moduleType: addModAction.moduleType,
                modulatorId: assignedModulatorId,
              },
            };
          }
          case 'remove': {
            if (typeof args.modulatorId !== 'string' || !args.modulatorId) {
              return { actions: [], response: errorPayload('action=remove requires modulatorId') };
            }
            if (typeof args.description !== 'string') {
              return { actions: [], response: errorPayload('Missing required parameter: description') };
            }

            const removeModAction: AIRemoveModulatorAction = {
              type: 'remove_modulator',
              trackId: args.trackId as string,
              modulatorId: args.modulatorId as string,
              description: args.description as string,
            };

            const removeModRejection = handleRejection(ctx?.validateAction?.(removeModAction), session, removeModAction);
            if (removeModRejection) return removeModRejection;

            return {
              actions: [removeModAction],
              response: {
                queued: true,
                trackId: removeModAction.trackId,
                modulatorId: removeModAction.modulatorId,
              },
            };
          }
          default:
            return { actions: [], response: errorPayload(`Invalid action "${modSubAction}". Use: add, remove`) };
        }
      }

      case 'modulation_route': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        const routeSubAction = args.action as string;
        if (!routeSubAction) return { actions: [], response: errorPayload('Missing required: action') };
        switch (routeSubAction) {
          case 'connect': {
            if (typeof args.modulatorId !== 'string' || !args.modulatorId) {
              return { actions: [], response: errorPayload('action=connect requires modulatorId') };
            }
            if (typeof args.targetKind !== 'string' || !args.targetKind) {
              return { actions: [], response: errorPayload('action=connect requires targetKind') };
            }
            if (typeof args.targetParam !== 'string' || !args.targetParam) {
              return { actions: [], response: errorPayload('action=connect requires targetParam') };
            }
            if (typeof args.depth !== 'number') {
              return { actions: [], response: errorPayload('action=connect requires depth') };
            }
            if (typeof args.description !== 'string') {
              return { actions: [], response: errorPayload('Missing required parameter: description') };
            }

            const targetKind = args.targetKind as string;
            if (targetKind !== 'source' && targetKind !== 'processor') {
              return { actions: [], response: errorPayload(`targetKind must be "source" or "processor", got "${targetKind}"`) };
            }
            if (targetKind === 'processor' && (typeof args.processorId !== 'string' || !args.processorId)) {
              return { actions: [], response: errorPayload('processorId is required when targetKind is "processor"') };
            }

            const modTarget: ModulationTarget = targetKind === 'source'
              ? { kind: 'source', param: args.targetParam as string }
              : { kind: 'processor', processorId: args.processorId as string, param: args.targetParam as string };

            const connectTrack = session.tracks.find(v => v.id === args.trackId);
            const existingRoute = (connectTrack?.modulations ?? []).find(r =>
              r.modulatorId === args.modulatorId &&
              r.target.kind === modTarget.kind &&
              r.target.param === modTarget.param &&
              (modTarget.kind === 'source' || (modTarget.kind === 'processor' && r.target.kind === 'processor' && r.target.processorId === modTarget.processorId))
            );

            const preAssignedId = existingRoute?.id ?? `mod-${Date.now()}`;

            const connectAction: AIConnectModulatorAction = {
              type: 'connect_modulator',
              trackId: args.trackId as string,
              modulatorId: args.modulatorId as string,
              target: modTarget,
              depth: args.depth as number,
              modulationId: preAssignedId,
              description: args.description as string,
            };

            const connectRejection = handleRejection(ctx?.validateAction?.(connectAction), session, connectAction);
            if (connectRejection) return connectRejection;

            const targetStr = modTarget.kind === 'source'
              ? `source:${modTarget.param}`
              : `processor:${modTarget.processorId}:${modTarget.param}`;

            return {
              actions: [connectAction],
              response: {
                queued: true,
                modulationId: preAssignedId,
                created: !existingRoute,
                ...(existingRoute ? { previousDepth: existingRoute.depth } : {}),
                target: targetStr,
                depth: args.depth,
              },
            };
          }
          case 'disconnect': {
            if (typeof args.modulationId !== 'string' || !args.modulationId) {
              return { actions: [], response: errorPayload('action=disconnect requires modulationId') };
            }
            if (typeof args.description !== 'string') {
              return { actions: [], response: errorPayload('Missing required parameter: description') };
            }

            const disconnectAction: AIDisconnectModulatorAction = {
              type: 'disconnect_modulator',
              trackId: args.trackId as string,
              modulationId: args.modulationId as string,
              description: args.description as string,
            };

            const disconnectRejection = handleRejection(ctx?.validateAction?.(disconnectAction), session, disconnectAction);
            if (disconnectRejection) return disconnectRejection;

            return {
              actions: [disconnectAction],
              response: {
                queued: true,
                trackId: disconnectAction.trackId,
                modulationId: disconnectAction.modulationId,
              },
            };
          }
          default:
            return { actions: [], response: errorPayload(`Invalid action "${routeSubAction}". Use: connect, disconnect`) };
        }
      }

      case 'set_surface': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (!Array.isArray(args.semanticControls)) {
          return { actions: [], response: errorPayload('Missing required parameter: semanticControls (must be an array)') };
        }
        if (typeof args.description !== 'string') {
          return { actions: [], response: errorPayload('Missing required parameter: description') };
        }

        const rawControls = args.semanticControls as Record<string, unknown>[];
        const semanticControls: SemanticControlDef[] = rawControls.map((sc, i) => {
          const rawWeights = (sc.weights as Record<string, unknown>[]) ?? [];
          const weights: SemanticControlWeight[] = rawWeights.map(w => ({
            moduleId: (w.moduleId as string) ?? 'source',
            controlId: (w.controlId as string) ?? '',
            weight: (w.weight as number) ?? 0,
            transform: ((w.transform as string) ?? 'linear') as SemanticControlWeight['transform'],
          }));
          const scName = (sc.name as string) ?? `control-${i}`;
          const rawRange = sc.range as Record<string, number> | undefined;
          return {
            id: scName.toLowerCase().replace(/\s+/g, '-'),
            name: scName,
            semanticRole: null,
            description: '',
            weights,
            range: rawRange
              ? { min: rawRange.min ?? 0, max: rawRange.max ?? 1, default: rawRange.default ?? 0.5 }
              : { min: 0, max: 1, default: 0.5 },
          };
        });

        const xyAxes = args.xyAxes as { x: string; y: string } | undefined;

        const setSurfaceAction: AISetSurfaceAction = {
          type: 'set_surface',
          trackId: args.trackId as string,
          semanticControls,
          ...(xyAxes ? { xyAxes } : {}),
          description: args.description as string,
        };

        const setSurfaceRejection = handleRejection(ctx?.validateAction?.(setSurfaceAction), session, setSurfaceAction);
        if (setSurfaceRejection) return setSurfaceRejection;

        return {
          actions: [setSurfaceAction],
          response: {
            applied: true,
            trackId: setSurfaceAction.trackId,
            controlCount: semanticControls.length,
          },
        };
      }

      case 'pin_control': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.moduleId !== 'string' || !args.moduleId) {
          return { actions: [], response: errorPayload('Missing required parameter: moduleId') };
        }
        if (typeof args.controlId !== 'string' || !args.controlId) {
          return { actions: [], response: errorPayload('Missing required parameter: controlId') };
        }
        const pinSubAction = args.action as string;
        if (!pinSubAction) return { actions: [], response: errorPayload('Missing required: action') };
        switch (pinSubAction) {
          case 'pin': {
            const pinAction: AIPinAction = {
              type: 'pin',
              trackId: args.trackId as string,
              moduleId: args.moduleId as string,
              controlId: args.controlId as string,
              description: `pin ${args.moduleId}:${args.controlId}`,
            };

            const pinRejection = handleRejection(ctx?.validateAction?.(pinAction), session, pinAction);
            if (pinRejection) return pinRejection;

            return {
              actions: [pinAction],
              response: {
                applied: true,
                trackId: pinAction.trackId,
                moduleId: pinAction.moduleId,
                controlId: pinAction.controlId,
              },
            };
          }
          case 'unpin': {
            const unpinAction: AIUnpinAction = {
              type: 'unpin',
              trackId: args.trackId as string,
              moduleId: args.moduleId as string,
              controlId: args.controlId as string,
              description: `unpin ${args.moduleId}:${args.controlId}`,
            };

            const unpinRejection = handleRejection(ctx?.validateAction?.(unpinAction), session, unpinAction);
            if (unpinRejection) return unpinRejection;

            return {
              actions: [unpinAction],
              response: {
                applied: true,
                trackId: unpinAction.trackId,
                moduleId: unpinAction.moduleId,
                controlId: unpinAction.controlId,
              },
            };
          }
          default:
            return { actions: [], response: errorPayload(`Invalid action "${pinSubAction}". Use: pin, unpin`) };
        }
      }

      case 'label_axes': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.x !== 'string' || !args.x) {
          return { actions: [], response: errorPayload('Missing required parameter: x') };
        }
        if (typeof args.y !== 'string' || !args.y) {
          return { actions: [], response: errorPayload('Missing required parameter: y') };
        }

        const labelAxesAction: AILabelAxesAction = {
          type: 'label_axes',
          trackId: args.trackId as string,
          x: args.x as string,
          y: args.y as string,
          description: `label axes: ${args.x} x ${args.y}`,
        };

        const labelAxesRejection = handleRejection(ctx?.validateAction?.(labelAxesAction), session, labelAxesAction);
        if (labelAxesRejection) return labelAxesRejection;

        return {
          actions: [labelAxesAction],
          response: {
            applied: true,
            trackId: labelAxesAction.trackId,
            x: labelAxesAction.x,
            y: labelAxesAction.y,
          },
        };
      }

      case 'set_track_meta': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        const hasName = args.name !== undefined;
        const hasVolume = typeof args.volume === 'number';
        const hasPan = typeof args.pan === 'number';
        const hasApproval = args.approval !== undefined;
        const hasImportance = args.importance !== undefined;
        const hasRole = args.musicalRole !== undefined;
        const hasMuted = args.muted !== undefined;
        const hasSolo = args.solo !== undefined;
        if (!hasName && !hasVolume && !hasPan && !hasApproval && !hasImportance && !hasRole && !hasMuted && !hasSolo) {
          return { actions: [], response: errorPayload('At least one of name, volume, pan, approval, importance, musicalRole, muted, solo required') };
        }

        const metaActions: AIAction[] = [];
        const applied: string[] = [];
        const errors: string[] = [];

        // Handle volume/pan
        if (hasVolume || hasPan) {
          const trackMix: AISetTrackMixAction = {
            type: 'set_track_mix',
            trackId: args.trackId as string,
            ...(hasVolume ? { volume: Math.max(0, Math.min(1, args.volume as number)) } : {}),
            ...(hasPan ? { pan: Math.max(-1, Math.min(1, args.pan as number)) } : {}),
          };
          metaActions.push(trackMix);
          if (hasVolume) applied.push('volume');
          if (hasPan) applied.push('pan');
        }

        // Handle muted/solo
        if (hasMuted || hasSolo) {
          const muteSoloAction: AISetMuteSoloAction = {
            type: 'set_mute_solo',
            trackId: args.trackId as string,
            ...(hasMuted ? { muted: !!args.muted } : {}),
            ...(hasSolo ? { solo: !!args.solo } : {}),
          };
          metaActions.push(muteSoloAction);
          if (hasMuted) applied.push('muted');
          if (hasSolo) applied.push('solo');
        }

        // Handle rename
        if (hasName) {
          if (typeof args.name !== 'string' || !args.name.trim()) {
            errors.push('name must be a non-empty string');
          } else {
            const renameAction: AIRenameTrackAction = {
              type: 'rename_track',
              trackId: args.trackId as string,
              name: args.name.trim() as string,
            };
            metaActions.push(renameAction);
            applied.push('name');
          }
        }

        if (hasApproval) {
          const level = args.approval as string;
          const validLevels: ApprovalLevel[] = ['exploratory', 'liked', 'approved', 'anchor'];
          if (!validLevels.includes(level as ApprovalLevel)) {
            errors.push(`Invalid approval level: ${level}`);
          } else if (!args.reason) {
            errors.push('approval requires reason');
          } else {
            const markApprovedAction: AIMarkApprovedAction = {
              type: 'mark_approved',
              trackId: args.trackId as string,
              level: level as ApprovalLevel,
              reason: args.reason as string,
            };
            const markRejection = handleRejection(ctx?.validateAction?.(markApprovedAction), session, markApprovedAction);
            if (markRejection) {
              errors.push(markRejection.response.error as string ?? markRejection.response.message as string ?? 'Rejected');
            } else {
              metaActions.push(markApprovedAction);
              applied.push('approval');
            }
          }
        }

        if (hasImportance) {
          if (typeof args.importance !== 'number' || !Number.isFinite(args.importance)) {
            errors.push('importance must be a finite number (0.0-1.0)');
          } else {
            const importance = Math.max(0, Math.min(1, args.importance));
            const setImportanceAction: AISetImportanceAction = {
              type: 'set_importance',
              trackId: args.trackId as string,
              importance,
              ...(hasRole ? { musicalRole: args.musicalRole as string } : {}),
            };
            metaActions.push(setImportanceAction);
            applied.push('importance');
            if (hasRole) applied.push('musicalRole');
          }
        } else if (hasRole) {
          // musicalRole without importance — preserve current importance if it exists
          const metaTrack = session.tracks.find(v => v.id === args.trackId);
          if (metaTrack?.importance === undefined) {
            errors.push('musicalRole requires importance to be set first (either in this call or previously)');
          } else {
            const setImportanceAction: AISetImportanceAction = {
              type: 'set_importance',
              trackId: args.trackId as string,
              importance: metaTrack.importance,
              musicalRole: args.musicalRole as string,
            };
            metaActions.push(setImportanceAction);
            applied.push('musicalRole');
          }
        }

        return {
          actions: metaActions,
          response: {
            trackId: args.trackId,
            applied,
            ...(errors.length > 0 ? { errors } : {}),
          },
        };
      }

      case 'explain_chain': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        const explainTrackId = resolveTrackId(args.trackId as string, session);
        if (!explainTrackId) {
          return { actions: [], response: errorPayload(`Unknown track: ${args.trackId}`) };
        }
        const explainTrack = getTrack(session, explainTrackId);

        // Source description
        const sourceName = getModelName(explainTrack.model);
        const parts: string[] = [`Source: Plaits — ${sourceName} (engine ${explainTrack.model}).`];

        // Source params that differ from 0.5 default
        const sourceParamEntries = Object.entries(explainTrack.params)
          .filter(([k, v]) => k !== 'note' && v !== undefined)
          .map(([k, v]) => `${k}=${(v as number).toFixed(2)}`);
        if (sourceParamEntries.length > 0) {
          parts.push(`Source params: ${sourceParamEntries.join(', ')}.`);
        }

        // Processors
        const processors = explainTrack.processors ?? [];
        if (processors.length === 0) {
          parts.push('No processors in the chain.');
        } else {
          for (const proc of processors) {
            const procInst = getProcessorInstrument(proc.type);
            const procLabel = procInst?.label ?? proc.type;
            const modeName = getProcessorEngineName(proc.type, proc.model) ?? `mode ${proc.model}`;
            const bypassStr = proc.enabled === false ? ' [BYPASSED]' : '';
            const paramStrs = Object.entries(proc.params)
              .map(([k, v]) => `${k}=${v.toFixed(2)}`)
              .join(', ');
            parts.push(`Processor: ${procLabel} (${modeName})${bypassStr}${paramStrs ? ` — ${paramStrs}` : ''}.`);
          }
        }

        // Modulators and routings
        const modulators = explainTrack.modulators ?? [];
        const modulations = explainTrack.modulations ?? [];
        if (modulators.length === 0) {
          parts.push('No modulators.');
        } else {
          for (const mod of modulators) {
            const modInst = getModulatorInstrument(mod.type);
            const modLabel = modInst?.label ?? mod.type;
            const modModeName = getModulatorEngineName(mod.type, mod.model) ?? `mode ${mod.model}`;
            const modParamStrs = Object.entries(mod.params)
              .map(([k, v]) => `${k}=${v.toFixed(2)}`)
              .join(', ');
            parts.push(`Modulator: ${modLabel} (${modModeName})${modParamStrs ? ` — ${modParamStrs}` : ''}.`);

            // Routings from this modulator
            const routes = modulations.filter(r => r.modulatorId === mod.id);
            for (const route of routes) {
              const targetDesc = route.target.kind === 'source'
                ? `source.${route.target.param}`
                : `processor(${route.target.processorId}).${route.target.param}`;
              parts.push(`  → routed to ${targetDesc}, depth ${route.depth.toFixed(2)}.`);
            }
          }
        }

        return { actions: [], response: { trackId: explainTrackId, description: parts.join('\n') } };
      }

      case 'simplify_chain': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        const simplifyTrackId = resolveTrackId(args.trackId as string, session);
        if (!simplifyTrackId) {
          return { actions: [], response: errorPayload(`Unknown track: ${args.trackId}`) };
        }
        const simplifyTrack = getTrack(session, simplifyTrackId);
        const simplifyProcessors = simplifyTrack.processors ?? [];

        const suggestions: string[] = [];

        if (simplifyProcessors.length === 0) {
          return { actions: [], response: { trackId: simplifyTrackId, suggestions: [], summary: 'No processors in the chain — nothing to simplify.' } };
        }

        // Check for bypassed processors
        for (const proc of simplifyProcessors) {
          if (proc.enabled === false) {
            suggestions.push(`"${proc.id}" (${proc.type}) is bypassed — consider removing it if no longer needed.`);
          }
        }

        // Check for default-valued processors (all params at default ~0.5 or empty)
        for (const proc of simplifyProcessors) {
          if (proc.enabled === false) continue; // already flagged
          const procInst = getProcessorInstrument(proc.type);
          if (!procInst || procInst.engines.length === 0) continue;
          const controlDefs = procInst.engines[0].controls;
          const allDefault = controlDefs.every(ctrl => {
            const val = proc.params[ctrl.id];
            const defaultVal = ctrl.range.default;
            return val === undefined || Math.abs(val - defaultVal) < 0.01;
          });
          if (allDefault) {
            suggestions.push(`"${proc.id}" (${proc.type}) has all parameters at defaults — it may not be contributing to the sound.`);
          }
        }

        // Check for duplicate processor types
        const typeCounts = new Map<string, string[]>();
        for (const proc of simplifyProcessors) {
          const ids = typeCounts.get(proc.type) ?? [];
          ids.push(proc.id);
          typeCounts.set(proc.type, ids);
        }
        for (const [type, ids] of typeCounts) {
          if (ids.length > 1) {
            suggestions.push(`Multiple ${type} processors: ${ids.join(', ')}. Consider whether all are needed.`);
          }
        }

        // Check for unrouted modulators (modulators with no routing)
        const simplifyModulators = simplifyTrack.modulators ?? [];
        const simplifyModulations = simplifyTrack.modulations ?? [];
        for (const mod of simplifyModulators) {
          const hasRoute = simplifyModulations.some(r => r.modulatorId === mod.id);
          if (!hasRoute) {
            suggestions.push(`Modulator "${mod.id}" (${mod.type}) has no routings — it is not affecting any parameter.`);
          }
        }

        const summary = suggestions.length === 0
          ? 'Chain looks clean — no obvious redundancies found.'
          : `Found ${suggestions.length} suggestion(s) for simplification.`;

        return { actions: [], response: { trackId: simplifyTrackId, suggestions, summary } };
      }

      case 'raise_decision': {
        if (typeof args.question !== 'string' || !args.question) {
          return { actions: [], response: errorPayload('Missing required parameter: question') };
        }

        const decisionId = `decision-${Date.now()}`;

        const raiseAction: AIRaiseDecisionAction = {
          type: 'raise_decision',
          decisionId,
          question: args.question as string,
          ...(typeof args.context === 'string' ? { context: args.context } : {}),
          ...(Array.isArray(args.options) ? { options: args.options as string[] } : {}),
          ...(Array.isArray(args.trackIds) ? { trackIds: args.trackIds as string[] } : {}),
        };

        return {
          actions: [raiseAction],
          response: {
            applied: true,
            decisionId,
            question: raiseAction.question,
          },
        };
      }

      case 'manage_track': {
        const trackSubAction = args.action as string;
        if (!trackSubAction) return { actions: [], response: errorPayload('Missing required: action') };
        if (typeof args.description !== 'string') {
          return { actions: [], response: errorPayload('Missing required parameter: description') };
        }
        switch (trackSubAction) {
          case 'add': {
            const kind = (args.kind as string) ?? 'audio';
            const validKinds: TrackKind[] = ['audio', 'bus'];
            if (!validKinds.includes(kind as TrackKind)) {
              return { actions: [], response: errorPayload(`Invalid kind: ${kind}. Must be one of: ${validKinds.join(', ')}`) };
            }

            const addTrackAction: AIAddTrackAction = {
              type: 'add_track',
              kind: kind as TrackKind,
              ...(typeof args.label === 'string' ? { label: args.label } : {}),
              description: args.description as string,
            };

            const addTrackRejection = handleRejection(ctx?.validateAction?.(addTrackAction), session, addTrackAction);
            if (addTrackRejection) return addTrackRejection;

            // Project the addition to determine the new track's ordinal position
            const projectedAfterAdd = addTrack(session, kind as TrackKind);
            const newTrackCount = projectedAfterAdd
              ? projectedAfterAdd.tracks.filter(t => getTrackKind(t) !== 'bus').length
              : session.tracks.filter(t => getTrackKind(t) !== 'bus').length + 1;

            return {
              actions: [addTrackAction],
              response: {
                queued: true,
                kind: addTrackAction.kind,
                ...(addTrackAction.label ? { label: addTrackAction.label } : {}),
                trackRef: `Track ${newTrackCount}`,
                note: `Use "Track ${newTrackCount}" to reference this track in subsequent tool calls this turn.`,
              },
            };
          }
          case 'remove': {
            if (typeof args.trackId !== 'string' || !args.trackId) {
              return { actions: [], response: errorPayload('action=remove requires trackId') };
            }

            const resolvedTrackId = resolveTrackId(args.trackId as string, session);
            if (!resolvedTrackId) {
              return { actions: [], response: errorPayload(`Track not found: ${args.trackId}`) };
            }

            const removeTrackAction: AIRemoveTrackAction = {
              type: 'remove_track',
              trackId: resolvedTrackId,
              description: args.description as string,
            };

            const removeTrackRejection = handleRejection(ctx?.validateAction?.(removeTrackAction), session, removeTrackAction);
            if (removeTrackRejection) return removeTrackRejection;

            return {
              actions: [removeTrackAction],
              response: {
                applied: true,
                trackId: removeTrackAction.trackId,
              },
            };
          }
          default:
            return { actions: [], response: errorPayload(`Invalid action "${trackSubAction}". Use: add, remove`) };
        }
      }

      case 'report_bug': {
        if (typeof args.summary !== 'string' || !args.summary) {
          return { actions: [], response: errorPayload('Missing required parameter: summary') };
        }
        if (typeof args.category !== 'string' || !args.category) {
          return { actions: [], response: errorPayload('Missing required parameter: category') };
        }
        const validCategories: BugCategory[] = ['audio', 'state', 'tool', 'ui', 'other'];
        if (!validCategories.includes(args.category as BugCategory)) {
          return { actions: [], response: errorPayload(`Invalid category: ${args.category}. Must be one of: ${validCategories.join(', ')}`) };
        }
        if (typeof args.details !== 'string' || !args.details) {
          return { actions: [], response: errorPayload('Missing required parameter: details') };
        }
        if (typeof args.severity !== 'string' || !args.severity) {
          return { actions: [], response: errorPayload('Missing required parameter: severity') };
        }
        const validSeverities: BugSeverity[] = ['low', 'medium', 'high'];
        if (!validSeverities.includes(args.severity as BugSeverity)) {
          return { actions: [], response: errorPayload(`Invalid severity: ${args.severity}. Must be one of: ${validSeverities.join(', ')}`) };
        }

        // Deduplication: reject reports with identical summaries within the same session
        const existingReports = session.bugReports ?? [];
        const isDuplicate = existingReports.some(r => r.summary === args.summary);
        if (isDuplicate) {
          return { actions: [], response: { duplicate: true, message: 'A bug report with this summary already exists in this session.' } };
        }

        const bugId = `bug-${Date.now()}`;

        const reportAction: AIReportBugAction = {
          type: 'report_bug',
          bugId,
          summary: args.summary as string,
          category: args.category as BugCategory,
          details: args.details as string,
          severity: args.severity as BugSeverity,
          ...(typeof args.context === 'string' ? { context: args.context } : {}),
        };

        return {
          actions: [reportAction],
          response: {
            filed: true,
            bugId,
            summary: reportAction.summary,
            category: reportAction.category,
            severity: reportAction.severity,
          },
        };
      }

      case 'listen': {
        if (ctx?.isStale?.()) {
          return { actions: [], response: { error: 'Request cancelled.' } };
        }

        const question = (args.question as string) ?? 'How does it sound?';
        const rawBars = typeof args.bars === 'number' ? args.bars : 2;
        const bars = Math.max(1, Math.min(16, Math.round(rawBars)));
        const rawTrackIds = args.trackIds as string[] | undefined;
        const trackIds = rawTrackIds && rawTrackIds.length > 0 ? rawTrackIds : undefined;

        // Lens: focused evaluation aspect
        const validLenses = new Set<string>(['full-mix', 'low-end', 'rhythm', 'harmony', 'texture', 'dynamics']);
        const rawLens = args.lens as string | undefined;
        const lens: ListenLens | undefined = rawLens && validLenses.has(rawLens)
          ? rawLens as ListenLens
          : undefined;

        // Compare: before/after evaluation
        const rawCompare = args.compare as Record<string, unknown> | undefined;

        if (trackIds) {
          const sessionTrackIds = new Set(session.tracks.map(v => v.id));
          const invalid = trackIds.filter(vid => !sessionTrackIds.has(vid));
          if (invalid.length > 0) {
            return {
              actions: [],
              response: { error: `Unknown track IDs: ${invalid.join(', ')}. Available: ${[...sessionTrackIds].join(', ')}.` },
            };
          }
        }

        // Rubric: structured evaluation scores
        const rubric = args.rubric === true;

        if (rawCompare) {
          // Comparative listening: render before + after, concatenate, evaluate
          const compareQuestion = (rawCompare.question as string) || question;
          const result = await this.compareHandler(compareQuestion, session, ctx?.listen, bars, trackIds, lens);
          return { actions: [], response: result };
        }

        const result = await this.listenHandler(question, session, ctx?.listen, bars, trackIds, lens, rubric);
        return { actions: [], response: result };
      }

      // --- Audio analysis tools ---

      case 'render': {
        if (ctx?.isStale?.()) {
          return { actions: [], response: { error: 'Request cancelled.' } };
        }
        if (!ctx?.listen?.renderOfflinePcm) {
          return { actions: [], response: errorPayload('Render not available.') };
        }

        const rawBars = typeof args.bars === 'number' ? args.bars : 2;
        const renderBars = Math.max(1, Math.min(16, Math.round(rawBars)));

        // Parse scope: string, string[], or undefined (full mix)
        let renderTrackIds: string[] | undefined;
        if (typeof args.scope === 'string') {
          renderTrackIds = [args.scope];
        } else if (Array.isArray(args.scope)) {
          renderTrackIds = args.scope as string[];
        }

        // Validate track IDs
        if (renderTrackIds) {
          const sessionTrackIds = new Set(session.tracks.map(v => v.id));
          const invalid = renderTrackIds.filter(vid => !sessionTrackIds.has(vid));
          if (invalid.length > 0) {
            return {
              actions: [],
              response: errorPayload(`Unknown track IDs: ${invalid.join(', ')}. Available: ${[...sessionTrackIds].join(', ')}.`),
            };
          }
        }

        try {
          const { pcm, sampleRate } = await ctx.listen.renderOfflinePcm(session, renderTrackIds, renderBars);
          const snapshotId = nextSnapshotId();
          storeSnapshot({
            id: snapshotId,
            pcm,
            sampleRate,
            scope: renderTrackIds ?? [],
            bars: renderBars,
          });
          return {
            actions: [],
            response: {
              snapshotId,
              scope: renderTrackIds ?? 'full_mix',
              bars: renderBars,
            },
          };
        } catch (error) {
          return { actions: [], response: errorPayload('Render failed — try again.') };
        }
      }

      case 'analyze': {
        const snapshotId = args.snapshotId as string | undefined;
        const compareSnapshotId = args.compareSnapshotId as string | undefined;
        const snapshotIds = Array.isArray(args.snapshotIds) ? args.snapshotIds as string[] : undefined;
        const rawTypes = args.types as string[];
        if (!Array.isArray(rawTypes) || rawTypes.length === 0) {
          return { actions: [], response: errorPayload('Missing required parameter: types (non-empty array)') };
        }

        // Deduplicate to avoid wasted work
        const types = [...new Set(rawTypes)];
        const hasSingleTrackTypes = types.some(t => t === 'spectral' || t === 'dynamics' || t === 'rhythm' || t === 'reference');
        const hasMasking = types.includes('masking');
        const hasDiff = types.includes('diff');
        const hasReference = types.includes('reference');

        // Validate: single-track types need snapshotId
        if (hasSingleTrackTypes && !snapshotId) {
          return { actions: [], response: errorPayload('Missing required parameter: snapshotId (needed for spectral, dynamics, or rhythm analysis)') };
        }

        // Validate: masking needs snapshotIds
        if (hasMasking && (!snapshotIds || snapshotIds.length < 2)) {
          return { actions: [], response: errorPayload('Masking analysis requires snapshotIds with at least 2 snapshot IDs (one per track). Render each track separately first.') };
        }

        // Validate: diff needs both snapshotId and compareSnapshotId
        if (hasDiff && (!snapshotId || !compareSnapshotId)) {
          return { actions: [], response: errorPayload('Diff analysis requires both snapshotId (after) and compareSnapshotId (before). Render before and after, then pass both.') };
        }

        // Validate: reference needs snapshotId and referenceProfile
        const referenceProfileId = args.referenceProfile as string | undefined;
        if (hasReference && !snapshotId) {
          return { actions: [], response: errorPayload('Reference analysis requires snapshotId. Call render first.') };
        }
        if (hasReference && !referenceProfileId) {
          return { actions: [], response: errorPayload('Reference analysis requires referenceProfile (e.g. "techno_dark"). Available: techno_dark, techno_minimal, house_deep, ambient, dnb, hiphop.') };
        }
        if (hasReference && referenceProfileId && !getProfile(referenceProfileId)) {
          return { actions: [], response: errorPayload(`Unknown reference profile: ${referenceProfileId}. Available: techno_dark, techno_minimal, house_deep, ambient, dnb, hiphop.`) };
        }

        // Resolve the primary snapshot for single-track analysis
        let snapshot: ReturnType<typeof getSnapshot> | undefined;
        if (snapshotId) {
          snapshot = getSnapshot(snapshotId);
          if (!snapshot && (hasSingleTrackTypes || hasDiff)) {
            return { actions: [], response: errorPayload(`Snapshot not found: ${snapshotId}. Call render first.`) };
          }
        }

        const results: Record<string, unknown> = {};
        const analysisErrors: string[] = [];

        for (const t of types) {
          switch (t) {
            case 'spectral':
              if (snapshot) results.spectral = analyzeSpectral(snapshot.pcm, snapshot.sampleRate);
              break;
            case 'dynamics':
              if (snapshot) results.dynamics = analyzeDynamics(snapshot.pcm, snapshot.sampleRate);
              break;
            case 'rhythm': {
              if (snapshot) {
                const bpm = session.transport.bpm;
                results.rhythm = analyzeRhythm(snapshot.pcm, snapshot.sampleRate, bpm);
              }
              break;
            }
            case 'masking': {
              if (!snapshotIds) break;
              // Resolve all snapshots and build TrackAudio entries
              const trackAudios: TrackAudio[] = [];
              for (const sid of snapshotIds) {
                const snap = getSnapshot(sid);
                if (!snap) {
                  analysisErrors.push(`Snapshot not found: ${sid}`);
                  continue;
                }
                if (snap.scope.length !== 1) {
                  analysisErrors.push(`Snapshot ${sid} must have exactly one track in scope (got ${snap.scope.length}). Render each track separately.`);
                  continue;
                }
                trackAudios.push({
                  trackId: snap.scope[0],
                  pcm: snap.pcm,
                  sampleRate: snap.sampleRate,
                });
              }
              if (trackAudios.length >= 2) {
                results.masking = analyzeMasking(trackAudios);
              } else {
                analysisErrors.push('Masking analysis requires at least 2 valid single-track snapshots.');
              }
              break;
            }
            case 'diff': {
              if (snapshot && compareSnapshotId) {
                const compareSnapshot = getSnapshot(compareSnapshotId);
                if (!compareSnapshot) {
                  analysisErrors.push(`Compare snapshot not found: ${compareSnapshotId}. Call render first.`);
                } else {
                  const bpm = session.transport.bpm;
                  results.diff = analyzeDiff(
                    compareSnapshot.pcm,
                    snapshot.pcm,
                    snapshot.sampleRate,
                    bpm,
                  );
                }
              }
              break;
            }
            case 'reference': {
              if (snapshot && referenceProfileId) {
                const profile = getProfile(referenceProfileId);
                if (profile) {
                  const bandEnergies = computeBandEnergies(snapshot.pcm, snapshot.sampleRate);
                  const dyn = analyzeDynamics(snapshot.pcm, snapshot.sampleRate);
                  results.reference = compareToProfile(profile, bandEnergies, dyn);
                }
              }
              break;
            }
            default:
              analysisErrors.push(`Unknown analysis type: ${t}`);
          }
        }

        return {
          actions: [],
          response: {
            ...(snapshotId ? { snapshotId } : {}),
            ...(compareSnapshotId ? { compareSnapshotId } : {}),
            ...(snapshotIds ? { snapshotIds } : {}),
            ...(referenceProfileId ? { referenceProfile: referenceProfileId } : {}),
            results,
            ...(analysisErrors.length > 0 ? { errors: analysisErrors } : {}),
          },
        };
      }

      case 'manage_send': {
        const sendSubAction = args.action as string;
        if (!sendSubAction) return { actions: [], response: errorPayload('Missing required: action') };
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.busId !== 'string' || !args.busId) {
          return { actions: [], response: errorPayload('Missing required parameter: busId') };
        }

        const sendTrackId = resolveTrackId(args.trackId as string, session);
        if (!sendTrackId) {
          return { actions: [], response: errorPayload(`Unknown track: ${args.trackId}`) };
        }

        const sendBusId = resolveTrackId(args.busId as string, session) ?? (args.busId as string);

        if (sendSubAction === 'add' || sendSubAction === 'set_level') {
          if (typeof args.level !== 'number' || !Number.isFinite(args.level)) {
            return { actions: [], response: errorPayload(`action=${sendSubAction} requires level (0.0-1.0)`) };
          }
        }

        const manageSendAction: AIManageSendAction = {
          type: 'manage_send',
          action: sendSubAction as 'add' | 'remove' | 'set_level',
          trackId: sendTrackId,
          busId: sendBusId,
          ...(args.level !== undefined ? { level: args.level as number } : {}),
        };

        const sendRejection = handleRejection(ctx?.validateAction?.(manageSendAction), session, manageSendAction);
        if (sendRejection) return sendRejection;

        return {
          actions: [manageSendAction],
          response: { queued: true, action: sendSubAction, trackId: sendTrackId, busId: sendBusId },
        };
      }

      case 'set_master': {
        const hasMasterVolume = args.volume !== undefined;
        const hasMasterPan = args.pan !== undefined;
        if (!hasMasterVolume && !hasMasterPan) {
          return { actions: [], response: errorPayload('At least one of volume, pan required') };
        }
        const setMasterAction: AISetMasterAction = {
          type: 'set_master',
          ...(hasMasterVolume ? { volume: args.volume as number } : {}),
          ...(hasMasterPan ? { pan: args.pan as number } : {}),
        };
        return {
          actions: [setMasterAction],
          response: { queued: true, ...(hasMasterVolume ? { volume: args.volume } : {}), ...(hasMasterPan ? { pan: args.pan } : {}) },
        };
      }

      case 'manage_pattern': {
        const patternSubAction = args.action as string;
        if (!patternSubAction) return { actions: [], response: errorPayload('Missing required: action') };
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.description !== 'string') {
          return { actions: [], response: errorPayload('Missing required parameter: description') };
        }

        const patternTrackId = resolveTrackId(args.trackId as string, session);
        if (!patternTrackId) {
          return { actions: [], response: errorPayload(`Unknown track: ${args.trackId}`) };
        }

        const validPatternActions = ['add', 'remove', 'duplicate', 'rename', 'set_active', 'set_length', 'clear'];
        if (!validPatternActions.includes(patternSubAction)) {
          return { actions: [], response: errorPayload(`Invalid action: ${patternSubAction}`) };
        }

        // Validate required sub-params
        if ((patternSubAction === 'remove' || patternSubAction === 'duplicate' || patternSubAction === 'rename' || patternSubAction === 'set_active') && !args.patternId) {
          return { actions: [], response: errorPayload(`action=${patternSubAction} requires patternId`) };
        }
        if (patternSubAction === 'rename' && typeof args.name !== 'string') {
          return { actions: [], response: errorPayload('action=rename requires name') };
        }
        if (patternSubAction === 'set_length' && (typeof args.length !== 'number' || !Number.isFinite(args.length as number))) {
          return { actions: [], response: errorPayload('action=set_length requires length (1-64)') };
        }

        const managePatternAction: AIManagePatternAction = {
          type: 'manage_pattern',
          action: patternSubAction as AIManagePatternAction['action'],
          trackId: patternTrackId,
          ...(args.patternId ? { patternId: args.patternId as string } : {}),
          ...(args.name !== undefined ? { name: args.name as string } : {}),
          ...(args.length !== undefined ? { length: args.length as number } : {}),
          description: args.description as string,
        };

        const patternRejection = handleRejection(ctx?.validateAction?.(managePatternAction), session, managePatternAction);
        if (patternRejection) return patternRejection;

        return {
          actions: [managePatternAction],
          response: {
            queued: true,
            action: patternSubAction,
            trackId: patternTrackId,
            ...(patternSubAction === 'add' || patternSubAction === 'duplicate'
              ? { note: 'The new pattern will be available immediately. Continue with further edits this turn.' }
              : {}),
          },
        };
      }

      case 'manage_sequence': {
        const seqSubAction = args.action as string;
        if (!seqSubAction) return { actions: [], response: errorPayload('Missing required: action') };
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.description !== 'string') {
          return { actions: [], response: errorPayload('Missing required parameter: description') };
        }

        const seqTrackId = resolveTrackId(args.trackId as string, session);
        if (!seqTrackId) {
          return { actions: [], response: errorPayload(`Unknown track: ${args.trackId}`) };
        }

        const validSeqActions = ['append', 'remove', 'reorder'];
        if (!validSeqActions.includes(seqSubAction)) {
          return { actions: [], response: errorPayload(`Invalid action: ${seqSubAction}`) };
        }

        if (seqSubAction === 'append' && typeof args.patternId !== 'string') {
          return { actions: [], response: errorPayload('action=append requires patternId') };
        }
        if (seqSubAction === 'remove' && (typeof args.sequenceIndex !== 'number' || !Number.isFinite(args.sequenceIndex as number))) {
          return { actions: [], response: errorPayload('action=remove requires sequenceIndex') };
        }
        if (seqSubAction === 'reorder') {
          if (typeof args.sequenceIndex !== 'number' || !Number.isFinite(args.sequenceIndex as number)) {
            return { actions: [], response: errorPayload('action=reorder requires sequenceIndex (fromIndex)') };
          }
          if (typeof args.toIndex !== 'number' || !Number.isFinite(args.toIndex as number)) {
            return { actions: [], response: errorPayload('action=reorder requires toIndex') };
          }
        }

        const manageSequenceAction: AIManageSequenceAction = {
          type: 'manage_sequence',
          action: seqSubAction as AIManageSequenceAction['action'],
          trackId: seqTrackId,
          ...(args.patternId ? { patternId: args.patternId as string } : {}),
          ...(args.sequenceIndex !== undefined ? { sequenceIndex: args.sequenceIndex as number } : {}),
          ...(args.toIndex !== undefined ? { toIndex: args.toIndex as number } : {}),
          description: args.description as string,
        };

        const seqRejection = handleRejection(ctx?.validateAction?.(manageSequenceAction), session, manageSequenceAction);
        if (seqRejection) return seqRejection;

        return {
          actions: [manageSequenceAction],
          response: { queued: true, action: seqSubAction, trackId: seqTrackId },
        };
      }

      case 'set_intent': {
        // Merge provided fields into existing intent
        const intentUpdate: SessionIntent = {};
        if (Array.isArray(args.genre)) intentUpdate.genre = args.genre as string[];
        if (Array.isArray(args.references)) intentUpdate.references = args.references as string[];
        if (Array.isArray(args.mood)) intentUpdate.mood = args.mood as string[];
        if (Array.isArray(args.avoid)) intentUpdate.avoid = args.avoid as string[];
        if (typeof args.currentGoal === 'string') intentUpdate.currentGoal = args.currentGoal;

        if (Object.keys(intentUpdate).length === 0) {
          return { actions: [], response: errorPayload('At least one intent field required (genre, references, mood, avoid, currentGoal)') };
        }

        const setIntentAction: AISetIntentAction = {
          type: 'set_intent',
          intent: intentUpdate,
        };

        return {
          actions: [setIntentAction],
          response: {
            applied: true,
            intent: { ...session.intent, ...intentUpdate },
          },
        };
      }

      case 'set_section': {
        const sectionUpdate: SectionMeta = {};
        if (typeof args.name === 'string') sectionUpdate.name = args.name;
        if (typeof args.intent === 'string') sectionUpdate.intent = args.intent;
        if (typeof args.targetEnergy === 'number' && Number.isFinite(args.targetEnergy)) {
          sectionUpdate.targetEnergy = Math.max(0, Math.min(1, args.targetEnergy));
        }
        if (typeof args.targetDensity === 'number' && Number.isFinite(args.targetDensity)) {
          sectionUpdate.targetDensity = Math.max(0, Math.min(1, args.targetDensity));
        }

        if (Object.keys(sectionUpdate).length === 0) {
          return { actions: [], response: errorPayload('At least one section field required (name, intent, targetEnergy, targetDensity)') };
        }

        const setSectionAction: AISetSectionAction = {
          type: 'set_section',
          section: sectionUpdate,
        };

        return {
          actions: [setSectionAction],
          response: {
            applied: true,
            section: { ...session.section, ...sectionUpdate },
          },
        };
      }

      case 'set_scale': {
        // Clear scale constraint
        if (args.clear === true) {
          const clearAction: AISetScaleAction = { type: 'set_scale', scale: null };
          return {
            actions: [clearAction],
            response: { applied: true, scale: null, message: 'Scale constraint cleared — chromatic/atonal mode.' },
          };
        }

        // Set scale constraint
        const root = typeof args.root === 'number' ? Math.round(args.root) : undefined;
        const mode = typeof args.mode === 'string' ? args.mode as ScaleMode : undefined;

        if (root === undefined || mode === undefined) {
          return { actions: [], response: errorPayload('Both root (0-11) and mode are required, or set clear: true to remove the scale.') };
        }

        if (root < 0 || root > 11) {
          return { actions: [], response: errorPayload(`Invalid root: ${root}. Must be 0-11 (0=C, 1=C#, ... 11=B).`) };
        }

        if (!SCALE_MODES.includes(mode)) {
          return { actions: [], response: errorPayload(`Invalid mode: ${mode}. Supported: ${SCALE_MODES.join(', ')}.`) };
        }

        const scaleConstraint: ScaleConstraint = { root, mode };
        const setScaleAction: AISetScaleAction = { type: 'set_scale', scale: scaleConstraint };

        return {
          actions: [setScaleAction],
          response: {
            applied: true,
            scale: scaleConstraint,
            label: scaleToString(scaleConstraint),
            notes: scaleNoteNames(scaleConstraint),
          },
        };
      }

      case 'apply_chain_recipe': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.recipe !== 'string' || !args.recipe) {
          return { actions: [], response: errorPayload('Missing required parameter: recipe') };
        }

        const recipe = getChainRecipe(args.recipe as string);
        if (!recipe) {
          return { actions: [], response: errorPayload(`Unknown chain recipe: "${args.recipe}"`) };
        }

        const recipeTrack = session.tracks.find(v => v.id === args.trackId);
        if (!recipeTrack) {
          return { actions: [], response: errorPayload(`Track not found: "${args.trackId}"`) };
        }

        const recipeActions: AIAction[] = [];

        // Remove existing processors
        for (const proc of recipeTrack.processors ?? []) {
          const removeAction: AIRemoveProcessorAction = {
            type: 'remove_processor',
            trackId: args.trackId as string,
            processorId: proc.id,
            description: `Remove ${proc.type} for chain recipe "${recipe.name}"`,
          };
          recipeActions.push(removeAction);
        }

        // Add recipe processors
        const addedProcessorIds: string[] = [];
        const now = Date.now();
        for (let i = 0; i < recipe.processors.length; i++) {
          const rp = recipe.processors[i];
          const procId = `${rp.type}-${now + i}`;
          addedProcessorIds.push(procId);

          const addAction: AIAddProcessorAction = {
            type: 'add_processor',
            trackId: args.trackId as string,
            moduleType: rp.type,
            processorId: procId,
            description: `Add ${rp.type} for chain recipe "${recipe.name}"`,
          };
          recipeActions.push(addAction);

          // Set model if not default (0)
          if (rp.model !== 0) {
            const setModelAction: AISetModelAction = {
              type: 'set_model',
              trackId: args.trackId as string,
              processorId: procId,
              model: getProcessorEngineName(rp.type, rp.model) ?? '',
            };
            recipeActions.push(setModelAction);
          }

          // Set params
          for (const [param, value] of Object.entries(rp.params)) {
            const moveAction: AIMoveAction = {
              type: 'move',
              trackId: args.trackId as string,
              processorId: procId,
              param,
              target: { absolute: value },
            };
            recipeActions.push(moveAction);
          }
        }

        return {
          actions: recipeActions,
          response: {
            applied: true,
            trackId: args.trackId,
            recipe: recipe.name,
            processorsAdded: addedProcessorIds,
            description: recipe.description,
          },
        };
      }

      case 'set_mix_role': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.role !== 'string' || !args.role) {
          return { actions: [], response: errorPayload('Missing required parameter: role') };
        }

        const mixRole = getMixRole(args.role as string);
        if (!mixRole) {
          return { actions: [], response: errorPayload(`Unknown mix role: "${args.role}"`) };
        }

        const roleTrack = session.tracks.find(v => v.id === args.trackId);
        if (!roleTrack) {
          return { actions: [], response: errorPayload(`Track not found: "${args.trackId}"`) };
        }

        // Convert pan from 0-1 (role format) to -1..1 (track format)
        const panValue = (mixRole.defaults.pan - 0.5) * 2;

        const trackMixAction: AISetTrackMixAction = {
          type: 'set_track_mix',
          trackId: args.trackId as string,
          volume: mixRole.defaults.volume,
          pan: panValue,
        };

        return {
          actions: [trackMixAction],
          response: {
            applied: true,
            trackId: args.trackId,
            role: mixRole.name,
            volume: mixRole.defaults.volume,
            pan: panValue,
            description: mixRole.description,
          },
        };
      }

      case 'apply_modulation': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.recipe !== 'string' || !args.recipe) {
          return { actions: [], response: errorPayload('Missing required parameter: recipe') };
        }

        const modRecipe = getModulationRecipe(args.recipe as string);
        if (!modRecipe) {
          return { actions: [], response: errorPayload(`Unknown modulation recipe: "${args.recipe}"`) };
        }

        const modTrack = session.tracks.find(v => v.id === args.trackId);
        if (!modTrack) {
          return { actions: [], response: errorPayload(`Track not found: "${args.trackId}"`) };
        }

        // For processor-targeted recipes, find the target processor
        let targetProcessorId: string | undefined;
        if (modRecipe.routeTargetType === 'processor') {
          if (typeof args.processorId === 'string' && args.processorId) {
            // Use explicitly provided processor ID
            targetProcessorId = args.processorId as string;
            const exists = (modTrack.processors ?? []).some(p => p.id === targetProcessorId);
            if (!exists) {
              return { actions: [], response: errorPayload(`Processor "${targetProcessorId}" not found on track`) };
            }
          } else {
            // Auto-find first matching processor type
            const matchingProc = (modTrack.processors ?? []).find(
              p => p.type === modRecipe.routeTargetProcessorType,
            );
            if (!matchingProc) {
              return {
                actions: [],
                response: errorPayload(
                  `Recipe "${modRecipe.name}" targets a ${modRecipe.routeTargetProcessorType} processor, but none found on this track. Add one first.`,
                ),
              };
            }
            targetProcessorId = matchingProc.id;
          }
        }

        // Validate modulator addition
        const modValidation = validateModulatorMutation(modTrack, { kind: 'add', type: modRecipe.modulatorType });
        if (!modValidation.valid) {
          return { actions: [], response: errorPayload(modValidation.errors[0]) };
        }

        const modActions: AIAction[] = [];
        const modNow = Date.now();
        const modulatorId = `${modRecipe.modulatorType}-${modNow}`;
        const modulationId = `mod-${modNow}`;

        // Add the modulator
        const addModAction: AIAddModulatorAction = {
          type: 'add_modulator',
          trackId: args.trackId as string,
          moduleType: modRecipe.modulatorType,
          modulatorId,
          description: `Add modulator for recipe "${modRecipe.name}"`,
        };
        modActions.push(addModAction);

        // Set model if not default (1 = Looping)
        if (modRecipe.modulatorModel !== 1) {
          const modModelName = getModulatorEngineName(modRecipe.modulatorType, modRecipe.modulatorModel);
          if (modModelName) {
            modActions.push({
              type: 'set_model',
              trackId: args.trackId as string,
              modulatorId,
              model: modModelName,
            } as AISetModelAction);
          }
        }

        // Set modulator params
        for (const [param, value] of Object.entries(modRecipe.modulatorParams)) {
          modActions.push({
            type: 'move',
            trackId: args.trackId as string,
            modulatorId,
            param,
            target: { absolute: value },
          } as AIMoveAction);
        }

        // Connect modulation route
        const modTarget: ModulationTarget = modRecipe.routeTargetType === 'source'
          ? { kind: 'source', param: modRecipe.routeTarget }
          : { kind: 'processor', processorId: targetProcessorId!, param: modRecipe.routeTarget };

        const connectAction: AIConnectModulatorAction = {
          type: 'connect_modulator',
          trackId: args.trackId as string,
          modulatorId,
          target: modTarget,
          depth: modRecipe.routeDepth,
          modulationId,
          description: `Connect modulation for recipe "${modRecipe.name}"`,
        };
        modActions.push(connectAction);

        return {
          actions: modActions,
          response: {
            applied: true,
            trackId: args.trackId,
            recipe: modRecipe.name,
            modulatorId,
            modulationId,
            target: modRecipe.routeTargetType === 'source'
              ? `source:${modRecipe.routeTarget}`
              : `processor:${targetProcessorId}:${modRecipe.routeTarget}`,
            depth: modRecipe.routeDepth,
            description: modRecipe.description,
          },
        };
      }

      case 'shape_timbre': {
        const trackId = (args.trackId as string) ?? session.activeTrackId;
        const direction = args.direction as TimbralDirection;
        const amount = typeof args.amount === 'number' ? Math.max(0, Math.min(1, args.amount)) : 0.3;

        if (!direction) {
          return { actions: [], response: errorPayload('Missing required parameter: direction') };
        }

        const track = session.tracks.find(t => t.id === trackId);
        if (!track) {
          return { actions: [], response: errorPayload(`Unknown track: ${trackId}`) };
        }

        // Resolve the Plaits engine ID from the track's model index
        const engineDef = plaitsInstrument.engines[track.model];
        if (!engineDef) {
          return { actions: [], response: errorPayload(`Track has no recognized synth engine.`) };
        }
        const engineId = engineDef.id;

        // Build move actions for the source synth
        const sourceDeltas = resolveTimbralMove(engineId, direction, amount);
        const actions: AIAction[] = [];
        const appliedParams: string[] = [];

        for (const { param, delta } of sourceDeltas) {
          const runtimeKey = controlIdToRuntimeParam[param] ?? param;
          const currentVal = track.params[runtimeKey] ?? 0.5;
          const newVal = Math.max(0, Math.min(1, currentVal + delta));
          actions.push({
            type: 'move',
            trackId,
            param,
            target: { absolute: newVal },
          } as AIMoveAction);
          appliedParams.push(`${param}: ${currentVal.toFixed(2)} -> ${newVal.toFixed(2)}`);
        }

        // Also apply to any processors in the chain
        const processorResults: string[] = [];
        for (const proc of track.processors ?? []) {
          const procVector = getProcessorTimbralVector(proc.type, direction);
          if (!procVector) continue;
          for (const [param, baseDelta] of Object.entries(procVector.params)) {
            const delta = baseDelta * amount;
            const currentVal = proc.params[param] ?? 0.5;
            const newVal = Math.max(0, Math.min(1, currentVal + delta));
            actions.push({
              type: 'move',
              trackId,
              processorId: proc.id,
              param,
              target: { absolute: newVal },
            } as AIMoveAction);
            processorResults.push(`${proc.type}.${param}: ${currentVal.toFixed(2)} -> ${newVal.toFixed(2)}`);
          }
        }

        if (actions.length === 0) {
          return {
            actions: [],
            response: {
              applied: false,
              reason: `No timbral mapping for direction "${direction}" on engine "${engineId}".`,
            },
          };
        }

        return {
          actions,
          response: {
            applied: true,
            engine: engineId,
            direction,
            amount,
            sourceParams: appliedParams,
            ...(processorResults.length > 0 ? { processorParams: processorResults } : {}),
          },
        };
      }

      case 'assign_spectral_slot': {
        const trackId = resolveTrackId(args.trackId as string, session);
        if (!trackId) {
          return { actions: [], response: errorPayload(`Unknown track: ${args.trackId}`) };
        }
        const track = session.tracks.find(t => t.id === trackId);
        if (!track) {
          return { actions: [], response: errorPayload(`Unknown track: ${trackId}`) };
        }

        const rawBands = args.bands as string[] | undefined;
        if (!rawBands || !Array.isArray(rawBands) || rawBands.length === 0) {
          return { actions: [], response: errorPayload('Missing required parameter: bands (non-empty array)') };
        }

        const validBands = rawBands.filter(b => (FREQUENCY_BANDS as readonly string[]).includes(b)) as FrequencyBand[];
        if (validBands.length === 0) {
          return { actions: [], response: errorPayload(`No valid frequency bands. Available: ${FREQUENCY_BANDS.join(', ')}`) };
        }

        const priority = typeof args.priority === 'number' ? Math.max(0, Math.min(10, Math.round(args.priority))) : 5;

        const slot = this.spectralSlots.assign(trackId, validBands, priority);
        const collisions = this.spectralSlots.detectCollisions();
        const adjustments = this.spectralSlots.computeAdjustments();

        const action: AIAssignSpectralSlotAction = {
          type: 'assign_spectral_slot',
          trackId,
          bands: validBands,
          priority,
        };

        return {
          actions: [action],
          response: {
            assigned: true,
            trackId,
            slot,
            collisions: collisions.length > 0 ? collisions : undefined,
            suggestedAdjustments: adjustments.length > 0 ? adjustments : undefined,
            allSlots: this.spectralSlots.getAll(),
          },
        };
      }

      case 'manage_motif': {
        const motifAction = args.action as string;
        if (!motifAction) {
          return { actions: [], response: errorPayload('Missing required parameter: action') };
        }

        switch (motifAction) {
          case 'register': {
            const name = args.name as string;
            if (!name) {
              return { actions: [], response: errorPayload('Missing required parameter: name') };
            }
            const trackId = resolveTrackId((args.trackId as string) ?? session.activeTrackId, session);
            if (!trackId) {
              return { actions: [], response: errorPayload(`Unknown track: ${args.trackId}`) };
            }
            const track = getTrack(session, trackId);
            const pattern = getActivePattern(track);
            const stepRange = args.stepRange as [number, number] | undefined;

            let events = [...pattern.events];
            if (stepRange && stepRange.length === 2) {
              const [start, end] = stepRange;
              events = events.filter(e => e.at >= start && e.at <= end);
            }

            if (events.length === 0) {
              return { actions: [], response: errorPayload('No events found in the specified range.') };
            }

            // Auto-detect rootPitch from lowest note if not provided
            let rootPitch = typeof args.rootPitch === 'number' ? args.rootPitch : undefined;
            if (rootPitch === undefined) {
              for (const e of events) {
                if (e.kind === 'note') {
                  if (rootPitch === undefined || e.pitch < rootPitch) rootPitch = e.pitch;
                }
              }
            }

            // Calculate duration from events
            let duration = pattern.duration;
            if (stepRange && stepRange.length === 2) {
              duration = stepRange[1] - stepRange[0];
              // Shift events to be relative to the start of the range
              const offset = stepRange[0];
              events = events.map(e => ({ ...e, at: e.at - offset }));
            }

            const motifId = `motif-${Date.now()}`;
            const motif: Motif = {
              id: motifId,
              name,
              events,
              rootPitch,
              duration,
              tags: args.tags as string[] | undefined,
            };

            this.motifLibrary.register(motif);

            const registerAction: AIManageMotifAction = {
              type: 'manage_motif',
              action: 'register',
              motifId,
              motifName: name,
              trackId,
              stepRange,
              description: args.description as string ?? `Register motif "${name}" from ${trackId}`,
            };

            return {
              actions: [registerAction],
              response: {
                applied: true,
                motifId,
                name,
                eventCount: events.length,
                duration,
                rootPitch,
                tags: motif.tags,
              },
            };
          }

          case 'recall': {
            const motifId = args.motifId as string;
            if (!motifId) {
              return { actions: [], response: errorPayload('Missing required parameter: motifId') };
            }
            let motif = this.motifLibrary.recall(motifId);
            if (!motif) {
              motif = this.motifLibrary.findByName(motifId);
            }
            if (!motif) {
              return { actions: [], response: errorPayload(`Motif not found: ${motifId}`) };
            }

            return {
              actions: [],
              response: {
                motifId: motif.id,
                name: motif.name,
                events: motif.events,
                duration: motif.duration,
                rootPitch: motif.rootPitch,
                tags: motif.tags,
                eventCount: motif.events.length,
              },
            };
          }

          case 'develop': {
            const motifId = args.motifId as string;
            if (!motifId) {
              return { actions: [], response: errorPayload('Missing required parameter: motifId') };
            }
            let motif = this.motifLibrary.recall(motifId);
            if (!motif) {
              motif = this.motifLibrary.findByName(motifId);
            }
            if (!motif) {
              return { actions: [], response: errorPayload(`Motif not found: ${motifId}`) };
            }
            const ops = args.operations as DevelopmentOp[];
            if (!ops || !Array.isArray(ops) || ops.length === 0) {
              return { actions: [], response: errorPayload('Missing required parameter: operations (array of development ops)') };
            }

            const developed = applyDevelopmentOps(motif, ops);

            // If targetTrackId is provided, write the developed motif as a sketch
            const targetTrackIdRaw = args.trackId as string;
            const actions: AIAction[] = [];
            if (targetTrackIdRaw) {
              const targetTrackId = resolveTrackId(targetTrackIdRaw, session);
              if (!targetTrackId) {
                return { actions: [], response: errorPayload(`Unknown target track: ${targetTrackIdRaw}`) };
              }

              const sketchAction: AISketchAction = {
                type: 'sketch',
                trackId: targetTrackId,
                description: args.description as string ?? `Developed motif "${motif.name}"`,
                events: developed.events,
              };
              actions.push(sketchAction);

              const motifAction: AIManageMotifAction = {
                type: 'manage_motif',
                action: 'develop',
                motifId: motif.id,
                targetTrackId,
                operations: ops,
                description: args.description as string ?? `Develop motif "${motif.name}"`,
              };
              actions.push(motifAction);
            }

            return {
              actions,
              response: {
                applied: true,
                sourceMotifId: motif.id,
                sourceName: motif.name,
                developedEvents: developed.events,
                developedDuration: developed.duration,
                eventCount: developed.events.length,
                operationsApplied: ops.map(o => o.op),
                ...(targetTrackIdRaw ? { writtenToTrack: resolveTrackId(targetTrackIdRaw, session) } : {}),
              },
            };
          }

          case 'list': {
            const motifs = this.motifLibrary.list();
            return {
              actions: [],
              response: {
                motifs: motifs.map(m => ({
                  id: m.id,
                  name: m.name,
                  eventCount: m.events.length,
                  duration: m.duration,
                  rootPitch: m.rootPitch,
                  tags: m.tags,
                })),
                count: motifs.length,
              },
            };
          }

          default:
            return { actions: [], response: errorPayload(`Unknown manage_motif action: ${motifAction}. Use register, recall, develop, or list.`) };
        }
      }

      case 'set_tension': {
        const rawPoints = Array.isArray(args.points) ? args.points : [];
        if (rawPoints.length === 0) {
          return { actions: [], response: errorPayload('At least one tension point is required.') };
        }

        const points: TensionPoint[] = [];
        for (const p of rawPoints) {
          const pt = p as Record<string, unknown>;
          const bar = typeof pt.bar === 'number' ? pt.bar : undefined;
          const energy = typeof pt.energy === 'number' ? pt.energy : undefined;
          const density = typeof pt.density === 'number' ? pt.density : undefined;
          if (bar === undefined || energy === undefined || density === undefined) {
            return { actions: [], response: errorPayload('Each point requires bar, energy, and density (all numbers).') };
          }
          if (bar < 1) {
            return { actions: [], response: errorPayload(`Invalid bar: ${bar}. Bars are 1-based.`) };
          }
          points.push({
            bar,
            energy: Math.max(0, Math.min(1, energy)),
            density: Math.max(0, Math.min(1, density)),
          });
        }

        let trackMappings: TrackTensionMapping[] | undefined;
        if (Array.isArray(args.trackMappings)) {
          trackMappings = [];
          for (const m of args.trackMappings) {
            const mm = m as Record<string, unknown>;
            const rawTrackId = mm.trackId as string;
            if (!rawTrackId) {
              return { actions: [], response: errorPayload('Each track mapping requires a trackId.') };
            }
            const resolvedId = resolveTrackId(rawTrackId, session);
            if (!resolvedId) {
              return { actions: [], response: errorPayload(`Unknown track: "${rawTrackId}"`) };
            }
            const rawParams = Array.isArray(mm.params) ? mm.params : [];
            const params: { param: string; low: number; high: number }[] = [];
            for (const pm of rawParams) {
              const pp = pm as Record<string, unknown>;
              if (typeof pp.param !== 'string' || typeof pp.low !== 'number' || typeof pp.high !== 'number') {
                return { actions: [], response: errorPayload('Each param mapping requires param (string), low (number), high (number).') };
              }
              params.push({ param: pp.param, low: pp.low, high: pp.high });
            }
            trackMappings.push({
              trackId: resolvedId,
              ...(typeof mm.activationThreshold === 'number' ? { activationThreshold: Math.max(0, Math.min(1, mm.activationThreshold)) } : {}),
              params,
            });
          }
        }

        const setTensionAction: AISetTensionAction = {
          type: 'set_tension',
          points,
          ...(trackMappings ? { trackMappings } : {}),
        };

        // Build the resulting curve for the response
        let resultCurve = session.tensionCurve ?? createTensionCurve();
        resultCurve = setTensionPoints(resultCurve, points);
        if (trackMappings) {
          for (const m of trackMappings) {
            resultCurve = setTrackTensionMapping(resultCurve, m);
          }
        }

        return {
          actions: [setTensionAction],
          response: {
            applied: true,
            pointCount: resultCurve.points.length,
            trackMappingCount: resultCurve.trackMappings.length,
            curve: resultCurve,
          },
        };
      }

      default:
        return { actions: [], response: { error: `Unknown tool: ${name}` } };
    }
  }

  private async listenHandler(
    question: string,
    session: Session,
    listen?: ListenContext,
    bars: number = 2,
    trackIds?: string[],
    lens?: ListenLens,
    rubric: boolean = false,
  ): Promise<Record<string, unknown>> {
    if (!listen) {
      return { error: 'Listen not available.' };
    }

    try {
      listen.onListening?.(true);

      const wavBlob = await listen.renderOffline(session, trackIds, bars);
      const state = compressState(session);

      // Build prompt — append rubric criteria when requested
      const basePrompt = buildListenPromptWithLens(question, lens);
      const systemPrompt = rubric ? basePrompt + RUBRIC_CRITERIA : basePrompt;

      const critique = await this.evaluateWithListeners({
        systemPrompt,
        stateJson: JSON.stringify(state),
        question,
        audioData: wavBlob,
        mimeType: 'audio/wav',
      });

      // When rubric mode is active, try to parse structured scores from the response
      if (rubric) {
        const parsed = parseRubricResponse(critique);
        if (parsed) {
          return { rubric: parsed, ...(lens ? { lens } : {}) };
        }
        // Fallback: return the raw critique if parsing fails
        return { critique, rubricRequested: true, rubricParseFailed: true, ...(lens ? { lens } : {}) };
      }

      return { critique, ...(lens ? { lens } : {}) };
    } catch (error) {
      if (error instanceof ProviderError) {
        const actions = this.handleError(error);
        const sayAction = actions.find(a => a.type === 'say');
        return { error: sayAction && 'text' in sayAction ? sayAction.text : 'Audio evaluation failed.' };
      }
      return { error: 'Audio evaluation failed — try again.' };
    } finally {
      listen.onListening?.(false);
    }
  }

  /**
   * Comparative listening handler.
   * Currently renders the current state only and sends with a compare prompt.
   * TODO: When undo-snapshot-based before-state rendering is available, render
   * both before and after audio, concatenate with silence, and send as one clip.
   */
  private async compareHandler(
    question: string,
    session: Session,
    listen?: ListenContext,
    bars: number = 2,
    trackIds?: string[],
    lens?: ListenLens,
  ): Promise<Record<string, unknown>> {
    if (!listen) {
      return { error: 'Listen not available.' };
    }

    // TODO: Render before-state from undo snapshot and concatenate with after-state.
    // For now, render the current (after) state and use the compare prompt to
    // indicate that comparative evaluation is intended. The before-state rendering
    // requires access to undo snapshots which is not yet wired through ListenContext.
    try {
      listen.onListening?.(true);

      const wavBlob = await listen.renderOffline(session, trackIds, bars);
      const state = compressState(session);

      const critique = await this.evaluateWithListeners({
        systemPrompt: buildComparePrompt(question, lens),
        stateJson: JSON.stringify(state),
        question,
        audioData: wavBlob,
        mimeType: 'audio/wav',
      });
      return {
        critique,
        mode: 'compare',
        note: 'Before-state audio rendering not yet available. Evaluation based on current state with comparative prompt.',
        ...(lens ? { lens } : {}),
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        const actions = this.handleError(error);
        const sayAction = actions.find(a => a.type === 'say');
        return { error: sayAction && 'text' in sayAction ? sayAction.text : 'Audio evaluation failed.' };
      }
      return { error: 'Audio evaluation failed — try again.' };
    } finally {
      listen.onListening?.(false);
    }
  }

  private handleError(error: unknown): AIAction[] {
    if (error instanceof ProviderError) {
      switch (error.kind) {
        case 'rate_limited':
          return [{ type: 'say', text: `Rate limited — backing off for ${Math.round(error.retryAfterMs / 1000)}s.` }];
        case 'auth':
          return [{ type: 'say', text: 'API key invalid or missing permissions.' }];
        case 'server':
          return [{ type: 'say', text: 'API error — please try again.' }];
        default:
          break;
      }
    }
    console.error('Gluon AI call failed:', error);
    return [];
  }

  /**
   * Run evaluate across all configured listeners.
   * When multiple listeners are active, runs in parallel and combines results.
   */
  private async evaluateWithListeners(opts: {
    systemPrompt: string;
    stateJson: string;
    question: string;
    audioData: Blob;
    mimeType: string;
  }): Promise<string> {
    const configured = this.listeners.filter(l => l.isConfigured());
    if (configured.length === 0) {
      throw new ProviderError('No listener provider configured.', 'auth');
    }

    if (configured.length === 1) {
      return configured[0].evaluate(opts);
    }

    // Multiple listeners — run in parallel, combine results.
    const results = await Promise.allSettled(
      configured.map(l => l.evaluate(opts)),
    );

    const parts: string[] = [];
    for (let i = 0; i < configured.length; i++) {
      const result = results[i];
      const label = configured[i].name.charAt(0).toUpperCase() + configured[i].name.slice(1);
      if (result.status === 'fulfilled') {
        parts.push(`**${label} evaluation:**\n${result.value}`);
      } else {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        parts.push(`**${label} evaluation:**\n[Error: ${reason}]`);
      }
    }
    return parts.join('\n\n');
  }

  clearHistory(): void {
    this.planner.clearHistory();
  }

  /**
   * Restore conversational context from persisted chat messages.
   * Called on project load so the AI retains awareness of prior exchanges.
   */
  restoreHistory(messages: ChatMessage[]): void {
    if (this.planner.restoreHistory) {
      this.planner.restoreHistory(messages);
    }
  }

  // ---------------------------------------------------------------------------
  // Token-budget-aware trimming (Phase 1a, #785)
  // ---------------------------------------------------------------------------

  /**
   * Trim conversation history to fit within the provider's token budget.
   *
   * For providers that support countContextTokens (e.g. Gemini), we measure
   * actual token usage and only trim when approaching the budget ceiling.
   * This typically allows ~40-50 exchanges instead of the fixed 12 cap.
   *
   * For providers without token counting (e.g. OpenAI), we fall back to
   * the fixed exchange-count cap for backward compatibility.
   */
  private async trimToTokenBudget(session: Session, _ctx?: AskContext): Promise<void> {
    const planner = this.planner;

    // If provider doesn't support token counting, use the fallback exchange cap
    if (!planner.countContextTokens || !planner.getTokenBudget) {
      planner.trimHistory(GluonAI.FALLBACK_MAX_EXCHANGES);
      return;
    }

    const budget = planner.getTokenBudget();
    const systemPrompt = buildSystemPrompt(session);

    try {
      let tokenCount = await planner.countContextTokens(systemPrompt, GLUON_TOOLS);
      const exchangeCount = planner.getExchangeCount?.() ?? 0;
      console.debug(
        `[gluon-ai] context: ${tokenCount} tokens / ${budget} budget (${Math.round((tokenCount / budget) * 100)}%), ${exchangeCount} exchanges`,
      );

      if (tokenCount <= budget) {
        // Under budget — no trimming needed
        return;
      }

      // Over budget — estimate tokens per exchange and drop enough to fit.
      // We estimate, trim, then verify with one more countTokens call.
      // If still over, trim one more exchange at a time (rare).
      if (exchangeCount === 0) return; // Nothing to trim

      const tokensPerExchange = tokenCount / exchangeCount;
      const overBy = tokenCount - budget;
      const estimatedDrop = Math.max(1, Math.ceil(overBy / tokensPerExchange));
      const keepCount = Math.max(1, exchangeCount - estimatedDrop);

      planner.trimHistory(keepCount);
      tokenCount = await planner.countContextTokens(systemPrompt, GLUON_TOOLS);
      console.debug(
        `[gluon-ai] trimmed to ${keepCount} exchanges, now ${tokenCount} tokens`,
      );

      // Fine-tune: if still over, drop one more at a time (max 5 rounds)
      let currentKeep = keepCount;
      for (let round = 0; round < 5 && tokenCount > budget && currentKeep > 1; round++) {
        currentKeep--;
        planner.trimHistory(currentKeep);
        tokenCount = await planner.countContextTokens(systemPrompt, GLUON_TOOLS);
        console.debug(
          `[gluon-ai] fine-trim to ${currentKeep} exchanges, now ${tokenCount} tokens`,
        );
      }
    } catch (error) {
      // If countTokens fails (e.g. network issue), fall back to exchange cap
      console.warn('[gluon-ai] countTokens failed, falling back to exchange cap:', error);
      planner.trimHistory(GluonAI.FALLBACK_MAX_EXCHANGES);
    }
  }
}
