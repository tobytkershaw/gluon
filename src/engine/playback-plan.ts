import type { MusicalEvent, NoteEvent } from './canonical-types';

export type RuntimeEventId = string;

interface PlannedEvent {
  absoluteStep: number;
  trackId: string;
  generation: number;
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
): RuntimeEventId {
  const suffix = event.kind === 'note'
    ? `note:${(event as NoteEvent).pitch}@${formatStep(event.at)}`
    : event.kind === 'parameter'
    ? `${event.controlId}@${formatStep(event.at)}`
    : `${event.kind}@${formatStep(event.at)}`;
  return `${generation}:${trackId}:${patternId}:${occurrence}:${suffix}`;
}

export class PlaybackPlan {
  private generation = 0;
  private planned = new Map<RuntimeEventId, PlannedEvent>();

  reset(generation: number): void {
    this.generation = generation;
    this.planned.clear();
  }

  admit(eventId: RuntimeEventId, absoluteStep: number, generation: number, trackId: string): boolean {
    if (generation !== this.generation) {
      this.reset(generation);
    }
    if (this.planned.has(eventId)) return false;
    this.planned.set(eventId, { absoluteStep, trackId, generation });
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

  invalidateTrack(trackId: string, generation: number, minStep = 0): void {
    for (const [eventId, event] of this.planned) {
      if (event.generation === generation && event.trackId === trackId && event.absoluteStep >= minStep) {
        this.planned.delete(eventId);
      }
    }
  }
}
