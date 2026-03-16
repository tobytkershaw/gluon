// src/ai/state-compression.ts
import type { Session, Track, ApprovalLevel, Reaction, OpenDecision, PreservationReport } from '../engine/types';
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
  target: string;  // "source:timbre" or "processor:rings-xxx:position"
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
  importance?: number;
  musicalRole?: string;
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

export type RestraintLevel = 'conservative' | 'moderate' | 'adventurous';

interface CompressedDecision {
  id: string;
  question: string;
  context?: string;
  options?: string[];
  trackIds?: string[];
}

/** Compressed summary of a preservation report for inclusion in AI state. */
interface CompressedPreservationReport {
  trackId: string;
  approval: ApprovalLevel;
  preserved: string[];   // e.g. ["rhythm", "event_count"]
  changed: string[];     // from PreservationReport.changed
}

export interface CompressedState {
  tracks: CompressedTrack[];
  activeTrackId: string;
  transport: { bpm: number; swing: number; playing: boolean };
  context: { energy: number; density: number };
  undo_depth: number;
  recent_human_actions: CompressedHumanAction[];
  recent_reactions: CompressedReaction[];
  observed_patterns: string[];
  restraint_level: RestraintLevel;
  open_decisions: CompressedDecision[];
  recent_preservation?: CompressedPreservationReport[];
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

// ---------------------------------------------------------------------------
// Observed patterns & restraint — derived from reaction history
// ---------------------------------------------------------------------------

/** Window of recent reactions used for pattern analysis. */
const RECENT_WINDOW = 10;

/** Minimum reactions needed before deriving any patterns. */
const MIN_REACTIONS_FOR_PATTERNS = 3;

/**
 * Extract recurring keyword themes from rationale strings.
 * Returns keyword → count for keywords that appear in at least 2 rationales.
 */
function extractRationaleKeywords(reactions: Reaction[]): Map<string, number> {
  const counts = new Map<string, number>();
  // Common words to exclude
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'was', 'it', 'too', 'very', 'and', 'or', 'but',
    'not', 'no', 'this', 'that', 'i', 'my', 'to', 'of', 'in', 'for', 'on',
    'with', 'do', 'did', 'be', 'have', 'has', 'had', 'so', 'just', 'like',
  ]);

  for (const r of reactions) {
    if (!r.rationale) continue;
    const words = r.rationale
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    // Deduplicate within a single rationale to avoid one verbose comment dominating
    const unique = new Set(words);
    for (const word of unique) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  // Only keep keywords appearing in at least 2 rationales
  const result = new Map<string, number>();
  for (const [word, count] of counts) {
    if (count >= 2) result.set(word, count);
  }
  return result;
}

/**
 * Derive natural-language pattern descriptions from reaction history.
 *
 * Simple, deterministic analysis:
 * - Overall approval rate in recent window
 * - Verdict clustering (streaks)
 * - Recurring rationale keywords in rejected vs approved reactions
 */
export function deriveObservedPatterns(reactions: Reaction[]): string[] {
  if (reactions.length < MIN_REACTIONS_FOR_PATTERNS) return [];

  const recent = reactions.slice(-RECENT_WINDOW);
  const patterns: string[] = [];

  const approved = recent.filter(r => r.verdict === 'approved').length;
  const rejected = recent.filter(r => r.verdict === 'rejected').length;
  const total = recent.length;

  // 1. Overall approval rate
  const approvalRate = approved / total;
  const rejectionRate = rejected / total;

  if (approvalRate >= 0.7) {
    patterns.push(`Human has approved ${approved} of last ${total} AI actions — generally receptive`);
  } else if (rejectionRate >= 0.7) {
    patterns.push(`Human has rejected ${rejected} of last ${total} AI actions — generally unreceptive`);
  } else if (rejectionRate >= 0.4) {
    patterns.push(`Mixed reactions: ${approved} approved, ${rejected} rejected out of last ${total} actions`);
  }

  // 2. Recent streak detection (last 3+ consecutive same verdict)
  if (recent.length >= 3) {
    const lastVerdict = recent[recent.length - 1].verdict;
    let streakLen = 1;
    for (let i = recent.length - 2; i >= 0; i--) {
      if (recent[i].verdict === lastVerdict) streakLen++;
      else break;
    }
    if (streakLen >= 3 && lastVerdict !== 'neutral') {
      patterns.push(
        lastVerdict === 'rejected'
          ? `Last ${streakLen} actions were all rejected — recent approach is not working`
          : `Last ${streakLen} actions were all approved — current direction is working well`
      );
    }
  }

  // 3. Keyword themes from rejected rationales
  const rejectedReactions = recent.filter(r => r.verdict === 'rejected');
  if (rejectedReactions.length >= 2) {
    const keywords = extractRationaleKeywords(rejectedReactions);
    // Take top 2 keywords by frequency
    const sorted = [...keywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    for (const [keyword, count] of sorted) {
      patterns.push(`"${keyword}" mentioned in ${count} rejection rationales`);
    }
  }

  // 4. Keyword themes from approved rationales
  const approvedReactions = recent.filter(r => r.verdict === 'approved');
  if (approvedReactions.length >= 2) {
    const keywords = extractRationaleKeywords(approvedReactions);
    const sorted = [...keywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    for (const [keyword, count] of sorted) {
      patterns.push(`"${keyword}" associated with ${count} approvals`);
    }
  }

  return patterns;
}

/**
 * Derive a restraint level from recent reaction history.
 *
 * - Mostly rejections (>=60%) → conservative
 * - Mostly approvals (>=60%) → adventurous
 * - Otherwise → moderate
 */
export function deriveRestraintLevel(reactions: Reaction[]): RestraintLevel {
  if (reactions.length < MIN_REACTIONS_FOR_PATTERNS) return 'moderate';

  const recent = reactions.slice(-RECENT_WINDOW);
  const approved = recent.filter(r => r.verdict === 'approved').length;
  const rejected = recent.filter(r => r.verdict === 'rejected').length;
  const total = recent.length;

  if (rejected / total >= 0.6) return 'conservative';
  if (approved / total >= 0.6) return 'adventurous';
  return 'moderate';
}

/**
 * Compress a PreservationReport into a concise format for the AI.
 */
function compressPreservationReport(report: PreservationReport): CompressedPreservationReport {
  const preserved: string[] = [];
  if (report.preserved.rhythmPositions) preserved.push('rhythm');
  if (report.preserved.eventCount) preserved.push('event_count');
  if (report.preserved.pitchContour) preserved.push('pitch_contour');
  return {
    trackId: report.trackId,
    approval: report.approvalLevel,
    preserved,
    changed: report.changed,
  };
}

export function compressState(session: Session, recentPreservationReports?: PreservationReport[]): CompressedState {
  const now = Date.now();
  const result: CompressedState = {
    tracks: session.tracks.map(track => ({
      id: track.id,
      label: getTrackLabel(track),
      model: modelName(track.model),
      params: {
        timbre: round2(track.params.timbre),
        harmonics: round2(track.params.harmonics),
        morph: round2(track.params.morph),
        frequency: round2(track.params.note),
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
      ...(track.importance != null ? { importance: round2(track.importance) } : {}),
      ...(track.musicalRole ? { musicalRole: track.musicalRole } : {}),
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
    observed_patterns: deriveObservedPatterns(session.reactionHistory ?? []),
    restraint_level: deriveRestraintLevel(session.reactionHistory ?? []),
    open_decisions: (session.openDecisions ?? [])
      .filter((d: OpenDecision) => !d.resolved)
      .slice(-5)
      .map((d: OpenDecision) => ({
        id: d.id,
        question: d.question,
        ...(d.context ? { context: d.context.slice(0, 200) } : {}),
        ...(d.options ? { options: d.options } : {}),
        ...(d.trackIds && d.trackIds.length > 0 ? { trackIds: d.trackIds } : {}),
      })),
    ...(recentPreservationReports && recentPreservationReports.length > 0 ? {
      recent_preservation: recentPreservationReports.map(compressPreservationReport),
    } : {}),
  };

  return result;
}
