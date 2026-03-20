// src/ai/api.ts — Provider-agnostic orchestrator.

import type { Session, AIAction, AIMoveAction, AISketchAction, AITransportAction, AISetModelAction, AITransformAction, AIEditPatternAction, PatternEditOp, AIAddViewAction, AIRemoveViewAction, AIAddProcessorAction, AIRemoveProcessorAction, AIReplaceProcessorAction, AIBypassProcessorAction, AIAddModulatorAction, AIRemoveModulatorAction, AIConnectModulatorAction, AIDisconnectModulatorAction, AISetMasterAction, AISetMuteSoloAction, AISetTrackMixAction, AIManageSendAction, AIManagePatternAction, AIManageSequenceAction, AISetSurfaceAction, AIPinAction, AIUnpinAction, AILabelAxesAction, AISetImportanceAction, AIRaiseDecisionAction, AIMarkApprovedAction, AIReportBugAction, AIAddTrackAction, AIRemoveTrackAction, AIRenameTrackAction, AISetPortamentoAction, AISetTrackIdentityAction, AISetIntentAction, AISetSectionAction, AISetScaleAction, AISetChordProgressionAction, AIAssignSpectralSlotAction, AIManageMotifAction, AISetTensionAction, AIManageDrumPadAction, ApprovalLevel, PreservationReport, ProcessorConfig, ModulatorConfig, ModulationTarget, TrackSurface, Track, BugReport, BugCategory, BugSeverity, TrackKind, ChatMessage, SessionIntent, SectionMeta, ScaleConstraint, ScaleMode, UserSelection } from '../engine/types';
import { getTrack, getActivePattern, updateTrack, getTrackKind } from '../engine/types';
import type { MusicalEvent, NoteEvent, ParameterEvent, Pattern, TriggerEvent } from '../engine/canonical-types';
import { controlIdToRuntimeParam, plaitsInstrument, getProcessorEngineByName, getModulatorEngineByName, getModelName, getProcessorInstrument, getModulatorInstrument, getProcessorEngineName, getModulatorEngineName, getProcessorControlIds, getModulatorControlIds } from '../audio/instrument-registry';
import { getEngineById } from '../audio/instrument-registry-plaits';
import { validateChainMutation, validateModulatorMutation } from '../engine/chain-validation';
import { resolveTrackId, getTrackOrdinalLabel } from '../engine/track-labels';
import { normalizePatternEvents } from '../engine/region-helpers';
import { projectPatternToStepGrid } from '../engine/region-projection';
import { editPatternEvents } from '../engine/pattern-primitives';
import { generatePreservationReport, groupSnapshots } from '../engine/operation-executor';
import type { StepExecutionReport } from '../engine/operation-executor';
import { addTrack, removeTrack, addPatternRef, removePatternRef, reorderPatternRef, setSequenceAutomation, clearSequenceAutomation } from '../engine/session';
import { SCALE_MODES, scaleToString, scaleNoteNames } from '../engine/scale';
import { MotifLibrary } from '../engine/motif';
import type { Motif } from '../engine/motif';
import { applyDevelopmentOps } from '../engine/motif-development';
import type { DevelopmentOp } from '../engine/motif-development';
import { rotate, transpose, reverse, duplicate } from '../engine/transformations';
import { humanize as humanizeEvents } from '../engine/musical-helpers';
import { applyGroove, GROOVE_TEMPLATES } from '../engine/groove-templates';
import { generateArchetypeEvents, getArchetype, ARCHETYPE_NAMES } from '../engine/pattern-archetypes';
import { generateFromGenerator } from '../engine/pattern-generator';
import type { PatternGenerator, GeneratorBase, GeneratorLayer } from '../engine/pattern-generator';
import { applyDynamicShape } from '../engine/dynamic-shapes';
import { kitToEvents } from '../engine/drum-grid';
import { setTensionPoints, setTrackTensionMapping, createTensionCurve } from '../engine/tension-curve';
import { getArrangementArchetype, expandArchetype, ARRANGEMENT_ARCHETYPE_NAMES as ARRANGEMENT_NAMES } from '../engine/arrangement-archetypes';
import type { TensionPoint, TrackTensionMapping } from '../engine/tension-curve';
import { compressState } from './state-compression';
import type { CompressedAutoDiffSummary } from './state-compression';
import { buildSystemPrompt } from './system-prompt';
import { buildListenPromptWithLens, buildComparePrompt } from './listen-prompt';
import type { ListenLens } from './listen-prompt';
import { GLUON_TOOLS } from './tool-schemas';
import type { PlannerProvider, ListenerProvider, NeutralFunctionCall, FunctionResponse, StreamTextCallback, StepResult, OnStepCallback, StepExecutor, ModelStatus } from './types';
import { ProviderError } from './types';
import { extractOldestExchanges } from './context-summary';
import { createCircuitBreaker, recordStep, isBlocked, isRepeatedFailure, isRepeatedSuccess } from './circuit-breaker';
import type { StepOutcome } from './circuit-breaker';
import { analyzeSpectral, analyzeDynamics, analyzeRhythm, analyzeMasking, analyzeDiff, computeBandEnergies } from '../audio/audio-analysis';
import type { TrackAudio } from '../audio/audio-analysis';
import { getProfile, compareToProfile } from '../engine/reference-profiles';
import { getSnapshot, storeSnapshot, nextSnapshotId } from '../audio/snapshot-store';
import type { PcmRenderResult } from '../audio/render-offline';
import type { AudioMetricsSnapshot } from '../audio/live-audio-metrics';
import { parsePosition, resolveSketchPositions, resolveEditPatternPositions } from './bar-beat-sixteenth';
import { getChainRecipe, RECIPE_NAMES as CHAIN_RECIPE_NAMES } from '../engine/chain-recipes';
import { savePatch, findPatch, getAllPatches, listPatches, BUILT_IN_PATCHES } from '../engine/patch-library';
import type { Patch } from '../engine/patch-library';
import { getMixRole, ROLE_NAMES as MIX_ROLE_NAMES } from '../engine/mix-roles';
import { resolveModulationRecipe, MODULATION_RECIPE_NAMES } from '../engine/modulation-recipes';
import type { ModulationRecipeOverrides } from '../engine/modulation-recipes';
import { resolveTimbralMove, getProcessorTimbralVector } from '../engine/timbral-vocabulary';
import { SpectralSlotManager, FREQUENCY_BANDS } from '../engine/spectral-slots';
import type { FrequencyBand } from '../engine/spectral-slots';
import type { TimbralDirection } from '../engine/timbral-vocabulary';
import { RUBRIC_CRITERIA, parseRubricResponse } from './listen-rubric';
import { appendSpectralAdvisory } from './spectral-lint';
import { deriveMixWarnings } from './mix-warnings';
import { expandParamShapes, validateParamShapes } from '../engine/param-shapes';
import type { ParamShapes } from '../engine/param-shapes';
import { getChordToneNames, normalizeChordProgression } from '../engine/chords';
import { resolveRhythmicRelation, planContrastDirection, inferSpectralComplementBands } from '../engine/relational-ops';

/**
 * Infer spectral slot priority from a track's musicalRole string.
 * Returns a priority 0-10 based on keyword matching, or 5 (default) if
 * the role is absent or unrecognized.
 */
export function inferSpectralPriorityFromRole(role: string | undefined): number {
  if (!role) return 5;
  const lower = role.toLowerCase();

  // Bass/sub — acoustically needs highest frequency priority
  if (/\b(kick|bass|sub|low)\b/.test(lower)) return 9;
  // Lead/vocal — prominent melodic content
  if (/\b(lead|vocal|melody)\b/.test(lower)) return 7;
  // Rhythm/percussion — mid-high priority
  if (/\b(hat|snare|drum|percussion|rhythm)\b/.test(lower)) return 6;
  // Harmony/chords — moderate priority
  if (/\b(pad|chord|harmony)\b/.test(lower)) return 4;
  // Texture/ambient — lowest priority
  if (/\b(texture|ambient|noise|atmosphere|fx)\b/.test(lower)) return 2;

  return 5;
}

type PatternEventSelector = {
  bar?: number;
  type?: 'trigger' | 'note' | 'parameter';
  pitch?: number;
  pitchClass?: string;
  velocity?: 'max' | 'min';
  accent?: boolean;
  controlId?: string;
};

type RawPatternEditOp = Omit<PatternEditOp, 'step'> & {
  step?: number | string;
  select?: PatternEventSelector;
};

type RawSequenceAutomationPoint = {
  at: number | string;
  value: number;
  interpolation?: 'step' | 'linear' | 'curve';
  tension?: number;
};

const RETURN_BUS_WET_PARAM: Record<string, string> = {
  clouds: 'dry-wet',
  beads: 'dry-wet',
  chorus: 'mix',
  compressor: 'mix',
  distortion: 'mix',
};

const PITCH_CLASS_LOOKUP: Record<string, number> = {
  C: 0,
  'B#': 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  FB: 4,
  F: 5,
  'E#': 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
  CB: 11,
};

function parsePitchClass(value: string): number | null {
  const normalized = value.trim().toUpperCase().replace(/♯/g, '#').replace(/♭/g, 'B');
  return PITCH_CLASS_LOOKUP[normalized] ?? null;
}

function matchesEventSelector(event: MusicalEvent, selector: PatternEventSelector): boolean {
  if (selector.type && event.kind !== selector.type) return false;

  if (selector.bar !== undefined && Math.floor(event.at / STEPS_PER_BAR) + 1 !== selector.bar) {
    return false;
  }

  if (selector.pitch !== undefined) {
    if (event.kind !== 'note' || (event as NoteEvent).pitch !== selector.pitch) return false;
  }

  if (selector.pitchClass !== undefined) {
    const pitchClass = parsePitchClass(selector.pitchClass);
    if (pitchClass === null) {
      throw new Error(`Invalid pitchClass "${selector.pitchClass}". Use note names like C, D#, or Bb.`);
    }
    if (event.kind !== 'note' || ((event as NoteEvent).pitch % 12 + 12) % 12 !== pitchClass) return false;
  }

  if (selector.accent !== undefined) {
    if (event.kind !== 'trigger' || Boolean((event as TriggerEvent).accent) !== selector.accent) return false;
  }

  if (selector.controlId !== undefined) {
    if (event.kind !== 'parameter' || (event as ParameterEvent).controlId !== selector.controlId) return false;
  }

  return true;
}

function applyVelocitySelector(events: MusicalEvent[], selector: PatternEventSelector): MusicalEvent[] {
  if (selector.velocity === undefined) return events;
  const velocityEvents = events.filter(
    event => (event.kind === 'trigger' || event.kind === 'note') && (event.velocity ?? 0) !== 0,
  ) as Array<TriggerEvent | NoteEvent>;
  if (velocityEvents.length === 0) {
    throw new Error('velocity selector only applies to trigger or note events.');
  }
  const values = velocityEvents.map(event => event.velocity ?? 0);
  const targetVelocity = selector.velocity === 'max'
    ? Math.max(...values)
    : Math.min(...values);
  return velocityEvents.filter(event => Math.abs((event.velocity ?? 0) - targetVelocity) < 0.0001);
}

function resolvePatternEventSelector(
  pattern: Pattern,
  selector: PatternEventSelector,
): { step: number; match?: PatternEditOp['match'] } {
  let matches = pattern.events.filter(event => matchesEventSelector(event, selector));
  matches = applyVelocitySelector(matches, selector);

  if (matches.length === 0) {
    throw new Error('Selector did not match any existing events in the target pattern.');
  }
  if (matches.length > 1) {
    throw new Error('Selector matched multiple events. Add more properties so it resolves to exactly one event.');
  }

  const event = matches[0];
  if (event.kind === 'note') {
    return { step: event.at, match: { type: 'note', pitch: event.pitch } };
  }
  if (event.kind === 'trigger') {
    return { step: event.at, match: { type: 'trigger' } };
  }
  return { step: event.at };
}

function resolvePatternEditOperations(
  session: Session,
  trackId: string,
  patternId: string | undefined,
  operations: RawPatternEditOp[],
): PatternEditOp[] {
  let projectedSession = session;

  return operations.map((op, index) => {
    const track = projectedSession.tracks.find(candidate => candidate.id === trackId);
    if (!track) {
      throw new Error(`Track not found: ${trackId}`);
    }
    const pattern = patternId
      ? track.patterns.find(candidate => candidate.id === patternId)
      : (track.patterns.length > 0 ? getActivePattern(track) : undefined);
    if (!pattern) {
      throw new Error(patternId ? `Pattern not found: ${patternId}` : `Track ${trackId} has no editable pattern.`);
    }

    const hasStep = op.step !== undefined;
    const hasSelector = op.select !== undefined;

    if (op.action === 'add' && !hasStep) {
      throw new Error(`operations[${index}]: add requires step`);
    }
    if (hasStep && hasSelector) {
      throw new Error(`operations[${index}]: provide either step or select, not both`);
    }
    if (!hasStep && !hasSelector) {
      throw new Error(`operations[${index}]: remove/modify require step or select`);
    }
    if (hasSelector && op.action === 'add') {
      throw new Error(`operations[${index}]: add does not support select`);
    }

    const resolved = hasSelector
      ? resolvePatternEventSelector(pattern, op.select as PatternEventSelector)
      : { step: op.step as number, match: op.match };

    const resolvedOp = {
      ...op,
      step: resolved.step,
      ...(resolved.match ? { match: resolved.match } : {}),
    } as PatternEditOp;

    projectedSession = editPatternEvents(projectedSession, trackId, patternId, [resolvedOp], '');

    return resolvedOp;
  });
}

/**
 * Lightweight projection of an action onto session state.
 * No undo entries or messages — just updates the values so later
 * tool calls in the same turn can validate against current state.
 */
/** @visibleForTesting — exported for unit tests only. */
export function projectAction(session: Session, action: AIAction): Session {
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
        if (!Number.isFinite(rawTarget)) return session; // reject non-finite (#892)
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
        if (!Number.isFinite(rawTarget)) return session; // reject non-finite (#892)
        const value = Math.max(0, Math.min(1, rawTarget));
        const updatedProc = { ...proc, params: { ...proc.params, [action.param]: value } };
        const newProcessors = [...processors];
        newProcessors[procIndex] = updatedProc;
        return updateTrack(session, trackId, { processors: newProcessors });
      }

      // Drum rack per-pad param path: "padId.param"
      if (action.param.includes('.') && track.engine === 'drum-rack' && track.drumRack) {
        const dotIdx = action.param.indexOf('.');
        const padId = action.param.slice(0, dotIdx);
        const padParam = action.param.slice(dotIdx + 1);
        const pad = track.drumRack.pads.find(p => p.id === padId);
        if (!pad) return session;
        const currentVal = padParam === 'level' ? pad.level : padParam === 'pan' ? pad.pan : pad.source.params[padParam] ?? 0;
        const rawTarget = 'absolute' in action.target
          ? action.target.absolute
          : currentVal + action.target.relative;
        if (!Number.isFinite(rawTarget)) return session;
        const value = Math.max(0, Math.min(1, rawTarget));
        const newPads = track.drumRack.pads.map(p => {
          if (p.id !== padId) return p;
          if (padParam === 'level') return { ...p, level: value };
          if (padParam === 'pan') return { ...p, pan: value };
          return { ...p, source: { ...p.source, params: { ...p.source.params, [padParam]: value } } };
        });
        return updateTrack(session, trackId, { drumRack: { ...track.drumRack, pads: newPads } });
      }

      // Source path
      const runtimeKey = controlIdToRuntimeParam[action.param] ?? action.param;
      const currentVal = track.params[runtimeKey] ?? 0;
      const rawTarget = 'absolute' in action.target
        ? action.target.absolute
        : currentVal + action.target.relative;
      if (!Number.isFinite(rawTarget)) return session; // reject non-finite (#892)
      const value = Math.max(0, Math.min(1, rawTarget));
      return updateTrack(session, trackId, {
        params: { ...track.params, [runtimeKey]: value },
      });
    }
    case 'set_transport': {
      const t = { ...session.transport };
      if (action.bpm !== undefined) {
        if (!Number.isFinite(action.bpm)) return session; // reject non-finite (#892)
        t.bpm = Math.max(20, Math.min(300, action.bpm));
      }
      if (action.swing !== undefined) {
        if (!Number.isFinite(action.swing)) return session; // reject non-finite (#892)
        t.swing = Math.max(0, Math.min(1, action.swing));
      }
      if (action.mode !== undefined) t.mode = action.mode;
      if (action.playing !== undefined) t.status = action.playing ? 'playing' : 'stopped';
      return { ...session, transport: t };
    }
    case 'sketch': {
      const track = getTrack(session, action.trackId);
      if ((!action.events && !action.kit) || track.patterns.length === 0) return session;
      const activeReg = getActivePattern(track);

      // Resolve events: from kit grid strings or direct events
      let sketchEvents: MusicalEvent[] | undefined;
      if (action.kit && track.engine === 'drum-rack' && track.drumRack) {
        // Kit sketch: convert grid strings to events, merge with existing
        const kitEvents = kitToEvents(action.kit) as MusicalEvent[];
        const mentionedPadIds = new Set(Object.keys(action.kit));
        const keptEvents = activeReg.events.filter(e =>
          e.kind !== 'trigger' || !('padId' in e) || !mentionedPadIds.has((e as { padId?: string }).padId ?? ''),
        );
        sketchEvents = [...keptEvents, ...kitEvents];
      } else {
        sketchEvents = action.events;
      }

      // Apply groove template (before humanize)
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

      // Drum rack pad path: switch a pad's Plaits model
      if (action.pad) {
        const track = getTrack(session, action.trackId);
        if (!track.drumRack) return session;
        const pad = track.drumRack.pads.find(p => p.id === action.pad);
        if (!pad) return session;
        const engineIndex = plaitsInstrument.engines.findIndex(e => e.id === action.model);
        if (engineIndex < 0) return session;
        const defaultParams: Record<string, number> = {};
        for (const ctrl of plaitsInstrument.engines[engineIndex].controls) {
          defaultParams[ctrl.id] = ctrl.range?.default ?? 0.5;
        }
        const newPads = track.drumRack.pads.map(p =>
          p.id === action.pad ? { ...p, source: { ...p.source, model: engineIndex, params: defaultParams } } : p,
        );
        return updateTrack(session, action.trackId, { drumRack: { ...track.drumRack, pads: newPads } });
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
        modules: action.modules,
      };
      return updateTrack(session, action.trackId, { surface: newSurface });
    }
    case 'pin': {
      const track = getTrack(session, action.trackId);
      const pinModule: SurfaceModule = {
        type: 'knob-group',
        id: `pinned-${action.moduleId}-${action.controlId}`,
        label: action.controlId,
        bindings: [{ role: 'control', trackId: action.trackId, target: action.controlId }],
        position: { x: 0, y: 0, w: 2, h: 2 },
        config: { pinned: true, moduleId: action.moduleId },
      };
      const modules = [...track.surface.modules, pinModule];
      return updateTrack(session, action.trackId, { surface: { ...track.surface, modules } });
    }
    case 'unpin': {
      const track = getTrack(session, action.trackId);
      const pinId = `pinned-${action.moduleId}-${action.controlId}`;
      const modules = track.surface.modules.filter(m => m.id !== pinId);
      return updateTrack(session, action.trackId, { surface: { ...track.surface, modules } });
    }
    case 'label_axes': {
      // Label axes updates the xy-pad module bindings — no-op if no xy-pad exists
      // (mirrors prevalidateAction which rejects label_axes without an xy-pad)
      const track = getTrack(session, action.trackId);
      const hasXYPad = track.surface.modules.some(m => m.type === 'xy-pad');
      if (!hasXYPad) return session;
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
      return updateTrack(session, action.trackId, { surface: { ...track.surface, modules } });
    }
    case 'set_importance': {
      if (!Number.isFinite(action.importance)) return session; // reject non-finite (#892)
      const clamped = Math.max(0, Math.min(1, action.importance));
      return updateTrack(session, action.trackId, {
        importance: clamped,
        ...(action.musicalRole ? { musicalRole: action.musicalRole } : {}),
      });
    }
    case 'set_track_identity': {
      const idTrack = session.tracks.find(t => t.id === action.trackId);
      if (!idTrack) return session;
      const existing = idTrack.visualIdentity ?? { colour: { hue: 0, saturation: 0.6, brightness: 0.7 }, weight: 0.5, edgeStyle: 'crisp' as const, prominence: 0.5 };
      const merged = {
        colour: {
          hue: Math.min(360, Math.max(0, action.identity.colour?.hue ?? existing.colour.hue)),
          saturation: Math.min(1, Math.max(0, action.identity.colour?.saturation ?? existing.colour.saturation)),
          brightness: Math.min(1, Math.max(0, action.identity.colour?.brightness ?? existing.colour.brightness)),
        },
        weight: Math.min(1, Math.max(0, action.identity.weight ?? existing.weight)),
        edgeStyle: action.identity.edgeStyle ?? existing.edgeStyle,
        prominence: Math.min(1, Math.max(0, action.identity.prominence ?? existing.prominence)),
      };
      return updateTrack(session, action.trackId, { visualIdentity: merged });
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
    case 'set_sidechain': {
      const targetTrack = session.tracks.find(t => t.id === action.targetTrackId);
      if (!targetTrack) return session;
      const processors = (targetTrack.processors ?? []).map(p => {
        if (action.processorId && p.id !== action.processorId) return p;
        if (!action.processorId && p.type !== 'compressor') return p;
        return { ...p, sidechainSourceId: action.sourceTrackId ?? undefined };
      });
      return updateTrack(session, action.targetTrackId, { processors });
    }
    case 'manage_pattern':
    case 'manage_sequence':
      // These are complex operations executed by session.ts helpers at execution time.
      // For projection purposes, return session unchanged — the state will be fully
      // updated during executeOperations.
      return session;
    case 'set_track_mix': {
      const update: Partial<Track> = {};
      if (action.volume !== undefined) {
        if (!Number.isFinite(action.volume)) return session; // reject non-finite (#892)
        update.volume = Math.max(0, Math.min(1, action.volume));
      }
      if (action.pan !== undefined) {
        if (!Number.isFinite(action.pan)) return session; // reject non-finite (#892)
        update.pan = Math.max(-1, Math.min(1, action.pan));
      }
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
    case 'set_chord_progression':
      return {
        ...session,
        chordProgression: action.chordProgression ? normalizeChordProgression(action.chordProgression) : action.chordProgression,
      };
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
    case 'manage_drum_pad': {
      const track = getTrack(session, action.trackId);
      const pads = [...(track.drumRack?.pads ?? [])];
      switch (action.action) {
        case 'add': {
          const engineIndex = plaitsInstrument.engines.findIndex(e => e.id === action.model);
          const defaultParams: Record<string, number> = {};
          if (engineIndex >= 0) {
            for (const ctrl of plaitsInstrument.engines[engineIndex].controls) {
              defaultParams[ctrl.id] = ctrl.range?.default ?? 0.5;
            }
          }
          const newPad: DrumPad = {
            id: action.padId,
            name: action.name ?? action.padId,
            source: { engine: 'plaits', model: engineIndex >= 0 ? engineIndex : 0, params: defaultParams },
            level: 0.8,
            pan: 0.5,
          };
          if (action.chokeGroup != null) newPad.chokeGroup = action.chokeGroup as number;
          pads.push(newPad);
          break;
        }
        case 'remove':
          return updateTrack(session, action.trackId, {
            drumRack: { ...(track.drumRack ?? { pads: [] }), pads: pads.filter(p => p.id !== action.padId) },
          });
        case 'rename':
          return updateTrack(session, action.trackId, {
            drumRack: { ...(track.drumRack ?? { pads: [] }), pads: pads.map(p => p.id === action.padId ? { ...p, name: action.name! } : p) },
          });
        case 'set_choke_group':
          return updateTrack(session, action.trackId, {
            drumRack: {
              ...(track.drumRack ?? { pads: [] }),
              pads: pads.map(p => {
                if (p.id !== action.padId) return p;
                if (action.chokeGroup === null || action.chokeGroup === undefined) {
                  const { chokeGroup: _, ...rest } = p;
                  return rest as DrumPad;
                }
                return { ...p, chokeGroup: action.chokeGroup };
              }),
            },
          });
        default:
          return session;
      }
      return updateTrack(session, action.trackId, {
        drumRack: { ...(track.drumRack ?? { pads: [] }), pads },
      });
    }
    case 'say':
    default:
      return session;
  }
}

interface ResolvedMoveTarget {
  target: { absolute: number } | { relative: number };
  tempoSyncLabel?: string;
}

function isTempoSyncableRateControl(args: Record<string, unknown>, param: string, semanticRole?: string): boolean {
  if (typeof args.modulatorId === 'string' && args.modulatorId) {
    return param === 'frequency';
  }
  return semanticRole === 'movement_rate';
}

function parseMusicalDivision(value: string): number | null {
  const match = value.trim().match(/^(\d+)\/(\d+)([dt])?$/i);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  const modifier = match[3]?.toLowerCase();
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
    return null;
  }

  let beats = (4 * numerator) / denominator;
  if (modifier === 'd') beats *= 1.5;
  if (modifier === 't') beats *= 2 / 3;
  return beats;
}

function invertDisplayMapping(displayValue: number, mapping: { type: 'linear' | 'log'; min: number; max: number }): number {
  if (mapping.type === 'linear') {
    return (displayValue - mapping.min) / (mapping.max - mapping.min);
  }
  return Math.log(displayValue / mapping.min) / Math.log(mapping.max / mapping.min);
}

function resolveTempoSyncedMoveTarget(
  session: Session,
  args: Record<string, unknown>,
): ResolvedMoveTarget | { error: string } {
  const target = args.target as Record<string, unknown> | undefined;
  if (!target) return { error: 'Missing required parameter: target (needs absolute, relative, or value)' };
  if (typeof target.absolute === 'number') return { target: { absolute: target.absolute } };
  if (typeof target.relative === 'number') return { target: { relative: target.relative } };

  const semanticValue = typeof target.value === 'string' ? target.value : undefined;
  if (!semanticValue) {
    return { error: 'Missing required parameter: target (needs absolute, relative, or value)' };
  }

  const beats = parseMusicalDivision(semanticValue);
  if (beats == null) {
    return { error: `Invalid target.value "${semanticValue}". Use note divisions like "1/4", "1/8d", or "1/8t".` };
  }

  const trackId = (args.trackId as string) ?? session.activeTrackId;
  const track = session.tracks.find(v => v.id === trackId);
  if (!track) {
    return { error: trackNotFoundError(trackId, session).error as string };
  }

  const param = args.param as string;
  let mapping: { type: 'linear' | 'log'; min: number; max: number } | undefined;
  let targetLabel: string | undefined;

  if (typeof args.modulatorId === 'string' && args.modulatorId) {
    const mod = (track.modulators ?? []).find(m => m.id === args.modulatorId);
    if (!mod) return { error: `Modulator not found: ${args.modulatorId}` };
    const instrument = getModulatorInstrument(mod.type);
    const schema = instrument?.engines[mod.model]?.controls.find(c => c.id === param);
    if (
      schema?.displayMapping &&
      (schema.displayMapping.type === 'log' || schema.displayMapping.type === 'linear') &&
      schema.displayMapping.unit === 'Hz' &&
      isTempoSyncableRateControl(args, param, schema.semanticRole)
    ) {
      mapping = schema.displayMapping;
      targetLabel = `${mod.type}.${param}`;
    }
  } else if (typeof args.processorId === 'string' && args.processorId) {
    const proc = (track.processors ?? []).find(p => p.id === args.processorId);
    if (!proc) return { error: `Processor not found: ${args.processorId}` };
    const instrument = getProcessorInstrument(proc.type);
    const schema = instrument?.engines[proc.model]?.controls.find(c => c.id === param);
    if (
      schema?.displayMapping &&
      (schema.displayMapping.type === 'log' || schema.displayMapping.type === 'linear') &&
      schema.displayMapping.unit === 'Hz' &&
      isTempoSyncableRateControl(args, param, schema.semanticRole)
    ) {
      mapping = schema.displayMapping;
      targetLabel = `${proc.type}.${param}`;
    }
  }

  if (!mapping || !targetLabel) {
    return {
      error: `Tempo-synced target.value is currently supported only for Hz-mapped rate controls (for example modulator frequency or chorus/flanger/phaser rate), not for "${param}".`,
    };
  }

  const secondsPerBeat = 60 / session.transport.bpm;
  const hz = 1 / (beats * secondsPerBeat);
  const normalized = Math.max(0, Math.min(1, invertDisplayMapping(hz, mapping)));

  return {
    target: { absolute: normalized },
    tempoSyncLabel: semanticValue,
  };
}

/**
 * Generate events for a section based on density config.
 * Produces trigger events distributed across the pattern length.
 */
function generateDensityEvents(
  config: import('../engine/arrangement-archetypes').DensityConfig,
  lengthSteps: number,
  hasFill: boolean,
): MusicalEvent[] {
  const events: MusicalEvent[] = [];
  if (config.eventDensity === 0) return events;

  const totalSlots = lengthSteps;
  const targetCount = Math.max(1, Math.round(totalSlots * config.eventDensity));
  const spacing = Math.max(1, Math.floor(totalSlots / targetCount));

  for (let i = 0; i < targetCount; i++) {
    const at = i * spacing;
    if (at >= lengthSteps) break;
    // Slight velocity variation based on position
    const beatPhase = at % 16;
    const isDownbeat = beatPhase === 0;
    const isBackbeat = beatPhase === 8;
    let velocity = config.velocityBase;
    if (isDownbeat) velocity = Math.min(1.0, velocity + config.velocityRange);
    else if (isBackbeat) velocity = Math.min(1.0, velocity + config.velocityRange * 0.5);
    else velocity = Math.max(0.1, velocity - config.velocityRange * 0.5);

    events.push({
      kind: 'trigger',
      at,
      velocity,
      ...(isDownbeat ? { accent: true } : {}),
    } as TriggerEvent);
  }

  // Add fill events in the last bar if requested
  if (hasFill && lengthSteps >= 16) {
    const fillStart = lengthSteps - 16;
    // Add extra hits in the last bar for a fill
    const fillPositions = [fillStart + 10, fillStart + 11, fillStart + 13, fillStart + 14, fillStart + 15];
    for (const pos of fillPositions) {
      if (pos < lengthSteps && !events.some(e => Math.abs(e.at - pos) < 0.5)) {
        events.push({
          kind: 'trigger',
          at: pos,
          velocity: Math.min(1.0, config.velocityBase + config.velocityRange),
        } as TriggerEvent);
      }
    }
  }

  // Sort by position
  events.sort((a, b) => a.at - b.at);
  return events;
}

/** Build an error function response payload */
function errorPayload(message: string): Record<string, unknown> {
  return { error: message };
}

/** Build an enriched error with hint and/or available items for model recovery. */
function enrichedError(
  message: string,
  extras: { hint?: string; available?: string[] },
): Record<string, unknown> {
  return {
    error: message,
    ...(extras.hint ? { hint: extras.hint } : {}),
    ...(extras.available ? { available: extras.available } : {}),
  };
}

/** Return a compact listing of available tracks for error messages. */
function trackListing(session: Session): string[] {
  const audioTracks = session.tracks.filter(t => getTrackKind(t) !== 'bus');
  const busTracks = session.tracks.filter(t => getTrackKind(t) === 'bus');
  return session.tracks.map(t => {
    const label = getTrackOrdinalLabel(t, audioTracks, busTracks);
    return `${t.id} = ${label}`;
  });
}

/** Build a "track not found" error with available track listing. */
function trackNotFoundError(ref: string, session: Session): Record<string, unknown> {
  return enrichedError(
    `Unknown track: "${ref}". Use "Track N" (1-indexed) or an internal track ID.`,
    {
      hint: 'Check the track listing below and use the exact ID or ordinal.',
      available: trackListing(session),
    },
  );
}

const STEPS_PER_BAR = 16;

/**
 * Infer the number of bars to render from the active pattern durations of the
 * given tracks (or all tracks when no IDs are provided).  Falls back to 2 when
 * no track context is available.
 */
export function inferBarsFromPatterns(session: Session, trackIds?: string[]): number {
  const tracks = trackIds
    ? session.tracks.filter(t => trackIds.includes(t.id))
    : session.tracks;
  if (tracks.length === 0) return 2;
  let maxBars = 0;
  for (const track of tracks) {
    if (track.patterns.length === 0) continue;
    const pattern = getActivePattern(track);
    const bars = Math.max(1, Math.floor(pattern.duration / STEPS_PER_BAR));
    if (bars > maxBars) maxBars = bars;
  }
  return maxBars > 0 ? maxBars : 2;
}

/**
 * Handle a validation rejection. Returns null if there's no rejection.
 */
function handleRejection(
  rejection: string | null | undefined,
  session: Session,
  action: AIAction,
  _existingActions: AIAction[] = [],
): { actions: AIAction[]; response: Record<string, unknown> } | null {
  if (!rejection) return null;

  // Enrich common rejection patterns with recovery hints
  if (rejection.startsWith('Track not found')) {
    return { actions: [], response: enrichedError(rejection, {
      hint: 'Use "Track N" (1-indexed) or an internal track ID.',
      available: trackListing(session),
    }) };
  }
  if (rejection.startsWith('Unknown control')) {
    const trackId = 'trackId' in action ? (action as { trackId?: string }).trackId : undefined;
    const track = trackId ? session.tracks.find(t => t.id === trackId) : undefined;
    const extras: { hint: string; available?: string[] } = {
      hint: 'Check the parameter name against the track\'s source or processor controls.',
    };
    if (track) {
      const sourceParams = Object.keys(track.params);
      extras.available = sourceParams.length > 0 ? sourceParams : undefined;
    }
    return { actions: [], response: enrichedError(rejection, extras) };
  }
  if (rejection.includes('Arbitration')) {
    return { actions: [], response: enrichedError(rejection, {
      hint: 'The human is currently interacting with this control. Try a different parameter or wait.',
    }) };
  }

  return { actions: [], response: errorPayload(rejection) };
}

/**
 * Auto-diff verification: renders audio before and after an edit action,
 * runs analyzeDiff, and returns a summary to include in the tool result.
 * Returns undefined if rendering is unavailable or fails.
 */
async function runAutoDiffVerification(
  beforeSession: Session,
  afterSession: Session,
  trackId: string,
  ctx?: AskContext,
): Promise<{ verification: { summary: string; confidence: number } } | undefined> {
  const renderPcm = ctx?.listen?.renderOfflinePcm;
  if (!renderPcm) return undefined;

  try {
    const bars = inferBarsFromPatterns(beforeSession, [trackId]);
    const [beforeResult, afterResult] = await Promise.all([
      renderPcm(beforeSession, [trackId], bars),
      renderPcm(afterSession, [trackId], bars),
    ]);
    const bpm = beforeSession.transport.bpm;
    const diff = analyzeDiff(beforeResult.pcm, afterResult.pcm, afterResult.sampleRate, bpm);
    return {
      verification: {
        summary: diff.summary,
        confidence: diff.confidence,
      },
    };
  } catch {
    return undefined;
  }
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
 * Pre-validate an action against a session state.
 * Returns null if the action will be accepted, or a rejection reason string.
 * Accepts a session parameter so callers can validate against the correct
 * working session rather than a potentially stale snapshot.
 */
export type ActionValidator = (session: Session, action: AIAction) => string | null;

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
  /** Called after a step's actions have been executed against real session state.
   *  The log entries are authoritative — only accepted actions appear here.
   *  Log entries include ActionDiff data for rich rendering. */
  onActionsExecuted?: (report: {
    log: import('../engine/types').ActionLogEntry[];
    rejected: { op: AIAction; reason: string }[];
  }) => void;
  /** Current UI selection in the Tracker (if any). Included in compressed state so the AI knows what the human is pointing at. */
  userSelection?: UserSelection;
  /** Fresh live analyser metrics, if available. */
  audioMetrics?: AudioMetricsSnapshot;
  /** Called when the AI completes a listen event, so the UI can capture the audio for human playback. */
  onListenEvent?: (event: import('../engine/types').ListenEvent) => void;
}

function buildPlannerUserMessage(
  stateJson: string,
  humanMessage: string,
  contextPrefix: string | null,
  contextSummary: string | null,
): string {
  let contextBlock = '';
  if (contextPrefix) contextBlock += `${contextPrefix}\n\n`;
  if (contextSummary) contextBlock += `[Session memory — summarized from earlier conversation]\n${contextSummary}\n\n`;
  return `${contextBlock}Project state:\n${stateJson}\n\nHuman says: ${humanMessage}`;
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

  /** In-memory cache of user-saved patches (loaded from IndexedDB on first access). */
  private _userPatches: Patch[] = [];
  private _userPatchesLoaded = false;
  /** Avoid repeating token-count fallback warnings every turn. */
  private countTokensFallbackWarned = false;
  /** Automatic before/after summaries from the most recent accepted AI edit step. */
  private recentAutoDiffs: CompressedAutoDiffSummary[] = [];
  /** Summaries accumulated during the current turn for next-turn context. */
  private turnAutoDiffs: CompressedAutoDiffSummary[] = [];

  constructor(
    private planner: PlannerProvider,
    private listener: ListenerProvider,
    private listeners: ListenerProvider[] = [listener],
  ) {}

  /** Returns true when the planner model is configured (gates chat). */
  isPlannerConfigured(): boolean {
    return this.planner.isConfigured();
  }

  /** Returns true when at least one listener model is configured. */
  isListenerConfigured(): boolean {
    return this.listeners.some(l => l.isConfigured());
  }

  /**
   * Legacy check — returns true when planner is configured.
   * Chat requires a planner; listener is optional (degrades gracefully).
   */
  isConfigured(): boolean {
    return this.isPlannerConfigured();
  }

  /** Snapshot of current model layer status for UI display. */
  getModelStatus(): ModelStatus {
    const plannerOk = this.planner.isConfigured();
    const listenerOk = this.listeners.some(l => l.isConfigured());
    return {
      planner: plannerOk ? 'available' : 'disabled',
      listener: listenerOk ? 'available' : 'disabled',
    };
  }

  /**
   * Batch ask — backward-compatible wrapper around askStreaming.
   * Runs the step loop internally, collecting all actions without UI callbacks.
   * Uses projectAction for mid-turn state visibility (no real execution).
   */
  async ask(session: Session, humanMessage: string, ctx?: AskContext): Promise<AIAction[]> {
    // For backward compatibility, ask() uses projectAction instead of real
    // step execution. This preserves existing behavior for any callers that
    // don't provide a StepExecutor.
    let projectedSession = session;
    const projectionExecutor: StepExecutor = (sess, actions) => {
      // Project actions onto session without real undo/validation
      for (const action of actions) {
        projectedSession = projectAction(projectedSession, action);
      }
      return {
        session: projectedSession,
        accepted: actions,
        rejected: [],
        log: [],
        sayTexts: [],
        resolvedParams: new Map(),
        preservationReports: [],
      };
    };

    return this.askStreaming(session, humanMessage, ctx, projectionExecutor);
  }

  // ---------------------------------------------------------------------------
  // Step-based agentic execution (#945)
  // ---------------------------------------------------------------------------

  /** Max steps per user request in the streaming loop. */
  private static MAX_STREAMING_STEPS = 10;

  /**
   * Step-based agentic execution. Runs the tool-call loop with real state
   * updates between steps, circuit breaker protection, and optional UI
   * callbacks for incremental rendering.
   *
   * @param session      Initial session state
   * @param humanMessage The user's message
   * @param ctx          Ask context (listen, streaming, staleness callbacks)
   * @param executeActions  Executes actions against real session state
   * @param onStep       Optional callback for UI rendering after each step
   */
  async askStreaming(
    session: Session,
    humanMessage: string,
    ctx: AskContext | undefined,
    executeActions: StepExecutor,
    onStep?: OnStepCallback,
  ): Promise<AIAction[]> {
    this.turnAutoDiffs = [];
    const state = this.buildCompressedState(session, ctx, ctx?.userSelection);
    const stateJson = JSON.stringify(state);
    await this.trimToTokenBudget(session, humanMessage, stateJson, ctx);

    const systemPrompt = buildSystemPrompt(session);
    const contextPrefix = this.planner.consumeConversationContext?.() ?? null;
    // contextSummary is only populated by summarizeBeforeTrim, which is only
    // called from trimToTokenBudget when countContextTokens is available.
    // No risk of double-injection (full history + summary) because the summary
    // only exists after exchanges have been dropped.
    const contextSummary = this.planner.getContextSummary?.() ?? null;

    const userMessage = buildPlannerUserMessage(stateJson, humanMessage, contextPrefix, contextSummary);

    let workingSession = session;
    const allActions: AIAction[] = [];
    let hadVisibleOutput = false;
    let breaker = createCircuitBreaker();

    try {
      if (ctx?.isStale?.()) {
        this.planner.discardTurn();
        return [];
      }

      const onStreamText = ctx?.onStreamText;
      let stepCount = 0;
      let stepBaseline = workingSession.undoStack.length;

      // First step: startTurn
      let generateResult = await this.planner.startTurn({
        systemPrompt,
        userMessage,
        tools: GLUON_TOOLS,
        onStreamText,
      });

      while (stepCount < GluonAI.MAX_STREAMING_STEPS) {
        // Process this round: collect text, execute tool calls
        const roundResult = await this.processRound(generateResult, workingSession, ctx, breaker, allActions);

        // Track visible output
        if (roundResult.textParts.length > 0) hadVisibleOutput = true;
        allActions.push(...roundResult.actions);

        // Execute non-say actions against real session state
        const actionable = roundResult.actions.filter(a => a.type !== 'say');
        let execReport: StepExecutionReport | null = null;
        if (actionable.length > 0) {
          const beforeStepSession = workingSession;
          execReport = executeActions(workingSession, actionable);
          await this.captureRecentAutoDiffs(beforeStepSession, execReport.session, execReport.accepted, ctx);
          workingSession = execReport.session;
          if (execReport.accepted.length > 0 || execReport.log.length > 0) {
            hadVisibleOutput = true;
          }

          // Stream authoritative execution results to UI
          // Log entries have ActionDiff at runtime (added during execution) even
          // though ExecutionReportLogEntry doesn't declare it — cast to ActionLogEntry.
          ctx?.onActionsExecuted?.({
            log: execReport.log as import('../engine/types').ActionLogEntry[],
            rejected: execReport.rejected,
          });

          // Group this step's snapshots into one ActionGroupSnapshot
          const stepSayText = roundResult.textParts.join(' ');
          const stepDesc = stepSayText
            || (execReport.log.length > 0
              ? `Step ${stepCount + 1}: ${execReport.log.length} changes`
              : `Step ${stepCount + 1}`);
          workingSession = {
            ...workingSession,
            undoStack: groupSnapshots(workingSession.undoStack, stepBaseline, stepDesc),
          };
        }
        // Advance baseline (say-only steps produce no undo entries)
        stepBaseline = workingSession.undoStack.length;

        // Build immutable step payload and notify UI
        const stepResult: StepResult = {
          textParts: roundResult.textParts,
          actions: roundResult.actions,
          executionReport: execReport,
          functionResponses: roundResult.functionResponses,
          done: roundResult.done,
          truncated: roundResult.truncated,
          ...(roundResult.suggestedReactions ? { suggestedReactions: roundResult.suggestedReactions } : {}),
        };
        onStep?.(stepResult, workingSession);

        // Check stale AFTER applying — finalize-partial
        if (ctx?.isStale?.() || roundResult.done) break;

        // Circuit breaker: record step outcome and check
        const stepOutcome: StepOutcome = {
          calls: roundResult.callOutcomes,
        };
        breaker = recordStep(breaker, stepOutcome);
        const breakerCheck = isBlocked(breaker);
        if (breakerCheck.blocked) {
          const breakerAction: AIAction = { type: 'say', text: breakerCheck.reason! };
          allActions.push(breakerAction);
          hadVisibleOutput = true;
          // Emit a say-only step so the UI includes the explanation in the chat message
          onStep?.({
            textParts: [breakerCheck.reason!],
            actions: [breakerAction],
            executionReport: null,
            functionResponses: [],
            done: true,
            truncated: false,
          }, workingSession);
          break;
        }

        stepCount++;
        if (stepCount >= GluonAI.MAX_STREAMING_STEPS) break;

        // Check stale before making another API call — don't waste a round
        if (ctx?.isStale?.()) break;

        // Continue to next step
        generateResult = await this.planner.continueTurn({
          systemPrompt,
          tools: GLUON_TOOLS,
          functionResponses: roundResult.functionResponses,
          onStreamText,
        });
      }
    } catch (error) {
      const errorActions = this.handleError(error);
      allActions.push(...errorActions);
      // Emit a say-only step so the UI includes the error explanation in the chat message.
      // Don't set hadVisibleOutput — the error message is shown to the user via onStep,
      // but it doesn't mean provider history should be committed. Only steps that were
      // successfully processed count.
      const errorTexts = errorActions.filter(a => a.type === 'say').map(a => a.type === 'say' ? a.text : '');
      if (errorTexts.length > 0) {
        onStep?.({
          textParts: errorTexts,
          actions: errorActions,
          executionReport: null,
          functionResponses: [],
          done: true,
          truncated: false,
        }, workingSession);
      }
    }

    // Finalize provider history. Commit if any visible output was produced,
    // even if the turn ended with an error — the user saw partial work and
    // conversation continuity requires the provider to remember what happened.
    if (hadVisibleOutput) {
      this.planner.commitTurn();
    } else {
      this.planner.discardTurn();
    }
    this.recentAutoDiffs = this.turnAutoDiffs;

    return allActions;
  }

  private buildCompressedState(
    session: Session,
    ctx?: AskContext,
    userSelection?: UserSelection,
  ) {
    const mixWarnings = deriveMixWarnings(session, ctx?.audioMetrics, this.spectralSlots);
    return compressState(
      session,
      undefined,
      userSelection,
      ctx?.audioMetrics,
      mixWarnings,
      this.recentAutoDiffs,
    );
  }

  private async captureRecentAutoDiffs(
    beforeSession: Session,
    afterSession: Session,
    accepted: AIAction[],
    ctx?: AskContext,
  ): Promise<void> {
    if (!ctx?.listen?.renderOfflinePcm || accepted.length === 0) return;

    const diffableTrackIds = Array.from(new Set(
      accepted.flatMap(action => {
        if (!('trackId' in action) || typeof action.trackId !== 'string') return [];
        const track = afterSession.tracks.find(candidate => candidate.id === action.trackId);
        if (!track || getTrackKind(track) !== 'audio') return [];
        switch (action.type) {
          case 'move':
          case 'sketch':
          case 'set_model':
          case 'transform':
          case 'edit_pattern':
          case 'set_track_mix':
          case 'manage_pattern':
          case 'manage_sequence':
            return [action.trackId];
          default:
            return [];
        }
      }),
    ));
    if (diffableTrackIds.length === 0) return;

    const summaries = await Promise.all(
      diffableTrackIds.map(async trackId => {
        const verification = await runAutoDiffVerification(beforeSession, afterSession, trackId, ctx);
        if (!verification) return null;
        return {
          trackId,
          summary: verification.verification.summary,
          confidence: verification.verification.confidence,
        } satisfies CompressedAutoDiffSummary;
      }),
    );

    const nextSummaries = summaries.filter((summary): summary is CompressedAutoDiffSummary => summary !== null);
    if (nextSummaries.length > 0) {
      this.turnAutoDiffs = nextSummaries.slice(-5);
    }
  }

  /**
   * Process one round of model output: collect text parts, execute tool calls,
   * build function responses. Returns an immutable result object.
   */
  private async processRound(
    result: import('./types').GenerateResult,
    session: Session,
    ctx?: AskContext,
    breaker?: import('./circuit-breaker').CircuitBreakerState,
    turnActions: AIAction[] = [],
  ): Promise<{
    textParts: string[];
    actions: AIAction[];
    functionResponses: FunctionResponse[];
    callOutcomes: StepOutcome['calls'];
    done: boolean;
    truncated: boolean;
    suggestedReactions?: string[];
  }> {
    const textParts: string[] = [];
    const actions: AIAction[] = [];
    const functionResponses: FunctionResponse[] = [];
    const callOutcomes: StepOutcome['calls'] = [];
    let suggestedReactions: string[] | undefined;

    for (const text of result.textParts) {
      textParts.push(text);
      actions.push({ type: 'say', text });
    }

    if (result.truncated) {
      const truncMsg = '(Response was truncated due to length limits.)';
      textParts.push(truncMsg);
      actions.push({ type: 'say', text: truncMsg });
    }

    // Execute each function call. Within a single round, project each call's
    // actions onto a running session snapshot so later calls (e.g. listen after
    // sketch) see the effects of earlier calls in the same round.
    let roundSession = session;
    for (const fc of result.functionCalls) {
      ctx?.onToolCall?.(fc.name, fc.args);

      // Short-circuit repeated failing calls: if the exact same call already
      // failed, return a synthetic error instead of re-executing.
      if (breaker && isRepeatedFailure(breaker, fc.name, fc.args)) {
        const syntheticError = errorPayload(
          'This operation already failed with these exact arguments. Try a different approach.',
        );
        functionResponses.push({ id: fc.id, name: fc.name, result: syntheticError });
        callOutcomes.push({ name: fc.name, args: fc.args, errored: true });
        continue;
      }

      // Short-circuit repeated successful mutation calls: if the exact same
      // call already succeeded, return a warning instead of re-executing.
      // Prevents add/remove loops where the model doesn't realize an operation
      // already completed (see #918).
      if (breaker && isRepeatedSuccess(breaker, fc.name, fc.args)) {
        const duplicateWarning = errorPayload(
          'This operation was already completed with these exact arguments earlier in this turn. Skipping to avoid a redundant loop.',
        );
        functionResponses.push({ id: fc.id, name: fc.name, result: duplicateWarning });
        callOutcomes.push({ name: fc.name, args: fc.args, errored: true });
        continue;
      }

      const execResult = await this.executeFunctionCall(fc, roundSession, ctx, [...turnActions, ...actions]);
      actions.push(...execResult.actions);
      functionResponses.push({ id: fc.id, name: fc.name, result: execResult.response });

      // Capture suggested reactions from the suggest_reactions tool
      if (fc.name === 'suggest_reactions' && execResult.response && Array.isArray(execResult.response.reactions)) {
        suggestedReactions = execResult.response.reactions as string[];
      }

      // Project actions onto the running snapshot for subsequent calls
      for (const action of execResult.actions) {
        roundSession = projectAction(roundSession, action);
      }

      // Track whether this call errored (for circuit breaker).
      // errorPayload() returns { error: "message string" }, so check for
      // any truthy `error` field (string or boolean).
      const errored = execResult.response != null &&
        typeof execResult.response === 'object' &&
        'error' in execResult.response && !!execResult.response.error;
      callOutcomes.push({ name: fc.name, args: fc.args, errored });
    }

    return {
      textParts,
      actions,
      functionResponses,
      callOutcomes,
      done: result.functionCalls.length === 0,
      truncated: result.truncated ?? false,
      ...(suggestedReactions ? { suggestedReactions } : {}),
    };
  }

  private async executeFunctionCall(
    fc: NeutralFunctionCall,
    session: Session,
    ctx?: AskContext,
    existingActions: AIAction[] = [],
  ): Promise<{ actions: AIAction[]; response: Record<string, unknown> }> {
    const { name, args } = fc;

    // Resolve ordinal track references (e.g. "Track 1") to internal IDs
    if (typeof args.trackId === 'string' && args.trackId) {
      const resolved = resolveTrackId(args.trackId, session);
      if (resolved) {
        args.trackId = resolved;
      } else {
        return { actions: [], response: trackNotFoundError(String(fc.args.trackId), session) };
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
          return { actions: [], response: trackNotFoundError(ref, session) };
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
        return { actions: [], response: trackNotFoundError(args.scope, session) };
      }
    } else if (Array.isArray(args.scope)) {
      const resolvedScope: string[] = [];
      for (const ref of args.scope) {
        if (typeof ref !== 'string') continue;
        const resolved = resolveTrackId(ref, session);
        if (resolved) {
          resolvedScope.push(resolved);
        } else {
          return { actions: [], response: trackNotFoundError(ref, session) };
        }
      }
      args.scope = resolvedScope;
    }

    switch (name) {
      case 'move': {
        if (typeof args.param !== 'string' || !args.param) {
          return { actions: [], response: errorPayload('Missing required parameter: param') };
        }
        const resolvedTarget = resolveTempoSyncedMoveTarget(session, args);
        if ('error' in resolvedTarget) {
          return { actions: [], response: errorPayload(resolvedTarget.error) };
        }

        const targetValue = resolvedTarget.target;

        if (!args.processorId && !args.modulatorId && (args.param === 'volume' || args.param === 'pan')) {
          const trackId = (args.trackId as string) ?? session.activeTrackId;
          const track = session.tracks.find(v => v.id === trackId);
          if (!track) {
            return { actions: [], response: trackNotFoundError(trackId, session) };
          }
          if (args.over !== undefined) {
            return { actions: [], response: errorPayload(`Timed moves (over) are not supported for track ${args.param}`) };
          }

          const currentVal = args.param === 'volume' ? track.volume : track.pan;
          const rawTarget = 'absolute' in targetValue
            ? targetValue.absolute
            : currentVal + targetValue.relative;
          if (!Number.isFinite(rawTarget)) {
            return { actions: [], response: errorPayload(`Non-finite track mix value for ${args.param}`) };
          }

          const mixAction: AISetTrackMixAction = {
            type: 'set_track_mix',
            trackId,
            ...(args.param === 'volume'
              ? { volume: Math.max(0, Math.min(1, rawTarget)) }
              : { pan: Math.max(-1, Math.min(1, rawTarget)) }),
          };

          const rejection = ctx?.validateAction?.(session, mixAction);
          const rejectionResult = handleRejection(rejection, session, mixAction, existingActions);
          if (rejectionResult) return rejectionResult;

          const resultValue = args.param === 'volume'
            ? Math.max(0, Math.min(1, rawTarget))
            : Math.max(-1, Math.min(1, rawTarget));
          const clamped = resultValue !== rawTarget;

          return {
            actions: [mixAction],
            response: {
              applied: true,
              param: args.param,
              trackId,
              trackLabel: track.name ?? trackId,
              from: Math.round(currentVal * 100) / 100,
              to: Math.round(resultValue * 100) / 100,
              ...(clamped ? { clamped: true, requestedValue: Math.round(rawTarget * 100) / 100 } : {}),
            },
          };
        }
        const action: AIMoveAction = {
          type: 'move',
          param: args.param as string,
          target: resolvedTarget.target,
          ...(args.trackId ? { trackId: args.trackId as string } : {}),
          ...(args.processorId ? { processorId: args.processorId as string } : {}),
          ...(args.modulatorId ? { modulatorId: args.modulatorId as string } : {}),
          ...(args.over ? { over: args.over as number } : {}),
        };

        const rejection = ctx?.validateAction?.(session, action);
        const rejectionResult = handleRejection(rejection, session, action, existingActions);
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
        if (!Number.isFinite(rawTarget)) {
          return { actions: [], response: errorPayload(`Error: non-finite parameter value (${rawTarget}) for ${action.param}`) };
        }
        const resultValue = Math.max(0, Math.min(1, rawTarget));

        // Detect recent human touch on this parameter for conflict awareness
        const HUMAN_TOUCH_WINDOW_MS = 5000;
        const now = Date.now();
        const recentHumanTouch = session.recentHumanActions.some(
          ha => ha.kind === 'param' && ha.trackId === trackId && ha.param === action.param &&
                (now - ha.timestamp) < HUMAN_TOUCH_WINDOW_MS,
        );

        const moveTrackLabel = track?.name ?? trackId;
        const clamped = resultValue !== rawTarget;

        return {
          actions: [action],
          response: {
            applied: true,
            param: action.param,
            trackId,
            trackLabel: moveTrackLabel,
            ...(action.processorId ? { processorId: action.processorId } : {}),
            ...(action.modulatorId ? { modulatorId: action.modulatorId } : {}),
            from: Math.round(currentVal * 100) / 100,
            to: Math.round(resultValue * 100) / 100,
            ...(clamped ? { clamped: true, requestedValue: Math.round(rawTarget * 100) / 100 } : {}),
            ...(resolvedTarget.tempoSyncLabel ? { tempoSync: resolvedTarget.tempoSyncLabel } : {}),
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
            return { actions: [], response: enrichedError(`Unknown archetype: "${args.archetype}"`, {
              hint: 'Use one of the built-in pattern archetypes.',
              available: ARCHETYPE_NAMES,
            }) };
          }
          resolvedEvents = generateArchetypeEvents(args.archetype);
          archetypeUsed = true;
        } else if (Array.isArray(args.events)) {
          resolvedEvents = args.events as AISketchAction['events'];
        } else if (args.kit && typeof args.kit === 'object') {
          // Kit-based sketch for drum rack tracks — events are generated from grid strings at execution time
          resolvedEvents = undefined;
        } else {
          return { actions: [], response: errorPayload('Sketch requires one of: events array, archetype name, generator object, or kit (drum rack)') };
        }

        // Resolve bar.beat.sixteenth strings to absolute step numbers
        if (resolvedEvents) {
          try {
            resolveSketchPositions(resolvedEvents as { at: number | string }[]);
          } catch (e) {
            return { actions: [], response: errorPayload((e as Error).message) };
          }
        }

        // Validate and expand inline parameter shapes
        let validatedParamShapes: ParamShapes | undefined;
        if (args.paramShapes && typeof args.paramShapes === 'object') {
          const shapeErr = validateParamShapes(args.paramShapes);
          if (shapeErr) {
            return { actions: [], response: errorPayload(shapeErr) };
          }
          validatedParamShapes = args.paramShapes as ParamShapes;

          // Expand shapes to ParameterEvents and merge into resolvedEvents
          const sketchTrackForShapes = session.tracks.find(v => v.id === args.trackId);
          const shapeDuration = sketchTrackForShapes && sketchTrackForShapes.patterns.length > 0
            ? getActivePattern(sketchTrackForShapes).duration
            : 16;
          const shapeEvents = expandParamShapes(validatedParamShapes, shapeDuration);
          if (resolvedEvents) {
            resolvedEvents = [...resolvedEvents, ...shapeEvents] as AISketchAction['events'];
          } else {
            resolvedEvents = shapeEvents as AISketchAction['events'];
          }
        }

        const action: AISketchAction = {
          type: 'sketch',
          trackId: args.trackId as string,
          description: args.description as string,
          events: resolvedEvents,
          ...(args.kit && typeof args.kit === 'object' ? { kit: args.kit as Record<string, string> } : {}),
          ...(typeof args.humanize === 'number' ? { humanize: Math.max(0, Math.min(1, args.humanize)) } : {}),
          ...(typeof args.groove === 'string' && args.groove in GROOVE_TEMPLATES ? { groove: args.groove } : {}),
          ...(typeof args.groove_amount === 'number' ? { grooveAmount: Math.max(0, Math.min(1, args.groove_amount)) } : {}),
          ...(typeof args.dynamic === 'string' ? { dynamic: args.dynamic as string } : {}),
          ...(validatedParamShapes ? { paramShapes: validatedParamShapes } : {}),
        };

        const rejection = ctx?.validateAction?.(session, action);
        const rejectionResult = handleRejection(rejection, session, action, existingActions);
        if (rejectionResult) return rejectionResult;

        // Kit-based sketches (drum rack): events are generated from the kit at execution time,
        // so action.events is undefined and event delta computation would be misleading.
        const sketchTrack = session.tracks.find(v => v.id === action.trackId);
        const isKitSketch = action.kit && sketchTrack?.engine === 'drum-rack';

        if (isKitSketch) {
          return {
            actions: [action],
            response: {
              applied: true,
              trackId: action.trackId,
              description: action.description,
              kitApplied: true,
              kitLanes: Object.keys(action.kit!),
              ...(generatorUsed ? { source: 'generator' } : {}),
              ...(archetypeUsed ? { source: 'archetype', archetype: args.archetype } : {}),
              ...(action.dynamic ? { dynamic: action.dynamic } : {}),
            },
          };
        }

        // Compute consequence details from the before/after state
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

        // Auto-diff verification: render before/after and include diff summary
        let verificationResult: { verification: { summary: string; confidence: number } } | undefined;
        if (args.verify === true) {
          const afterSession = projectAction(session, action);
          verificationResult = await runAutoDiffVerification(session, afterSession, action.trackId, ctx);
        }

        // Compute resulting state for model context
        const resultingEventCount = newEvents.length;
        const activePatternForSketch = sketchTrack && sketchTrack.patterns.length > 0 ? getActivePattern(sketchTrack) : undefined;
        const patternLength = activePatternForSketch?.duration;

        return {
          actions: [action],
          response: {
            applied: true,
            trackId: action.trackId,
            description: action.description,
            resultingEventCount,
            eventsAdded,
            eventsRemoved,
            eventsModified,
            rhythmChanged,
            ...(patternLength !== undefined ? { patternLength } : {}),
            ...(hasApprovalLock ? { approvalLevel: approval } : {}),
            ...(preservationReport ? { preservation: preservationReport } : {}),
            ...(generatorUsed ? { source: 'generator' } : {}),
            ...(archetypeUsed ? { source: 'archetype', archetype: args.archetype } : {}),
            ...(action.dynamic ? { dynamic: action.dynamic } : {}),
            ...(validatedParamShapes ? { paramShapes: Object.keys(validatedParamShapes) } : {}),
            ...(verificationResult ?? {}),
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

        const rawOperations = args.operations as RawPatternEditOp[];

        // Resolve bar.beat.sixteenth strings to absolute step numbers before selector matching
        try {
          resolveEditPatternPositions(
            rawOperations.filter(
              (op): op is RawPatternEditOp & { step: number | string } => op.step !== undefined,
            ),
          );
        } catch (e) {
          return { actions: [], response: errorPayload((e as Error).message) };
        }

        // Validate operation shape
        const validActions = ['add', 'remove', 'modify'];
        for (let i = 0; i < rawOperations.length; i++) {
          const op = rawOperations[i];
          if (!validActions.includes(op.action)) {
            return { actions: [], response: errorPayload(`operations[${i}]: unknown action "${op.action}". Must be add, remove, or modify`) };
          }
          if (op.step !== undefined && (typeof op.step !== 'number' || op.step < 0)) {
            return { actions: [], response: errorPayload(`operations[${i}]: step must be a non-negative number`) };
          }
        }

        let resolvedOperations: PatternEditOp[];
        try {
          resolvedOperations = resolvePatternEditOperations(
            session,
            args.trackId as string,
            typeof args.patternId === 'string' ? args.patternId : undefined,
            rawOperations,
          );
        } catch (e) {
          return { actions: [], response: errorPayload((e as Error).message) };
        }

        const action: AIEditPatternAction = {
          type: 'edit_pattern',
          trackId: args.trackId as string,
          operations: resolvedOperations,
          description: args.description as string,
          ...(args.patternId ? { patternId: args.patternId as string } : {}),
          ...(args.pad ? { pad: args.pad as string } : {}),
        };

        const rejection = ctx?.validateAction?.(session, action);
        const rejectionResult = handleRejection(rejection, session, action, existingActions);
        if (rejectionResult) return rejectionResult;

        // Summarize operations
        const adds = action.operations.filter(o => o.action === 'add').length;
        const removes = action.operations.filter(o => o.action === 'remove').length;
        const modifies = action.operations.filter(o => o.action === 'modify').length;

        // Auto-diff verification: render before/after and include diff summary
        let editVerificationResult: { verification: { summary: string; confidence: number } } | undefined;
        if (args.verify === true) {
          const afterSession = projectAction(session, action);
          editVerificationResult = await runAutoDiffVerification(session, afterSession, action.trackId, ctx);
        }

        // Compute resulting state for model context
        const editTrack = session.tracks.find(v => v.id === action.trackId);
        const editPattern = editTrack && editTrack.patterns.length > 0
          ? (action.patternId ? editTrack.patterns.find(p => p.id === action.patternId) : getActivePattern(editTrack))
          : undefined;
        const editResultingEventCount = editPattern ? editPattern.events.length + adds - removes : undefined;
        const editPatternLength = editPattern?.duration;

        return {
          actions: [action],
          response: {
            applied: true,
            trackId: action.trackId,
            description: action.description,
            added: adds,
            removed: removes,
            modified: modifies,
            ...(editResultingEventCount !== undefined ? { resultingEventCount: editResultingEventCount } : {}),
            ...(editPatternLength !== undefined ? { patternLength: editPatternLength } : {}),
            ...(editVerificationResult ?? {}),
          },
        };
      }

      case 'set_transport': {
        const hasBpm = typeof args.bpm === 'number';
        const hasSwing = typeof args.swing === 'number';
        const hasMode = typeof args.mode === 'string' && ['pattern', 'song'].includes(args.mode as string);
        const hasPlaying = typeof args.playing === 'boolean';
        const hasTimeSig = typeof args.timeSignatureNumerator === 'number' || typeof args.timeSignatureDenominator === 'number';
        if (!hasBpm && !hasSwing && !hasMode && !hasPlaying && !hasTimeSig) {
          return { actions: [], response: errorPayload('At least one transport property must be provided') };
        }

        const action: AITransportAction = {
          type: 'set_transport',
          ...(hasBpm ? { bpm: args.bpm as number } : {}),
          ...(hasSwing ? { swing: args.swing as number } : {}),
          ...(hasMode ? { mode: args.mode as 'pattern' | 'song' } : {}),
          ...(hasPlaying ? { playing: args.playing as boolean } : {}),
          ...(typeof args.timeSignatureNumerator === 'number' ? { timeSignatureNumerator: args.timeSignatureNumerator as number } : {}),
          ...(typeof args.timeSignatureDenominator === 'number' ? { timeSignatureDenominator: args.timeSignatureDenominator as number } : {}),
        };

        const rejection = ctx?.validateAction?.(session, action);
        const rejectionResult = handleRejection(rejection, session, action, existingActions);
        if (rejectionResult) return rejectionResult;

        const resultBpm = action.bpm !== undefined ? Math.max(20, Math.min(300, action.bpm)) : undefined;
        const resultSwing = action.swing !== undefined ? Math.max(0, Math.min(1, action.swing)) : undefined;

        // Compute full resulting transport state for model context
        const resultingTransport = {
          bpm: resultBpm ?? session.transport.bpm,
          swing: resultSwing !== undefined ? Math.round(resultSwing * 100) / 100 : session.transport.swing,
          mode: action.mode ?? session.transport.mode ?? 'pattern',
          status: hasPlaying ? (action.playing ? 'playing' : 'stopped') : session.transport.status,
        };

        return {
          actions: [action],
          response: {
            applied: true,
            ...(resultBpm !== undefined ? { bpm: resultBpm } : {}),
            ...(resultSwing !== undefined ? { swing: Math.round(resultSwing * 100) / 100 } : {}),
            ...(action.mode ? { mode: action.mode } : {}),
            ...(hasPlaying ? { playing: action.playing } : {}),
            currentTransport: resultingTransport,
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
          ...(typeof args.pad === 'string' ? { pad: args.pad } : {}),
        };

        const rejection = ctx?.validateAction?.(session, action);
        const rejectionResult = handleRejection(rejection, session, action, existingActions);
        if (rejectionResult) return rejectionResult;

        // Resolve available parameters for the new model
        let modelParams: string[] | undefined;
        if (action.processorId) {
          const procTrack = session.tracks.find(v => v.id === action.trackId);
          const proc = (procTrack?.processors ?? []).find(p => p.id === action.processorId);
          if (proc) modelParams = getProcessorControlIds(proc.type);
        } else if (action.modulatorId) {
          const modTrack = session.tracks.find(v => v.id === action.trackId);
          const mod = (modTrack?.modulators ?? []).find(m => m.id === action.modulatorId);
          if (mod) modelParams = getModulatorControlIds(mod.type);
        } else {
          // Track source engine — resolve from engine registry
          const engineDef = getEngineById(action.model);
          if (engineDef) modelParams = engineDef.controls.map(c => c.id);
        }

        const setModelResponse: Record<string, unknown> = {
            queued: true,
            trackId: action.trackId,
            model: action.model,
            ...(action.processorId ? { processorId: action.processorId } : {}),
            ...(action.modulatorId ? { modulatorId: action.modulatorId } : {}),
            ...(modelParams ? { availableParams: modelParams } : {}),
          };

        // Spectral lint: changing a track's engine may shift its frequency profile.
        appendSpectralAdvisory(setModelResponse, session, this.spectralSlots);

        return {
          actions: [action],
          response: setModelResponse,
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
          ...(typeof args.pad === 'string' ? { pad: args.pad } : {}),
          ...(hasSteps ? { steps: args.steps as number } : {}),
          ...(hasSemitones ? { semitones: args.semitones as number } : {}),
          ...(typeof args.velocity_amount === 'number' ? { velocity_amount: args.velocity_amount } : { velocity_amount: 0.3 }),
          ...(typeof args.timing_amount === 'number' ? { timing_amount: args.timing_amount } : { timing_amount: 0.1 }),
          ...(typeof args.hits === 'number' ? { hits: args.hits } : {}),
          ...(typeof args.rotation === 'number' ? { rotation: args.rotation } : { rotation: 0 }),
          ...(typeof args.velocity === 'number' ? { velocity: args.velocity } : {}),
          ...(typeof args.probability === 'number' ? { probability: args.probability } : {}),
          ...(typeof args.amount === 'number' ? { amount: args.amount } : {}),
        };

        const rejection = ctx?.validateAction?.(session, action);
        const rejectionResult = handleRejection(rejection, session, action, existingActions);
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

            const addViewRejection = handleRejection(ctx?.validateAction?.(session, addViewAction), session, addViewAction, existingActions);
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

            const removeViewRejection = handleRejection(ctx?.validateAction?.(session, removeViewAction), session, removeViewAction, existingActions);
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
                const currentChain = (track.processors ?? []).map(p => getProcessorEngineName(p.type) ?? p.type);
                return { actions: [], response: enrichedError(chainResult.errors[0], {
                  hint: `Current chain: [${currentChain.join(' → ')}]. Valid processor types: filter, eq, compressor, delay, reverb.`,
                  available: currentChain,
                }) };
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

            const addProcRejection = handleRejection(ctx?.validateAction?.(session, addProcAction), session, addProcAction, existingActions);
            if (addProcRejection) return addProcRejection;

            // Include the projected chain so the model knows what's already on the track
            const projectedAfterAdd = projectAction(session, addProcAction);
            const chainAfterAdd = projectedAfterAdd.tracks.find(v => v.id === addProcAction.trackId)?.processors ?? [];

            return {
              actions: [addProcAction],
              response: {
                applied: true,
                trackId: addProcAction.trackId,
                moduleType: addProcAction.moduleType,
                processorId: assignedProcessorId,
                currentChain: chainAfterAdd.map(p => ({ id: p.id, type: p.type })),
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

            const removeProcRejection = handleRejection(ctx?.validateAction?.(session, removeProcAction), session, removeProcAction, existingActions);
            if (removeProcRejection) return removeProcRejection;

            const projectedAfterRemove = projectAction(session, removeProcAction);
            const chainAfterRemove = projectedAfterRemove.tracks.find(v => v.id === removeProcAction.trackId)?.processors ?? [];

            return {
              actions: [removeProcAction],
              response: {
                applied: true,
                trackId: removeProcAction.trackId,
                processorId: removeProcAction.processorId,
                currentChain: chainAfterRemove.map(p => ({ id: p.id, type: p.type })),
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

            const replaceRejection = handleRejection(ctx?.validateAction?.(session, replaceAction), session, replaceAction, existingActions);
            if (replaceRejection) return replaceRejection;

            const projectedAfterReplace = projectAction(session, replaceAction);
            const chainAfterReplace = projectedAfterReplace.tracks.find(v => v.id === replaceAction.trackId)?.processors ?? [];

            return {
              actions: [replaceAction],
              response: {
                applied: true,
                trackId: replaceAction.trackId,
                replacedProcessorId: replaceAction.processorId,
                newModuleType: replaceAction.newModuleType,
                newProcessorId,
                currentChain: chainAfterReplace.map(p => ({ id: p.id, type: p.type })),
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

            const bypassRejection = handleRejection(ctx?.validateAction?.(session, bypassAction), session, bypassAction, existingActions);
            if (bypassRejection) return bypassRejection;

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
                const currentMods = (track.modulators ?? []).map(m => getModulatorEngineName(m.type) ?? m.type);
                return { actions: [], response: enrichedError(modResult.errors[0], {
                  hint: `Current modulators: [${currentMods.join(', ')}]. Valid types: lfo, envelope.`,
                  available: currentMods,
                }) };
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

            const addModRejection = handleRejection(ctx?.validateAction?.(session, addModAction), session, addModAction, existingActions);
            if (addModRejection) return addModRejection;

            // Include projected modulator list for model context
            const projectedAfterModAdd = projectAction(session, addModAction);
            const modulatorsAfterAdd = projectedAfterModAdd.tracks.find(v => v.id === addModAction.trackId)?.modulators ?? [];

            return {
              actions: [addModAction],
              response: {
                queued: true,
                trackId: addModAction.trackId,
                moduleType: addModAction.moduleType,
                modulatorId: assignedModulatorId,
                currentModulators: modulatorsAfterAdd.map(m => ({ id: m.id, type: m.type })),
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

            const removeModRejection = handleRejection(ctx?.validateAction?.(session, removeModAction), session, removeModAction, existingActions);
            if (removeModRejection) return removeModRejection;

            // Include projected modulator list after removal for model context
            const projectedAfterModRemove = projectAction(session, removeModAction);
            const modulatorsAfterRemove = projectedAfterModRemove.tracks.find(v => v.id === removeModAction.trackId)?.modulators ?? [];

            return {
              actions: [removeModAction],
              response: {
                queued: true,
                trackId: removeModAction.trackId,
                modulatorId: removeModAction.modulatorId,
                remainingModulators: modulatorsAfterRemove.map(m => ({ id: m.id, type: m.type })),
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

            const connectRejection = handleRejection(ctx?.validateAction?.(session, connectAction), session, connectAction, existingActions);
            if (connectRejection) return connectRejection;

            const targetStr = modTarget.kind === 'source'
              ? `source:${modTarget.param}`
              : `processor:${modTarget.processorId}:${modTarget.param}`;

            // Include projected modulation routes for model context
            const projectedAfterConnect = projectAction(session, connectAction);
            const routesAfterConnect = projectedAfterConnect.tracks.find(v => v.id === connectAction.trackId)?.modulations ?? [];

            return {
              actions: [connectAction],
              response: {
                queued: true,
                modulationId: preAssignedId,
                created: !existingRoute,
                ...(existingRoute ? { previousDepth: existingRoute.depth } : {}),
                target: targetStr,
                depth: args.depth,
                currentRoutes: routesAfterConnect.map(r => ({
                  id: r.id,
                  modulatorId: r.modulatorId,
                  target: r.target.kind === 'source'
                    ? `source:${r.target.param}`
                    : `processor:${r.target.processorId}:${r.target.param}`,
                  depth: r.depth,
                })),
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

            const disconnectRejection = handleRejection(ctx?.validateAction?.(session, disconnectAction), session, disconnectAction, existingActions);
            if (disconnectRejection) return disconnectRejection;

            // Include projected modulation routes after disconnection for model context
            const projectedAfterDisconnect = projectAction(session, disconnectAction);
            const routesAfterDisconnect = projectedAfterDisconnect.tracks.find(v => v.id === disconnectAction.trackId)?.modulations ?? [];

            return {
              actions: [disconnectAction],
              response: {
                queued: true,
                trackId: disconnectAction.trackId,
                modulationId: disconnectAction.modulationId,
                remainingRoutes: routesAfterDisconnect.map(r => ({
                  id: r.id,
                  modulatorId: r.modulatorId,
                  target: r.target.kind === 'source'
                    ? `source:${r.target.param}`
                    : `processor:${r.target.processorId}:${r.target.param}`,
                  depth: r.depth,
                })),
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
        if (typeof args.description !== 'string') {
          return { actions: [], response: errorPayload('Missing required parameter: description') };
        }
        if (!Array.isArray(args.modules)) {
          return { actions: [], response: errorPayload('Missing required parameter: modules (must be an array)') };
        }

        const modules: SurfaceModule[] = (args.modules as Record<string, unknown>[]).map((m, i) => {
          const rawBindings = Array.isArray(m.bindings) ? (m.bindings as Record<string, unknown>[]) : [];
          const bindings: ModuleBinding[] = rawBindings.map(b => ({
            role: (b.role as string) ?? 'control',
            trackId: args.trackId as string,
            target: (b.target as string) ?? '',
          }));

          const rawPosition = m.position as Record<string, number> | undefined;
          const position = rawPosition
            ? { x: rawPosition.x ?? 0, y: rawPosition.y ?? i * 2, w: rawPosition.w ?? 4, h: rawPosition.h ?? 2 }
            : { x: 0, y: i * 2, w: 4, h: 2 };

          return {
            type: (m.type as string) ?? 'knob-group',
            id: (m.id as string) ?? `module-${i}`,
            label: (m.label as string) ?? `Module ${i}`,
            bindings,
            position,
            config: (m.config as Record<string, unknown>) ?? {},
          };
        });

        const setSurfaceAction: AISetSurfaceAction = {
          type: 'set_surface',
          trackId: args.trackId as string,
          modules,
          description: args.description as string,
        };

        const setSurfaceRejection = handleRejection(ctx?.validateAction?.(session, setSurfaceAction), session, setSurfaceAction, existingActions);
        if (setSurfaceRejection) return setSurfaceRejection;

        return {
          actions: [setSurfaceAction],
          response: {
            applied: true,
            trackId: setSurfaceAction.trackId,
            moduleCount: modules.length,
            moduleTypes: modules.map(m => m.type),
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

            const pinRejection = handleRejection(ctx?.validateAction?.(session, pinAction), session, pinAction, existingActions);
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

            const unpinRejection = handleRejection(ctx?.validateAction?.(session, unpinAction), session, unpinAction, existingActions);
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

        const labelAxesRejection = handleRejection(ctx?.validateAction?.(session, labelAxesAction), session, labelAxesAction, existingActions);
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
        const hasSwing = args.swing !== undefined || args.inheritSwing === true;
        const hasApproval = args.approval !== undefined;
        const hasImportance = args.importance !== undefined;
        const hasRole = args.musicalRole !== undefined;
        const hasMuted = args.muted !== undefined;
        const hasSolo = args.solo !== undefined;
        const hasPortamentoTime = args.portamentoTime !== undefined;
        const hasPortamentoMode = args.portamentoMode !== undefined;
        if (!hasName && !hasVolume && !hasPan && !hasSwing && !hasApproval && !hasImportance && !hasRole && !hasMuted && !hasSolo && !hasPortamentoTime && !hasPortamentoMode) {
          return { actions: [], response: errorPayload('At least one of name, volume, pan, swing, approval, importance, musicalRole, muted, solo, portamentoTime, portamentoMode required') };
        }

        const metaActions: AIAction[] = [];
        const applied: string[] = [];
        const errors: string[] = [];

        // Handle volume/pan/swing
        if (hasVolume || hasPan || hasSwing) {
          let swingValue: number | null | undefined;
          let swingError = false;
          if (hasSwing) {
            if (args.inheritSwing === true) {
              swingValue = null; // null = inherit global transport swing
            } else if (typeof args.swing === 'number' && Number.isFinite(args.swing)) {
              swingValue = Math.max(0, Math.min(1, args.swing));
            } else {
              errors.push('swing must be a finite number (0.0-1.0), or use inheritSwing: true to clear');
              swingError = true;
            }
          }
          if (!swingError) {
            const trackMix: AISetTrackMixAction = {
              type: 'set_track_mix',
              trackId: args.trackId as string,
              ...(hasVolume ? { volume: Math.max(0, Math.min(1, args.volume as number)) } : {}),
              ...(hasPan ? { pan: Math.max(-1, Math.min(1, args.pan as number)) } : {}),
              ...(hasSwing ? { swing: swingValue } : {}),
            };
            metaActions.push(trackMix);
            if (hasVolume) applied.push('volume');
            if (hasPan) applied.push('pan');
            if (hasSwing) applied.push('swing');
          }
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
            const markRejection = handleRejection(ctx?.validateAction?.(session, markApprovedAction), session, markApprovedAction, existingActions);
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

        // Handle portamento
        if (hasPortamentoTime || hasPortamentoMode) {
          const portaAction: AISetPortamentoAction = {
            type: 'set_portamento',
            trackId: args.trackId as string,
          };
          let portaError = false;
          if (hasPortamentoTime) {
            if (typeof args.portamentoTime !== 'number' || !Number.isFinite(args.portamentoTime)) {
              errors.push('portamentoTime must be a finite number (0.0-1.0)');
              portaError = true;
            } else {
              portaAction.time = Math.max(0, Math.min(1, args.portamentoTime));
            }
          }
          if (hasPortamentoMode) {
            const validModes = ['off', 'always', 'legato'];
            if (typeof args.portamentoMode !== 'string' || !validModes.includes(args.portamentoMode)) {
              errors.push(`portamentoMode must be one of: ${validModes.join(', ')}`);
              portaError = true;
            } else {
              portaAction.mode = args.portamentoMode as 'off' | 'always' | 'legato';
            }
          }
          if (!portaError) {
            metaActions.push(portaAction);
            if (hasPortamentoTime) applied.push('portamentoTime');
            if (hasPortamentoMode) applied.push('portamentoMode');
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

      case 'set_track_identity': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        const identityTrackId = resolveTrackId(args.trackId as string, session);
        if (!identityTrackId) {
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
        }

        // Build partial identity from provided args
        const identity: Partial<import('../engine/types').TrackVisualIdentity> = {};

        if (args.colour && typeof args.colour === 'object') {
          const c = args.colour as Record<string, unknown>;
          identity.colour = {
            hue: typeof c.hue === 'number' ? Math.min(360, Math.max(0, c.hue)) : 0,
            saturation: typeof c.saturation === 'number' ? Math.min(1, Math.max(0, c.saturation)) : 0.6,
            brightness: typeof c.brightness === 'number' ? Math.min(1, Math.max(0, c.brightness)) : 0.7,
          };
        }
        if (typeof args.weight === 'number') {
          identity.weight = Math.min(1, Math.max(0, args.weight));
        }
        if (typeof args.edgeStyle === 'string') {
          const validEdges = ['crisp', 'soft', 'glow'] as const;
          if (validEdges.includes(args.edgeStyle as typeof validEdges[number])) {
            identity.edgeStyle = args.edgeStyle as 'crisp' | 'soft' | 'glow';
          }
        }
        if (typeof args.prominence === 'number') {
          identity.prominence = Math.min(1, Math.max(0, args.prominence));
        }

        if (Object.keys(identity).length === 0) {
          return { actions: [], response: errorPayload('At least one visual property (colour, weight, edgeStyle, prominence) is required') };
        }

        const setIdentityAction: AISetTrackIdentityAction = {
          type: 'set_track_identity',
          trackId: identityTrackId,
          identity,
        };

        const identityRejection = handleRejection(ctx?.validateAction?.(session, setIdentityAction), session, setIdentityAction, existingActions);
        if (identityRejection) return identityRejection;

        return {
          actions: [setIdentityAction],
          response: { queued: true, trackId: identityTrackId, identity },
        };
      }

      case 'explain_chain': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        const explainTrackId = resolveTrackId(args.trackId as string, session);
        if (!explainTrackId) {
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
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
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
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

            const addTrackRejection = handleRejection(ctx?.validateAction?.(session, addTrackAction), session, addTrackAction, existingActions);
            if (addTrackRejection) return addTrackRejection;

            // Project the addition to determine the new track's ordinal position and ID
            const projectedAfterAdd = addTrack(session, kind as TrackKind);
            const newTrackCount = projectedAfterAdd
              ? projectedAfterAdd.tracks.filter(t => getTrackKind(t) !== 'bus').length
              : session.tracks.filter(t => getTrackKind(t) !== 'bus').length + 1;
            // The new track's ID — addTrack sets activeTrackId to the new track.
            // Don't use tracks[length-1] because splice inserts before master bus.
            const newTrackId = projectedAfterAdd?.activeTrackId;

            const addResponse: Record<string, unknown> = {
                queued: true,
                kind: addTrackAction.kind,
                ...(addTrackAction.label ? { label: addTrackAction.label } : {}),
                trackRef: `Track ${newTrackCount}`,
                ...(newTrackId ? { trackId: newTrackId } : {}),
                note: `Use "Track ${newTrackCount}" or "${newTrackId ?? `Track ${newTrackCount}`}" to reference this track in subsequent tool calls this turn.`,
              };

            // Spectral lint: check if the projected session (after adding the track)
            // warrants an advisory about unslotted tracks.
            if (projectedAfterAdd) {
              appendSpectralAdvisory(addResponse, projectedAfterAdd, this.spectralSlots);
            }

            return {
              actions: [addTrackAction],
              response: addResponse,
            };
          }
          case 'remove': {
            if (typeof args.trackId !== 'string' || !args.trackId) {
              return { actions: [], response: errorPayload('action=remove requires trackId') };
            }

            const resolvedTrackId = resolveTrackId(args.trackId as string, session);
            if (!resolvedTrackId) {
              return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
            }

            const removeTrackAction: AIRemoveTrackAction = {
              type: 'remove_track',
              trackId: resolvedTrackId,
              description: args.description as string,
            };

            const removeTrackRejection = handleRejection(ctx?.validateAction?.(session, removeTrackAction), session, removeTrackAction, existingActions);
            if (removeTrackRejection) return removeTrackRejection;

            // Compute remaining tracks after removal for model context
            const remainingTracks = session.tracks
              .filter(t => t.id !== removeTrackAction.trackId)
              .map(t => ({ id: t.id, name: t.name ?? t.id, kind: getTrackKind(t) }));

            return {
              actions: [removeTrackAction],
              response: {
                applied: true,
                trackId: removeTrackAction.trackId,
                remainingTrackCount: remainingTracks.length,
                remainingTracks,
              },
            };
          }
          default:
            return { actions: [], response: errorPayload(`Invalid action "${trackSubAction}". Use: add, remove`) };
        }
      }

      case 'manage_drum_pad': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.padId !== 'string' || !args.padId) {
          return { actions: [], response: errorPayload('Missing required parameter: padId') };
        }
        if (typeof args.description !== 'string') {
          return { actions: [], response: errorPayload('Missing required parameter: description') };
        }
        const drumPadSubAction = args.action as string;
        if (!drumPadSubAction || !['add', 'remove', 'rename', 'set_choke_group'].includes(drumPadSubAction)) {
          return { actions: [], response: errorPayload(`Invalid action: ${drumPadSubAction}. Must be one of: add, remove, rename, set_choke_group`) };
        }

        const resolvedDrumTrackId = resolveTrackId(args.trackId as string, session);
        if (!resolvedDrumTrackId) {
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
        }

        const drumPadAction: AIManageDrumPadAction = {
          type: 'manage_drum_pad',
          trackId: resolvedDrumTrackId,
          action: drumPadSubAction as AIManageDrumPadAction['action'],
          padId: args.padId as string,
          ...(typeof args.name === 'string' ? { name: args.name } : {}),
          ...(typeof args.model === 'string' ? { model: args.model } : {}),
          ...(args.chokeGroup !== undefined ? { chokeGroup: args.chokeGroup as number | null } : {}),
          description: args.description as string,
        };

        const drumPadRejection = handleRejection(ctx?.validateAction?.(session, drumPadAction), session, drumPadAction, existingActions);
        if (drumPadRejection) return drumPadRejection;

        return {
          actions: [drumPadAction],
          response: {
            applied: true,
            trackId: resolvedDrumTrackId,
            action: drumPadSubAction,
            padId: args.padId,
          },
        };
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
        const rawTrackIds = args.trackIds as string[] | undefined;
        const trackIds = rawTrackIds && rawTrackIds.length > 0 ? rawTrackIds : undefined;
        const rawBars = typeof args.bars === 'number' ? args.bars : inferBarsFromPatterns(session, trackIds);
        const bars = Math.max(1, Math.min(16, Math.round(rawBars)));

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
          const result = await this.compareHandler(compareQuestion, session, ctx?.listen, bars, trackIds, lens, ctx?.onListenEvent);
          return { actions: [], response: result };
        }

        const result = await this.listenHandler(question, session, ctx?.listen, bars, trackIds, lens, rubric, ctx?.onListenEvent);
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

        // Parse scope: string, string[], or undefined (full mix)
        let renderTrackIds: string[] | undefined;
        if (typeof args.scope === 'string') {
          renderTrackIds = [args.scope];
        } else if (Array.isArray(args.scope)) {
          renderTrackIds = args.scope as string[];
        }

        const rawBars = typeof args.bars === 'number' ? args.bars : inferBarsFromPatterns(session, renderTrackIds);
        const renderBars = Math.max(1, Math.min(16, Math.round(rawBars)));

        // Validate track IDs
        if (renderTrackIds) {
          const sessionTrackIds = new Set(session.tracks.map(v => v.id));
          const invalid = renderTrackIds.filter(vid => !sessionTrackIds.has(vid));
          if (invalid.length > 0) {
            return {
              actions: [],
              response: enrichedError(
                `Unknown track IDs: ${invalid.join(', ')}.`,
                { hint: 'Use "Track N" (1-indexed) or an internal track ID.', available: trackListing(session) },
              ),
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
        } catch {
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
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
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

        const sendRejection = handleRejection(ctx?.validateAction?.(session, manageSendAction), session, manageSendAction, existingActions);
        if (sendRejection) return sendRejection;

        return {
          actions: [manageSendAction],
          response: { queued: true, action: sendSubAction, trackId: sendTrackId, busId: sendBusId },
        };
      }

      case 'set_sidechain': {
        if (typeof args.targetTrackId !== 'string' || !args.targetTrackId) {
          return { actions: [], response: errorPayload('Missing required parameter: targetTrackId') };
        }
        if (typeof args.description !== 'string' || !args.description) {
          return { actions: [], response: errorPayload('Missing required parameter: description') };
        }

        // sourceTrackId can be null (to remove), or a string
        const rawSourceId = args.sourceTrackId;
        let resolvedSourceId: string | null = null;
        if (rawSourceId !== null && rawSourceId !== undefined) {
          if (typeof rawSourceId !== 'string') {
            return { actions: [], response: errorPayload('sourceTrackId must be a string or null') };
          }
          resolvedSourceId = resolveTrackId(rawSourceId, session);
          if (!resolvedSourceId) {
            return { actions: [], response: trackNotFoundError(String(rawSourceId), session) };
          }
        }

        const resolvedTargetId = resolveTrackId(args.targetTrackId as string, session);
        if (!resolvedTargetId) {
          return { actions: [], response: trackNotFoundError(String(args.targetTrackId), session) };
        }

        // Validate source and target are different
        if (resolvedSourceId !== null && resolvedSourceId === resolvedTargetId) {
          return { actions: [], response: enrichedError('Sidechain source and target must be different tracks.', {
            hint: 'A compressor cannot sidechain from itself.',
          }) };
        }

        // Simple cycle detection: walk from source's sidechain sources back to see if target appears
        if (resolvedSourceId !== null) {
          const visited = new Set<string>();
          let current: string | null = resolvedSourceId;
          while (current) {
            if (current === resolvedTargetId) {
              return { actions: [], response: enrichedError('Sidechain routing would create a cycle.', {
                hint: 'Track A sidechaining to B which sidechains back to A is not allowed.',
              }) };
            }
            if (visited.has(current)) break;
            visited.add(current);
            // Check if this track has a compressor that sidechains from somewhere
            const checkTrack = session.tracks.find(t => t.id === current);
            if (!checkTrack) break;
            const scProc = (checkTrack.processors ?? []).find(p => p.type === 'compressor' && p.sidechainSourceId);
            current = scProc?.sidechainSourceId ?? null;
          }
        }

        // Auto-detect compressor if processorId not provided
        let scProcessorId = args.processorId as string | undefined;
        if (!scProcessorId && resolvedSourceId !== null) {
          const targetTrack = session.tracks.find(t => t.id === resolvedTargetId);
          const compressors = (targetTrack?.processors ?? []).filter(p => p.type === 'compressor');
          if (compressors.length === 0) {
            return { actions: [], response: enrichedError(`No compressor found on target track. Add one first with manage_processor.`, {
              hint: 'Use manage_processor to add a compressor before setting up sidechain.',
            }) };
          }
          if (compressors.length > 1) {
            return { actions: [], response: enrichedError(`Multiple compressors on target track — specify processorId.`, {
              hint: `Available compressor IDs: ${compressors.map(p => p.id).join(', ')}`,
            }) };
          }
          scProcessorId = compressors[0].id;
        }

        const sidechainAction: import('../engine/types').AISetSidechainAction = {
          type: 'set_sidechain',
          sourceTrackId: resolvedSourceId,
          targetTrackId: resolvedTargetId,
          ...(scProcessorId ? { processorId: scProcessorId } : {}),
          description: args.description as string,
        };

        const scRejection = handleRejection(ctx?.validateAction?.(session, sidechainAction), session, sidechainAction, existingActions);
        if (scRejection) return scRejection;

        return {
          actions: [sidechainAction],
          response: {
            queued: true,
            sourceTrackId: resolvedSourceId,
            targetTrackId: resolvedTargetId,
            processorId: scProcessorId,
          },
        };
      }

      case 'setup_return_bus': {
        if (typeof args.sourceTrackId !== 'string' || !args.sourceTrackId) {
          return { actions: [], response: errorPayload('Missing required parameter: sourceTrackId') };
        }
        if (typeof args.processorType !== 'string' || !args.processorType) {
          return { actions: [], response: errorPayload('Missing required parameter: processorType') };
        }
        if (typeof args.description !== 'string' || !args.description) {
          return { actions: [], response: errorPayload('Missing required parameter: description') };
        }

        const sourceTrackId = resolveTrackId(args.sourceTrackId as string, session);
        if (!sourceTrackId) {
          return { actions: [], response: trackNotFoundError(String(args.sourceTrackId), session) };
        }

        const sourceTrack = session.tracks.find(t => t.id === sourceTrackId);
        if (!sourceTrack) {
          return { actions: [], response: trackNotFoundError(String(args.sourceTrackId), session) };
        }

        const processorType = String(args.processorType);
        const wetParam = RETURN_BUS_WET_PARAM[processorType];
        if (!wetParam || !getProcessorInstrument(processorType)) {
          return {
            actions: [],
            response: enrichedError(`Unsupported return-bus processor: "${processorType}"`, {
              hint: 'Use a wet-capable processor type for return routing.',
              available: Object.keys(RETURN_BUS_WET_PARAM),
            }),
          };
        }

        const wet = typeof args.wet === 'number' ? args.wet : 1.0;
        const sendLevel = typeof args.sendLevel === 'number' ? args.sendLevel : 0.3;
        const projectedAfterAdd = addTrack(session, 'bus');
        if (!projectedAfterAdd) {
          return { actions: [], response: errorPayload('Unable to add another bus track.') };
        }
        const busId = projectedAfterAdd.activeTrackId;
        const now = Date.now();
        const processorId = `${processorType}-${now}`;

        const addTrackAction: AIAddTrackAction = {
          type: 'add_track',
          kind: 'bus',
          ...(typeof args.name === 'string' && args.name ? { label: args.name } : {}),
          description: args.description as string,
        };

        const addTrackRejection = handleRejection(ctx?.validateAction?.(session, addTrackAction), session, addTrackAction, existingActions);
        if (addTrackRejection) return addTrackRejection;

        const addProcessorAction: AIAddProcessorAction = {
          type: 'add_processor',
          trackId: busId,
          moduleType: processorType,
          processorId,
          description: `Add ${processorType} to return bus`,
        };

        const addProcessorRejection = handleRejection(ctx?.validateAction?.(projectedAfterAdd, addProcessorAction), projectedAfterAdd, addProcessorAction, existingActions);
        if (addProcessorRejection) return addProcessorRejection;

        const busActions: AIAction[] = [addTrackAction, addProcessorAction];

        if (typeof args.processorModel === 'string' && args.processorModel) {
          const setModelAction: AISetModelAction = {
            type: 'set_model',
            trackId: busId,
            processorId,
            model: args.processorModel as string,
          };
          const setModelRejection = handleRejection(ctx?.validateAction?.(projectedAfterAdd, setModelAction), projectedAfterAdd, setModelAction, existingActions);
          if (setModelRejection) return setModelRejection;
          busActions.push(setModelAction);
        }

        const moveAction: AIMoveAction = {
          type: 'move',
          trackId: busId,
          processorId,
          param: wetParam,
          target: { absolute: wet },
        };
        const moveRejection = handleRejection(ctx?.validateAction?.(projectedAfterAdd, moveAction), projectedAfterAdd, moveAction, existingActions);
        if (moveRejection) return moveRejection;
        busActions.push(moveAction);

        const sendAction: AIManageSendAction = {
          type: 'manage_send',
          action: 'add',
          trackId: sourceTrackId,
          busId,
          level: sendLevel,
        };

        const sendRejection = handleRejection(ctx?.validateAction?.(projectedAfterAdd, sendAction), projectedAfterAdd, sendAction, existingActions);
        if (sendRejection) return sendRejection;

        busActions.push(sendAction);

        return {
          actions: busActions,
          response: {
            applied: true,
            sourceTrackId,
            busId,
            processorId,
            processorType,
            wet,
            sendLevel,
            ...(typeof args.name === 'string' && args.name ? { busLabel: args.name } : {}),
          },
        };
      }

      case 'apply_arrangement_archetype': {
        if (typeof args.archetype !== 'string' || !args.archetype) {
          return { actions: [], response: errorPayload('Missing required parameter: archetype') };
        }
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.description !== 'string' || !args.description) {
          return { actions: [], response: errorPayload('Missing required parameter: description') };
        }

        const archetype = getArrangementArchetype(args.archetype as string);
        if (!archetype) {
          return {
            actions: [],
            response: enrichedError(`Unknown arrangement archetype: "${args.archetype}"`, {
              hint: 'Use one of the built-in arrangement archetypes.',
              available: ARRANGEMENT_NAMES,
            }),
          };
        }

        const archTrackId = resolveTrackId(args.trackId as string, session);
        if (!archTrackId) {
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
        }

        const archTrack = session.tracks.find(t => t.id === archTrackId);
        if (!archTrack) {
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
        }

        const expandedSections = expandArchetype(archetype);
        const archActions: AIAction[] = [];
        const sectionPatternIds: { name: string; patternId: string; bars: number }[] = [];

        // Phase 1: Create patterns for each section
        for (const section of expandedSections) {
          const patternId = `pat-${section.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

          // Add pattern
          const addAction: AIManagePatternAction = {
            type: 'manage_pattern',
            action: 'add',
            trackId: archTrackId,
            description: `Add pattern for ${section.name} section`,
          };

          const addRejection = handleRejection(ctx?.validateAction?.(session, addAction), session, addAction, existingActions);
          if (addRejection) return addRejection;
          archActions.push(addAction);

          // We need to project the session to get the actual pattern ID assigned
          // The pattern ID is generated during execution, so we track section info for the response
          sectionPatternIds.push({ name: section.name, patternId, bars: section.bars });

          // Set pattern length
          const lengthAction: AIManagePatternAction = {
            type: 'manage_pattern',
            action: 'set_length',
            trackId: archTrackId,
            length: section.lengthSteps,
            description: `Set ${section.name} to ${section.bars} bars (${section.lengthSteps} steps)`,
          };
          archActions.push(lengthAction);

          // Rename pattern
          const renameAction: AIManagePatternAction = {
            type: 'manage_pattern',
            action: 'rename',
            trackId: archTrackId,
            name: section.name,
            description: `Rename pattern to "${section.name}"`,
          };
          archActions.push(renameAction);

          // Sketch events based on density (only if not silent)
          if (section.density !== 'silent') {
            const sketchAction: AISketchAction = {
              type: 'sketch',
              trackId: archTrackId,
              description: `${section.name}: ${section.density} density (energy ${section.energy})`,
              events: generateDensityEvents(section.densityConfig, section.lengthSteps, section.hasFill),
            };
            archActions.push(sketchAction);
          }
        }

        // Phase 2: Build the sequence (append each section pattern in order)
        // The sequence references will be built from the patterns that were added.
        // Since pattern IDs are assigned during execution, we emit append actions
        // that reference patterns by their creation order. The execution layer
        // handles this — the newly-added patterns will be available on the track.

        return {
          actions: archActions,
          response: {
            applied: true,
            archetype: archetype.name,
            trackId: archTrackId,
            totalBars: archetype.totalBars,
            sections: expandedSections.map(s => ({
              name: s.name,
              bars: s.bars,
              density: s.density,
              energy: s.energy,
            })),
            note: 'Patterns created for each section. Use manage_sequence to arrange them in order, and set_transport mode: "song" to play through the full arrangement.',
          },
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
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
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

        const patternRejection = handleRejection(ctx?.validateAction?.(session, managePatternAction), session, managePatternAction, existingActions);
        if (patternRejection) return patternRejection;

        // Compute resulting pattern metadata for model context
        const projectedAfterPattern = projectAction(session, managePatternAction);
        const patternTrack = projectedAfterPattern.tracks.find(v => v.id === patternTrackId);
        const patternList = patternTrack?.patterns.map(p => ({
          id: p.id,
          name: p.name,
          length: p.duration,
          eventCount: p.events.length,
        })) ?? [];

        return {
          actions: [managePatternAction],
          response: {
            queued: true,
            action: patternSubAction,
            trackId: patternTrackId,
            patterns: patternList,
            ...(patternTrack?.activePatternId ? { activePatternId: patternTrack.activePatternId } : {}),
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
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
        }

        const validSeqActions = ['append', 'remove', 'reorder', 'set_automation', 'clear_automation'];
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
        if (seqSubAction === 'set_automation' || seqSubAction === 'clear_automation') {
          if (typeof args.controlId !== 'string' || !args.controlId) {
            return { actions: [], response: errorPayload(`action=${seqSubAction} requires controlId`) };
          }
          const validControlIds = new Set(
            plaitsInstrument.engines.flatMap(engine => engine.controls.map(control => control.id)),
          );
          if (!validControlIds.has(args.controlId as string)) {
            return { actions: [], response: errorPayload(`Unsupported sequence automation controlId: ${String(args.controlId)}`) };
          }
        }
        if (seqSubAction === 'set_automation') {
          if (!Array.isArray(args.points) || args.points.length === 0) {
            return { actions: [], response: errorPayload('action=set_automation requires points') };
          }
        }

        let resolvedPoints: AIManageSequenceAction['points'] | undefined;
        if (seqSubAction === 'set_automation') {
          const track = getTrack(session, seqTrackId);
          let sequenceLength = 0;
          for (const ref of track.sequence) {
            const pattern = track.patterns.find(candidate => candidate.id === ref.patternId);
            if (pattern) sequenceLength += pattern.duration;
          }
          if (sequenceLength <= 0) {
            return { actions: [], response: errorPayload('Track sequence has no duration to automate') };
          }

          resolvedPoints = (args.points as RawSequenceAutomationPoint[]).map((point, index) => {
            if (point == null || typeof point !== 'object') {
              throw new Error(`points[${index}] must be an object`);
            }
            if (point.at === undefined) {
              throw new Error(`points[${index}] is missing at`);
            }
            if (typeof point.value !== 'number' || !Number.isFinite(point.value)) {
              throw new Error(`points[${index}] value must be a finite number`);
            }
            const at = parsePosition(point.at);
            if (at < 0 || at > sequenceLength) {
              throw new Error(`points[${index}] at=${at} is outside the current sequence length (${sequenceLength} steps)`);
            }
            return {
              at,
              value: Math.max(0, Math.min(1, point.value)),
              ...(point.interpolation ? { interpolation: point.interpolation } : {}),
              ...(point.tension !== undefined ? { tension: point.tension } : {}),
            };
          }).sort((a, b) => a.at - b.at);
        }

        const manageSequenceAction: AIManageSequenceAction = {
          type: 'manage_sequence',
          action: seqSubAction as AIManageSequenceAction['action'],
          trackId: seqTrackId,
          ...(args.patternId ? { patternId: args.patternId as string } : {}),
          ...(args.sequenceIndex !== undefined ? { sequenceIndex: args.sequenceIndex as number } : {}),
          ...(args.toIndex !== undefined ? { toIndex: args.toIndex as number } : {}),
          ...(args.controlId ? { controlId: args.controlId as string } : {}),
          ...(resolvedPoints ? { points: resolvedPoints } : {}),
          description: args.description as string,
        };

        const seqRejection = handleRejection(ctx?.validateAction?.(session, manageSequenceAction), session, manageSequenceAction, existingActions);
        if (seqRejection) return seqRejection;

        let projectedAfterSeq = session;
        switch (manageSequenceAction.action) {
          case 'append':
            projectedAfterSeq = manageSequenceAction.patternId
              ? addPatternRef(session, seqTrackId, manageSequenceAction.patternId)
              : session;
            break;
          case 'remove':
            projectedAfterSeq = manageSequenceAction.sequenceIndex !== undefined
              ? removePatternRef(session, seqTrackId, manageSequenceAction.sequenceIndex)
              : session;
            break;
          case 'reorder':
            projectedAfterSeq = (manageSequenceAction.sequenceIndex !== undefined && manageSequenceAction.toIndex !== undefined)
              ? reorderPatternRef(session, seqTrackId, manageSequenceAction.sequenceIndex, manageSequenceAction.toIndex)
              : session;
            break;
          case 'set_automation':
            projectedAfterSeq = (manageSequenceAction.controlId && manageSequenceAction.points)
              ? setSequenceAutomation(session, seqTrackId, manageSequenceAction.controlId, manageSequenceAction.points)
              : session;
            break;
          case 'clear_automation':
            projectedAfterSeq = manageSequenceAction.controlId
              ? clearSequenceAutomation(session, seqTrackId, manageSequenceAction.controlId)
              : session;
            break;
        }
        const seqTrack = projectedAfterSeq.tracks.find(v => v.id === seqTrackId);
        const currentSequence = seqTrack?.sequence.map((ref, i) => ({
          index: i,
          patternId: ref.patternId,
          ...(ref.automation && ref.automation.length > 0 ? {
            automation: ref.automation.map(lane => ({
              controlId: lane.controlId,
              points: lane.points.map(point => ({
                at: point.at,
                value: point.value,
              })),
            })),
          } : {}),
        })) ?? [];

        return {
          actions: [manageSequenceAction],
          response: {
            queued: true,
            action: seqSubAction,
            trackId: seqTrackId,
            currentSequence,
          },
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

      case 'set_chord_progression': {
        if (args.clear === true) {
          const clearAction: AISetChordProgressionAction = { type: 'set_chord_progression', chordProgression: null };
          return {
            actions: [clearAction],
            response: { applied: true, chord_progression: null, message: 'Chord progression cleared.' },
          };
        }

        if (!Array.isArray(args.chords) || args.chords.length === 0) {
          return { actions: [], response: errorPayload('Provide a non-empty chords array, or set clear: true to remove the chord progression.') };
        }

        const seenBars = new Set<number>();
        const chordProgression = [] as NonNullable<AISetChordProgressionAction['chordProgression']>;
        for (const [index, rawChord] of args.chords.entries()) {
          if (!rawChord || typeof rawChord !== 'object') {
            return { actions: [], response: errorPayload(`chords[${index}] must be an object with bar and chord.`) };
          }
          const barValue = Number((rawChord as Record<string, unknown>).bar);
          const chord = String((rawChord as Record<string, unknown>).chord ?? '').trim();
          if (!Number.isInteger(barValue) || barValue < 1) {
            return { actions: [], response: errorPayload(`chords[${index}].bar must be a positive integer.`) };
          }
          const bar = barValue;
          if (!chord) {
            return { actions: [], response: errorPayload(`chords[${index}].chord is required.`) };
          }
          if (seenBars.has(bar)) {
            return { actions: [], response: errorPayload(`Duplicate chord entry for bar ${bar}. Use one chord per bar.`) };
          }
          seenBars.add(bar);
          chordProgression.push({ bar, chord });
        }

        chordProgression.sort((a, b) => a.bar - b.bar);

        const setChordProgressionAction: AISetChordProgressionAction = {
          type: 'set_chord_progression',
          chordProgression,
        };

        return {
          actions: [setChordProgressionAction],
          response: {
            applied: true,
            chord_progression: chordProgression.map(entry => ({
              bar: entry.bar,
              chord: entry.chord,
              tones: getChordToneNames(entry.chord),
            })),
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
          return { actions: [], response: enrichedError(`Unknown chain recipe: "${args.recipe}"`, {
            hint: 'Use one of the built-in chain recipes.',
            available: CHAIN_RECIPE_NAMES,
          }) };
        }

        const recipeTrack = session.tracks.find(v => v.id === args.trackId);
        if (!recipeTrack) {
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
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
          return { actions: [], response: enrichedError(`Unknown mix role: "${args.role}"`, {
            hint: 'Use one of the built-in mix roles.',
            available: MIX_ROLE_NAMES,
          }) };
        }

        const roleTrack = session.tracks.find(v => v.id === args.trackId);
        if (!roleTrack) {
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
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

        // Build overrides from any explicit parameters
        const modOverrides: ModulationRecipeOverrides = {};
        if (typeof args.depth === 'number') modOverrides.depth = args.depth;
        if (typeof args.rate === 'number') modOverrides.rate = args.rate;
        if (typeof args.shape === 'number') modOverrides.shape = args.shape;
        if (typeof args.smoothness === 'number') modOverrides.smoothness = args.smoothness;
        if (typeof args.target === 'string' && args.target) modOverrides.target = args.target;
        const hasOverrides = Object.keys(modOverrides).length > 0;

        const modRecipe = resolveModulationRecipe(args.recipe as string, hasOverrides ? modOverrides : undefined);
        if (!modRecipe) {
          return { actions: [], response: enrichedError(`Unknown modulation recipe: "${args.recipe}"`, {
            hint: 'Use one of the built-in modulation recipes.',
            available: MODULATION_RECIPE_NAMES,
          }) };
        }

        const modTrack = session.tracks.find(v => v.id === args.trackId);
        if (!modTrack) {
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
        }

        // For processor-targeted recipes, find the target processor
        let targetProcessorId: string | undefined;
        if (modRecipe.routeTargetType === 'processor') {
          if (typeof args.processorId === 'string' && args.processorId) {
            // Use explicitly provided processor ID
            targetProcessorId = args.processorId as string;
            const exists = (modTrack.processors ?? []).some(p => p.id === targetProcessorId);
            if (!exists) {
              const procList = (modTrack.processors ?? []).map(p => `${p.id} (${getProcessorEngineName(p.type) ?? p.type})`);
              return { actions: [], response: enrichedError(`Processor "${targetProcessorId}" not found on track`, {
                hint: 'Use one of the processor IDs on this track.',
                available: procList,
              }) };
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
          const currentMods = (modTrack.modulators ?? []).map(m => getModulatorEngineName(m.type) ?? m.type);
          return { actions: [], response: enrichedError(modValidation.errors[0], {
            hint: `Current modulators: [${currentMods.join(', ')}]. Valid types: lfo, envelope.`,
            available: currentMods,
          }) };
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
            ...(hasOverrides ? { overridesApplied: modOverrides } : {}),
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
          return { actions: [], response: trackNotFoundError(String(trackId), session) };
        }

        // Resolve the Plaits engine ID from the track's model index
        const engineDef = plaitsInstrument.engines[track.model];
        if (!engineDef) {
          return { actions: [], response: enrichedError('Track has no recognized synth engine.', {
            hint: `Track model index is ${track.model}. This track may be a bus or have an unrecognized source.`,
          }) };
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
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
        }
        const track = session.tracks.find(t => t.id === trackId);
        if (!track) {
          return { actions: [], response: trackNotFoundError(String(trackId), session) };
        }

        const rawBands = args.bands as string[] | undefined;
        if (!rawBands || !Array.isArray(rawBands) || rawBands.length === 0) {
          return { actions: [], response: errorPayload('Missing required parameter: bands (non-empty array)') };
        }

        const validBands = rawBands.filter(b => (FREQUENCY_BANDS as readonly string[]).includes(b)) as FrequencyBand[];
        if (validBands.length === 0) {
          return { actions: [], response: errorPayload(`No valid frequency bands. Available: ${FREQUENCY_BANDS.join(', ')}`) };
        }

        const priority = typeof args.priority === 'number'
          ? Math.max(0, Math.min(10, Math.round(args.priority)))
          : inferSpectralPriorityFromRole(track.musicalRole);

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

      case 'relate': {
        const sourceTrackId = resolveTrackId(String(args.sourceTrackId ?? ''), session);
        if (!sourceTrackId) {
          return { actions: [], response: trackNotFoundError(String(args.sourceTrackId), session) };
        }
        const targetTrackId = resolveTrackId(String(args.targetTrackId ?? ''), session);
        if (!targetTrackId) {
          return { actions: [], response: trackNotFoundError(String(args.targetTrackId), session) };
        }
        if (sourceTrackId === targetTrackId) {
          return { actions: [], response: errorPayload('sourceTrackId and targetTrackId must be different tracks') };
        }

        const relation = args.relation as string | undefined;
        if (!relation) {
          return { actions: [], response: errorPayload('Missing required parameter: relation') };
        }
        if (typeof args.description !== 'string' || !args.description) {
          return { actions: [], response: errorPayload('Missing required parameter: description') };
        }

        const sourceTrack = session.tracks.find(track => track.id === sourceTrackId);
        const targetTrack = session.tracks.find(track => track.id === targetTrackId);
        if (!sourceTrack || !targetTrack) {
          return { actions: [], response: errorPayload('Source or target track not found') };
        }

        if (relation === 'align' || relation === 'complement') {
          if (sourceTrack.patterns.length === 0) {
            return { actions: [], response: errorPayload(`Source track ${sourceTrackId} has no patterns`) };
          }
          if (targetTrack.patterns.length === 0) {
            return { actions: [], response: errorPayload(`Target track ${targetTrackId} has no patterns`) };
          }
          try {
            const resolved = resolveRhythmicRelation(
              getActivePattern(sourceTrack),
              getActivePattern(targetTrack),
              relation,
            );
            const action: AISketchAction = {
              type: 'sketch',
              trackId: targetTrackId,
              description: args.description as string,
              events: resolved.events,
            };
            const rejection = ctx?.validateAction?.(session, action);
            const rejectionResult = handleRejection(rejection, session, action, existingActions);
            if (rejectionResult) return rejectionResult;

            return {
              actions: [action],
              response: {
                applied: true,
                sourceTrackId,
                targetTrackId,
                relation,
                sourceOnsets: resolved.sourceOnsets,
                targetOnsets: resolved.targetOnsets,
                resultingEventCount: resolved.events.length,
              },
            };
          } catch (error) {
            return { actions: [], response: errorPayload((error as Error).message) };
          }
        }

        if (relation === 'increase_contrast' || relation === 'decrease_contrast') {
          const dimension = args.dimension as 'brightness' | 'thickness' | undefined;
          if (!dimension) {
            return { actions: [], response: errorPayload('dimension is required for contrast relations') };
          }
          const amount = typeof args.amount === 'number' ? Math.max(0, Math.min(1, args.amount)) : 0.3;
          const plan = planContrastDirection(sourceTrack, targetTrack, relation, dimension);
          const engineDef = plaitsInstrument.engines[targetTrack.model];
          if (!engineDef) {
            return { actions: [], response: enrichedError('Target track has no recognized synth engine.', {
              hint: `Target model index is ${targetTrack.model}.`,
            }) };
          }

          const deltas = resolveTimbralMove(engineDef.id, plan.direction, amount);
          if (deltas.length === 0) {
            return { actions: [], response: errorPayload(`No timbral mapping for ${plan.direction} on engine ${engineDef.id}`) };
          }

          const actions: AIAction[] = deltas.map(({ param, delta }) => {
            const runtimeKey = controlIdToRuntimeParam[param] ?? param;
            const currentVal = targetTrack.params[runtimeKey] ?? 0.5;
            return {
              type: 'move',
              trackId: targetTrackId,
              param,
              target: { absolute: Math.max(0, Math.min(1, currentVal + delta)) },
            } satisfies AIMoveAction;
          });

          for (const action of actions) {
            const rejection = ctx?.validateAction?.(session, action);
            const rejectionResult = handleRejection(rejection, session, action, existingActions);
            if (rejectionResult) return rejectionResult;
          }

          return {
            actions,
            response: {
              applied: true,
              sourceTrackId,
              targetTrackId,
              relation,
              dimension,
              direction: plan.direction,
              sourceValue: Math.round(plan.sourceValue * 100) / 100,
              targetValue: Math.round(plan.targetValue * 100) / 100,
              amount,
            },
          };
        }

        if (relation === 'spectral_complement') {
          const sourceMetrics = ctx?.audioMetrics?.tracks[sourceTrackId];
          const targetMetrics = ctx?.audioMetrics?.tracks[targetTrackId];
          const resolved = inferSpectralComplementBands(sourceTrack, targetTrack, sourceMetrics, targetMetrics);
          const priority = inferSpectralPriorityFromRole(targetTrack.musicalRole);
          const slot = this.spectralSlots.assign(targetTrackId, resolved.targetBands, priority);
          const collisions = this.spectralSlots.detectCollisions();
          const adjustments = this.spectralSlots.computeAdjustments();
          const action: AIAssignSpectralSlotAction = {
            type: 'assign_spectral_slot',
            trackId: targetTrackId,
            bands: resolved.targetBands,
            priority,
          };
          const rejection = ctx?.validateAction?.(session, action);
          const rejectionResult = handleRejection(rejection, session, action, existingActions);
          if (rejectionResult) return rejectionResult;
          return {
            actions: [action],
            response: {
              applied: true,
              sourceTrackId,
              targetTrackId,
              relation,
              sourceBand: resolved.sourceBand,
              targetBands: resolved.targetBands,
              slot,
              collisions: collisions.length > 0 ? collisions : undefined,
              suggestedAdjustments: adjustments.length > 0 ? adjustments : undefined,
            },
          };
        }

        return { actions: [], response: errorPayload(`Unknown relation: ${relation}`) };
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
              return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
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
              return { actions: [], response: trackNotFoundError(String(rawTrackId), session) };
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

      case 'save_patch': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.name !== 'string' || !args.name.trim()) {
          return { actions: [], response: errorPayload('Missing required parameter: name') };
        }

        const saveTrack = session.tracks.find(v => v.id === args.trackId);
        if (!saveTrack) {
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
        }

        const tags = Array.isArray(args.tags)
          ? args.tags.filter((t): t is string => typeof t === 'string' && t.length > 0)
          : undefined;

        const patch = savePatch(saveTrack, (args.name as string).trim(), tags);

        // Add to in-memory cache
        this._userPatches.push(patch);

        // Persist to IndexedDB (fire-and-forget — doesn't block the tool response)
        import('../engine/patch-library').then(m => m.persistPatch(patch)).catch(err => {
          console.warn('[gluon-ai] Failed to persist patch to IndexedDB:', err);
        });

        return {
          actions: [],
          response: {
            saved: true,
            patchId: patch.id,
            name: patch.name,
            tags: patch.tags,
            engine: patch.engine,
            model: patch.model,
            processorCount: patch.processors?.length ?? 0,
            modulatorCount: patch.modulators?.length ?? 0,
          },
        };
      }

      case 'load_patch': {
        if (typeof args.trackId !== 'string' || !args.trackId) {
          return { actions: [], response: errorPayload('Missing required parameter: trackId') };
        }
        if (typeof args.patch !== 'string' || !args.patch.trim()) {
          return { actions: [], response: errorPayload('Missing required parameter: patch (name or ID)') };
        }

        const loadTrack = session.tracks.find(v => v.id === args.trackId);
        if (!loadTrack) {
          return { actions: [], response: trackNotFoundError(String(args.trackId), session) };
        }

        // Lazy-load user patches from IndexedDB on first access
        if (!this._userPatchesLoaded) {
          try {
            const m = await import('../engine/patch-library');
            this._userPatches = await m.loadUserPatches();
          } catch {
            // IndexedDB not available (e.g. test environment) — continue with empty cache
          }
          this._userPatchesLoaded = true;
        }

        const allPatches = getAllPatches(this._userPatches);
        const patch = findPatch(allPatches, (args.patch as string).trim());
        if (!patch) {
          return { actions: [], response: enrichedError(`Patch not found: "${args.patch}"`, {
            hint: 'Use list_patches to see available patches.',
            builtIn: BUILT_IN_PATCHES.map(p => p.name),
            userCount: this._userPatches.length,
          }) };
        }

        // Build actions to apply the patch. We use a composite set of actions:
        // 1. Remove existing processors/modulators/modulations
        // 2. Set model
        // 3. Set params
        // 4. Add new processors with params
        // 5. Add new modulators with modulation routings
        const loadActions: AIAction[] = [];
        const trackId = args.trackId as string;

        // Remove existing modulations first (before removing modulators)
        for (const mod of loadTrack.modulations ?? []) {
          const disconnectAction: AIDisconnectModulatorAction = {
            type: 'disconnect_modulator',
            trackId,
            modulationId: mod.id,
            description: `Remove modulation for patch "${patch.name}"`,
          };
          loadActions.push(disconnectAction);
        }

        // Remove existing modulators
        for (const mod of loadTrack.modulators ?? []) {
          const removeModAction: AIRemoveModulatorAction = {
            type: 'remove_modulator',
            trackId,
            modulatorId: mod.id,
            description: `Remove modulator for patch "${patch.name}"`,
          };
          loadActions.push(removeModAction);
        }

        // Remove existing processors
        for (const proc of loadTrack.processors ?? []) {
          const removeAction: AIRemoveProcessorAction = {
            type: 'remove_processor',
            trackId,
            processorId: proc.id,
            description: `Remove ${proc.type} for patch "${patch.name}"`,
          };
          loadActions.push(removeAction);
        }

        // Set model
        const modelEngine = plaitsInstrument.engines[patch.model];
        if (modelEngine) {
          const setModelAction: AISetModelAction = {
            type: 'set_model',
            trackId,
            model: modelEngine.id,
          };
          loadActions.push(setModelAction);
        }

        // Set source params
        for (const [param, value] of Object.entries(patch.params)) {
          const moveAction: AIMoveAction = {
            type: 'move',
            trackId,
            param,
            target: { absolute: value },
          };
          loadActions.push(moveAction);
        }

        // Add processors
        const now = Date.now();
        const procIdMap = new Map<string, string>();
        for (let i = 0; i < (patch.processors?.length ?? 0); i++) {
          const rp = patch.processors![i];
          const procId = `${rp.type}-${now + i}`;
          procIdMap.set(rp.id, procId);

          const addAction: AIAddProcessorAction = {
            type: 'add_processor',
            trackId,
            moduleType: rp.type,
            processorId: procId,
            description: `Add ${rp.type} for patch "${patch.name}"`,
          };
          loadActions.push(addAction);

          // Set processor model if not default (0)
          if (rp.model !== 0) {
            const procModelName = getProcessorEngineName(rp.type, rp.model);
            if (procModelName) {
              const setProcModel: AISetModelAction = {
                type: 'set_model',
                trackId,
                processorId: procId,
                model: procModelName,
              };
              loadActions.push(setProcModel);
            }
          }

          // Set processor params
          for (const [param, value] of Object.entries(rp.params)) {
            const moveAction: AIMoveAction = {
              type: 'move',
              trackId,
              processorId: procId,
              param,
              target: { absolute: value },
            };
            loadActions.push(moveAction);
          }
        }

        // Add modulators
        const modIdMap = new Map<string, string>();
        for (let i = 0; i < (patch.modulators?.length ?? 0); i++) {
          const rm = patch.modulators![i];
          const modId = `${rm.type}-${now + 100 + i}`;
          modIdMap.set(rm.id, modId);

          const addModAction: AIAddModulatorAction = {
            type: 'add_modulator',
            trackId,
            moduleType: rm.type,
            modulatorId: modId,
            description: `Add ${rm.type} modulator for patch "${patch.name}"`,
          };
          loadActions.push(addModAction);

          // Set modulator model
          if (rm.model !== 0) {
            const modModelName = getModulatorEngineName(rm.type, rm.model);
            if (modModelName) {
              const setModModel: AISetModelAction = {
                type: 'set_model',
                trackId,
                modulatorId: modId,
                model: modModelName,
              };
              loadActions.push(setModModel);
            }
          }

          // Set modulator params
          for (const [param, value] of Object.entries(rm.params)) {
            const moveAction: AIMoveAction = {
              type: 'move',
              trackId,
              modulatorId: modId,
              param,
              target: { absolute: value },
            };
            loadActions.push(moveAction);
          }
        }

        // Connect modulation routings
        for (let i = 0; i < (patch.modulations?.length ?? 0); i++) {
          const routing = patch.modulations![i];
          const newModulatorId = modIdMap.get(routing.modulatorId) ?? routing.modulatorId;
          const newTarget = { ...routing.target } as ModulationTarget;
          if (newTarget.kind === 'processor' && procIdMap.has(newTarget.processorId)) {
            newTarget.processorId = procIdMap.get(newTarget.processorId)!;
          }

          const connectAction: AIConnectModulatorAction = {
            type: 'connect_modulator',
            trackId,
            modulatorId: newModulatorId,
            target: newTarget,
            depth: routing.depth,
            modulationId: `mod-route-${now + 200 + i}`,
            description: `Connect modulation for patch "${patch.name}"`,
          };
          loadActions.push(connectAction);
        }

        return {
          actions: loadActions,
          response: {
            applied: true,
            trackId,
            patchName: patch.name,
            patchId: patch.id,
            builtIn: patch.builtIn ?? false,
            actionsGenerated: loadActions.length,
            engine: patch.engine,
            model: patch.model,
            processorTypes: patch.processors?.map(p => p.type) ?? [],
            modulatorTypes: patch.modulators?.map(m => m.type) ?? [],
          },
        };
      }

      case 'list_patches': {
        // Lazy-load user patches from IndexedDB on first access
        if (!this._userPatchesLoaded) {
          try {
            const m = await import('../engine/patch-library');
            this._userPatches = await m.loadUserPatches();
          } catch {
            // IndexedDB not available (e.g. test environment) — continue with empty cache
          }
          this._userPatchesLoaded = true;
        }

        const allPatches = getAllPatches(this._userPatches);
        const tagFilter = typeof args.tag === 'string' ? args.tag : undefined;
        const patchList = listPatches(allPatches, tagFilter);

        return {
          actions: [],
          response: {
            patches: patchList,
            total: patchList.length,
            builtInCount: BUILT_IN_PATCHES.length,
            userCount: this._userPatches.length,
          },
        };
      }

      case 'suggest_reactions': {
        const raw = Array.isArray(args.reactions) ? args.reactions : [];
        // Validate and sanitize: short strings only, cap at 5
        const reactions = raw
          .filter((r): r is string => typeof r === 'string' && r.length > 0)
          .map(r => r.slice(0, 20))
          .slice(0, 5);
        return {
          actions: [],
          response: { applied: true, reactions },
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
    onListenEvent?: (event: import('../engine/types').ListenEvent) => void,
  ): Promise<Record<string, unknown>> {
    if (!listen) {
      return { error: 'Listen not available.' };
    }

    try {
      listen.onListening?.(true);

      const wavBlob = await listen.renderOffline(session, trackIds, bars);
      const state = this.buildCompressedState(session, ctx);

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

      // Emit listen event for inline playback in chat
      if (onListenEvent) {
        const audioUrl = URL.createObjectURL(wavBlob);
        const scopeLabel = trackIds
          ? trackIds.map(id => {
              const t = session.tracks.find(v => v.id === id);
              return t?.name ?? id;
            }).join(', ')
          : 'full mix';
        const evaluationText = rubric
          ? undefined
          : (typeof critique === 'string' ? critique : undefined);
        onListenEvent({
          audioUrl,
          duration: bars * (4 * 60 / (session.transport.bpm ?? 120)),
          evaluation: evaluationText,
          isDiff: false,
          label: lens ?? undefined,
          scope: scopeLabel,
        });
      }

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
    onListenEvent?: (event: import('../engine/types').ListenEvent) => void,
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
      const state = this.buildCompressedState(session, ctx);

      const critique = await this.evaluateWithListeners({
        systemPrompt: buildComparePrompt(question, lens),
        stateJson: JSON.stringify(state),
        question,
        audioData: wavBlob,
        mimeType: 'audio/wav',
      });

      // Emit listen event for inline playback in chat
      if (onListenEvent) {
        const audioUrl = URL.createObjectURL(wavBlob);
        const scopeLabel = trackIds
          ? trackIds.map(id => {
              const t = session.tracks.find(v => v.id === id);
              return t?.name ?? id;
            }).join(', ')
          : 'full mix';
        onListenEvent({
          audioUrl,
          duration: bars * (4 * 60 / (session.transport.bpm ?? 120)),
          evaluation: typeof critique === 'string' ? critique : undefined,
          isDiff: false,
          label: lens ?? 'compare',
          scope: scopeLabel,
        });
      }

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
      throw new ProviderError('Audio evaluation unavailable — no listener model configured.', 'auth');
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
    // Clear project-scoped AI state so it doesn't leak across projects
    this.spectralSlots.clear();
    this.motifLibrary.clear();
    this.recentAutoDiffs = [];
    this.turnAutoDiffs = [];
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
  private async trimToTokenBudget(
    session: Session,
    humanMessage: string,
    stateJson: string,
    _ctx?: AskContext,
  ): Promise<void> {
    const planner = this.planner;

    // If provider doesn't support token counting, use the fallback exchange cap
    if (!planner.countContextTokens || !planner.getTokenBudget) {
      planner.trimHistory(GluonAI.FALLBACK_MAX_EXCHANGES);
      return;
    }

    const budget = planner.getTokenBudget();
    const exchangeCount = planner.getExchangeCount?.() ?? 0;

    // Skip token counting on first turn — no history to trim, and countTokens
    // adds 1-2 API round trips of latency before the user sees anything.
    if (exchangeCount === 0) return;

    const systemPrompt = buildSystemPrompt(session);
    const buildProjectedUserMessage = (): string =>
      buildPlannerUserMessage(
        stateJson,
        humanMessage,
        null,
        planner.getContextSummary?.() ?? null,
      );

    try {
      let tokenCount = await planner.countContextTokens(
        systemPrompt,
        GLUON_TOOLS,
        buildProjectedUserMessage(),
      );
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

      // Summarize dropped exchanges before trimming (Phase 2, #785)
      if (planner.summarizeBeforeTrim) {
        const dropped = extractOldestExchanges(session.messages, estimatedDrop);
        await planner.summarizeBeforeTrim(dropped, keepCount);
      } else {
        planner.trimHistory(keepCount);
      }
      tokenCount = await planner.countContextTokens(
        systemPrompt,
        GLUON_TOOLS,
        buildProjectedUserMessage(),
      );
      console.debug(
        `[gluon-ai] trimmed to ${keepCount} exchanges, now ${tokenCount} tokens`,
      );

      // Fine-tune: if still over, drop one more at a time (max 5 rounds).
      // Each round also summarizes the next-oldest exchange to avoid silent loss.
      let currentKeep = keepCount;
      let fineTuneRounds = 0;
      // Track the message-index boundary of already-dropped exchanges to avoid
      // recomputing it each round (reviewer P2: eliminate redundant extraction).
      let prevDropBoundary = extractOldestExchanges(session.messages, estimatedDrop).length;
      for (let round = 0; round < 5 && tokenCount > budget && currentKeep > 1; round++) {
        currentKeep--;
        fineTuneRounds++;
        if (planner.summarizeBeforeTrim) {
          const totalDropped = exchangeCount - currentKeep;
          const allDropped = extractOldestExchanges(session.messages, totalDropped);
          // Only the newly dropped exchange (tail beyond previous boundary)
          const newlyDropped = allDropped.slice(prevDropBoundary);
          prevDropBoundary = allDropped.length;
          await planner.summarizeBeforeTrim(newlyDropped, currentKeep);
        } else {
          planner.trimHistory(currentKeep);
        }
        tokenCount = await planner.countContextTokens(
          systemPrompt,
          GLUON_TOOLS,
          buildProjectedUserMessage(),
        );
        console.debug(
          `[gluon-ai] fine-trim to ${currentKeep} exchanges, now ${tokenCount} tokens`,
        );
      }
      if (fineTuneRounds > 0) {
        console.debug(
          `[gluon-ai] context trimming required ${fineTuneRounds} fine-tune round(s) with summarization`,
        );
      }
    } catch (error) {
      // If countTokens fails (e.g. network issue), fall back to exchange cap
      if (!this.countTokensFallbackWarned) {
        this.countTokensFallbackWarned = true;
        console.warn('[gluon-ai] countTokens failed, falling back to exchange cap:', error);
      }
      planner.trimHistory(GluonAI.FALLBACK_MAX_EXCHANGES);
    }
  }
}
