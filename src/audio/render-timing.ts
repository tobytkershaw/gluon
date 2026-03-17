// src/audio/render-timing.ts
// Sub-block event scheduling for offline render parity with live playback.
// The live engine processes events at sample-accurate positions via
// AudioWorklet scheduling. The offline render must match this precision
// by splitting render blocks at event boundaries.

/**
 * A segment within a render block. The render loop processes segments
 * sequentially: apply events, then render `length` frames.
 */
export interface BlockSegment {
  /** Offset within the block (0-based, in frames). */
  startOffset: number;
  /** Number of frames to render in this segment. */
  length: number;
  /** Indices of events to apply before rendering this segment. */
  eventsToApply: number[];
}

/**
 * Split a render block into segments at event boundaries for sub-block
 * timing precision.
 *
 * Events are positioned by converting their beatTime to an absolute frame,
 * then computing the offset within the current block. Events that fall at
 * the same frame are coalesced into a single segment boundary.
 *
 * @param events      Events that fall within this block, with their original
 *                    indices in the sorted event list.
 * @param blockFrame  Absolute frame number of the block start.
 * @param framesToRender  Number of frames in the block (usually BLOCK_SIZE).
 * @param framesPerStep   Frames per beat step (16th note).
 * @returns Array of segments covering the full block.
 */
export function splitBlockAtEvents(
  events: { beatTime: number; index: number }[],
  blockFrame: number,
  framesToRender: number,
  framesPerStep: number,
): BlockSegment[] {
  if (events.length === 0) {
    return [{ startOffset: 0, length: framesToRender, eventsToApply: [] }];
  }

  // Compute frame offsets within the block for each event
  const eventOffsets: { offset: number; index: number }[] = events.map(ev => {
    const absFrame = Math.round(ev.beatTime * framesPerStep);
    const offset = Math.max(0, Math.min(framesToRender, absFrame - blockFrame));
    return { offset, index: ev.index };
  });

  // Group events by their frame offset
  const offsetMap = new Map<number, number[]>();
  for (const { offset, index } of eventOffsets) {
    const existing = offsetMap.get(offset);
    if (existing) {
      existing.push(index);
    } else {
      offsetMap.set(offset, [index]);
    }
  }

  // Sort unique offsets
  const sortedOffsets = [...offsetMap.keys()].sort((a, b) => a - b);

  const segments: BlockSegment[] = [];
  let cursor = 0;

  for (const offset of sortedOffsets) {
    // If there's a gap before this event, emit a silent segment
    if (offset > cursor) {
      segments.push({
        startOffset: cursor,
        length: offset - cursor,
        eventsToApply: [],
      });
    }

    // Determine the length: until the next event offset or end of block
    const nextIdx = sortedOffsets.indexOf(offset) + 1;
    const nextOffset = nextIdx < sortedOffsets.length ? sortedOffsets[nextIdx] : framesToRender;

    segments.push({
      startOffset: offset,
      length: nextOffset - offset,
      eventsToApply: offsetMap.get(offset)!,
    });

    cursor = nextOffset;
  }

  // If the last event didn't reach the end of the block, that's already
  // handled by the nextOffset = framesToRender fallback above.

  return segments;
}
