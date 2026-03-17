import type { MusicalEvent, NoteEvent } from './canonical-types';

/**
 * Rotate all events by `steps`, wrapping at `duration`.
 * Pure: returns a new sorted array without mutating input.
 */
export function rotate(events: MusicalEvent[], steps: number, duration: number): MusicalEvent[] {
  const result = events.map((e) => {
    const newAt = ((e.at + steps) % duration + duration) % duration;
    return { ...e, at: newAt };
  });
  return result.sort((a, b) => a.at - b.at);
}

/**
 * Transpose NoteEvent pitches by `semitones`, clamped to 0–127.
 * No-op on TriggerEvent and ParameterEvent.
 */
export function transpose(events: MusicalEvent[], semitones: number): MusicalEvent[] {
  return events.map((e) => {
    if (e.kind !== 'note') return { ...e };
    const note = e as NoteEvent;
    const pitch = Math.max(0, Math.min(127, note.pitch + semitones));
    return { ...note, pitch };
  });
}

/**
 * Reverse event positions within `duration`.
 * Maps `at` → `(duration - at) % duration`, so `at=0` stays at 0
 * and all other positions are mirrored.
 * Pure: returns a new sorted array.
 */
export function reverse(events: MusicalEvent[], duration: number): MusicalEvent[] {
  const result = events.map((e) => {
    let newAt = duration - e.at;
    if (newAt >= duration) newAt = 0;
    return { ...e, at: newAt };
  });
  return result.sort((a, b) => a.at - b.at);
}

/**
 * Duplicate all events, shifting copies by `duration`.
 * Returns doubled events and doubled duration.
 */
/** Maximum duration after duplication (in steps). */
const MAX_DUPLICATE_DURATION = 512;

export function duplicate(
  events: MusicalEvent[],
  duration: number,
): { events: MusicalEvent[]; duration: number } {
  if (duration * 2 > MAX_DUPLICATE_DURATION) {
    return { events: events.map((e) => ({ ...e })), duration };
  }
  const originals = events.map((e) => ({ ...e }));
  const copies = events.map((e) => ({ ...e, at: e.at + duration }));
  return {
    events: [...originals, ...copies],
    duration: duration * 2,
  };
}
