import type { Pattern, MusicalEvent, NoteEvent, TriggerEvent } from './canonical-types';
import type { Track } from './types';
import type { AudioMetricFrame } from '../audio/live-audio-metrics';
import type { FrequencyBand } from './spectral-slots';
import { BAND_RANGES } from './spectral-slots';

export type RelationalRhythm = 'align' | 'complement';
export type RelationalContrast = 'increase_contrast' | 'decrease_contrast';
export type RelationalDimension = 'brightness' | 'thickness';

export interface RhythmicRelationResult {
  events: MusicalEvent[];
  sourceOnsets: number[];
  targetOnsets: number[];
}

export interface ContrastPlan {
  direction: 'brighter' | 'darker' | 'thicker' | 'thinner';
  sourceValue: number;
  targetValue: number;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sortEvents(events: MusicalEvent[]): MusicalEvent[] {
  return [...events].sort((a, b) => a.at - b.at);
}

function getSoundEvents(pattern: Pattern): Array<NoteEvent | TriggerEvent> {
  return pattern.events.filter((event): event is NoteEvent | TriggerEvent =>
    event.kind === 'note' || event.kind === 'trigger',
  );
}

function uniqueSortedOnsets(events: Array<NoteEvent | TriggerEvent>, duration: number): number[] {
  return Array.from(new Set(events.map(event => round3(((event.at % duration) + duration) % duration))))
    .sort((a, b) => a - b);
}

function cloneEventAt(event: NoteEvent | TriggerEvent, at: number): NoteEvent | TriggerEvent {
  return { ...event, at };
}

function deriveComplementOnsets(sourceOnsets: number[], duration: number): number[] {
  if (sourceOnsets.length === 0) return [];
  if (sourceOnsets.length === 1) return [round3((sourceOnsets[0] + duration / 2) % duration)];

  const positions: number[] = [];
  for (let i = 0; i < sourceOnsets.length; i++) {
    const current = sourceOnsets[i];
    const next = i === sourceOnsets.length - 1 ? sourceOnsets[0] + duration : sourceOnsets[i + 1];
    positions.push(round3((current + ((next - current) / 2)) % duration));
  }
  return Array.from(new Set(positions)).sort((a, b) => a - b);
}

export function resolveRhythmicRelation(
  sourcePattern: Pattern,
  targetPattern: Pattern,
  relation: RelationalRhythm,
): RhythmicRelationResult {
  const targetSoundEvents = getSoundEvents(targetPattern);
  if (targetSoundEvents.length === 0) {
    throw new Error('Target track has no existing note/trigger events to reshape');
  }

  const sourceSoundEvents = getSoundEvents(sourcePattern);
  const sourceOnsets = uniqueSortedOnsets(sourceSoundEvents, targetPattern.duration);
  if (sourceOnsets.length === 0) {
    throw new Error('Source track has no note/trigger events to relate against');
  }

  const targetOnsets = relation === 'align'
    ? sourceOnsets
    : deriveComplementOnsets(sourceOnsets, targetPattern.duration);
  if (targetOnsets.length === 0) {
    throw new Error(`Could not derive ${relation} positions from the source pattern`);
  }

  const remappedSoundEvents = targetSoundEvents.map((event, index) =>
    cloneEventAt(event, targetOnsets[index % targetOnsets.length]),
  );
  const nonSoundEvents = targetPattern.events.filter(event => event.kind === 'parameter');

  return {
    events: sortEvents([...remappedSoundEvents, ...nonSoundEvents]),
    sourceOnsets,
    targetOnsets,
  };
}

export function planContrastDirection(
  sourceTrack: Track,
  targetTrack: Track,
  relation: RelationalContrast,
  dimension: RelationalDimension,
): ContrastPlan {
  const sourceValue = dimension === 'brightness'
    ? sourceTrack.params.timbre
    : sourceTrack.params.harmonics;
  const targetValue = dimension === 'brightness'
    ? targetTrack.params.timbre
    : targetTrack.params.harmonics;
  const targetBelowOrEqual = targetValue <= sourceValue;

  if (dimension === 'brightness') {
    return {
      direction: relation === 'increase_contrast'
        ? (targetBelowOrEqual ? 'darker' : 'brighter')
        : (targetBelowOrEqual ? 'brighter' : 'darker'),
      sourceValue,
      targetValue,
    };
  }

  return {
    direction: relation === 'increase_contrast'
      ? (targetBelowOrEqual ? 'thinner' : 'thicker')
      : (targetBelowOrEqual ? 'thicker' : 'thinner'),
    sourceValue,
    targetValue,
  };
}

function inferBandFromCentroid(centroidHz: number): FrequencyBand {
  const bands = Object.entries(BAND_RANGES) as Array<[FrequencyBand, [number, number]]>;
  for (const [band, [low, high]] of bands) {
    if (centroidHz >= low && centroidHz < high) return band;
  }
  return centroidHz < BAND_RANGES.low[0] ? 'sub' : 'air';
}

function inferBandFromRole(track: Track): FrequencyBand {
  const roleText = `${track.name ?? ''} ${track.musicalRole ?? ''}`.toLowerCase();
  if (/\b(kick|bass|sub|low)\b/.test(roleText)) return 'sub';
  if (/\b(snare|body|warm)\b/.test(roleText)) return 'low_mid';
  if (/\b(chord|pad|mid)\b/.test(roleText)) return 'mid';
  if (/\b(lead|vocal|presence)\b/.test(roleText)) return 'high_mid';
  if (/\b(hat|air|shimmer|bright)\b/.test(roleText)) return 'high';
  return 'mid';
}

export function inferPrimaryBand(track: Track, metrics?: AudioMetricFrame): FrequencyBand {
  if (metrics) return inferBandFromCentroid(metrics.centroid);
  return inferBandFromRole(track);
}

const COMPLEMENTARY_BANDS: Record<FrequencyBand, FrequencyBand[]> = {
  sub: ['high_mid', 'high'],
  low: ['high_mid', 'air'],
  low_mid: ['high', 'air'],
  mid: ['sub', 'air'],
  high_mid: ['sub', 'low'],
  high: ['low_mid', 'low'],
  air: ['low_mid', 'mid'],
};

export function inferSpectralComplementBands(
  sourceTrack: Track,
  targetTrack: Track,
  sourceMetrics?: AudioMetricFrame,
  targetMetrics?: AudioMetricFrame,
): { sourceBand: FrequencyBand; targetBands: FrequencyBand[] } {
  const sourceBand = inferPrimaryBand(sourceTrack, sourceMetrics);
  const targetBand = inferPrimaryBand(targetTrack, targetMetrics);
  const candidates = COMPLEMENTARY_BANDS[sourceBand].filter(band => band !== targetBand);
  return {
    sourceBand,
    targetBands: candidates.length > 0 ? candidates.slice(0, 2) : COMPLEMENTARY_BANDS[sourceBand].slice(0, 2),
  };
}
