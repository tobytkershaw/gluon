// src/ai/api.ts

import { GoogleGenAI, createPartFromFunctionResponse, FunctionCallingConfigMode } from '@google/genai';
import type { Content, FunctionCall, Part } from '@google/genai';
import type { Session, AIAction, AIMoveAction, AISketchAction, AITransportAction, AISetModelAction, AITransformAction, AIAddViewAction, AIRemoveViewAction, AIAddProcessorAction, AIRemoveProcessorAction, AIReplaceProcessorAction, AIAddModulatorAction, AIRemoveModulatorAction, AIConnectModulatorAction, AIDisconnectModulatorAction, ProcessorConfig, ModulatorConfig, ModulationTarget } from '../engine/types';
import { getTrack, updateTrack } from '../engine/types';
import { controlIdToRuntimeParam, plaitsInstrument, getProcessorEngineByName, getModulatorEngineByName } from '../audio/instrument-registry';
import { validateChainMutation, validateModulatorMutation } from '../engine/chain-validation';
import { normalizeRegionEvents } from '../engine/region-helpers';
import { projectRegionToPattern } from '../engine/region-projection';
import { rotate, transpose, reverse, duplicate } from '../engine/transformations';
import { compressState } from './state-compression';
import { buildSystemPrompt } from './system-prompt';
import { GLUON_LISTEN_PROMPT } from './listen-prompt';
import { GLUON_TOOLS } from './tool-declarations';

const MODEL = 'gemini-2.5-flash';

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
      if (action.playing !== undefined) t.playing = action.playing;
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
    case 'say':
    default:
      return session;
  }
}

/** Build an error function response that returns no actions */
function errorResponse(
  id: string,
  name: string,
  message: string,
): { actions: AIAction[]; responsePart: Part } {
  return {
    actions: [],
    responsePart: createPartFromFunctionResponse(id, name, { error: message }),
  };
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
 * This runs the same checks as executeOperations() (track existence, agency,
 * control validity, arbitration) so the tool response is honest.
 */
export type ActionValidator = (action: AIAction) => string | null;

/** Context passed to ask() for listen support and cancellation */
export interface AskContext {
  listen?: ListenContext;
  isStale?: () => boolean;
  /** Pre-validate actions against session state before returning tool responses */
  validateAction?: ActionValidator;
}

/** A single human-AI exchange, stored as an atomic unit for history trimming */
interface Exchange {
  userText: string;
  turns: Content[];
}

/** Backoff state for rate-limit handling */
interface BackoffState {
  until: number;
  delay: number;
}

export class GluonAI {
  private ai: GoogleGenAI | null = null;
  private exchanges: Exchange[] = [];
  private backoff: BackoffState = { until: 0, delay: 0 };

  private static MAX_EXCHANGES = 12;
  private static MAX_TOOL_ROUNDS = 5;

  constructor() {
    const envKey = import.meta.env.VITE_GOOGLE_API_KEY;
    if (envKey) {
      this.setApiKey(envKey);
    }
  }

  setApiKey(key: string): void {
    this.ai = new GoogleGenAI({ apiKey: key });
    this.exchanges = [];
    this.backoff = { until: 0, delay: 0 };
  }

  isConfigured(): boolean {
    return this.ai !== null;
  }

  async ask(session: Session, humanMessage: string, ctx?: AskContext): Promise<AIAction[]> {
    if (!this.ai) return [];

    // Trim history
    if (this.exchanges.length > GluonAI.MAX_EXCHANGES) {
      this.exchanges = this.exchanges.slice(-GluonAI.MAX_EXCHANGES);
    }

    // Build contents: history + current turn
    const contents: Content[] = [];
    for (const ex of this.exchanges) {
      contents.push({ role: 'user', parts: [{ text: ex.userText }] });
      for (const turn of ex.turns) {
        // Ensure every history entry is a valid Content object for the SDK.
        // API responses sometimes omit `parts` or `role`; normalize here.
        contents.push({
          role: turn.role ?? 'model',
          parts: Array.isArray(turn.parts) ? turn.parts : [],
        });
      }
    }

    const state = compressState(session);
    const userText = `Project state:\n${JSON.stringify(state)}\n\nHuman says: ${humanMessage}`;
    contents.push({ role: 'user', parts: [{ text: userText }] });

    const collectedActions: AIAction[] = [];
    const loopContents: Content[] = [];
    let hadError = false;
    // Turn-local projected session: later tool calls validate against
    // the projected result of earlier accepted calls in this turn.
    let projectedSession = session;

    try {
      for (let round = 0; round < GluonAI.MAX_TOOL_ROUNDS; round++) {
        // Cancellation check before API call
        if (ctx?.isStale?.()) break;

        const response = await this.callWithTools(contents, projectedSession);
        const candidate = response.candidates?.[0];
        const rawContent = candidate?.content;

        // Empty or missing content — the API returned nothing useful.
        // This can happen when safety filters suppress the response or
        // the model produces only thinking tokens with no visible output.
        if (!rawContent || !Array.isArray(rawContent.parts) || rawContent.parts.length === 0) {
          break;
        }

        // Normalize model content to guarantee valid Content shape.
        const modelContent: Content = {
          role: rawContent.role ?? 'model',
          parts: rawContent.parts,
        };

        loopContents.push(modelContent);
        contents.push(modelContent);

        // Collect text parts as say actions (skip thought parts)
        for (const part of modelContent.parts ?? []) {
          if (part.text && !('thought' in part && part.thought)) {
            collectedActions.push({ type: 'say', text: part.text });
          }
        }

        // Check for function calls
        const functionCalls = response.functionCalls;
        if (!functionCalls || functionCalls.length === 0) break;

        // Execute function calls sequentially against projected state
        const responseParts: Part[] = [];
        for (const fc of functionCalls) {
          const result = await this.executeFunctionCall(fc, projectedSession, ctx);
          collectedActions.push(...result.actions);
          responseParts.push(result.responsePart);
          // Project accepted actions onto local state for subsequent calls
          for (const action of result.actions) {
            projectedSession = projectAction(projectedSession, action);
          }
        }

        const functionResponseContent: Content = { role: 'user', parts: responseParts };
        loopContents.push(functionResponseContent);
        contents.push(functionResponseContent);
      }
    } catch (error) {
      hadError = true;
      const errorActions = this.handleError(error);
      collectedActions.push(...errorActions);
    }

    // Only store exchange in history if the request succeeded and wasn't
    // cancelled. Broken or stale exchanges pollute history and cause
    // cascading SDK failures on subsequent calls.
    if (!ctx?.isStale?.() && !hadError && loopContents.length > 0) {
      this.exchanges.push({ userText: humanMessage, turns: loopContents });
      if (this.exchanges.length > GluonAI.MAX_EXCHANGES) {
        this.exchanges = this.exchanges.slice(-GluonAI.MAX_EXCHANGES);
      }
    }

    return collectedActions;
  }

  private async callWithTools(contents: Content[], session: Session) {
    if (!this.ai) throw new Error('API not configured');

    const now = Date.now();
    if (now < this.backoff.until) {
      throw new Error('Rate limited — backing off.');
    }

    const response = await this.ai.models.generateContent({
      model: MODEL,
      contents: [...contents],
      config: {
        systemInstruction: buildSystemPrompt(session),
        maxOutputTokens: 2048,
        tools: [{ functionDeclarations: GLUON_TOOLS }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO,
          },
        },
      },
    });

    this.backoff = { until: 0, delay: 0 };
    return response;
  }

  private async executeFunctionCall(
    fc: FunctionCall,
    session: Session,
    ctx?: AskContext,
  ): Promise<{ actions: AIAction[]; responsePart: Part }> {
    const name = fc.name ?? '';
    const args = fc.args ?? {};
    const id = fc.id ?? '';

    switch (name) {
      case 'move': {
        // Validate required args
        if (typeof args.param !== 'string' || !args.param) {
          return errorResponse(id, name, 'Missing required parameter: param');
        }
        const target = args.target as Record<string, unknown> | undefined;
        if (!target || (typeof target.absolute !== 'number' && typeof target.relative !== 'number')) {
          return errorResponse(id, name, 'Missing required parameter: target (needs absolute or relative number)');
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
        if (rejection) return errorResponse(id, name, rejection);

        // Compute resulting value for the response
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
          responsePart: createPartFromFunctionResponse(id, name, {
            applied: true,
            param: action.param,
            trackId,
            ...(action.processorId ? { processorId: action.processorId } : {}),
            ...(action.modulatorId ? { modulatorId: action.modulatorId } : {}),
            value: Math.round(resultValue * 100) / 100,
          }),
        };
      }

      case 'sketch': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return errorResponse(id, name, 'Missing required parameter: trackId');
        }
        if (typeof args.description !== 'string') {
          return errorResponse(id, name, 'Missing required parameter: description');
        }
        if (!Array.isArray(args.events)) {
          return errorResponse(id, name, 'Missing required parameter: events (must be an array)');
        }

        const action: AISketchAction = {
          type: 'sketch',
          trackId: args.trackId as string,
          description: args.description as string,
          events: args.events as AISketchAction['events'],
        };

        const rejection = ctx?.validateAction?.(action);
        if (rejection) return errorResponse(id, name, rejection);

        return {
          actions: [action],
          responsePart: createPartFromFunctionResponse(id, name, {
            applied: true,
            trackId: action.trackId,
            description: action.description,
            eventCount: action.events?.length ?? 0,
          }),
        };
      }

      case 'set_transport': {
        const hasBpm = typeof args.bpm === 'number';
        const hasSwing = typeof args.swing === 'number';
        const hasPlaying = typeof args.playing === 'boolean';
        if (!hasBpm && !hasSwing && !hasPlaying) {
          return errorResponse(id, name, 'At least one of bpm, swing, or playing must be provided');
        }

        const action: AITransportAction = {
          type: 'set_transport',
          ...(hasBpm ? { bpm: args.bpm as number } : {}),
          ...(hasSwing ? { swing: args.swing as number } : {}),
          ...(hasPlaying ? { playing: args.playing as boolean } : {}),
        };

        const rejection = ctx?.validateAction?.(action);
        if (rejection) return errorResponse(id, name, rejection);

        // Compute resulting transport values (clamped)
        const resultBpm = action.bpm !== undefined ? Math.max(60, Math.min(200, action.bpm)) : undefined;
        const resultSwing = action.swing !== undefined ? Math.max(0, Math.min(1, action.swing)) : undefined;

        return {
          actions: [action],
          responsePart: createPartFromFunctionResponse(id, name, {
            applied: true,
            ...(resultBpm !== undefined ? { bpm: resultBpm } : {}),
            ...(resultSwing !== undefined ? { swing: Math.round(resultSwing * 100) / 100 } : {}),
            ...(action.playing !== undefined ? { playing: action.playing } : {}),
          }),
        };
      }

      case 'set_model': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return errorResponse(id, name, 'Missing required parameter: trackId');
        }
        if (typeof args.model !== 'string' || !args.model) {
          return errorResponse(id, name, 'Missing required parameter: model');
        }

        const action: AISetModelAction = {
          type: 'set_model',
          trackId: args.trackId as string,
          model: args.model as string,
          ...(args.processorId ? { processorId: args.processorId as string } : {}),
          ...(args.modulatorId ? { modulatorId: args.modulatorId as string } : {}),
        };

        const rejection = ctx?.validateAction?.(action);
        if (rejection) return errorResponse(id, name, rejection);

        return {
          actions: [action],
          responsePart: createPartFromFunctionResponse(id, name, {
            queued: true,
            trackId: action.trackId,
            model: action.model,
            ...(action.processorId ? { processorId: action.processorId } : {}),
          }),
        };
      }

      case 'transform': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return errorResponse(id, name, 'Missing required parameter: trackId');
        }
        if (typeof args.operation !== 'string' || !args.operation) {
          return errorResponse(id, name, 'Missing required parameter: operation');
        }
        if (typeof args.description !== 'string') {
          return errorResponse(id, name, 'Missing required parameter: description');
        }

        const operation = args.operation as string;
        const validOps = ['rotate', 'transpose', 'reverse', 'duplicate'];
        if (!validOps.includes(operation)) {
          return errorResponse(id, name, `Unknown operation: ${operation}. Must be one of: ${validOps.join(', ')}`);
        }

        const hasSteps = typeof args.steps === 'number';
        const hasSemitones = typeof args.semitones === 'number';

        if (operation === 'rotate') {
          if (!hasSteps) return errorResponse(id, name, 'rotate requires steps parameter');
          if (hasSemitones) return errorResponse(id, name, 'rotate does not accept semitones parameter');
          if (args.steps === 0) return errorResponse(id, name, 'steps must be non-zero');
        } else if (operation === 'transpose') {
          if (!hasSemitones) return errorResponse(id, name, 'transpose requires semitones parameter');
          if (hasSteps) return errorResponse(id, name, 'transpose does not accept steps parameter');
          if (args.semitones === 0) return errorResponse(id, name, 'semitones must be non-zero');
        } else {
          if (hasSteps) return errorResponse(id, name, `${operation} does not accept steps parameter`);
          if (hasSemitones) return errorResponse(id, name, `${operation} does not accept semitones parameter`);
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
        if (rejection) return errorResponse(id, name, rejection);

        return {
          actions: [action],
          responsePart: createPartFromFunctionResponse(id, name, {
            applied: true,
            trackId: action.trackId,
            operation: action.operation,
            description: action.description,
          }),
        };
      }

      case 'add_view': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return errorResponse(id, name, 'Missing required parameter: trackId');
        }
        if (typeof args.viewKind !== 'string' || !args.viewKind) {
          return errorResponse(id, name, 'Missing required parameter: viewKind');
        }
        const validKinds = ['step-grid'];
        if (!validKinds.includes(args.viewKind as string)) {
          return errorResponse(id, name, `Unknown viewKind: ${args.viewKind}. Must be one of: ${validKinds.join(', ')}`);
        }
        if (typeof args.description !== 'string') {
          return errorResponse(id, name, 'Missing required parameter: description');
        }

        const addViewAction: AIAddViewAction = {
          type: 'add_view',
          trackId: args.trackId as string,
          viewKind: args.viewKind as AIAddViewAction['viewKind'],
          description: args.description as string,
        };

        const addViewRejection = ctx?.validateAction?.(addViewAction);
        if (addViewRejection) return errorResponse(id, name, addViewRejection);

        return {
          actions: [addViewAction],
          responsePart: createPartFromFunctionResponse(id, name, {
            applied: true,
            trackId: addViewAction.trackId,
            viewKind: addViewAction.viewKind,
          }),
        };
      }

      case 'remove_view': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return errorResponse(id, name, 'Missing required parameter: trackId');
        }
        if (typeof args.viewId !== 'string' || !args.viewId) {
          return errorResponse(id, name, 'Missing required parameter: viewId');
        }
        if (typeof args.description !== 'string') {
          return errorResponse(id, name, 'Missing required parameter: description');
        }

        const removeViewAction: AIRemoveViewAction = {
          type: 'remove_view',
          trackId: args.trackId as string,
          viewId: args.viewId as string,
          description: args.description as string,
        };

        const removeViewRejection = ctx?.validateAction?.(removeViewAction);
        if (removeViewRejection) return errorResponse(id, name, removeViewRejection);

        return {
          actions: [removeViewAction],
          responsePart: createPartFromFunctionResponse(id, name, {
            applied: true,
            trackId: removeViewAction.trackId,
            viewId: removeViewAction.viewId,
          }),
        };
      }

      case 'add_processor': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return errorResponse(id, name, 'Missing required parameter: trackId');
        }
        if (typeof args.moduleType !== 'string' || !args.moduleType) {
          return errorResponse(id, name, 'Missing required parameter: moduleType');
        }
        // Chain validation: type and capacity
        const track = session.tracks.find(v => v.id === args.trackId);
        if (track) {
          const chainResult = validateChainMutation(track, { kind: 'add', type: args.moduleType as string });
          if (!chainResult.valid) {
            return errorResponse(id, name, chainResult.errors[0]);
          }
        }
        if (typeof args.description !== 'string') {
          return errorResponse(id, name, 'Missing required parameter: description');
        }

        // Generate the processor ID once — used by projection, execution, and response
        const assignedProcessorId = `${args.moduleType}-${Date.now()}`;

        const addProcAction: AIAddProcessorAction = {
          type: 'add_processor',
          trackId: args.trackId as string,
          moduleType: args.moduleType as string,
          processorId: assignedProcessorId,
          description: args.description as string,
        };

        const addProcRejection = ctx?.validateAction?.(addProcAction);
        if (addProcRejection) return errorResponse(id, name, addProcRejection);

        return {
          actions: [addProcAction],
          responsePart: createPartFromFunctionResponse(id, name, {
            applied: true,
            trackId: addProcAction.trackId,
            moduleType: addProcAction.moduleType,
            processorId: assignedProcessorId,
          }),
        };
      }

      case 'remove_processor': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return errorResponse(id, name, 'Missing required parameter: trackId');
        }
        if (typeof args.processorId !== 'string' || !args.processorId) {
          return errorResponse(id, name, 'Missing required parameter: processorId');
        }
        if (typeof args.description !== 'string') {
          return errorResponse(id, name, 'Missing required parameter: description');
        }

        const removeProcAction: AIRemoveProcessorAction = {
          type: 'remove_processor',
          trackId: args.trackId as string,
          processorId: args.processorId as string,
          description: args.description as string,
        };

        const removeProcRejection = ctx?.validateAction?.(removeProcAction);
        if (removeProcRejection) return errorResponse(id, name, removeProcRejection);

        return {
          actions: [removeProcAction],
          responsePart: createPartFromFunctionResponse(id, name, {
            applied: true,
            trackId: removeProcAction.trackId,
            processorId: removeProcAction.processorId,
          }),
        };
      }

      case 'replace_processor': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return errorResponse(id, name, 'Missing required parameter: trackId');
        }
        if (typeof args.processorId !== 'string' || !args.processorId) {
          return errorResponse(id, name, 'Missing required parameter: processorId');
        }
        if (typeof args.newModuleType !== 'string' || !args.newModuleType) {
          return errorResponse(id, name, 'Missing required parameter: newModuleType');
        }
        if (typeof args.description !== 'string') {
          return errorResponse(id, name, 'Missing required parameter: description');
        }

        // Generate the replacement processor ID once — used by projection, execution, and response
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
        if (replaceRejection) return errorResponse(id, name, replaceRejection);

        return {
          actions: [replaceAction],
          responsePart: createPartFromFunctionResponse(id, name, {
            applied: true,
            trackId: replaceAction.trackId,
            replacedProcessorId: replaceAction.processorId,
            newModuleType: replaceAction.newModuleType,
            newProcessorId,
          }),
        };
      }

      case 'add_modulator': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return errorResponse(id, name, 'Missing required parameter: trackId');
        }
        if (typeof args.moduleType !== 'string' || !args.moduleType) {
          return errorResponse(id, name, 'Missing required parameter: moduleType');
        }
        const track = session.tracks.find(v => v.id === args.trackId);
        if (track) {
          const modResult = validateModulatorMutation(track, { kind: 'add', type: args.moduleType as string });
          if (!modResult.valid) {
            return errorResponse(id, name, modResult.errors[0]);
          }
        }
        if (typeof args.description !== 'string') {
          return errorResponse(id, name, 'Missing required parameter: description');
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
        if (addModRejection) return errorResponse(id, name, addModRejection);

        return {
          actions: [addModAction],
          responsePart: createPartFromFunctionResponse(id, name, {
            queued: true,
            trackId: addModAction.trackId,
            moduleType: addModAction.moduleType,
            modulatorId: assignedModulatorId,
          }),
        };
      }

      case 'remove_modulator': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return errorResponse(id, name, 'Missing required parameter: trackId');
        }
        if (typeof args.modulatorId !== 'string' || !args.modulatorId) {
          return errorResponse(id, name, 'Missing required parameter: modulatorId');
        }
        if (typeof args.description !== 'string') {
          return errorResponse(id, name, 'Missing required parameter: description');
        }

        const removeModAction: AIRemoveModulatorAction = {
          type: 'remove_modulator',
          trackId: args.trackId as string,
          modulatorId: args.modulatorId as string,
          description: args.description as string,
        };

        const removeModRejection = ctx?.validateAction?.(removeModAction);
        if (removeModRejection) return errorResponse(id, name, removeModRejection);

        return {
          actions: [removeModAction],
          responsePart: createPartFromFunctionResponse(id, name, {
            queued: true,
            trackId: removeModAction.trackId,
            modulatorId: removeModAction.modulatorId,
          }),
        };
      }

      case 'connect_modulator': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return errorResponse(id, name, 'Missing required parameter: trackId');
        }
        if (typeof args.modulatorId !== 'string' || !args.modulatorId) {
          return errorResponse(id, name, 'Missing required parameter: modulatorId');
        }
        if (typeof args.targetKind !== 'string' || !args.targetKind) {
          return errorResponse(id, name, 'Missing required parameter: targetKind');
        }
        if (typeof args.targetParam !== 'string' || !args.targetParam) {
          return errorResponse(id, name, 'Missing required parameter: targetParam');
        }
        if (typeof args.depth !== 'number') {
          return errorResponse(id, name, 'Missing required parameter: depth');
        }
        if (typeof args.description !== 'string') {
          return errorResponse(id, name, 'Missing required parameter: description');
        }

        const targetKind = args.targetKind as string;
        if (targetKind !== 'source' && targetKind !== 'processor') {
          return errorResponse(id, name, `targetKind must be "source" or "processor", got "${targetKind}"`);
        }
        if (targetKind === 'processor' && (typeof args.processorId !== 'string' || !args.processorId)) {
          return errorResponse(id, name, 'processorId is required when targetKind is "processor"');
        }

        const modTarget: ModulationTarget = targetKind === 'source'
          ? { kind: 'source', param: args.targetParam as string }
          : { kind: 'processor', processorId: args.processorId as string, param: args.targetParam as string };

        // Check for existing route (for idempotent response)
        const connectTrack = session.tracks.find(v => v.id === args.trackId);
        const existingRoute = (connectTrack?.modulations ?? []).find(r =>
          r.modulatorId === args.modulatorId &&
          r.target.kind === modTarget.kind &&
          r.target.param === modTarget.param &&
          (modTarget.kind === 'source' || (modTarget.kind === 'processor' && r.target.kind === 'processor' && r.target.processorId === modTarget.processorId))
        );

        // Pre-assign route ID for new routes (enables same-turn disconnect)
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
        if (connectRejection) return errorResponse(id, name, connectRejection);

        const targetStr = modTarget.kind === 'source'
          ? `source:${modTarget.param}`
          : `processor:${modTarget.processorId}:${modTarget.param}`;

        return {
          actions: [connectAction],
          responsePart: createPartFromFunctionResponse(id, name, {
            queued: true,
            modulationId: preAssignedId,
            created: !existingRoute,
            ...(existingRoute ? { previousDepth: existingRoute.depth } : {}),
            target: targetStr,
            depth: args.depth,
          }),
        };
      }

      case 'disconnect_modulator': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return errorResponse(id, name, 'Missing required parameter: trackId');
        }
        if (typeof args.modulationId !== 'string' || !args.modulationId) {
          return errorResponse(id, name, 'Missing required parameter: modulationId');
        }
        if (typeof args.description !== 'string') {
          return errorResponse(id, name, 'Missing required parameter: description');
        }

        const disconnectAction: AIDisconnectModulatorAction = {
          type: 'disconnect_modulator',
          trackId: args.trackId as string,
          modulationId: args.modulationId as string,
          description: args.description as string,
        };

        const disconnectRejection = ctx?.validateAction?.(disconnectAction);
        if (disconnectRejection) return errorResponse(id, name, disconnectRejection);

        return {
          actions: [disconnectAction],
          responsePart: createPartFromFunctionResponse(id, name, {
            queued: true,
            trackId: disconnectAction.trackId,
            modulationId: disconnectAction.modulationId,
          }),
        };
      }

      case 'listen': {
        // Cancellation check before side effect
        if (ctx?.isStale?.()) {
          return {
            actions: [],
            responsePart: createPartFromFunctionResponse(id, name, {
              error: 'Request cancelled.',
            }),
          };
        }

        const question = (args.question as string) ?? 'How does it sound?';
        const rawBars = typeof args.bars === 'number' ? args.bars : 2;
        const bars = Math.max(1, Math.min(16, Math.round(rawBars)));
        const rawTrackIds = args.trackIds as string[] | undefined;
        // Empty array = same as omitting (hear all unmuted tracks)
        const trackIds = rawTrackIds && rawTrackIds.length > 0 ? rawTrackIds : undefined;

        // Validate that all requested track IDs exist in the session
        if (trackIds) {
          const sessionTrackIds = new Set(session.tracks.map(v => v.id));
          const invalid = trackIds.filter(vid => !sessionTrackIds.has(vid));
          if (invalid.length > 0) {
            return {
              actions: [],
              responsePart: createPartFromFunctionResponse(id, name, {
                error: `Unknown track IDs: ${invalid.join(', ')}. Available: ${[...sessionTrackIds].join(', ')}.`,
              }),
            };
          }
        }

        const result = await this.listenHandler(question, session, ctx?.listen, bars, trackIds);
        return {
          actions: [],
          responsePart: createPartFromFunctionResponse(id, name, result),
        };
      }

      default:
        return {
          actions: [],
          responsePart: createPartFromFunctionResponse(id, name, {
            error: `Unknown tool: ${name}`,
          }),
        };
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

      const critique = await this.evaluateAudio(session, wavBlob, 'audio/wav', question);
      return { critique };
    } catch {
      return { error: 'Audio evaluation failed — try again.' };
    } finally {
      listen.onListening?.(false);
    }
  }

  private async evaluateAudio(
    session: Session,
    audioBlob: Blob,
    mimeType: string,
    question: string,
  ): Promise<string> {
    if (!this.ai) return 'API not configured.';

    const now = Date.now();
    if (now < this.backoff.until) return 'Rate limited — try again shortly.';

    const state = compressState(session);
    const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < audioBytes.length; i += chunkSize) {
      binary += String.fromCharCode(...audioBytes.subarray(i, i + chunkSize));
    }
    const audioBase64 = btoa(binary);

    try {
      const response = await this.ai.models.generateContent({
        model: MODEL,
        config: {
          systemInstruction: GLUON_LISTEN_PROMPT,
        },
        contents: [{
          role: 'user',
          parts: [
            { text: `Project state:\n${JSON.stringify(state)}\n\nQuestion: ${question}` },
            { inlineData: { mimeType, data: audioBase64 } },
          ],
        }],
      });

      this.backoff = { until: 0, delay: 0 };
      return response.text ?? 'No response from model.';
    } catch (error) {
      const actions = this.handleError(error);
      const sayAction = actions.find(a => a.type === 'say');
      return sayAction && 'text' in sayAction ? sayAction.text : 'Audio evaluation failed.';
    }
  }

  private handleError(error: unknown): AIAction[] {
    const msg = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status
      ?? (error as { httpStatusCode?: number }).httpStatusCode;

    if (status === 429 || /rate.limit|quota|resource.exhausted/i.test(msg)) {
      const delay = Math.min(this.backoff.delay ? this.backoff.delay * 2 : 5_000, 120_000);
      this.backoff = { until: Date.now() + delay, delay };
      const secs = Math.round(delay / 1000);
      return [{ type: 'say', text: `Rate limited — backing off for ${secs}s.` }];
    }

    if (status === 401 || status === 403 || /api.key|unauthorized|forbidden/i.test(msg)) {
      return [{ type: 'say', text: 'API key invalid or missing permissions. Check your Google API key.' }];
    }

    if (status && status >= 500) {
      this.backoff = { until: Date.now() + 10_000, delay: 10_000 };
      return [{ type: 'say', text: 'Gemini API error — retrying shortly.' }];
    }

    console.error('Gluon AI call failed:', error);
    return [];
  }

  clearHistory(): void {
    this.exchanges = [];
    this.backoff = { until: 0, delay: 0 };
  }
}
