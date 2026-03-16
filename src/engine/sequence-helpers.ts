// src/engine/sequence-helpers.ts
// Pure functions for resolving sequence positions (shared between scheduler and UI).

import type { Pattern } from './canonical-types';
import type { PatternRef } from './sequencer-types';

/**
 * Resolved position within a sequence: which pattern is playing and where within it.
 */
export interface SequencePosition {
  /** Index into the sequence array. */
  sequenceIndex: number;
  /** ID of the pattern at this position. */
  patternId: string;
  /** Position within the pattern (local step). */
  localStep: number;
  /** Accumulated steps before this pattern slot. */
  sequenceOffset: number;
}

/**
 * Resolve a global step position to a sequence position.
 * Returns null if the position is past the end of the sequence.
 *
 * @param globalStep   The absolute step position to resolve.
 * @param sequence     The track's sequence (ordered pattern refs).
 * @param patterns     The track's pattern library.
 */
export function resolveSequencePosition(
  globalStep: number,
  sequence: PatternRef[],
  patterns: Pattern[],
): SequencePosition | null {
  let offset = 0;
  for (let i = 0; i < sequence.length; i++) {
    const ref = sequence[i];
    const pat = patterns.find(p => p.id === ref.patternId);
    if (!pat) continue;

    const patEnd = offset + pat.duration;
    if (globalStep < patEnd) {
      return {
        sequenceIndex: i,
        patternId: ref.patternId,
        localStep: globalStep - offset,
        sequenceOffset: offset,
      };
    }
    offset = patEnd;
  }
  return null; // past end of sequence
}

/**
 * Compute the total length of a sequence in steps.
 */
export function getSequenceLength(
  sequence: PatternRef[],
  patterns: Pattern[],
): number {
  let total = 0;
  for (const ref of sequence) {
    const pat = patterns.find(p => p.id === ref.patternId);
    if (pat) total += pat.duration;
  }
  return total;
}
