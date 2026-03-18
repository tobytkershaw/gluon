import type { MusicalEvent, NoteEvent } from './canonical-types';

export type RuntimeEventId = string;

interface PlannedEvent {
  absoluteStep: number;
  trackId: string;
}

function formatStep(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6);
}

export function buildRuntimeEventId(
  generation: number,
  trackId: string,
  patternId: string,
  event: MusicalEvent,
  occurrence: number,
  trackRevision = 0,
): RuntimeEventId {
  const suffix = event.kind === 'note'
    ? `note:${(event as NoteEvent).pitch}@${formatStep(event.at)}`
    : event.kind === 'parameter'
    ? `${event.controlId}@${formatStep(event.at)}`
    : `${event.kind}@${formatStep(event.at)}`;
  // Include trackRevision so events after a pattern edit get fresh IDs,
  // preventing stale plan entries from blocking re-scheduling.
  return trackRevision > 0
    ? `${generation}:${trackId}:${patternId}:${occurrence}:r${trackRevision}:${suffix}`
    : `${generation}:${trackId}:${patternId}:${occurrence}:${suffix}`;
}

export class PlaybackPlan {
  private generation = 0;
  private planned = new Map<RuntimeEventId, PlannedEvent>();
  /** Per-track revision counter — bumped on each invalidateTrack call. */
  private trackRevisions = new Map<string, number>();

  reset(generation: number): void {
    this.generation = generation;
    this.planned.clear();
    this.trackRevisions.clear();
  }

  admit(eventId: RuntimeEventId, absoluteStep: number, generation: number, trackId: string): boolean {
    if (generation !== this.generation) {
      this.reset(generation);
    }
    if (this.planned.has(eventId)) return false;
    this.planned.set(eventId, { absoluteStep, trackId });
    return true;
  }

  pruneBeforeStep(minStep: number): void {
    for (const [eventId, event] of this.planned) {
      if (event.absoluteStep < minStep) {
        this.planned.delete(eventId);
      }
    }
  }

  has(eventId: RuntimeEventId): boolean {
    return this.planned.has(eventId);
  }

  /**
   * Bump the track's revision counter so that subsequent events for this
   * track produce fresh runtime IDs.  Old plan entries (from before the
   * edit) remain in the map harmlessly — they'll never match the new IDs
   * and will be pruned naturally by `pruneBeforeStep`.
   */
  invalidateTrack(trackId: string): void {
    const current = this.trackRevisions.get(trackId) ?? 0;
    this.trackRevisions.set(trackId, current + 1);
  }

  /** Return the current revision for a track (0 if never invalidated). */
  getTrackRevision(trackId: string): number {
    return this.trackRevisions.get(trackId) ?? 0;
  }
}
