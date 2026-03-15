// src/ai/state-compression.ts
import type { Session, Track, ApprovalLevel, Reaction } from '../engine/types';
import { getModelName, runtimeParamToControlId, getProcessorEngineName, getModulatorEngineName } from '../audio/instrument-registry';
import { getTrackLabel } from '../engine/track-labels';

interface CompressedPattern {
  length: number;
  event_count: number;
  triggers: number[];
  notes: { at: number; pitch: number; vel: number }[];
  accents: number[];
  param_locks: { at: number; params: Record<string, number> }[];
  density: number;
}

interface CompressedProcessor {
  id: string;
  type: string;
  model: string;
  params: Record<string, number>;
}

interface CompressedModulator {
  id: string;
  type: string;
  model: string;
  params: Record<string, number>;
}

interface CompressedModulation {
  id: string;
  modulatorId: string;
  target: string;  // "source:brightness" or "processor:rings-xxx:position"
  depth: number;
}

interface CompressedTrack {
  id: string;
  label: string;
  model: string;
  params: Record<string, number>;
  agency: string;
  approval: ApprovalLevel;
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
  pattern: CompressedPattern;
  views: string[];
  processors: CompressedProcessor[];
  modulators: CompressedModulator[];
  modulations: CompressedModulation[];
}

interface CompressedReaction {
  actionGroupIndex: number;
  verdict: 'approved' | 'rejected' | 'neutral';
  rationale?: string;
  age_ms: number;
}

interface CompressedHumanAction {
  trackId: string;
  param: string;
  from: number;
  to: number;
  age_ms: number;
}

export interface CompressedState {
  tracks: CompressedTrack[];
  activeTrackId: string;
  transport: { bpm: number; swing: number; playing: boolean };
  context: { energy: number; density: number };
  undo_depth: number;
  recent_human_actions: CompressedHumanAction[];
  recent_reactions: CompressedReaction[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function modelName(model: number): string {
  const name = getModelName(model);
  return name.toLowerCase().replace(/[\s/]+/g, '_');
}

function compressPattern(track: Track): CompressedPattern {
  const region = track.regions[0];
  if (!region) {
    return { length: track.pattern.length, event_count: 0, triggers: [], notes: [], accents: [], param_locks: [], density: 0 };
  }

  const events = region.events;
  const triggers: number[] = [];
  const notes: { at: number; pitch: number; vel: number }[] = [];
  const accents: number[] = [];
  const paramMap = new Map<string, Record<string, number>>();

  for (const e of events) {
    switch (e.kind) {
      case 'trigger':
        if (e.velocity !== 0) {
          triggers.push(round2(e.at));
          if (e.accent || (e.velocity !== undefined && e.velocity >= 0.95)) {
            accents.push(round2(e.at));
          }
        }
        break;
      case 'note':
        notes.push({ at: round2(e.at), pitch: e.pitch, vel: round2(e.velocity) });
        if (e.velocity >= 0.95) {
          accents.push(round2(e.at));
        }
        break;
      case 'parameter': {
        const bucket = String(round2(e.at));
        const existing = paramMap.get(bucket) ?? {};
        existing[e.controlId] = round2(e.value as number);
        paramMap.set(bucket, existing);
        break;
      }
    }
  }

  const param_locks = Array.from(paramMap.entries()).map(([atStr, params]) => ({
    at: Number(atStr),
    params,
  }));

  const soundEvents = triggers.length + notes.length;
  const density = region.duration > 0 ? round2(soundEvents / region.duration) : 0;

  return {
    length: region.duration,
    event_count: events.length,
    triggers,
    notes,
    accents,
    param_locks,
    density,
  };
}

export function compressState(session: Session): CompressedState {
  const now = Date.now();
  const result: CompressedState = {
    tracks: session.tracks.map(track => ({
      id: track.id,
      label: getTrackLabel(track),
      model: modelName(track.model),
      params: {
        brightness: round2(track.params.timbre),
        richness: round2(track.params.harmonics),
        texture: round2(track.params.morph),
        pitch: round2(track.params.note),
      },
      agency: track.agency,
      approval: track.approval ?? 'exploratory',
      muted: track.muted,
      solo: track.solo,
      volume: round2(track.volume),
      pan: round2(track.pan),
      pattern: compressPattern(track),
      views: (track.views ?? []).map(v => `${v.kind}:${v.id}`),
      processors: (track.processors ?? []).map(p => ({
        id: p.id,
        type: p.type,
        model: getProcessorEngineName(p.type, p.model) ?? String(p.model),
        params: Object.fromEntries(Object.entries(p.params).map(([k, v]) => [k, round2(v)])),
      })),
      modulators: (track.modulators ?? []).map(m => ({
        id: m.id,
        type: m.type,
        model: getModulatorEngineName(m.type, m.model) ?? String(m.model),
        params: Object.fromEntries(Object.entries(m.params).map(([k, v]) => [k, round2(v)])),
      })),
      modulations: (track.modulations ?? []).map(r => ({
        id: r.id,
        modulatorId: r.modulatorId,
        target: r.target.kind === 'source'
          ? `source:${r.target.param}`
          : `processor:${r.target.processorId}:${r.target.param}`,
        depth: round2(r.depth),
      })),
      ...(track.surface.semanticControls.length > 0 ? {
        surface_semantic: track.surface.semanticControls.map(sc => sc.name),
        surface_xy: `${track.surface.xyAxes.x} x ${track.surface.xyAxes.y}`,
      } : {}),
      ...(track.surface.pinnedControls.length > 0 ? {
        surface_pinned: track.surface.pinnedControls.map(p => `${p.moduleId}:${p.controlId}`),
      } : {}),
    })),
    activeTrackId: session.activeTrackId,
    transport: {
      bpm: session.transport.bpm,
      swing: round2(session.transport.swing),
      playing: session.transport.playing,
    },
    context: {
      energy: round2(session.context.energy),
      density: round2(session.context.density),
    },
    undo_depth: session.undoStack.length,
    recent_human_actions: session.recentHumanActions.slice(-5).map(a => ({
      trackId: a.trackId,
      param: runtimeParamToControlId[a.param] ?? a.param,
      from: round2(a.from),
      to: round2(a.to),
      age_ms: now - a.timestamp,
    })),
    recent_reactions: (session.reactionHistory ?? []).slice(-10).map((r: Reaction) => ({
      actionGroupIndex: r.actionGroupIndex,
      verdict: r.verdict,
      ...(r.rationale ? { rationale: r.rationale } : {}),
      age_ms: now - r.timestamp,
    })),
  };

  return result;
}
