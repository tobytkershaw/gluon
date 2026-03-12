// src/engine/operation-executor.ts
import type { Session, AIAction, ActionGroupSnapshot, Voice, TransportSnapshot, ModelSnapshot } from './types';
import type { ControlState, SourceAdapter, ExecutionReportLogEntry } from './canonical-types';
import type { Arbitrator } from './arbitration';
import { getVoice, updateVoice } from './types';
import { applyMove, applySketch } from './primitives';
import { eventsToSteps } from './event-conversion';
import { VOICE_LABELS } from './voice-labels';
import { getEngineById, plaitsInstrument } from '../audio/instrument-registry';

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

      const resolved = resolveMoveParam(action.param, adapter);
      if (!resolved) return `Unknown control: ${action.param}`;

      const validation = adapter.validateOperation(action);
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
      const engine = getEngineById(action.model);
      if (!engine) return `Unknown model: ${action.model}`;
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
        const resolved = resolveMoveParam(action.param, adapter)!;
        const { runtimeParam, controlId } = resolved;

        const vLabel = VOICE_LABELS[voiceId]?.toUpperCase() ?? voiceId;

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

          log.push({ voiceId, voiceLabel: vLabel, description: `${controlId} ${currentVal.toFixed(2)} → ${targetVal.toFixed(2)} (drift ${action.over}ms)` });
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

          log.push({ voiceId, voiceLabel: vLabel, description: `${controlId} ${beforeVal.toFixed(2)} → ${afterVal.toFixed(2)}` });
          resolvedParams.set(accepted.length, runtimeParam);
          accepted.push(action);
        }
        break;
      }

      case 'sketch': {
        const voice = getVoice(next, action.voiceId);

        if (action.events) {
          // Canonical sketch: convert MusicalEvent[] to PatternSketch via adapter
          const steps = eventsToSteps(action.events, voice.pattern.length, {
            midiToPitch: adapter.midiToNormalisedPitch.bind(adapter),
            canonicalToRuntime: (id) => {
              const binding = adapter.mapControl(id);
              const parts = binding.path.split('.');
              return parts[parts.length - 1];
            },
          });
          // Include ALL steps so ungated steps explicitly clear existing gates.
          // Without this, the sketch is additive and old gates persist.
          const sketch = {
            steps: steps.map((s, i) => ({ index: i, ...s })),
          };
          next = applySketch(next, action.voiceId, action.description, sketch);
        } else if (action.pattern) {
          // Legacy sketch: pass through directly
          next = applySketch(next, action.voiceId, action.description, action.pattern);
        } else {
          rejected.push({ op: action, reason: 'Sketch has neither events nor pattern' });
          break;
        }

        const vLabel = VOICE_LABELS[action.voiceId]?.toUpperCase() ?? action.voiceId;
        log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `pattern: ${action.description}` });
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

        log.push({ voiceId: '', voiceLabel: 'TRANSPORT', description: snapshot.description });
        accepted.push(action);
        break;
      }

      case 'set_model': {
        const voice = getVoice(next, action.voiceId);
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

        const vLabel = VOICE_LABELS[action.voiceId]?.toUpperCase() ?? action.voiceId;
        log.push({ voiceId: action.voiceId, voiceLabel: vLabel, description: `model → ${engineDef.label}` });
        accepted.push(action);
        break;
      }

      case 'say':
        sayTexts.push(action.text);
        accepted.push(action);
        break;
    }
  }

  // Collapse multiple snapshots into a single undo group
  const newSnapshots = next.undoStack.slice(undoBaseline);
  if (newSnapshots.length > 1) {
    const sayText = sayTexts.join(' ');
    const voiceCount = new Set(log.map(e => e.voiceId)).size;
    const undoDesc = sayText || `AI: ${log.length} changes across ${voiceCount} voice${voiceCount !== 1 ? 's' : ''}`;
    const group: ActionGroupSnapshot = {
      kind: 'group',
      snapshots: newSnapshots.filter((e): e is Exclude<typeof e, ActionGroupSnapshot> => e.kind !== 'group'),
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
