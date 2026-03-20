// src/audio/render-spec.ts
// Converts session state into a serializable RenderSpec for the offline render Worker.

import type { Session, Track, ProcessorConfig, ModulatorConfig, ModulationRouting, DrumPad } from '../engine/types';
import type { SynthParamValues } from '../engine/types';
import { getActivePattern, getTrackKind, MASTER_BUS_ID } from '../engine/types';
import type { PatternRef, TransportMode } from '../engine/sequencer-types';
import type { MusicalEvent, NoteEvent, TriggerEvent, ParameterEvent } from '../engine/canonical-types';
import { controlIdToRuntimeParam } from './instrument-registry';
import { getAudibleTracks, resolveEventParams } from '../engine/sequencer-helpers';
import { getInterpolatedParams } from '../engine/interpolation';
import { getSequenceAutomationValuesAt, hasSequenceAutomationPointAt } from '../engine/sequence-automation';

// ---------------------------------------------------------------------------
// Types — all plain data, safe to postMessage to a Worker
// ---------------------------------------------------------------------------

export interface RenderSpec {
  sampleRate: number;       // always 48000
  bpm: number;
  bars: number;
  master: RenderMasterSpec;
  tracks: RenderTrackSpec[];
}

export interface RenderMasterSpec {
  volume: number;
  pan: number;
}

export interface RenderTrackSpec {
  id: string;
  /** Plaits engine index (already offset by +8 for the Plaits C ABI). */
  model: number;
  /** Per-track volume (linear gain), 0.0–1.0 */
  volume: number;
  /** Per-track pan, -1.0 (left) to 1.0 (right) */
  pan: number;
  params: RenderSynthPatch;
  /** Plaits extended parameters (FM, LPG, etc.) */
  extendedParams: RenderPlaitsExtended;
  /** Portamento time (0-1, maps to 0-500ms) */
  portamentoTime: number;
  /** Portamento mode: 0=off, 1=always, 2=legato-only */
  portamentoMode: number;
  events: RenderEvent[];
  processors: RenderProcessorSpec[];
  modulators: RenderModulatorSpec[];
  modulations: RenderModulationSpec[];
  /** When true, this track is a drum-rack — events carry padId and `pads` has per-pad specs. */
  isDrumRack?: boolean;
  /** Per-pad source descriptors for drum-rack tracks. */
  pads?: RenderPadSpec[];
}

export interface RenderSynthPatch {
  harmonics: number;
  timbre: number;
  morph: number;
  note: number;
}

export interface RenderPlaitsExtended {
  fm_amount: number;
  timbre_mod_amount: number;
  morph_mod_amount: number;
  decay: number;
  lpg_colour: number;
}

export interface RenderProcessorSpec {
  type: 'rings' | 'clouds' | 'compressor' | 'beads';
  id: string;
  model: number;
  params: Record<string, number>;
  /** For compressors: the source track ID whose pre-rendered audio feeds the sidechain detector. */
  sidechainSourceTrackId?: string;
}

export interface RenderModulatorSpec {
  id: string;
  type: 'tides';
  model: number;
  params: {
    frequency: number;
    shape: number;
    slope: number;
    smoothness: number;
  };
  /** Tides extended parameters (shift, output mode, range). */
  extendedParams: {
    shift: number;
    output_mode: number;
    range: number;
  };
}

export type RenderModulationTargetSpec =
  | { kind: 'source'; param: keyof RenderSynthPatch }
  | { kind: 'processor'; processorId: string; param: string };

export interface RenderModulationSpec {
  id: string;
  modulatorId: string;
  target: RenderModulationTargetSpec;
  depth: number;
}

export interface RenderEvent {
  /** Absolute beat position (0-based, in steps — 16ths). */
  beatTime: number;
  type: 'trigger' | 'gate-on' | 'gate-off' | 'set-patch' | 'set-note' | 'set-extended';
  accentLevel?: number;
  patch?: Partial<RenderSynthPatch>;
  extended?: Partial<RenderPlaitsExtended>;
  note?: number;   // normalised 0-1 pitch for set-note
  /** For drum-rack tracks: which pad this event targets. */
  padId?: string;
}

/**
 * Per-pad source descriptor for drum-rack tracks.
 * Each pad has its own Plaits model/params so the renderer can instantiate
 * one synth voice per pad.
 */
export interface RenderPadSpec {
  id: string;
  /** Plaits engine index (already offset by +8). */
  model: number;
  params: RenderSynthPatch;
  extendedParams: RenderPlaitsExtended;
  /** Per-pad volume, 0.0–1.0 */
  level: number;
  /** Per-pad pan, 0.0–1.0 (0.5 = center) */
  pan: number;
  /** Choke group — pads sharing a group silence each other on trigger. */
  chokeGroup?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLUON_TO_PLAITS_ENGINE_OFFSET = 8;
const STEPS_PER_BAR = 16;
const NOTE_DURATION_STEPS = 0.25;  // default gate length for note events

/** Runtime param keys that belong to the Plaits extended surface (set via _plaits_set_extended). */
const EXTENDED_RUNTIME_KEYS = new Set([
  'fm_amount', 'timbre_mod_amount', 'morph_mod_amount', 'decay', 'lpg_colour',
]);

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a RenderSpec from the current session state.
 *
 * @param session  Current session
 * @param trackIds Optional subset of tracks to render. If omitted, all unmuted tracks.
 * @param bars     Number of bars to render (default 2)
 */
export function buildRenderSpec(
  session: Session,
  trackIds?: string[],
  bars = 2,
): RenderSpec {
  const selectedTracks = selectTracks(session, trackIds);
  const unsupportedRoutingReason = getUnsupportedOfflineRoutingReason(selectedTracks);
  if (unsupportedRoutingReason) {
    throw new Error(unsupportedRoutingReason);
  }
  const selectedIdSet = new Set(selectedTracks.map(t => t.id));
  const mode: TransportMode = session.transport.mode ?? 'pattern';

  // When rendering a subset, strip sidechain references whose source track
  // is not in the rendered set.  This avoids silent broken references and
  // logs a warning so callers can diagnose unexpected mix differences.
  const sanitisedTracks = trackIds
    ? selectedTracks.map(t => sanitiseSidechainRefs(t, selectedIdSet))
    : selectedTracks;

  return {
    sampleRate: 48000,
    bpm: session.transport.bpm,
    bars,
    master: {
      volume: session.master.volume,
      pan: session.master.pan,
    },
    tracks: sanitisedTracks.map(v => buildTrackSpec(v, bars, mode)),
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Strip sidechain source references from compressor processors when the
 * source track is not present in the rendered track set.  Logs a warning
 * so that callers know the sidechain was dropped for this render pass.
 */
function sanitiseSidechainRefs(track: Track, renderedIds: Set<string>): Track {
  const procs = track.processors;
  if (!procs || procs.length === 0) return track;

  let changed = false;
  const newProcs = procs.map(p => {
    if (p.type === 'compressor' && p.sidechainSourceId && !renderedIds.has(p.sidechainSourceId)) {
      console.warn(
        `[render-spec] Track "${track.id}" compressor "${p.id}": sidechain source "${p.sidechainSourceId}" excluded from render subset — disabling sidechain for this pass`,
      );
      const { sidechainSourceId: _, ...rest } = p;
      changed = true;
      return rest;
    }
    return p;
  });

  return changed ? { ...track, processors: newProcs } : track;
}

function selectTracks(session: Session, trackIds?: string[]): Track[] {
  if (trackIds && trackIds.length > 0) {
    const idSet = new Set(trackIds);
    return session.tracks.filter(v => idSet.has(v.id));
  }
  // Default: mirror the live engine's audible-track rule (solo-aware)
  return getAudibleTracks(session);
}

function getUnsupportedOfflineRoutingReason(tracks: Track[]): string | null {
  for (const track of tracks) {
    if (getTrackKind(track) !== 'audio') continue;
    const unsupportedSend = (track.sends ?? []).find(send => send.busId !== MASTER_BUS_ID && send.level > 0);
    if (unsupportedSend) {
      return `Offline render does not support send-return bus routing yet: track "${track.id}" sends to bus "${unsupportedSend.busId}".`;
    }
  }
  return null;
}

function buildTrackSpec(track: Track, bars: number, mode: TransportMode): RenderTrackSpec {
  const isDrumRack = track.engine === 'drum-rack';

  const params: RenderSynthPatch = {
    harmonics: track.params.harmonics,
    timbre: track.params.timbre,
    morph: track.params.morph,
    note: track.params.note,
  };

  const extendedParams: RenderPlaitsExtended = {
    fm_amount: track.params.fm_amount ?? 0.0,
    timbre_mod_amount: track.params.timbre_mod_amount ?? 0.0,
    morph_mod_amount: track.params.morph_mod_amount ?? 0.0,
    decay: track.params.decay ?? 0.5,
    lpg_colour: track.params.lpg_colour ?? 0.5,
  };

  const events = collectEvents(track, bars, mode);
  const processors = (track.processors ?? []).filter(p => p.enabled !== false).map(buildProcessorSpec);
  const modulators = (track.modulators ?? []).map(buildModulatorSpec);
  const modulations = buildModulationSpecs(track, modulators);

  const portamentoModeMap: Record<string, number> = { off: 0, always: 1, legato: 2 };
  const portamentoMode = portamentoModeMap[track.portamentoMode ?? 'off'] ?? 0;

  const spec: RenderTrackSpec = {
    id: track.id,
    model: clampModel(track.model) + GLUON_TO_PLAITS_ENGINE_OFFSET,
    volume: track.volume ?? 0.8,
    pan: track.pan ?? 0.0,
    params,
    extendedParams,
    portamentoTime: track.portamentoTime ?? 0,
    portamentoMode,
    events,
    processors,
    modulators,
    modulations,
  };

  if (isDrumRack && track.drumRack) {
    spec.isDrumRack = true;
    spec.pads = track.drumRack.pads.map(buildPadSpec);
  }

  return spec;
}

function buildPadSpec(pad: DrumPad): RenderPadSpec {
  const p = pad.source.params;
  return {
    id: pad.id,
    model: clampModel(pad.source.model) + GLUON_TO_PLAITS_ENGINE_OFFSET,
    params: {
      harmonics: p.harmonics ?? 0.5,
      timbre: p.timbre ?? 0.5,
      morph: p.morph ?? 0.5,
      note: p.note ?? 0.5,
    },
    extendedParams: {
      fm_amount: p.fm_amount ?? 0.0,
      timbre_mod_amount: p.timbre_mod_amount ?? 0.0,
      morph_mod_amount: p.morph_mod_amount ?? 0.0,
      decay: p.decay ?? 0.5,
      lpg_colour: p.lpg_colour ?? 0.5,
    },
    level: pad.level,
    pan: pad.pan,
    chokeGroup: pad.chokeGroup,
  };
}

function clampModel(model: number): number {
  return Math.max(0, Math.min(15, model));
}

function buildProcessorSpec(proc: ProcessorConfig): RenderProcessorSpec {
  return {
    type: proc.type as 'rings' | 'clouds' | 'compressor' | 'beads',
    id: proc.id,
    model: proc.model,
    params: { ...proc.params },
    ...(proc.sidechainSourceId ? { sidechainSourceTrackId: proc.sidechainSourceId } : {}),
  };
}

function buildModulatorSpec(mod: ModulatorConfig): RenderModulatorSpec {
  if (mod.type !== 'tides') {
    throw new Error(`Unsupported offline modulator type: ${mod.type}`);
  }
  return {
    id: mod.id,
    type: 'tides',
    model: mod.model,
    params: {
      frequency: mod.params.frequency ?? 0.5,
      shape: mod.params.shape ?? 0.5,
      slope: mod.params.slope ?? 0.5,
      smoothness: mod.params.smoothness ?? 0.5,
    },
    extendedParams: {
      shift: mod.params.shift ?? 0.0,
      output_mode: Math.round(mod.params['output-mode'] ?? 1),
      range: Math.round(mod.params.range ?? 0),
    },
  };
}

function buildModulationSpecs(track: Track, modulators: RenderModulatorSpec[]): RenderModulationSpec[] {
  const modulatorIds = new Set(modulators.map(mod => mod.id));
  const processorIds = new Set((track.processors ?? []).filter(p => p.enabled !== false).map(proc => proc.id));

  return (track.modulations ?? []).flatMap((routing: ModulationRouting) => {
    if (!modulatorIds.has(routing.modulatorId)) {
      return [];
    }
    if (routing.target.kind === 'source') {
      const runtimeParam = controlIdToRuntimeParam[routing.target.param] ?? routing.target.param;
      if (!isRenderSourceParam(runtimeParam)) {
        throw new Error(`Unsupported offline source modulation target: ${routing.target.param}`);
      }
      return [{
        id: routing.id,
        modulatorId: routing.modulatorId,
        target: { kind: 'source', param: runtimeParam },
        depth: routing.depth,
      }];
    }

    if (!processorIds.has(routing.target.processorId)) {
      return [];
    }

    return [{
      id: routing.id,
      modulatorId: routing.modulatorId,
      target: {
        kind: 'processor',
        processorId: routing.target.processorId,
        param: routing.target.param,
      },
      depth: routing.depth,
    }];
  });
}

function isRenderSourceParam(param: string): param is keyof RenderSynthPatch {
  return param === 'harmonics' || param === 'timbre' || param === 'morph' || param === 'note';
}

/**
 * Collect render events from a track's patterns, unrolled across the requested
 * number of bars.
 *
 * - **Pattern mode**: Loop only the active pattern for N bars.
 * - **Song mode**: Walk `track.sequence`, resolving each PatternRef to its
 *   pattern and playing them back-to-back.
 */
function collectEvents(track: Track, bars: number, mode: TransportMode): RenderEvent[] {
  const totalSteps = bars * STEPS_PER_BAR;
  const events: RenderEvent[] = [];

  if (mode === 'song') {
    // Song mode: walk the sequence back-to-back
    let offset = 0;
    for (const ref of track.sequence) {
      if (offset >= totalSteps) break;
      const pat = track.patterns.find(p => p.id === ref.patternId);
      if (!pat || pat.duration <= 0) {
        if (pat) offset += pat.duration;
        continue;
      }
      emitPatternEvents(events, pat, ref, offset, totalSteps, track.params);
      offset += pat.duration;
    }
  } else {
    // Pattern mode: loop the active pattern
    const active = getActivePattern(track);
    // Resolve the PatternRef for the active pattern so sequence automation is applied
    const patternRef = (track.sequence ?? []).find(r => r.patternId === active.id);
    const hasAutomation = (patternRef?.automation?.length ?? 0) > 0;
    if (active && (active.events.length > 0 || hasAutomation) && active.duration > 0) {
      let offset = 0;
      while (offset < totalSteps) {
        emitPatternEvents(events, active, patternRef, offset, totalSteps, track.params);
        offset += active.duration;
      }
    }
  }

  // Sort by beat time for the Worker's event scheduling
  events.sort((a, b) => a.beatTime - b.beatTime);
  return events;
}

/**
 * Emit render events for a single pattern instance at a given offset.
 */
function emitPatternEvents(
  out: RenderEvent[],
  pattern: import('../engine/canonical-types').Pattern,
  ref: PatternRef | undefined,
  offset: number,
  totalSteps: number,
  baseParams: SynthParamValues,
): void {
  pushSequenceAutomationEvents(out, pattern.events, ref, offset, pattern.duration, totalSteps);
  for (const ev of pattern.events) {
    const beatTime = offset + ev.at;
    if (beatTime >= totalSteps) break; // events are sorted ascending
    if (beatTime >= 0) {
      if (ev.kind === 'trigger' || ev.kind === 'note') {
        pushResolvedSequenceAutomationForEvent(out, pattern.events, ref, ev, beatTime, baseParams);
      }
      pushMusicalEvent(out, ev, beatTime, baseParams);
    }
  }
  // Emit interpolated parameter values at each integer step
  pushInterpolatedEvents(out, pattern.events, offset, pattern.duration, totalSteps);
}

function pushResolvedSequenceAutomationForEvent(
  out: RenderEvent[],
  patternEvents: MusicalEvent[],
  ref: PatternRef | undefined,
  event: TriggerEvent | NoteEvent,
  beatTime: number,
  baseParams: SynthParamValues,
): void {
  const sequenceAutomationValues = getSequenceAutomationValuesAt(ref, event.at);
  if (Object.keys(sequenceAutomationValues).length === 0) return;

  const automatedBaseParams = {
    ...baseParams,
    ...Object.fromEntries(
      Object.entries(sequenceAutomationValues).map(([controlId, value]) => [
        controlIdToRuntimeParam[controlId] ?? controlId,
        value,
      ]),
    ),
  };
  const resolvedParams = resolveEventParams(
    patternEvents,
    event.at,
    automatedBaseParams,
    {},
    (controlId) => controlIdToRuntimeParam[controlId] ?? controlId,
  );

  const patch: Partial<RenderSynthPatch> = {};
  if (typeof resolvedParams.harmonics === 'number') patch.harmonics = resolvedParams.harmonics;
  if (typeof resolvedParams.timbre === 'number') patch.timbre = resolvedParams.timbre;
  if (typeof resolvedParams.morph === 'number') patch.morph = resolvedParams.morph;
  if (event.kind !== 'note' && typeof resolvedParams.note === 'number') patch.note = resolvedParams.note;

  const extended: Partial<RenderPlaitsExtended> = {};
  if (typeof resolvedParams.fm_amount === 'number') extended.fm_amount = resolvedParams.fm_amount;
  if (typeof resolvedParams.timbre_mod_amount === 'number') extended.timbre_mod_amount = resolvedParams.timbre_mod_amount;
  if (typeof resolvedParams.morph_mod_amount === 'number') extended.morph_mod_amount = resolvedParams.morph_mod_amount;
  if (typeof resolvedParams.decay === 'number') extended.decay = resolvedParams.decay;
  if (typeof resolvedParams.lpg_colour === 'number') extended.lpg_colour = resolvedParams.lpg_colour;

  if (Object.keys(patch).length > 0) {
    out.push({ beatTime, type: 'set-patch', patch });
  }
  if (Object.keys(extended).length > 0) {
    out.push({ beatTime, type: 'set-extended', extended });
  }
}

function pushSequenceAutomationEvents(
  out: RenderEvent[],
  patternEvents: MusicalEvent[],
  ref: PatternRef | undefined,
  regionOffset: number,
  regionDuration: number,
  totalSteps: number,
): void {
  for (const lane of ref?.automation ?? []) {
    for (const point of lane.points) {
      const beatTime = regionOffset + point.at;
      if (point.at >= regionDuration || beatTime >= totalSteps || beatTime < 0) continue;
      if (patternEvents.some(event =>
        event.kind === 'parameter'
        && (event as ParameterEvent).controlId === lane.controlId
        && Math.abs(event.at - point.at) < 0.0001
      )) {
        continue;
      }
      pushMusicalEvent(out, {
        kind: 'parameter',
        at: point.at,
        controlId: lane.controlId,
        value: point.value,
      }, beatTime, {} as SynthParamValues);
    }
  }

  for (let step = 0; step < regionDuration; step++) {
    const beatTime = regionOffset + step;
    if (beatTime >= totalSteps) break;
    const values = getSequenceAutomationValuesAt(ref, step);
    for (const [controlId, value] of Object.entries(values)) {
      if (hasSequenceAutomationPointAt(ref, controlId, step)) continue;
      if (patternEvents.some(event =>
        event.kind === 'parameter'
        && (event as ParameterEvent).controlId === controlId
        && Math.abs(event.at - step) < 0.0001
      )) {
        continue;
      }
      pushMusicalEvent(out, {
        kind: 'parameter',
        at: step,
        controlId,
        value,
      }, beatTime, {} as SynthParamValues);
    }
  }
}

/**
 * Convert a canonical MusicalEvent into one or more RenderEvents.
 */
function pushMusicalEvent(
  out: RenderEvent[],
  event: MusicalEvent,
  beatTime: number,
  _baseParams: SynthParamValues,
): void {
  switch (event.kind) {
    case 'trigger': {
      const te = event as TriggerEvent;
      const padId = te.padId;
      out.push({
        beatTime,
        type: 'trigger',
        accentLevel: te.accent ? 1.0 : (te.velocity ?? 0.8),
        ...(padId ? { padId } : {}),
      });
      out.push({ beatTime, type: 'gate-on', ...(padId ? { padId } : {}) });
      out.push({ beatTime: beatTime + (te.gate ?? 1), type: 'gate-off', ...(padId ? { padId } : {}) });
      break;
    }
    case 'note': {
      const ne = event as NoteEvent;
      // Convert MIDI pitch to normalised 0-1
      const normPitch = Math.max(0, Math.min(1, ne.pitch / 127));
      out.push({
        beatTime,
        type: 'set-note',
        note: normPitch,
      });
      out.push({
        beatTime,
        type: 'set-patch',
        patch: { note: normPitch },
      });
      out.push({
        beatTime,
        type: 'trigger',
        accentLevel: ne.velocity ?? 0.8,
      });
      out.push({ beatTime, type: 'gate-on' });
      out.push({ beatTime: beatTime + (ne.duration ?? NOTE_DURATION_STEPS), type: 'gate-off' });
      break;
    }
    case 'parameter': {
      const pe = event as ParameterEvent;
      // Map semantic control ID to runtime param name
      const runtimeParam = controlIdToRuntimeParam[pe.controlId] ?? pe.controlId;
      if (typeof pe.value === 'number') {
        if (EXTENDED_RUNTIME_KEYS.has(runtimeParam)) {
          out.push({
            beatTime,
            type: 'set-extended',
            extended: { [runtimeParam]: pe.value } as Partial<RenderPlaitsExtended>,
          });
        } else {
          out.push({
            beatTime,
            type: 'set-patch',
            patch: { [runtimeParam]: pe.value } as Partial<RenderSynthPatch>,
          });
        }
      }
      break;
    }
  }
}

/**
 * Generate interpolated set-patch events at each integer step between
 * parameter events that have linear or curve interpolation.
 */
function pushInterpolatedEvents(
  out: RenderEvent[],
  regionEvents: MusicalEvent[],
  regionOffset: number,
  regionDuration: number,
  totalSteps: number,
): void {
  for (let step = 0; step < regionDuration; step++) {
    const beatTime = regionOffset + step;
    if (beatTime >= totalSteps) break;
    if (beatTime < 0) continue;

    const interpolated = getInterpolatedParams(regionEvents, step, regionDuration);
    for (const { controlId, value } of interpolated) {
      const runtimeParam = controlIdToRuntimeParam[controlId] ?? controlId;
      if (EXTENDED_RUNTIME_KEYS.has(runtimeParam)) {
        out.push({
          beatTime,
          type: 'set-extended',
          extended: { [runtimeParam]: value } as Partial<RenderPlaitsExtended>,
        });
      } else {
        out.push({
          beatTime,
          type: 'set-patch',
          patch: { [runtimeParam]: value } as Partial<RenderSynthPatch>,
        });
      }
    }
  }
}
