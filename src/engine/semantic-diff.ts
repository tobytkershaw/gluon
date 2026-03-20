// src/engine/semantic-diff.ts — Semantic musical diffs: event-level change descriptions.
// Pure functions that compare MusicalEvent arrays and produce structured musical descriptions.

import type { MusicalEvent, NoteEvent } from './canonical-types';
import { midiToNoteName } from './scale';
import { recogniseChord } from './chords';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SemanticDiffContext {
  trackId: string;
  stepsPerBeat: number;       // for grid quantization reference
  // TODO: use for pitch_range note naming
  scale?: { root: number; mode: string };
}

export type DiffDimensionKind =
  | 'density'
  | 'pitch_range'
  | 'contour'
  | 'transposition'
  | 'rhythm_placement'
  | 'chord_quality'
  | 'velocity_profile';

export interface DiffDimension {
  kind: DiffDimensionKind;
  description: string;
  before: string;
  after: string;
  magnitude: 'minor' | 'moderate' | 'major';
  confidence: number;
}

export interface SemanticDiff {
  trackId: string;
  dimensions: DiffDimension[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSoundEvents(events: MusicalEvent[]): MusicalEvent[] {
  return events.filter(e =>
    (e.kind === 'note' || e.kind === 'trigger') &&
    (e as { velocity?: number }).velocity !== 0
  );
}

function getNoteEvents(events: MusicalEvent[]): NoteEvent[] {
  return events.filter((e): e is NoteEvent => e.kind === 'note');
}

function getSortedPitches(events: MusicalEvent[]): number[] {
  return getNoteEvents(events)
    .sort((a, b) => a.at - b.at)
    .map(e => e.pitch);
}

function getVelocities(events: MusicalEvent[]): number[] {
  return getSoundEvents(events)
    .sort((a, b) => a.at - b.at)
    .map(e => (e as { velocity?: number }).velocity ?? 1.0);
}

function intervalName(semitones: number): string {
  const abs = Math.abs(semitones);
  const dir = semitones > 0 ? 'up' : 'down';
  const names: Record<number, string> = {
    1: 'minor second', 2: 'major second', 3: 'minor third',
    4: 'major third', 5: 'perfect fourth', 6: 'tritone',
    7: 'perfect fifth', 8: 'minor sixth', 9: 'major sixth',
    10: 'minor seventh', 11: 'major seventh', 12: 'octave',
  };
  const name = names[abs];
  if (name) return `${dir} a ${name}`;
  if (abs > 12 && abs % 12 === 0) return `${dir} ${abs / 12} octaves`;
  return `${dir} ${abs} semitones`;
}

// ---------------------------------------------------------------------------
// Dimension detectors
// ---------------------------------------------------------------------------

export function detectDensity(
  oldEvents: MusicalEvent[],
  newEvents: MusicalEvent[],
): DiffDimension | null {
  const oldCount = getSoundEvents(oldEvents).length;
  const newCount = getSoundEvents(newEvents).length;
  if (oldCount === newCount) return null;

  const change = oldCount === 0
    ? Infinity
    : Math.abs(newCount - oldCount) / oldCount;

  let magnitude: DiffDimension['magnitude'];
  if (oldCount === 0 || newCount === 0 || change > 1.0) magnitude = 'major';
  else if (change > 0.25) magnitude = 'moderate';
  else magnitude = 'minor';

  const ratio = oldCount > 0 && newCount > 0
    ? (newCount / oldCount)
    : 0;
  const ratioDesc = ratio === 2 ? 'doubled' : ratio === 0.5 ? 'halved' : '';
  const verb = newCount > oldCount ? 'increased' : 'decreased';
  const description = ratioDesc
    ? `Density ${ratioDesc} from ${oldCount} to ${newCount} events`
    : `Density ${verb} from ${oldCount} to ${newCount} events`;

  return {
    kind: 'density',
    description,
    before: `${oldCount} sound events`,
    after: `${newCount} sound events`,
    magnitude,
    confidence: 1.0,
  };
}

export function detectPitchRange(
  oldEvents: MusicalEvent[],
  newEvents: MusicalEvent[],
): DiffDimension | null {
  const oldNotes = getNoteEvents(oldEvents);
  const newNotes = getNoteEvents(newEvents);
  if (oldNotes.length === 0 || newNotes.length === 0) return null;

  const oldPitches = oldNotes.map(n => n.pitch);
  const newPitches = newNotes.map(n => n.pitch);

  const oldMin = Math.min(...oldPitches);
  const oldMax = Math.max(...oldPitches);
  const newMin = Math.min(...newPitches);
  const newMax = Math.max(...newPitches);

  const oldSpan = oldMax - oldMin;
  const newSpan = newMax - newMin;

  const rangeShift = Math.abs(((newMin + newMax) / 2) - ((oldMin + oldMax) / 2));
  const spanChange = Math.abs(newSpan - oldSpan);

  if (rangeShift < 1 && spanChange < 1) return null;

  let magnitude: DiffDimension['magnitude'];
  if (rangeShift >= 12 || spanChange > 6) magnitude = 'major';
  else if (rangeShift >= 4 || spanChange >= 3) magnitude = 'moderate';
  else magnitude = 'minor';

  const before = `${midiToNoteName(oldMin)}–${midiToNoteName(oldMax)}`;
  const after = `${midiToNoteName(newMin)}–${midiToNoteName(newMax)}`;

  const parts: string[] = [];
  if (rangeShift >= 1) {
    const dir = ((newMin + newMax) / 2) > ((oldMin + oldMax) / 2) ? 'up' : 'down';
    if (Math.abs(rangeShift - 12) < 1) parts.push(`shifted ${dir} one octave`);
    else parts.push(`shifted ${dir} ${Math.round(rangeShift)} semitones`);
  }
  if (spanChange >= 1) {
    parts.push(newSpan > oldSpan ? 'span widened' : 'span narrowed');
  }
  const description = `Pitch range ${parts.join(', ')}`;

  return {
    kind: 'pitch_range',
    description,
    before,
    after,
    magnitude,
    confidence: 1.0,
  };
}

export function detectContour(
  oldEvents: MusicalEvent[],
  newEvents: MusicalEvent[],
): DiffDimension | null {
  const oldPitches = getSortedPitches(oldEvents);
  const newPitches = getSortedPitches(newEvents);

  if (oldPitches.length <= 1 && newPitches.length <= 1) return null;

  const getIntervals = (pitches: number[]) =>
    pitches.slice(1).map((p, i) => Math.sign(p - pitches[i]));

  const sameCount = oldPitches.length === newPitches.length;
  const confidence = sameCount ? 1.0 : 0.5;

  if (oldPitches.length <= 1 || newPitches.length <= 1) {
    // Can't compare contour with single notes
    return {
      kind: 'contour',
      description: 'Pitch contour changed (different note count)',
      before: `${oldPitches.length} notes`,
      after: `${newPitches.length} notes`,
      magnitude: 'major',
      confidence,
    };
  }

  const oldIntervals = getIntervals(oldPitches);
  const newIntervals = getIntervals(newPitches);

  if (!sameCount) {
    return {
      kind: 'contour',
      description: 'Pitch contour rewritten (different note count)',
      before: `${oldPitches.length} notes`,
      after: `${newPitches.length} notes`,
      magnitude: 'major',
      confidence,
    };
  }

  // Count direction changes
  const dirChanges = oldIntervals.filter((dir, i) => dir !== newIntervals[i]).length;

  if (dirChanges === 0) return null; // preserved

  // Check for full inversion (filter out zero intervals to avoid -0 === 0 false positives)
  const nonZeroOld = oldIntervals.filter(d => d !== 0);
  const nonZeroNew = newIntervals.filter(d => d !== 0);
  const isInverted = nonZeroOld.length > 0 &&
    nonZeroOld.length === nonZeroNew.length &&
    nonZeroOld.every((dir, i) => dir === -nonZeroNew[i]);

  let magnitude: DiffDimension['magnitude'];
  let description: string;

  if (isInverted) {
    magnitude = 'major';
    description = 'Pitch contour inverted';
  } else if (dirChanges <= 1) {
    magnitude = 'minor';
    description = `${dirChanges} interval direction changed`;
  } else {
    magnitude = 'moderate';
    description = `${dirChanges} interval directions changed`;
  }

  return {
    kind: 'contour',
    description,
    before: `contour [${oldIntervals.map(d => d > 0 ? 'up' : d < 0 ? 'down' : 'same').join(', ')}]`,
    after: `contour [${newIntervals.map(d => d > 0 ? 'up' : d < 0 ? 'down' : 'same').join(', ')}]`,
    magnitude,
    confidence,
  };
}

export function detectTransposition(
  oldEvents: MusicalEvent[],
  newEvents: MusicalEvent[],
): DiffDimension | null {
  const oldPitches = getSortedPitches(oldEvents);
  const newPitches = getSortedPitches(newEvents);

  if (oldPitches.length === 0 || oldPitches.length !== newPitches.length) return null;

  const shift = newPitches[0] - oldPitches[0];
  if (shift === 0) return null;

  // Check all notes shifted by the same interval
  const uniform = oldPitches.every((p, i) => newPitches[i] - p === shift);
  if (!uniform) return null;

  const abs = Math.abs(shift);
  let magnitude: DiffDimension['magnitude'];
  if (abs >= 7) magnitude = 'major';
  else if (abs >= 3) magnitude = 'moderate';
  else magnitude = 'minor';

  return {
    kind: 'transposition',
    description: `Transposed ${intervalName(shift)} (${shift > 0 ? '+' : ''}${shift} semitones)`,
    before: `root ${midiToNoteName(oldPitches[0])}`,
    after: `root ${midiToNoteName(newPitches[0])}`,
    magnitude,
    confidence: 1.0,
  };
}

export function detectRhythmPlacement(
  oldEvents: MusicalEvent[],
  newEvents: MusicalEvent[],
  context: SemanticDiffContext,
): DiffDimension | null {
  const GRID_TOLERANCE = 0.05;

  const classify = (events: MusicalEvent[]) => {
    const sound = getSoundEvents(events);
    let onBeat = 0;
    let onSubdivision = 0;
    let syncopated = 0;

    const spb = context.stepsPerBeat;

    for (const e of sound) {
      const stepFrac = e.at % 1;
      const isOnStep = stepFrac < GRID_TOLERANCE || stepFrac > (1 - GRID_TOLERANCE);

      if (!isOnStep) {
        // Fractional step position — off-grid / humanized
        syncopated++;
        continue;
      }

      // Integer step position — check if it's a beat boundary
      const nearestStep = Math.round(e.at);
      if (nearestStep % spb < GRID_TOLERANCE) {
        onBeat++;
      } else {
        onSubdivision++;
      }
    }
    const total = sound.length;
    return { onBeat, onSubdivision, syncopated, total };
  };

  const oldR = classify(oldEvents);
  const newR = classify(newEvents);

  if (oldR.total === 0 && newR.total === 0) return null;

  const oldSyncRatio = oldR.total > 0 ? oldR.syncopated / oldR.total : 0;
  const newSyncRatio = newR.total > 0 ? newR.syncopated / newR.total : 0;
  const syncChange = Math.abs(newSyncRatio - oldSyncRatio);

  const oldOnBeatRatio = oldR.total > 0 ? oldR.onBeat / oldR.total : 0;
  const newOnBeatRatio = newR.total > 0 ? newR.onBeat / newR.total : 0;
  const onBeatChange = Math.abs(newOnBeatRatio - oldOnBeatRatio);

  if (syncChange < 0.05 && onBeatChange < 0.05) return null;

  let magnitude: DiffDimension['magnitude'];
  if (syncChange > 0.3) magnitude = 'major';
  else if (syncChange > 0.1) magnitude = 'moderate';
  else magnitude = 'minor';

  const confidence = (oldR.total >= 4 && newR.total >= 4) ? 1.0 : 0.6;

  let description: string;
  if (newSyncRatio > oldSyncRatio + 0.1) {
    description = 'Rhythm shifted from straight to syncopated';
  } else if (oldSyncRatio > newSyncRatio + 0.1) {
    description = 'Rhythm shifted from syncopated to straight';
  } else if (newOnBeatRatio > oldOnBeatRatio + 0.1) {
    description = 'Rhythm moved more on-beat';
  } else {
    description = 'Rhythm placement shifted';
  }

  const formatRhythm = (r: { onBeat: number; onSubdivision: number; syncopated: number }) =>
    `${r.onBeat} on-beat, ${r.onSubdivision} on-subdivision, ${r.syncopated} syncopated`;

  return {
    kind: 'rhythm_placement',
    description,
    before: formatRhythm(oldR),
    after: formatRhythm(newR),
    magnitude,
    confidence,
  };
}

export function detectChordQuality(
  oldEvents: MusicalEvent[],
  newEvents: MusicalEvent[],
  context: SemanticDiffContext,
): DiffDimension | null {
  const GROUP_TOLERANCE = 0.05;

  const extractChords = (events: MusicalEvent[]): string[] => {
    const notes = getNoteEvents(events);
    if (notes.length < 3) return [];

    // Group notes by onset time
    const groups: NoteEvent[][] = [];
    const sorted = [...notes].sort((a, b) => a.at - b.at);

    let currentGroup: NoteEvent[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (Math.abs(sorted[i].at - currentGroup[0].at) < GROUP_TOLERANCE) {
        currentGroup.push(sorted[i]);
      } else {
        groups.push(currentGroup);
        currentGroup = [sorted[i]];
      }
    }
    groups.push(currentGroup);

    // Filter for chordal groups: >= 3 notes, average duration >= 1 beat (in step units)
    const chordalGroups = groups.filter(g => {
      if (g.length < 3) return false;
      const avgDuration = g.reduce((sum, n) => sum + n.duration, 0) / g.length;
      return avgDuration >= context.stepsPerBeat;
    });

    if (chordalGroups.length < 2) return [];

    return chordalGroups
      .map(g => recogniseChord(g.map(n => n.pitch)))
      .filter((c): c is string => c !== null);
  };

  const oldChords = extractChords(oldEvents);
  const newChords = extractChords(newEvents);

  if (oldChords.length === 0 && newChords.length === 0) return null;
  if (oldChords.length === 0 || newChords.length === 0) {
    const description = oldChords.length === 0
      ? `Chord progression added: ${newChords.join('–')}`
      : `Chord progression removed (was ${oldChords.join('–')})`;
    return {
      kind: 'chord_quality',
      description,
      before: oldChords.join('–') || 'none',
      after: newChords.join('–') || 'none',
      magnitude: 'major',
      confidence: 1.0,
    };
  }

  // Compare chord sequences
  const sameLength = oldChords.length === newChords.length;
  const matchingRoots = sameLength
    ? oldChords.filter((c, i) => c.charAt(0) === newChords[i].charAt(0) ||
        c.replace(/[^A-G#]/g, '') === newChords[i].replace(/[^A-G#]/g, '')).length
    : 0;

  let magnitude: DiffDimension['magnitude'];
  let description: string;

  if (!sameLength || matchingRoots === 0) {
    magnitude = 'major';
    description = `Chord progression changed: ${oldChords.join('–')} → ${newChords.join('–')}`;
  } else if (matchingRoots === oldChords.length) {
    // Same roots, quality changed
    const changed = oldChords.some((c, i) => c !== newChords[i]);
    if (!changed) return null;
    magnitude = 'minor';
    description = `Chord quality changed: ${oldChords.join('–')} → ${newChords.join('–')}`;
  } else {
    magnitude = 'moderate';
    description = `Chord progression changed: ${oldChords.join('–')} → ${newChords.join('–')}`;
  }

  // Confidence based on how many groups were recognised
  const totalGroups = Math.max(oldChords.length, newChords.length);
  const confidence = totalGroups > 0 ? 1.0 : 0.5;

  return {
    kind: 'chord_quality',
    description,
    before: oldChords.join('–'),
    after: newChords.join('–'),
    magnitude,
    confidence,
  };
}

export function detectVelocityProfile(
  oldEvents: MusicalEvent[],
  newEvents: MusicalEvent[],
): DiffDimension | null {
  const oldVels = getVelocities(oldEvents);
  const newVels = getVelocities(newEvents);

  if (oldVels.length === 0 && newVels.length === 0) return null;
  if (oldVels.length === 0 || newVels.length === 0) return null;

  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const oldMean = mean(oldVels);
  const newMean = mean(newVels);
  const oldRange = Math.max(...oldVels) - Math.min(...oldVels);
  const newRange = Math.max(...newVels) - Math.min(...newVels);

  const meanChange = Math.abs(newMean - oldMean);
  const rangeChange = Math.abs(newRange - oldRange);

  if (meanChange <= 0.05 && rangeChange <= 0.05) return null;

  let magnitude: DiffDimension['magnitude'];
  if (meanChange > 0.3 || rangeChange > 0.3) magnitude = 'major';
  else if (meanChange > 0.1 || rangeChange > 0.1) magnitude = 'moderate';
  else magnitude = 'minor';

  const confidence = (oldVels.length >= 4 && newVels.length >= 4) ? 1.0 : 0.6;

  const parts: string[] = [];
  if (rangeChange > 0.05) {
    parts.push(newRange < oldRange ? 'narrower velocity range' : 'wider velocity range');
  }
  if (meanChange > 0.05) {
    parts.push(newMean < oldMean ? 'lower average' : 'higher average');
  }

  const description = newRange < oldRange - 0.1 && rangeChange > 0.1
    ? `Dynamics flattened: ${parts.join(', ')}`
    : `Dynamics changed: ${parts.join(', ')}`;

  const r2 = (n: number) => Math.round(n * 100) / 100;

  return {
    kind: 'velocity_profile',
    description,
    before: `mean ${r2(oldMean)}, range ${r2(oldRange)}`,
    after: `mean ${r2(newMean)}, range ${r2(newRange)}`,
    magnitude,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Summary renderer
// ---------------------------------------------------------------------------

function renderSummary(dimensions: DiffDimension[]): string {
  if (dimensions.length === 0) return 'No significant changes detected';

  // Sort by magnitude (major first) then by confidence
  const magnitudeOrder = { major: 0, moderate: 1, minor: 2 };
  const sorted = [...dimensions].sort((a, b) =>
    magnitudeOrder[a.magnitude] - magnitudeOrder[b.magnitude] || b.confidence - a.confidence,
  );

  return sorted.map(d => d.description).join('; ');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function generateSemanticDiff(
  oldEvents: MusicalEvent[],
  newEvents: MusicalEvent[],
  context: SemanticDiffContext,
): SemanticDiff {
  const detectors: Array<DiffDimension | null> = [
    detectDensity(oldEvents, newEvents),
    detectPitchRange(oldEvents, newEvents),
    detectContour(oldEvents, newEvents),
    detectTransposition(oldEvents, newEvents),
    detectRhythmPlacement(oldEvents, newEvents, context),
    detectChordQuality(oldEvents, newEvents, context),
    detectVelocityProfile(oldEvents, newEvents),
  ];

  // If transposition detected, suppress contour (transposition is more specific)
  const hasTransposition = detectors.some(d => d?.kind === 'transposition');
  const dimensions = detectors.filter((d): d is DiffDimension =>
    d !== null && !(hasTransposition && d.kind === 'contour'),
  );

  return {
    trackId: context.trackId,
    dimensions,
    summary: renderSummary(dimensions),
  };
}
