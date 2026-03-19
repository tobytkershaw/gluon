// src/ai/state-compression.ts
import type { Session, Track, ApprovalLevel, Reaction, OpenDecision, PreservationReport, SessionIntent, SectionMeta, UserSelection } from '../engine/types';
import { getActivePattern } from '../engine/types';
import { getModelName, runtimeParamToControlId, getProcessorEngineName, getModulatorEngineName, getProcessorDefaultParams, getModulatorDefaultParams } from '../audio/instrument-registry';
import { getTrackOrdinalLabel } from '../engine/track-labels';
import { getTrackKind, MASTER_BUS_ID } from '../engine/types';
import { scaleToString, scaleNoteNames } from '../engine/scale';
import { getChordToneNames } from '../engine/chords';
import { getProfile, type ReferenceProfile } from '../engine/reference-profiles';
import type { AudioMetricsSnapshot, AudioMetricFrame } from '../audio/live-audio-metrics';
import type { MixWarning } from './mix-warnings';

interface CompressedPattern {
  length: number;
  event_count: number;
  triggers: { at: number; vel: number }[];
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
  params: Record<string, number>;
  approval: ApprovalLevel;
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
  swing?: number | null;
  pattern: CompressedPattern;
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
  profileId: string;
  label: string;
  description: string;
  lufs: { min: number; max: number };
  dynamicRange: { min: number; max: number };
  crestFactor: { min: number; max: number };
  spectralCentroidHz: { min: number; max: number };
  frequencyBalance: { band: string; range: string; minDb: number; maxDb: number }[];
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function modelName(model: number): string {
  const name = getModelName(model);
  return name.toLowerCase().replace(/[\s/]+/g, '_');
}

function compressPattern(track: Track): CompressedPattern {
  const region = track.patterns.length > 0 ? getActivePattern(track) : undefined;
  if (!region) {
    return { length: track.stepGrid.length, event_count: 0, triggers: [], notes: [], accents: [], param_locks: [], density: 0 };
  }

  const events = region.events;
  const triggers: { at: number; vel: number }[] = [];
  const notes: { at: number; pitch: number; vel: number }[] = [];
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
    profileId: profile.id,
    label: profile.label,
    description: profile.description,
    lufs: { min: profile.dynamics.lufsMin, max: profile.dynamics.lufsMax },
    dynamicRange: { min: profile.dynamics.dynamicRangeMin, max: profile.dynamics.dynamicRangeMax },
    crestFactor: { min: profile.dynamics.crestFactorMin, max: profile.dynamics.crestFactorMax },
    spectralCentroidHz: spec.spectralCentroidHz,
    frequencyBalance: profile.bands.map(band => ({
      band: band.band,
      range: band.range,
      minDb: band.minDb,
      maxDb: band.maxDb,
    })),
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
    tracks: session.tracks.map(track => ({
      id: track.id,
      label: getTrackOrdinalLabel(track, audioTracks, busTracks),
      ...(track.kind === 'bus' ? { kind: 'bus' as const } : {}),
      model: modelName(track.model),
      params: {
        timbre: round2(track.params.timbre),
        harmonics: round2(track.params.harmonics),
        morph: round2(track.params.morph),
        frequency: round2(track.params.note),
      },
      approval: track.approval ?? 'exploratory',
      muted: track.muted,
      solo: track.solo,
      volume: round2(track.volume),
      pan: round2(track.pan),
      ...(track.swing != null ? { swing: round2(track.swing) } : {}),
      pattern: compressPattern(track),
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
        const merged = { ...defaults, ...p.params };
        return {
          id: p.id,
          type: p.type,
          model: getProcessorEngineName(p.type, p.model) ?? String(p.model),
          params: Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, round2(v)])),
          ...(p.enabled === false ? { enabled: false } : {}),
          ...(p.sidechainSourceId ? { sidechainSourceId: p.sidechainSourceId } : {}),
        };
      }),
      modulators: (track.modulators ?? []).map(m => {
        const defaults = getModulatorDefaultParams(m.type, m.model);
        const merged = { ...defaults, ...m.params };
        return {
          id: m.id,
          type: m.type,
          model: getModulatorEngineName(m.type, m.model) ?? String(m.model),
          params: Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, round2(v)])),
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
    })),
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
