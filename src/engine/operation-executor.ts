// src/engine/operation-executor.ts
import type { Session, AIAction, AITransformAction, ActionGroupSnapshot, Snapshot, TransportSnapshot, ModelSnapshot, RegionSnapshot, ViewSnapshot, ProcessorSnapshot, ProcessorStateSnapshot, ProcessorConfig, ModulatorConfig, ModulationRouting, ModulatorSnapshot, ModulatorStateSnapshot, ModulationRoutingSnapshot, ActionDiff } from './types';
import type { ControlState, SourceAdapter, ExecutionReportLogEntry, MusicalEvent, MoveOp } from './canonical-types';
import type { Arbitrator } from './arbitration';
import { getVoice, updateVoice } from './types';
import { applyMove, applySketch } from './primitives';
import { rotate, transpose, reverse, duplicate } from './transformations';
import { projectRegionToPattern } from './region-projection';
import { normalizeRegionEvents, validateRegion } from './region-helpers';
import { getVoiceLabel } from './voice-labels';
import { getEngineById, plaitsInstrument, getProcessorEngineByName, getModulatorEngineByName } from '../audio/instrument-registry';
import { validateChainMutation, validateProcessorTarget, validateModulatorMutation, validateModulationTarget, validateModulatorTarget } from './chain-validation';

export interface OperationExecutionReport {
  session: Session;
  accepted: AIAction[];
  rejected: { op: AIAction; reason: string }[];
  log: ExecutionReportLogEntry[];
  /** For accepted move actions, maps action index → resolved runtime param key */
  resolvedParams: Map<number, string>;
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
      const voiceId = action.voiceId ?? session.activeVoiceId;
      const voice = session.voices.find(v => v.id === voiceId);
      if (!voice) return `Voice not found: ${voiceId}`;
      if (voice.agency !== 'ON') return `Voice ${voiceId} has agency OFF`;

      // Modulator path: validate against modulator registry
      if (action.modulatorId) {
        if (action.over) return `Timed moves (over) are not supported for modulator controls`;
        const targetResult = validateModulatorTarget(voice, action.modulatorId, { param: action.param });
        if (!targetResult.valid) return targetResult.errors[0];
        if (!arbitrator.canAIAct(voiceId, `modulator:${action.modulatorId}:${action.param}`)) {
          return `Arbitration: human is currently interacting with ${action.modulatorId}:${action.param} on ${voiceId}`;
        }
        return null;
      }

      // Processor path: validate against processor registry via chain-validation
      if (action.processorId) {
        if (action.over) return `Timed moves (over) are not supported for processor controls`;
        const targetResult = validateProcessorTarget(voice, action.processorId, { param: action.param });
        if (!targetResult.valid) return targetResult.errors[0];
        if (!arbitrator.canAIAct(voiceId, `processor:${action.processorId}:${action.param}`)) {
          return `Arbitration: human is currently interacting with ${action.processorId}:${action.param} on ${voiceId}`;
        }
        return null;
      }

      // Source path: resolve through adapter
      const resolved = resolveMoveParam(action.param, adapter);
      if (!resolved) return `Unknown control: ${action.param}`;

      const validationMove: MoveOp = {
        type: 'move',
        voiceId,
        controlId: resolved.controlId,
        target: 'absolute' in action.target
          ? { absolute: action.target.absolute }
          : { relative: action.target.relative },
        ...(action.over ? { overMs: action.over } : {}),
      };
      const validation = adapter.validateOperation(validationMove);
      if (!validation.valid) return validation.reason ?? `Validation failed for ${action.param}`;

      if (!arbitrator.canAIAct(voiceId, resolved.runtimeParam)) {
        return `Arbitration: human is currently holding ${resolved.runtimeParam} on ${voiceId}`;
      }
      return null;
    }

    case 'sketch': {
      const voice = session.voices.find(v => v.id === action.voiceId);
      if (!voice) return `Voice not found: ${action.voiceId}`;
      if (voice.agency !== 'ON') return `Voice ${action.voiceId} has agency OFF`;
      return null;
    }

    case 'set_model': {
      const voice = session.voices.find(v => v.id === action.voiceId);
      if (!voice) return `Voice not found: ${action.voiceId}`;
      if (voice.agency !== 'ON') return `Voice ${action.voiceId} has agency OFF`;

      // Modulator path: resolve model against modulator type's engine list
      if (action.modulatorId) {
        const targetResult = validateModulatorTarget(voice, action.modulatorId, { model: action.model });
        if (!targetResult.valid) return targetResult.errors[0];
        if (!arbitrator.canAIActOnVoice(action.voiceId)) {
          return `Arbitration: human is currently interacting with voice ${action.voiceId}`;
        }
        return null;
      }

      // Processor path: resolve model against processor type's engine list via chain-validation
      if (action.processorId) {
        const targetResult = validateProcessorTarget(voice, action.processorId, { model: action.model });
        if (!targetResult.valid) return targetResult.errors[0];
        if (!arbitrator.canAIActOnVoice(action.voiceId)) {
          return `Arbitration: human is currently interacting with voice ${action.voiceId}`;
        }
        return null;
      }

      // Source path: resolve against Plaits engines
      const engine = getEngineById(action.model);
      if (!engine) return `Unknown model: ${action.model}`;
      if (!arbitrator.canAIActOnVoice(action.voiceId)) {
        return `Arbitration: human is currently interacting with voice ${action.voiceId}`;
      }
      return null;
    }

    case 'transform': {
      const voice = session.voices.find(v => v.id === action.voiceId);
      if (!voice) return `Voice not found: ${action.voiceId}`;
      if (voice.agency !== 'ON') return `Voice ${action.voiceId} has agency OFF`;
      return null;
    }

    case 'add_view': {
      const voice = session.voices.find(v => v.id === action.voiceId);
      if (!voice) return `Voice not found: ${action.voiceId}`;
      // No agency check — view ops are UI curation, not musical mutation
      return null;
    }

    case 'remove_view': {
      const voice = session.voices.find(v => v.id === action.voiceId);
      if (!voice) return `Voice not found: ${action.voiceId}`;
      // No agency check
      const views = voice.views ?? [];
      if (!views.some(v => v.id === action.viewId)) return `View not found: ${action.viewId}`;
      return null;
    }

    case 'add_processor': {
      const voice = session.voices.find(v => v.id === action.voiceId);
      if (!voice) return `Voice not found: ${action.voiceId}`;
      if (voice.agency !== 'ON') return `Voice ${action.voiceId} has agency OFF`;
      const chainResult = validateChainMutation(voice, { kind: 'add', type: action.moduleType });
      if (!chainResult.valid) return chainResult.errors[0];
      if (!arbitrator.canAIActOnVoice(action.voiceId)) {
        return `Arbitration: human is currently interacting with voice ${action.voiceId}`;
      }
      return null;
    }

    case 'remove_processor': {
      const voice = session.voices.find(v => v.id === action.voiceId);
      if (!voice) return `Voice not found: ${action.voiceId}`;
      if (voice.agency !== 'ON') return `Voice ${action.voiceId} has agency OFF`;
      const chainResult = validateChainMutation(voice, { kind: 'remove', processorId: action.processorId });
      if (!chainResult.valid) return chainResult.errors[0];
      if (!arbitrator.canAIActOnVoice(action.voiceId)) {
        return `Arbitration: human is currently interacting with voice ${action.voiceId}`;
      }
      return null;
    }

    case 'replace_processor': {
      const voice = session.voices.find(v => v.id === action.voiceId);
      if (!voice) return `Voice not found: ${action.voiceId}`;
      if (voice.agency !== 'ON') return `Voice ${action.voiceId} has agency OFF`;
      // Validate old processor exists
      const removeResult = validateChainMutation(voice, { kind: 'remove', processorId: action.processorId });
      if (!removeResult.valid) return removeResult.errors[0];
      // Validate new type is valid (use a simulated chain without the old one for the add check)
      const filteredProcessors = (voice.processors ?? []).filter(p => p.id !== action.processorId);
      const simulatedVoice = { ...voice, processors: filteredProcessors };
      const addResult = validateChainMutation(simulatedVoice, { kind: 'add', type: action.newModuleType });
      if (!addResult.valid) return addResult.errors[0];
      if (!arbitrator.canAIActOnVoice(action.voiceId)) {
        return `Arbitration: human is currently interacting with voice ${action.voiceId}`;
      }
      return null;
    }

    case 'add_modulator': {
      const voice = session.voices.find(v => v.id === action.voiceId);
      if (!voice) return `Voice not found: ${action.voiceId}`;
      if (voice.agency !== 'ON') return `Voice ${action.voiceId} has agency OFF`;
      const modResult = validateModulatorMutation(voice, { kind: 'add', type: action.moduleType });
      if (!modResult.valid) return modResult.errors[0];
      if (!arbitrator.canAIActOnVoice(action.voiceId)) {
        return `Arbitration: human is currently interacting with voice ${action.voiceId}`;
      }
      return null;
    }

    case 'remove_modulator': {
      const voice = session.voices.find(v => v.id === action.voiceId);
      if (!voice) return `Voice not found: ${action.voiceId}`;
      if (voice.agency !== 'ON') return `Voice ${action.voiceId} has agency OFF`;
      const modResult = validateModulatorMutation(voice, { kind: 'remove', modulatorId: action.modulatorId });
      if (!modResult.valid) return modResult.errors[0];
      if (!arbitrator.canAIActOnVoice(action.voiceId)) {
        return `Arbitration: human is currently interacting with voice ${action.voiceId}`;
      }
      return null;
    }

    case 'connect_modulator': {
      const voice = session.voices.find(v => v.id === action.voiceId);
      if (!voice) return `Voice not found: ${action.voiceId}`;
      if (voice.agency !== 'ON') return `Voice ${action.voiceId} has agency OFF`;
      const routeResult = validateModulationTarget(voice, { modulatorId: action.modulatorId, target: action.target, depth: action.depth });
      if (!routeResult.valid) return routeResult.errors[0];
      if (!arbitrator.canAIActOnVoice(action.voiceId)) {
        return `Arbitration: human is currently interacting with voice ${action.voiceId}`;
      }
      return null;
    }

    case 'disconnect_modulator': {
      const voice = session.voices.find(v => v.id === action.voiceId);
      if (!voice) return `Voice not found: ${action.voiceId}`;
      if (voice.agency !== 'ON') return `Voice ${action.voiceId} has agency OFF`;
      const modulations = voice.modulations ?? [];
      if (!modulations.some(m => m.id === action.modulationId)) return `Modulation routing not found: ${action.modulationId}`;
      if (!arbitrator.canAIActOnVoice(action.voiceId)) {
        return `Arbitration: human is currently interacting with voice ${action.voiceId}`;
      }
      return null;
    }

    case 'set_transport':
    case 'say':
      return null;
  }
}

export function executeOperations(
  session: Session,
  actions: AIAction[],
  adapter: SourceAdapter,
  arbitrator: Arbitrator,
): OperationExecutionReport {
  const accepted: AIAction[] = [];
  const rejected: { op: AIAction; reason: string }[] = [];
  const log: ExecutionReportLogEntry[] = [];
  const sayTexts: string[] = [];
  const resolvedParams = new Map<number, string>();

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
        const voiceId = action.voiceId ?? next.activeVoiceId;
        const voice = getVoice(next, voiceId);
        const vLabel = getVoiceLabel(getVoice(next, voiceId)).toUpperCase();

        // Modulator path: write directly to modulator.params
        if (action.modulatorId) {
          const modulators = voice.modulators ?? [];
          const modIndex = modulators.findIndex(m => m.id === action.modulatorId);
          const mod = modulators[modIndex];
          const currentVal = mod.params[action.param] ?? 0;
          const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
          const targetVal = Math.max(0, Math.min(1, rawTarget));

          const snapshot: ModulatorStateSnapshot = {
            kind: 'modulator-state',
            voiceId,
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
            ...updateVoice(next, voiceId, { modulators: newModulators }),
            undoStack: [...next.undoStack, snapshot],
          };

          log.push({ voiceId, voiceLabel: vLabel, description: `${mod.type}/${action.param} ${currentVal.toFixed(2)} → ${targetVal.toFixed(2)}`, diff: { kind: 'param-change', controlId: `${mod.type}/${action.param}`, from: currentVal, to: targetVal } });
          accepted.push(action);
          break;
        }

        // Processor path: write directly to processor.params
        if (action.processorId) {
          const processors = voice.processors ?? [];
          const procIndex = processors.findIndex(p => p.id === action.processorId);
          const proc = processors[procIndex];
          const currentVal = proc.params[action.param] ?? 0;
          const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
          const targetVal = Math.max(0, Math.min(1, rawTarget));

          const snapshot: ProcessorStateSnapshot = {
            kind: 'processor-state',
            voiceId,
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
            ...updateVoice(next, voiceId, { processors: newProcessors }),
            undoStack: [...next.undoStack, snapshot],
          };

          log.push({ voiceId, voiceLabel: vLabel, description: `${proc.type}/${action.param} ${currentVal.toFixed(2)} → ${targetVal.toFixed(2)}`, diff: { kind: 'param-change', controlId: `${proc.type}/${action.param}`, from: currentVal, to: targetVal } });
          accepted.push(action);
          break;
        }

        // Source path: resolve through adapter
        const resolved = resolveMoveParam(action.param, adapter)!;
        const { runtimeParam, controlId } = resolved;

        if (action.over) {
          // Drift move: record snapshot + provenance, but actual animation is handled by caller
          const currentVal = voice.params[runtimeParam] ?? 0;
          const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
          const targetVal = Math.max(0, Math.min(1, rawTarget));

          const prevProvenance: Partial<ControlState> = {};
          if (voice.controlProvenance?.[controlId]) {
            prevProvenance[controlId] = { ...voice.controlProvenance[controlId] };
          }

          next = {
            ...next,
            undoStack: [...next.undoStack, {
              kind: 'param' as const,
              voiceId,
              prevValues: { [runtimeParam]: currentVal },
              aiTargetValues: { [runtimeParam]: targetVal },
              prevProvenance,
              timestamp: Date.now(),
              description: `AI drift: ${controlId} ${currentVal.toFixed(2)} -> ${targetVal.toFixed(2)} over ${action.over}ms`,
            }],
          };

          if (voice.controlProvenance) {
            next = updateVoice(next, voiceId, {
              controlProvenance: {
                ...voice.controlProvenance,
                [controlId]: { value: targetVal, source: 'ai', updatedAt: Date.now() },
              },
            });
          }

          log.push({ voiceId, voiceLabel: vLabel, description: `${controlId} ${currentVal.toFixed(2)} → ${targetVal.toFixed(2)} (drift ${action.over}ms)`, diff: { kind: 'param-change', controlId, from: currentVal, to: targetVal } });
          resolvedParams.set(accepted.length, runtimeParam);
          accepted.push(action);
        } else {
          // Immediate move
          const currentVoice = getVoice(next, voiceId);
          const beforeVal = currentVoice.params[runtimeParam] ?? 0;

          const prevProvenance: Partial<ControlState> = {};
          if (currentVoice.controlProvenance?.[controlId]) {
            prevProvenance[controlId] = { ...currentVoice.controlProvenance[controlId] };
          }

          next = applyMove(next, voiceId, runtimeParam, action.target);

          // Patch the last snapshot with prevProvenance
          const lastIdx = next.undoStack.length - 1;
          const lastSnapshot = next.undoStack[lastIdx];
          if (lastSnapshot && lastSnapshot.kind === 'param') {
            const patched = { ...lastSnapshot, prevProvenance };
            next = { ...next, undoStack: [...next.undoStack.slice(0, lastIdx), patched] };
          }

          // Update provenance
          const afterVoice = getVoice(next, voiceId);
          const afterVal = afterVoice.params[runtimeParam] ?? 0;
          if (afterVoice.controlProvenance) {
            next = updateVoice(next, voiceId, {
              controlProvenance: {
                ...afterVoice.controlProvenance,
                [controlId]: { value: afterVal, source: 'ai', updatedAt: Date.now() },
              },
            });
          }

          log.push({ voiceId, voiceLabel: vLabel, description: `${controlId} ${beforeVal.toFixed(2)} → ${afterVal.toFixed(2)}`, diff: { kind: 'param-change', controlId, from: beforeVal, to: afterVal } });
          resolvedParams.set(accepted.length, runtimeParam);
          accepted.push(action);
        }
        break;
      }

      case 'sketch': {
        const voice = getVoice(next, action.voiceId);
        const eventsBefore = voice.regions[0]?.events?.length ?? 0;
        let eventsAfter = eventsBefore;

        if (action.events) {
          // Canonical sketch: write events to region first (source of truth),
          // then project to pattern (derived cache).
          const prevEvents = voice.regions[0]?.events ?? [];
          const prevDuration = voice.regions[0]?.duration;

          // Build updated region with new events
          const updatedRegion = normalizeRegionEvents({
            ...voice.regions[0],
            events: action.events,
          });

          // Enforce region invariants on the canonical write path
          const validation = validateRegion(updatedRegion);
          if (!validation.valid) {
            rejected.push({ op: action, reason: `Invalid region: ${validation.errors.join('; ')}` });
            break;
          }

          const newRegions = [updatedRegion, ...voice.regions.slice(1)];

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
            voiceId: action.voiceId,
            prevEvents: [...prevEvents],
            prevDuration: prevDuration !== updatedRegion.duration ? prevDuration : undefined,
            timestamp: Date.now(),
            description: action.description,
          };

          next = {
            ...updateVoice(next, action.voiceId, { regions: newRegions, pattern }),
            undoStack: [...next.undoStack, snapshot],
          };
          eventsAfter = updatedRegion.events.length;
        } else if (action.pattern) {
          // Legacy sketch: pass through directly (writes only to pattern, not regions)
          next = applySketch(next, action.voiceId, action.description, action.pattern);
          eventsAfter = action.pattern.steps?.filter(s => s.on).length ?? eventsBefore;
        } else {
          rejected.push({ op: action, reason: 'Sketch has neither events nor pattern' });
          break;
        }

        const vLabel = getVoiceLabel(getVoice(next, action.voiceId)).toUpperCase();
        log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `pattern: ${action.description}`, diff: { kind: 'pattern-change', eventsBefore, eventsAfter, description: action.description } });
        accepted.push(action);
        break;
      }

      case 'set_transport': {
        const prev = next.transport;
        const newTransport = { ...prev };
        if (action.bpm !== undefined) newTransport.bpm = Math.max(60, Math.min(200, action.bpm));
        if (action.swing !== undefined) newTransport.swing = Math.max(0, Math.min(1, action.swing));
        if (action.playing !== undefined) newTransport.playing = action.playing;

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
          transportDiff = { kind: 'transport-change', field: 'playing', from: prev.playing ? 'playing' : 'stopped', to: newTransport.playing ? 'playing' : 'stopped' };
        }
        log.push({ voiceId: '', voiceLabel: 'TRANSPORT', description: snapshot.description, diff: transportDiff });
        accepted.push(action);
        break;
      }

      case 'set_model': {
        const voice = getVoice(next, action.voiceId);
        const vLabel = getVoiceLabel(getVoice(next, action.voiceId)).toUpperCase();

        // Modulator path: switch modulator mode
        if (action.modulatorId) {
          const modulators = voice.modulators ?? [];
          const modIndex = modulators.findIndex(m => m.id === action.modulatorId);
          const mod = modulators[modIndex];
          const result = getModulatorEngineByName(mod.type, action.model)!;

          const snapshot: ModulatorStateSnapshot = {
            kind: 'modulator-state',
            voiceId: action.voiceId,
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
            ...updateVoice(next, action.voiceId, { modulators: newModulators }),
            undoStack: [...next.undoStack, snapshot],
          };

          log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `${mod.type} mode → ${result.engine.label}`, diff: { kind: 'model-change', from: mod.type, to: result.engine.label } });
          accepted.push(action);
          break;
        }

        // Processor path: switch processor mode
        if (action.processorId) {
          const processors = voice.processors ?? [];
          const procIndex = processors.findIndex(p => p.id === action.processorId);
          const proc = processors[procIndex];
          const result = getProcessorEngineByName(proc.type, action.model)!;

          const snapshot: ProcessorStateSnapshot = {
            kind: 'processor-state',
            voiceId: action.voiceId,
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
            ...updateVoice(next, action.voiceId, { processors: newProcessors }),
            undoStack: [...next.undoStack, snapshot],
          };

          log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `${proc.type} mode → ${result.engine.label}`, diff: { kind: 'model-change', from: proc.type, to: result.engine.label } });
          accepted.push(action);
          break;
        }

        // Source path: switch voice synthesis engine
        const engineIndex = plaitsInstrument.engines.findIndex(e => e.id === action.model);
        const engineDef = plaitsInstrument.engines[engineIndex];
        const prevModel = voice.model;
        const prevEngine = voice.engine;

        // Derive engine name the same way as session.ts:setModel
        const engineName = `plaits:${engineDef.label.toLowerCase().replace(/[\s/]+/g, '_')}`;

        const snapshot: ModelSnapshot = {
          kind: 'model',
          voiceId: action.voiceId,
          prevModel,
          prevEngine,
          timestamp: Date.now(),
          description: `AI model: ${plaitsInstrument.engines[prevModel]?.label ?? prevModel} → ${engineDef.label}`,
        };

        next = {
          ...updateVoice(next, action.voiceId, { model: engineIndex, engine: engineName }),
          undoStack: [...next.undoStack, snapshot],
        };

        log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `model → ${engineDef.label}`, diff: { kind: 'model-change', from: plaitsInstrument.engines[prevModel]?.label ?? String(prevModel), to: engineDef.label } });
        accepted.push(action);
        break;
      }

      case 'transform': {
        const voice = getVoice(next, action.voiceId);
        const region = voice.regions[0];
        if (!region) {
          rejected.push({ op: action, reason: 'No region on voice' });
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

        const newRegions = [updatedRegion, ...voice.regions.slice(1)];

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
          voiceId: action.voiceId,
          prevEvents,
          prevDuration: prevDuration !== newDuration ? prevDuration : undefined,
          timestamp: Date.now(),
          description: action.description,
        };

        next = {
          ...updateVoice(next, action.voiceId, { regions: newRegions, pattern }),
          undoStack: [...next.undoStack, snapshot],
        };

        const vLabel = getVoiceLabel(getVoice(next, action.voiceId)).toUpperCase();
        log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `transform ${action.operation}: ${action.description}`, diff: { kind: 'transform', operation: action.operation, description: action.description } });
        accepted.push(action);
        break;
      }

      case 'add_view': {
        const voice = getVoice(next, action.voiceId);
        const prevViews = [...(voice.views ?? [])];
        const newView = { kind: action.viewKind, id: `${action.viewKind}-ai-${Date.now()}` };
        const snapshot: ViewSnapshot = {
          kind: 'view',
          voiceId: action.voiceId,
          prevViews,
          timestamp: Date.now(),
          description: action.description,
        };
        next = {
          ...updateVoice(next, action.voiceId, { views: [...prevViews, newView] }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getVoiceLabel(getVoice(next, action.voiceId)).toUpperCase();
        log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `added ${action.viewKind} view` });
        accepted.push(action);
        break;
      }

      case 'remove_view': {
        const voice = getVoice(next, action.voiceId);
        const prevViews = [...(voice.views ?? [])];
        const filtered = prevViews.filter(v => v.id !== action.viewId);
        if (filtered.length === prevViews.length) {
          rejected.push({ op: action, reason: `View not found: ${action.viewId}` });
          break;
        }
        const snapshot: ViewSnapshot = {
          kind: 'view',
          voiceId: action.voiceId,
          prevViews,
          timestamp: Date.now(),
          description: action.description,
        };
        next = {
          ...updateVoice(next, action.voiceId, { views: filtered }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getVoiceLabel(getVoice(next, action.voiceId)).toUpperCase();
        log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `removed view ${action.viewId}` });
        accepted.push(action);
        break;
      }

      case 'add_processor': {
        const voice = getVoice(next, action.voiceId);
        const prevProcessors = [...(voice.processors ?? [])];
        const newProcessor: ProcessorConfig = {
          id: action.processorId,
          type: action.moduleType as ProcessorConfig['type'],
          model: 0,
          params: {},
        };
        const snapshot: ProcessorSnapshot = {
          kind: 'processor',
          voiceId: action.voiceId,
          prevProcessors,
          timestamp: Date.now(),
          description: action.description,
        };
        next = {
          ...updateVoice(next, action.voiceId, { processors: [...prevProcessors, newProcessor] }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getVoiceLabel(getVoice(next, action.voiceId)).toUpperCase();
        log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `added ${action.moduleType} processor (${action.processorId})`, diff: { kind: 'processor-add', processorType: action.moduleType } });
        accepted.push(action);
        break;
      }

      case 'remove_processor': {
        const voice = getVoice(next, action.voiceId);
        const prevProcessors = [...(voice.processors ?? [])];
        const prevModulations = [...(voice.modulations ?? [])];
        const filteredModulations = prevModulations.filter(
          route => route.target.kind !== 'processor' || route.target.processorId !== action.processorId,
        );
        const processorSnapshot: ProcessorSnapshot = {
          kind: 'processor',
          voiceId: action.voiceId,
          prevProcessors,
          timestamp: Date.now(),
          description: action.description,
        };
        const filtered = prevProcessors.filter(p => p.id !== action.processorId);
        const snapshots: (ProcessorSnapshot | ModulationRoutingSnapshot)[] = [processorSnapshot];
        if (filteredModulations.length !== prevModulations.length) {
          snapshots.push({
            kind: 'modulation-routing',
            voiceId: action.voiceId,
            prevModulations,
            timestamp: Date.now(),
            description: `${action.description} (clear dependent modulation routes)`,
          });
        }
        next = {
          ...updateVoice(next, action.voiceId, { processors: filtered, modulations: filteredModulations }),
          undoStack: [...next.undoStack, snapshots.length === 1 ? snapshots[0] : {
            kind: 'group',
            snapshots,
            timestamp: Date.now(),
            description: action.description,
          }],
        };
        const vLabel = getVoiceLabel(getVoice(next, action.voiceId)).toUpperCase();
        const removedProc = prevProcessors.find(p => p.id === action.processorId);
        log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `removed processor ${action.processorId}`, diff: { kind: 'processor-remove', processorType: removedProc?.type ?? action.processorId } });
        accepted.push(action);
        break;
      }

      case 'replace_processor': {
        const voice = getVoice(next, action.voiceId);
        const prevProcessors = [...(voice.processors ?? [])];
        const prevModulations = [...(voice.modulations ?? [])];
        const idx = prevProcessors.findIndex(p => p.id === action.processorId);
        if (idx === -1) break; // Should not happen after prevalidation
        const processorSnapshot: ProcessorSnapshot = {
          kind: 'processor',
          voiceId: action.voiceId,
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
            voiceId: action.voiceId,
            prevModulations,
            timestamp: Date.now(),
            description: `${action.description} (clear dependent modulation routes)`,
          });
        }
        next = {
          ...updateVoice(next, action.voiceId, { processors: newProcessors, modulations: filteredModulations }),
          undoStack: [...next.undoStack, snapshots.length === 1 ? snapshots[0] : {
            kind: 'group',
            snapshots,
            timestamp: Date.now(),
            description: action.description,
          }],
        };
        const vLabel = getVoiceLabel(getVoice(next, action.voiceId)).toUpperCase();
        log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `replaced ${prevProcessors[idx].type} with ${action.newModuleType}`, diff: { kind: 'processor-replace', fromType: prevProcessors[idx].type, toType: action.newModuleType } });
        accepted.push(action);
        break;
      }

      case 'add_modulator': {
        const voice = getVoice(next, action.voiceId);
        const prevModulators = [...(voice.modulators ?? [])];
        const prevModulations = [...(voice.modulations ?? [])];
        const newModulator: ModulatorConfig = {
          id: action.modulatorId,
          type: action.moduleType,
          model: 1, // default to Looping mode
          params: {},
        };
        const snapshot: ModulatorSnapshot = {
          kind: 'modulator',
          voiceId: action.voiceId,
          prevModulators,
          prevModulations,
          timestamp: Date.now(),
          description: action.description,
        };
        next = {
          ...updateVoice(next, action.voiceId, { modulators: [...prevModulators, newModulator] }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getVoiceLabel(getVoice(next, action.voiceId)).toUpperCase();
        log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `added ${action.moduleType} modulator (${action.modulatorId})`, diff: { kind: 'modulator-add', modulatorType: action.moduleType } });
        accepted.push(action);
        break;
      }

      case 'remove_modulator': {
        const voice = getVoice(next, action.voiceId);
        const prevModulators = [...(voice.modulators ?? [])];
        const prevModulations = [...(voice.modulations ?? [])];
        const snapshot: ModulatorSnapshot = {
          kind: 'modulator',
          voiceId: action.voiceId,
          prevModulators,
          prevModulations,
          timestamp: Date.now(),
          description: action.description,
        };
        // Cascade: remove modulator and all associated routings
        const filteredModulators = prevModulators.filter(m => m.id !== action.modulatorId);
        const filteredModulations = prevModulations.filter(r => r.modulatorId !== action.modulatorId);
        next = {
          ...updateVoice(next, action.voiceId, { modulators: filteredModulators, modulations: filteredModulations }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getVoiceLabel(getVoice(next, action.voiceId)).toUpperCase();
        const removedMod = prevModulators.find(m => m.id === action.modulatorId);
        log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `removed modulator ${action.modulatorId}`, diff: { kind: 'modulator-remove', modulatorType: removedMod?.type ?? action.modulatorId } });
        accepted.push(action);
        break;
      }

      case 'connect_modulator': {
        const voice = getVoice(next, action.voiceId);
        const prevModulations = [...(voice.modulations ?? [])];
        const snapshot: ModulationRoutingSnapshot = {
          kind: 'modulation-routing',
          voiceId: action.voiceId,
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
          ...updateVoice(next, action.voiceId, { modulations: newModulations }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getVoiceLabel(getVoice(next, action.voiceId)).toUpperCase();
        const targetStr = action.target.kind === 'source' ? `source:${action.target.param}` : `${action.target.processorId}:${action.target.param}`;
        log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `${existingIdx >= 0 ? 'updated' : 'connected'} modulation → ${targetStr} (${action.depth.toFixed(2)})`, diff: { kind: 'modulation-connect', modulatorId: action.modulatorId, target: targetStr, depth: action.depth } });
        accepted.push(action);
        break;
      }

      case 'disconnect_modulator': {
        const voice = getVoice(next, action.voiceId);
        const prevModulations = [...(voice.modulations ?? [])];
        const snapshot: ModulationRoutingSnapshot = {
          kind: 'modulation-routing',
          voiceId: action.voiceId,
          prevModulations,
          timestamp: Date.now(),
          description: action.description,
        };
        const filteredModulations = prevModulations.filter(r => r.id !== action.modulationId);
        next = {
          ...updateVoice(next, action.voiceId, { modulations: filteredModulations }),
          undoStack: [...next.undoStack, snapshot],
        };
        const vLabel = getVoiceLabel(getVoice(next, action.voiceId)).toUpperCase();
        const disconnectedRoute = prevModulations.find(r => r.id === action.modulationId);
        const disconnectTargetStr = disconnectedRoute
          ? (disconnectedRoute.target.kind === 'source' ? `source:${disconnectedRoute.target.param}` : `${disconnectedRoute.target.processorId}:${disconnectedRoute.target.param}`)
          : action.modulationId;
        log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `disconnected modulation ${action.modulationId}`, diff: { kind: 'modulation-disconnect', target: disconnectTargetStr } });
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
    const voiceCount = new Set(log.map(e => e.voiceId)).size;
    const undoDesc = sayText || `AI: ${log.length} changes across ${voiceCount} voice${voiceCount !== 1 ? 's' : ''}`;
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
      }],
    };
  }

  return { session: next, accepted, rejected, log, resolvedParams };
}
