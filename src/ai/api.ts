// src/ai/api.ts — Provider-agnostic orchestrator.

import type { Session, AIAction, AIMoveAction, AISketchAction, AITransportAction, AISetModelAction, AITransformAction, AIAddViewAction, AIRemoveViewAction, AIAddProcessorAction, AIRemoveProcessorAction, AIReplaceProcessorAction, AIAddModulatorAction, AIRemoveModulatorAction, AIConnectModulatorAction, AIDisconnectModulatorAction, AISetSurfaceAction, AIPinAction, AIUnpinAction, AILabelAxesAction, AISetImportanceAction, ProcessorConfig, ModulatorConfig, ModulationTarget, SemanticControlDef, SemanticControlWeight, TrackSurface } from '../engine/types';
import { getTrack, updateTrack } from '../engine/types';
import { controlIdToRuntimeParam, plaitsInstrument, getProcessorEngineByName, getModulatorEngineByName } from '../audio/instrument-registry';
import { validateChainMutation, validateModulatorMutation } from '../engine/chain-validation';
import { normalizeRegionEvents } from '../engine/region-helpers';
import { projectRegionToPattern } from '../engine/region-projection';
import { rotate, transpose, reverse, duplicate } from '../engine/transformations';
import { compressState } from './state-compression';
import { buildSystemPrompt } from './system-prompt';
import { buildListenPrompt } from './listen-prompt';
import { GLUON_TOOLS } from './tool-schemas';
import type { PlannerProvider, ListenerProvider, NeutralFunctionCall, FunctionResponse } from './types';
import { ProviderError } from './types';

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
      if (action.bpm !== undefined) t.bpm = Math.max(60, Math.min(200, action.bpm));
      if (action.swing !== undefined) t.swing = Math.max(0, Math.min(1, action.swing));
      if (action.playing !== undefined) {
        t.playing = action.playing;
        t.status = action.playing ? 'playing' : 'stopped';
      }
      return { ...session, transport: t };
    }
    case 'sketch': {
      const track = getTrack(session, action.trackId);
      if (!action.events || track.regions.length === 0) return session;
      const updatedRegion = normalizeRegionEvents({
        ...track.regions[0],
        events: action.events,
      });
      const inverseOpts = {
        midiToPitch: (midi: number) => midi / 127,
        canonicalToRuntime: (id: string) => controlIdToRuntimeParam[id] ?? id,
      };
      const pattern = projectRegionToPattern(updatedRegion, updatedRegion.duration, inverseOpts);
      const newRegions = [updatedRegion, ...track.regions.slice(1)];
      return updateTrack(session, action.trackId, { regions: newRegions, pattern });
    }
    case 'transform': {
      const track = getTrack(session, action.trackId);
      if (track.regions.length === 0) return session;
      const region = track.regions[0];
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
      const updatedRegion = normalizeRegionEvents({ ...region, events: newEvents, duration: newDuration });
      const inverseOpts = {
        midiToPitch: (midi: number) => midi / 127,
        canonicalToRuntime: (id: string) => controlIdToRuntimeParam[id] ?? id,
      };
      const pattern = projectRegionToPattern(updatedRegion, updatedRegion.duration, inverseOpts);
      const newRegions = [updatedRegion, ...track.regions.slice(1)];
      return updateTrack(session, action.trackId, { regions: newRegions, pattern });
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
    case 'say':
    default:
      return session;
  }
}

/** Build an error function response payload */
function errorPayload(message: string): Record<string, unknown> {
  return { error: message };
}

/** Context for the listen tool — audio capture and eval plumbing */
export interface ListenContext {
  /** Render audio offline — no transport or AudioContext needed. */
  renderOffline: (session: Session, trackIds?: string[], bars?: number) => Promise<Blob>;
  onListening?: (active: boolean) => void;
}

/**
 * Pre-validate an action against current session state.
 * Returns null if the action will be accepted, or a rejection reason string.
 */
export type ActionValidator = (action: AIAction) => string | null;

/** Context passed to ask() for listen support and cancellation */
export interface AskContext {
  listen?: ListenContext;
  isStale?: () => boolean;
  validateAction?: ActionValidator;
}

export class GluonAI {
  private static MAX_EXCHANGES = 12;
  private static MAX_PLANNER_INVOCATIONS = 5;

  constructor(
    private planner: PlannerProvider,
    private listener: ListenerProvider,
  ) {}

  isConfigured(): boolean {
    return this.planner.isConfigured() && this.listener.isConfigured();
  }

  async ask(session: Session, humanMessage: string, ctx?: AskContext): Promise<AIAction[]> {
    this.planner.trimHistory(GluonAI.MAX_EXCHANGES);

    const systemPrompt = buildSystemPrompt(session);
    const state = compressState(session);
    const userMessage = `Project state:\n${JSON.stringify(state)}\n\nHuman says: ${humanMessage}`;
    const collectedActions: AIAction[] = [];
    let projectedSession = session;
    let hadError = false;
    let hadModelContent = false;

    try {
      if (ctx?.isStale?.()) {
        this.planner.discardTurn();
        return [];
      }

      let invocationCount = 1;
      let result = await this.planner.startTurn({
        systemPrompt,
        userMessage,
        tools: GLUON_TOOLS,
      });

      while (invocationCount <= GluonAI.MAX_PLANNER_INVOCATIONS) {
        if (result.textParts.length > 0 || result.functionCalls.length > 0) {
          hadModelContent = true;
        }

        for (const text of result.textParts) {
          collectedActions.push({ type: 'say', text });
        }

        if (result.functionCalls.length === 0) break;

        const responses: FunctionResponse[] = [];
        for (const fc of result.functionCalls) {
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
        if (rejection) return { actions: [], response: errorPayload(rejection) };

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

        return {
          actions: [action],
          response: {
            applied: true,
            param: action.param,
            trackId,
            ...(action.processorId ? { processorId: action.processorId } : {}),
            ...(action.modulatorId ? { modulatorId: action.modulatorId } : {}),
            value: Math.round(resultValue * 100) / 100,
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
        if (!Array.isArray(args.events)) {
          return { actions: [], response: errorPayload('Missing required parameter: events (must be an array)') };
        }

        const action: AISketchAction = {
          type: 'sketch',
          trackId: args.trackId as string,
          description: args.description as string,
          events: args.events as AISketchAction['events'],
        };

        const rejection = ctx?.validateAction?.(action);
        if (rejection) return { actions: [], response: errorPayload(rejection) };

        return {
          actions: [action],
          response: {
            applied: true,
            trackId: action.trackId,
            description: action.description,
            eventCount: action.events?.length ?? 0,
          },
        };
      }

      case 'set_transport': {
        const hasBpm = typeof args.bpm === 'number';
        const hasSwing = typeof args.swing === 'number';
        const hasPlaying = typeof args.playing === 'boolean';
        if (!hasBpm && !hasSwing && !hasPlaying) {
          return { actions: [], response: errorPayload('At least one of bpm, swing, or playing must be provided') };
        }

        const action: AITransportAction = {
          type: 'set_transport',
          ...(hasBpm ? { bpm: args.bpm as number } : {}),
          ...(hasSwing ? { swing: args.swing as number } : {}),
          ...(hasPlaying ? { playing: args.playing as boolean } : {}),
        };

        const rejection = ctx?.validateAction?.(action);
        if (rejection) return { actions: [], response: errorPayload(rejection) };

        const resultBpm = action.bpm !== undefined ? Math.max(60, Math.min(200, action.bpm)) : undefined;
        const resultSwing = action.swing !== undefined ? Math.max(0, Math.min(1, action.swing)) : undefined;

        return {
          actions: [action],
          response: {
            applied: true,
            ...(resultBpm !== undefined ? { bpm: resultBpm } : {}),
            ...(resultSwing !== undefined ? { swing: Math.round(resultSwing * 100) / 100 } : {}),
            ...(action.playing !== undefined ? { playing: action.playing } : {}),
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
        if (rejection) return { actions: [], response: errorPayload(rejection) };

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
        const validOps = ['rotate', 'transpose', 'reverse', 'duplicate'];
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
        };

        const rejection = ctx?.validateAction?.(action);
        if (rejection) return { actions: [], response: errorPayload(rejection) };

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

      case 'add_view': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.viewKind !== 'string' || !args.viewKind) {
          return { actions: [], response: errorPayload('Missing required parameter: viewKind') };
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

        const addViewRejection = ctx?.validateAction?.(addViewAction);
        if (addViewRejection) return { actions: [], response: errorPayload(addViewRejection) };

        return {
          actions: [addViewAction],
          response: {
            applied: true,
            trackId: addViewAction.trackId,
            viewKind: addViewAction.viewKind,
          },
        };
      }

      case 'remove_view': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.viewId !== 'string' || !args.viewId) {
          return { actions: [], response: errorPayload('Missing required parameter: viewId') };
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

        const removeViewRejection = ctx?.validateAction?.(removeViewAction);
        if (removeViewRejection) return { actions: [], response: errorPayload(removeViewRejection) };

        return {
          actions: [removeViewAction],
          response: {
            applied: true,
            trackId: removeViewAction.trackId,
            viewId: removeViewAction.viewId,
          },
        };
      }

      case 'add_processor': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.moduleType !== 'string' || !args.moduleType) {
          return { actions: [], response: errorPayload('Missing required parameter: moduleType') };
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

        const addProcRejection = ctx?.validateAction?.(addProcAction);
        if (addProcRejection) return { actions: [], response: errorPayload(addProcRejection) };

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

      case 'remove_processor': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.processorId !== 'string' || !args.processorId) {
          return { actions: [], response: errorPayload('Missing required parameter: processorId') };
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

        const removeProcRejection = ctx?.validateAction?.(removeProcAction);
        if (removeProcRejection) return { actions: [], response: errorPayload(removeProcRejection) };

        return {
          actions: [removeProcAction],
          response: {
            applied: true,
            trackId: removeProcAction.trackId,
            processorId: removeProcAction.processorId,
          },
        };
      }

      case 'replace_processor': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.processorId !== 'string' || !args.processorId) {
          return { actions: [], response: errorPayload('Missing required parameter: processorId') };
        }
        if (typeof args.newModuleType !== 'string' || !args.newModuleType) {
          return { actions: [], response: errorPayload('Missing required parameter: newModuleType') };
        }
        if (typeof args.description !== 'string') {
          return { actions: [], response: errorPayload('Missing required parameter: description') };
        }

        const newProcessorId = `${args.newModuleType}-${Date.now()}`;

        const replaceAction: AIReplaceProcessorAction = {
          type: 'replace_processor',
          trackId: args.trackId as string,
          processorId: args.processorId as string,
          newModuleType: args.newModuleType as string,
          newProcessorId,
          description: args.description as string,
        };

        const replaceRejection = ctx?.validateAction?.(replaceAction);
        if (replaceRejection) return { actions: [], response: errorPayload(replaceRejection) };

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

      case 'add_modulator': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.moduleType !== 'string' || !args.moduleType) {
          return { actions: [], response: errorPayload('Missing required parameter: moduleType') };
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

        const addModRejection = ctx?.validateAction?.(addModAction);
        if (addModRejection) return { actions: [], response: errorPayload(addModRejection) };

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

      case 'remove_modulator': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.modulatorId !== 'string' || !args.modulatorId) {
          return { actions: [], response: errorPayload('Missing required parameter: modulatorId') };
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

        const removeModRejection = ctx?.validateAction?.(removeModAction);
        if (removeModRejection) return { actions: [], response: errorPayload(removeModRejection) };

        return {
          actions: [removeModAction],
          response: {
            queued: true,
            trackId: removeModAction.trackId,
            modulatorId: removeModAction.modulatorId,
          },
        };
      }

      case 'connect_modulator': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.modulatorId !== 'string' || !args.modulatorId) {
          return { actions: [], response: errorPayload('Missing required parameter: modulatorId') };
        }
        if (typeof args.targetKind !== 'string' || !args.targetKind) {
          return { actions: [], response: errorPayload('Missing required parameter: targetKind') };
        }
        if (typeof args.targetParam !== 'string' || !args.targetParam) {
          return { actions: [], response: errorPayload('Missing required parameter: targetParam') };
        }
        if (typeof args.depth !== 'number') {
          return { actions: [], response: errorPayload('Missing required parameter: depth') };
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

        const connectRejection = ctx?.validateAction?.(connectAction);
        if (connectRejection) return { actions: [], response: errorPayload(connectRejection) };

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

      case 'disconnect_modulator': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.modulationId !== 'string' || !args.modulationId) {
          return { actions: [], response: errorPayload('Missing required parameter: modulationId') };
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

        const disconnectRejection = ctx?.validateAction?.(disconnectAction);
        if (disconnectRejection) return { actions: [], response: errorPayload(disconnectRejection) };

        return {
          actions: [disconnectAction],
          response: {
            queued: true,
            trackId: disconnectAction.trackId,
            modulationId: disconnectAction.modulationId,
          },
        };
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

        const setSurfaceRejection = ctx?.validateAction?.(setSurfaceAction);
        if (setSurfaceRejection) return { actions: [], response: errorPayload(setSurfaceRejection) };

        return {
          actions: [setSurfaceAction],
          response: {
            applied: true,
            trackId: setSurfaceAction.trackId,
            controlCount: semanticControls.length,
          },
        };
      }

      case 'pin': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.moduleId !== 'string' || !args.moduleId) {
          return { actions: [], response: errorPayload('Missing required parameter: moduleId') };
        }
        if (typeof args.controlId !== 'string' || !args.controlId) {
          return { actions: [], response: errorPayload('Missing required parameter: controlId') };
        }

        const pinAction: AIPinAction = {
          type: 'pin',
          trackId: args.trackId as string,
          moduleId: args.moduleId as string,
          controlId: args.controlId as string,
          description: `pin ${args.moduleId}:${args.controlId}`,
        };

        const pinRejection = ctx?.validateAction?.(pinAction);
        if (pinRejection) return { actions: [], response: errorPayload(pinRejection) };

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
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.moduleId !== 'string' || !args.moduleId) {
          return { actions: [], response: errorPayload('Missing required parameter: moduleId') };
        }
        if (typeof args.controlId !== 'string' || !args.controlId) {
          return { actions: [], response: errorPayload('Missing required parameter: controlId') };
        }

        const unpinAction: AIUnpinAction = {
          type: 'unpin',
          trackId: args.trackId as string,
          moduleId: args.moduleId as string,
          controlId: args.controlId as string,
          description: `unpin ${args.moduleId}:${args.controlId}`,
        };

        const unpinRejection = ctx?.validateAction?.(unpinAction);
        if (unpinRejection) return { actions: [], response: errorPayload(unpinRejection) };

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

        const labelAxesRejection = ctx?.validateAction?.(labelAxesAction);
        if (labelAxesRejection) return { actions: [], response: errorPayload(labelAxesRejection) };

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

      case 'set_importance': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.importance !== 'number') {
          return { actions: [], response: errorPayload('Missing required parameter: importance (must be a number 0.0-1.0)') };
        }
        if (args.importance < 0 || args.importance > 1) {
          return { actions: [], response: errorPayload('importance must be between 0.0 and 1.0') };
        }

        const setImportanceAction: AISetImportanceAction = {
          type: 'set_importance',
          trackId: args.trackId as string,
          importance: args.importance as number,
          ...(typeof args.musicalRole === 'string' ? { musicalRole: args.musicalRole } : {}),
        };

        return {
          actions: [setImportanceAction],
          response: {
            applied: true,
            trackId: setImportanceAction.trackId,
            importance: Math.round(setImportanceAction.importance * 100) / 100,
            ...(setImportanceAction.musicalRole ? { musicalRole: setImportanceAction.musicalRole } : {}),
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

        const result = await this.listenHandler(question, session, ctx?.listen, bars, trackIds);
        return { actions: [], response: result };
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
  ): Promise<Record<string, unknown>> {
    if (!listen) {
      return { error: 'Listen not available.' };
    }

    try {
      listen.onListening?.(true);

      const wavBlob = await listen.renderOffline(session, trackIds, bars);
      const state = compressState(session);

      const critique = await this.listener.evaluate({
        systemPrompt: buildListenPrompt(question),
        stateJson: JSON.stringify(state),
        question,
        audioData: wavBlob,
        mimeType: 'audio/wav',
      });
      return { critique };
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
          return [{ type: 'say', text: 'API error — retrying shortly.' }];
        default:
          break;
      }
    }
    console.error('Gluon AI call failed:', error);
    return [];
  }

  clearHistory(): void {
    this.planner.clearHistory();
  }
}
