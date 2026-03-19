// src/ai/state-compression.ts
import type { Session, Track, ApprovalLevel, Reaction, OpenDecision, PreservationReport, SessionIntent, SectionMeta, UserSelection, DrumPad } from '../engine/types';
import { getActivePattern } from '../engine/types';
import { getModelName, runtimeParamToControlId, getProcessorEngineName, getModulatorEngineName, getProcessorDefaultParams, getModulatorDefaultParams } from '../audio/instrument-registry';
import { getTrackOrdinalLabel } from '../engine/track-labels';
import { getTrackKind, MASTER_BUS_ID } from '../engine/types';
import { scaleToString, scaleNoteNames, midiToNoteName } from '../engine/scale';
import { getChordToneNames } from '../engine/chords';
import { getProfile, type ReferenceProfile } from '../engine/reference-profiles';
import type { AudioMetricsSnapshot, AudioMetricFrame } from '../audio/live-audio-metrics';
import type { MixWarning } from './mix-warnings';
import type { TriggerEvent } from '../engine/canonical-types';
import { eventsToGrid, eventsToKit, formatLegend, velocityToGridChar, DEFAULT_LEGEND } from '../engine/drum-grid';

interface CompressedPattern {
  length: number;
  event_count: number;
  triggers?: { at: number; vel: number }[];
  notes?: { at: number; pitch: string; vel: number; dur?: number }[];
  accents?: number[];
  param_locks?: { at: number; params: Record<string, number> }[];
  density: number;
}

/** Compressed drum pad metadata for AI state. */
interface CompressedDrumPad {
  id: string;
  model: string;
  level: number;
  pan: string;    // "C", "L20", "R45" etc.
  chokeGroup?: number;
}

/** Compressed drum rack pattern — stacked grid lanes with legend and optional detail map. */
interface CompressedDrumRackPattern {
  length: number;
  bars: number;
  steps: number;
  lanes: Record<string, string>;   // padId → grid string
  detail?: Record<string, Record<string, number>>;  // "padId@bar.beat.sixteenth" → { vel?, offset? }
  legend: string;
  density: number;
  event_count: number;
}

interface CompressedProcessor {
  id: string;
  type: string;
  model: string;
  params: Record<string, number>;
  enabled?: boolean;
  /** Sidechain source track ID, when this compressor is sidechained. */
  sidechainSourceId?: string;
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

interface _CompressedRegion {
  id: string;
  name?: string;
  start: number;
  duration: number;
  loop: boolean;
  event_count: number;
}

interface CompressedTrack {
  id: string;
  label: string;
  model: string;
  params?: Record<string, number>;
  approval: ApprovalLevel;
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
  swing?: number | null;
  pattern: CompressedPattern | CompressedDrumRackPattern;
  /** Drum rack pad metadata — present only for drum-rack tracks. */
  pads?: CompressedDrumPad[];
  sequence?: Array<{
    index: number;
    patternId: string;
    length: number;
    automation?: Array<{
      controlId: string;
      point_count: number;
      points: Array<{ at: number; value: number }>;
    }>;
  }>;
  regions?: CompressedPattern[];
  activePatternId?: string;
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

interface CompressedChordProgressionEntry {
  bar: number;
  chord: string;
  tones: string[];
}

/** Compressed summary of a preservation report for inclusion in AI state. */
interface CompressedPreservationReport {
  trackId: string;
  approval: ApprovalLevel;
  preserved: string[];   // e.g. ["rhythm", "event_count"]
  changed: string[];     // from PreservationReport.changed
}

/** Compressed user selection context — present only when the human has an active selection in the Tracker. */
export interface CompressedUserSelection {
  trackId: string;
  stepRange: [number, number];
  eventCount: number;
}

export interface CompressedState {
  tracks: CompressedTrack[];
  track_count: number;
  soft_track_cap: number;
  activeTrackId: string;
  transport: { bpm: number; swing: number; playing: boolean; mode: string; time_signature: string };
  context: { energy: number; density: number };
  undo_depth: number;
  redo_depth: number;
  recent_human_actions: CompressedHumanAction[];
  recent_reactions: CompressedReaction[];
  observed_patterns: string[];
  restraint_level: RestraintLevel;
  open_decisions: CompressedDecision[];
  recent_preservation?: CompressedPreservationReport[];
  intent?: SessionIntent;
  genre_reference_overlays?: CompressedGenreReferenceOverlay[];
  audioMetrics?: CompressedAudioMetrics;
  mixWarnings?: MixWarning[];
  recentAutoDiffs?: CompressedAutoDiffSummary[];
  section?: SectionMeta;
  scale?: { root: number; mode: string; label: string; notes: string[] } | null;
  chord_progression?: CompressedChordProgressionEntry[] | null;
  userSelection?: CompressedUserSelection;
}

interface CompressedGenreReferenceOverlay {
  genre: string;
  profile: string;
  targetLufs: [number, number];
  centroidHz: [number, number];
  mixNotes: string[];
}

interface CompressedAudioMetrics {
  master: AudioMetricFrame;
  tracks: Record<string, AudioMetricFrame>;
}

export interface CompressedAutoDiffSummary {
  trackId: string;
  summary: string;
  confidence: number;
}

const AUTOMATION_POINT_PREVIEW_LIMIT = 8;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function modelName(model: number): string {
  const name = getModelName(model);
  return name.toLowerCase().replace(/[\s/]+/g, '_');
}

function sampleAutomationPoints<T>(points: T[], limit: number): T[] {
  if (points.length <= limit) return points;
  const indices = new Set<number>();
  for (let i = 0; i < limit; i++) {
    indices.add(Math.round((i * (points.length - 1)) / (limit - 1)));
  }
  return [...indices].sort((a, b) => a - b).map(index => points[index]);
}

function compressPattern(track: Track): CompressedPattern {
  const region = track.patterns.length > 0 ? getActivePattern(track) : undefined;
  if (!region) {
    return { length: track.stepGrid.length, event_count: 0, density: 0 };
  }

  const events = region.events;
  const triggers: { at: number; vel: number }[] = [];
  const notes: { at: number; pitch: string; vel: number; dur?: number }[] = [];
  const accents: number[] = [];
  const paramMap = new Map<string, Record<string, number>>();

  for (const e of events) {
    switch (e.kind) {
      case 'trigger':
        if (e.velocity !== 0) {
          triggers.push({ at: round2(e.at), vel: round2(e.velocity) });
          if (e.accent || (e.velocity !== undefined && e.velocity >= 0.95)) {
            accents.push(round2(e.at));
          }
        }
        break;
      case 'note':
        notes.push({
          at: round2(e.at),
          pitch: midiToNoteName(e.pitch),
          vel: round2(e.velocity),
          ...(e.duration !== undefined && round2(e.duration) !== 1 ? { dur: round2(e.duration) } : {}),
        });
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
    ...(triggers.length > 0 ? { triggers } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(accents.length > 0 ? { accents } : {}),
    ...(param_locks.length > 0 ? { param_locks } : {}),
    density,
  };
}

// ---------------------------------------------------------------------------
// Drum rack compression helpers
// ---------------------------------------------------------------------------

/**
 * Format pan as a human-readable string: "C", "L20", "R45".
 * Pan is 0.0 (full left) to 1.0 (full right), 0.5 = center.
 */
function formatPan(pan: number): string {
  if (Math.abs(pan - 0.5) < 0.01) return 'C';
  if (pan < 0.5) {
    const pct = Math.round((0.5 - pan) * 200);
    return `L${pct}`;
  }
  const pct = Math.round((pan - 0.5) * 200);
  return `R${pct}`;
}

/**
 * Compress a single drum pad's metadata for AI state.
 */
function compressDrumPad(pad: DrumPad): CompressedDrumPad {
  return {
    id: pad.id,
    model: modelName(pad.source.model),
    level: round2(pad.level),
    pan: formatPan(pad.pan),
    ...(pad.chokeGroup != null ? { chokeGroup: pad.chokeGroup } : {}),
  };
}

/**
 * Build a detail map for events that deviate from the grid category's default velocity,
 * or have micro-timing offsets (fractional `at` values).
 *
 * Keys are "padId@bar.beat.sixteenth", values override velocity and/or offset.
 */
function buildDetailMap(
  events: TriggerEvent[],
  stepsPerBar: number,
): Record<string, Record<string, number>> | undefined {
  const detail: Record<string, Record<string, number>> = {};

  for (const event of events) {
    if (!event.padId) continue;
    const vel = event.velocity ?? 0.75;
    if (vel === 0) continue;

    const step = Math.floor(event.at);
    const offset = round2(event.at - step);

    // Check if velocity deviates from the grid category's default
    const gridChar = velocityToGridChar(vel);
    const defaultVel = DEFAULT_LEGEND[gridChar]?.velocity ?? vel;
    const velDeviation = Math.abs(vel - defaultVel) > 0.05;

    if (!velDeviation && Math.abs(offset) < 0.01) continue;

    // Convert step to bar.beat.sixteenth (1-based)
    const bar = Math.floor(step / stepsPerBar) + 1;
    const withinBar = step % stepsPerBar;
    const beat = Math.floor(withinBar / 4) + 1;
    const sixteenth = (withinBar % 4) + 1;
    const key = `${event.padId}@${bar}.${beat}.${sixteenth}`;

    const entry: Record<string, number> = {};
    if (velDeviation) entry.vel = round2(vel);
    if (Math.abs(offset) >= 0.01) entry.offset = round2(offset);
    if (Object.keys(entry).length > 0) detail[key] = entry;
  }

  return Object.keys(detail).length > 0 ? detail : undefined;
}

/**
 * Compress a drum rack track's active pattern into stacked grid lanes.
 */
function compressDrumRackPattern(track: Track): CompressedDrumRackPattern {
  const region = track.patterns.length > 0 ? getActivePattern(track) : undefined;
  const pads = track.drumRack?.pads ?? [];
  const padIds = pads.map(p => p.id);
  const stepsPerBar = 16; // 4/4 at 16th resolution

  if (!region || pads.length === 0) {
    return {
      length: region?.duration ?? track.stepGrid.length,
      bars: Math.ceil((region?.duration ?? track.stepGrid.length) / stepsPerBar),
      steps: region?.duration ?? track.stepGrid.length,
      lanes: Object.fromEntries(padIds.map(id => [id, eventsToGrid([], region?.duration ?? track.stepGrid.length, stepsPerBar)])),
      legend: formatLegend(),
      density: 0,
      event_count: 0,
    };
  }

  const triggerEvents = region.events.filter(
    (e): e is TriggerEvent => e.kind === 'trigger'
  );
  const lanes = eventsToKit(triggerEvents, padIds, region.duration, stepsPerBar);
  const detail = buildDetailMap(triggerEvents, stepsPerBar);

  const soundEventCount = triggerEvents.filter(e => (e.velocity ?? 0.75) !== 0).length;
  const density = region.duration > 0 ? round2(soundEventCount / region.duration) : 0;

  return {
    length: region.duration,
    bars: Math.ceil(region.duration / stepsPerBar),
    steps: region.duration,
    lanes,
    ...(detail ? { detail } : {}),
    legend: formatLegend(),
    density,
    event_count: region.events.length,
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

interface GenreReferenceOverlaySpec {
  aliases: string[];
  profileId: string;
  spectralCentroidHz: { min: number; max: number };
  mixNotes: string[];
}

const GENRE_REFERENCE_OVERLAY_SPECS: GenreReferenceOverlaySpec[] = [
  {
    aliases: ['dark techno', 'industrial techno', 'techno_dark'],
    profileId: 'techno_dark',
    spectralCentroidHz: { min: 900, max: 2200 },
    mixNotes: ['Prioritize kick and sub weight', 'Keep highs controlled and slightly recessed'],
  },
  {
    aliases: ['techno', 'minimal techno', 'minimal', 'techno_minimal'],
    profileId: 'techno_minimal',
    spectralCentroidHz: { min: 1200, max: 3000 },
    mixNotes: ['Keep low end firm but not overloaded', 'Leave space for crisp hats and percussion detail'],
  },
  {
    aliases: ['deep house', 'house', 'house_deep'],
    profileId: 'house_deep',
    spectralCentroidHz: { min: 1500, max: 3500 },
    mixNotes: ['Warm low mids are part of the sound', 'Highs should feel smooth rather than sharp'],
  },
  {
    aliases: ['ambient', 'drone'],
    profileId: 'ambient',
    spectralCentroidHz: { min: 1800, max: 5000 },
    mixNotes: ['Favor wide spectral spread over kick dominance', 'Preserve headroom and dynamic movement'],
  },
  {
    aliases: ['dnb', 'drum and bass', 'drum & bass', 'jungle'],
    profileId: 'dnb',
    spectralCentroidHz: { min: 2200, max: 5500 },
    mixNotes: ['Sub should stay powerful and stable', 'Let snare presence and top-end attack cut through'],
  },
  {
    aliases: ['hiphop', 'hip-hop', 'rap', 'trap'],
    profileId: 'hiphop',
    spectralCentroidHz: { min: 1200, max: 3200 },
    mixNotes: ['Low end should feel heavy but controlled', 'Protect vocal or lead midrange clarity'],
  },
];

function normalizeGenreTag(genre: string): string {
  return genre.trim().toLowerCase().replace(/\s+/g, ' ');
}

function findGenreReferenceSpec(genre: string): GenreReferenceOverlaySpec | undefined {
  const normalized = normalizeGenreTag(genre);
  return GENRE_REFERENCE_OVERLAY_SPECS.find(spec => spec.aliases.includes(normalized));
}

function compressGenreReferenceOverlay(genre: string, profile: ReferenceProfile, spec: GenreReferenceOverlaySpec): CompressedGenreReferenceOverlay {
  return {
    genre,
    profile: profile.id,
    targetLufs: [profile.dynamics.lufsMin, profile.dynamics.lufsMax],
    centroidHz: [spec.spectralCentroidHz.min, spec.spectralCentroidHz.max],
    mixNotes: spec.mixNotes,
  };
}

function deriveGenreReferenceOverlays(intent?: SessionIntent): CompressedGenreReferenceOverlay[] {
  if (!intent?.genre || intent.genre.length === 0) return [];

  const overlays: CompressedGenreReferenceOverlay[] = [];
  const seenProfiles = new Set<string>();

  for (const genre of intent.genre) {
    const spec = findGenreReferenceSpec(genre);
    if (!spec || seenProfiles.has(spec.profileId)) continue;
    const profile = getProfile(spec.profileId);
    if (!profile) continue;
    overlays.push(compressGenreReferenceOverlay(genre, profile, spec));
    seenProfiles.add(spec.profileId);
  }

  return overlays;
}

export function compressState(
  session: Session,
  recentPreservationReports?: PreservationReport[],
  userSelection?: UserSelection,
  audioMetrics?: AudioMetricsSnapshot,
  mixWarnings?: MixWarning[],
  recentAutoDiffs?: CompressedAutoDiffSummary[],
): CompressedState {
  const now = Date.now();
  const audioTracks = session.tracks.filter(t => getTrackKind(t) !== 'bus');
  const busTracks = session.tracks.filter(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID);
  const genreReferenceOverlays = deriveGenreReferenceOverlays(session.intent);
  const result: CompressedState = {
    tracks: session.tracks.map(track => {
      const isDrumRack = track.engine === 'drum-rack' && track.drumRack;
      return {
      id: track.id,
      label: getTrackOrdinalLabel(track, audioTracks, busTracks),
      ...(track.kind === 'bus' ? { kind: 'bus' as const } : {}),
      model: isDrumRack ? 'drum-rack' : modelName(track.model),
      ...(isDrumRack || getTrackKind(track) === 'bus' ? {} : {
        params: {
          timbre: round2(track.params.timbre),
          harmonics: round2(track.params.harmonics),
          morph: round2(track.params.morph),
          frequency: round2(track.params.note),
        },
      }),
      ...(isDrumRack ? {
        pads: track.drumRack!.pads.map(compressDrumPad),
      } : {}),
      approval: track.approval ?? 'exploratory',
      muted: track.muted,
      solo: track.solo,
      volume: round2(track.volume),
      pan: round2(track.pan),
      ...(track.swing != null ? { swing: round2(track.swing) } : {}),
      pattern: isDrumRack ? compressDrumRackPattern(track) : compressPattern(track),
      ...(track.sequence.length > 0 ? {
        sequence: track.sequence.map((ref, index) => {
          const pattern = track.patterns.find(candidate => candidate.id === ref.patternId);
          return {
            index,
            patternId: ref.patternId,
            ...(pattern?.name ? { name: pattern.name } : {}),
            length: pattern?.duration ?? 0,
            ...(ref.automation && ref.automation.length > 0 ? {
              automation: ref.automation.map(lane => ({
                controlId: lane.controlId,
                point_count: lane.points.length,
                points: sampleAutomationPoints(lane.points, AUTOMATION_POINT_PREVIEW_LIMIT).map(point => ({
                  at: round2(point.at),
                  value: round2(point.value),
                })),
              })),
            } : {}),
          };
        }),
      } : {}),
      ...(track.patterns.length > 1 ? {
        patterns: track.patterns.map(r => ({
          id: r.id,
          ...(r.name ? { name: r.name } : {}),
          duration: r.duration,
          event_count: r.events.length,
        })),
        activePatternId: getActivePattern(track).id,
      } : {}),
      views: (track.views ?? []).map(v => `${v.kind}:${v.id}`),
      processors: (track.processors ?? []).map(p => {
        const defaults = getProcessorDefaultParams(p.type, p.model);
        const nonDefault = Object.fromEntries(
          Object.entries(p.params)
            .filter(([k, v]) => {
              const def = defaults[k];
              return def === undefined || round2(v) !== round2(def);
            })
            .map(([k, v]) => [k, round2(v)])
        );
        return {
          id: p.id,
          type: p.type,
          model: getProcessorEngineName(p.type, p.model) ?? String(p.model),
          params: nonDefault,
          ...(p.enabled === false ? { enabled: false } : {}),
          ...(p.sidechainSourceId ? { sidechainSourceId: p.sidechainSourceId } : {}),
        };
      }),
      modulators: (track.modulators ?? []).map(m => {
        const defaults = getModulatorDefaultParams(m.type, m.model);
        const nonDefault = Object.fromEntries(
          Object.entries(m.params)
            .filter(([k, v]) => {
              const def = defaults[k];
              return def === undefined || round2(v) !== round2(def);
            })
            .map(([k, v]) => [k, round2(v)])
        );
        return {
          id: m.id,
          type: m.type,
          model: getModulatorEngineName(m.type, m.model) ?? String(m.model),
          params: nonDefault,
        };
      }),
      modulations: (track.modulations ?? []).map(r => ({
        id: r.id,
        modulatorId: r.modulatorId,
        target: r.target.kind === 'source'
          ? `source:${r.target.param}`
          : `processor:${r.target.processorId}:${r.target.param}`,
        depth: round2(r.depth),
      })),
      ...(track.surface.modules.length > 0 ? {
        surface_modules: track.surface.modules.map(m => {
          const suffix = m.config.pinned ? ' (pinned)' : '';
          if (m.type === 'macro-knob') return `MacroKnob[${m.label}]${suffix}`;
          if (m.type === 'knob-group') return `KnobGroup[${m.bindings.map(b => b.target).join(', ')}]${suffix}`;
          if (m.type === 'xy-pad') {
            const xBinding = m.bindings.find(b => b.role === 'x-axis');
            const yBinding = m.bindings.find(b => b.role === 'y-axis');
            return `XYPad[${xBinding?.target ?? '?'}×${yBinding?.target ?? '?'}]`;
          }
          if (m.type === 'step-grid') return 'StepGrid';
          if (m.type === 'chain-strip') return 'ChainStrip';
          return `${m.type}[${m.label}]`;
        }),
      } : {}),
      ...(track.visualIdentity ? {
        identity: {
          hue: Math.round(track.visualIdentity.colour.hue),
          sat: round2(track.visualIdentity.colour.saturation),
          bright: round2(track.visualIdentity.colour.brightness),
          weight: round2(track.visualIdentity.weight),
          edge: track.visualIdentity.edgeStyle,
          prom: round2(track.visualIdentity.prominence),
        },
      } : {}),
      ...(track.importance != null ? { importance: round2(track.importance) } : {}),
      ...(track.musicalRole ? { musicalRole: track.musicalRole } : {}),
      ...(track.sends && track.sends.length > 0 ? {
        sends: track.sends.map(s => ({ busId: s.busId, level: round2(s.level) })),
      } : {}),
    };
    }),
    track_count: session.tracks.length,
    soft_track_cap: 16,
    activeTrackId: session.activeTrackId,
    transport: {
      bpm: session.transport.bpm,
      swing: round2(session.transport.swing),
      playing: session.transport.status === 'playing',
      mode: session.transport.mode ?? 'pattern',
      loop: session.transport.loop ?? true,
      time_signature: `${session.transport.timeSignature?.numerator ?? 4}/${session.transport.timeSignature?.denominator ?? 4}`,
    },
    context: {
      energy: round2(session.context.energy),
      density: round2(session.context.density),
    },
    undo_depth: session.undoStack.length,
    redo_depth: session.redoStack.length,
    recent_human_actions: session.recentHumanActions.slice(-5).map(a => {
      if (a.kind === 'undo' || a.kind === 'redo') {
        return { type: a.kind, description: a.description, age_ms: now - a.timestamp };
      }
      return {
        type: 'param',
        trackId: a.trackId,
        param: runtimeParamToControlId[a.param] ?? a.param,
        from: round2(a.from),
        to: round2(a.to),
        age_ms: now - a.timestamp,
      };
    }),
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
    ...(session.intent && Object.keys(session.intent).length > 0 ? { intent: session.intent } : {}),
    ...(genreReferenceOverlays.length > 0 ? { genre_reference_overlays: genreReferenceOverlays } : {}),
    ...(audioMetrics ? {
      // Keep freshness handling in runtime state; the AI only needs the measurements.
      audioMetrics: {
        master: audioMetrics.master,
        tracks: audioMetrics.tracks,
      },
    } : {}),
    ...(mixWarnings && mixWarnings.length > 0 ? { mixWarnings } : {}),
    ...(recentAutoDiffs && recentAutoDiffs.length > 0 ? { recentAutoDiffs } : {}),
    ...(session.section && Object.keys(session.section).length > 0 ? { section: session.section } : {}),
    ...(session.scale !== undefined ? {
      scale: session.scale ? {
        root: session.scale.root,
        mode: session.scale.mode,
        label: scaleToString(session.scale),
        notes: scaleNoteNames(session.scale),
      } : null,
    } : {}),
    ...(session.chordProgression !== undefined ? {
      chord_progression: session.chordProgression ? session.chordProgression.map(entry => ({
        bar: entry.bar,
        chord: entry.chord,
        tones: getChordToneNames(entry.chord),
      })) : null,
    } : {}),
    ...(userSelection && userSelection.eventIndices.length > 0 ? {
      userSelection: {
        trackId: userSelection.trackId,
        stepRange: userSelection.stepRange,
        eventCount: userSelection.eventIndices.length,
      },
    } : {}),
  };

  return result;
}
