import { describe, it, expect } from 'vitest';
import { transposeEventsByIndices } from '../../src/engine/event-primitives';
import { createSession } from '../../src/engine/session';
import { getActivePattern } from '../../src/engine/types';
import type { NoteEvent, ParameterEvent } from '../../src/engine/canonical-types';

function note(at: number, pitch: number): NoteEvent {
  return { kind: 'note', at, pitch, velocity: 0.8, duration: 1 };
}

function param(at: number, controlId: string, value: number): ParameterEvent {
  return { kind: 'parameter', at, controlId, value };
}

function sessionWithEvents(events: (NoteEvent | ParameterEvent)[]) {
  const session = createSession();
  const track = session.tracks[0];
  const pattern = getActivePattern(track);
  const newPattern = { ...pattern, events: [...events] };
  const newTrack = { ...track, patterns: [newPattern] };
  return { ...session, tracks: [newTrack, ...session.tracks.slice(1)] };
}

describe('transposeEventsByIndices', () => {
  it('transposes selected note events by given semitones', () => {
    const s = sessionWithEvents([note(0, 60), note(1, 64), note(2, 67)]);
    const result = transposeEventsByIndices(s, s.activeTrackId, [0, 2], 2);
    const events = getActivePattern(result.tracks[0]).events;
    expect((events[0] as NoteEvent).pitch).toBe(62);
    expect((events[1] as NoteEvent).pitch).toBe(64); // unchanged
    expect((events[2] as NoteEvent).pitch).toBe(69);
  });

  it('clamps pitches to 0-127', () => {
    const s = sessionWithEvents([note(0, 126), note(1, 1)]);
    const up = transposeEventsByIndices(s, s.activeTrackId, [0], 5);
    expect((getActivePattern(up.tracks[0]).events[0] as NoteEvent).pitch).toBe(127);

    const down = transposeEventsByIndices(s, s.activeTrackId, [1], -5);
    expect((getActivePattern(down.tracks[0]).events[1] as NoteEvent).pitch).toBe(0);
  });

  it('ignores non-note events in the index set', () => {
    const s = sessionWithEvents([note(0, 60), param(1, 'timbre', 0.5)]);
    const result = transposeEventsByIndices(s, s.activeTrackId, [0, 1], 3);
    const events = getActivePattern(result.tracks[0]).events;
    expect((events[0] as NoteEvent).pitch).toBe(63);
    expect((events[1] as ParameterEvent).value).toBe(0.5); // unchanged
  });

  it('returns session unchanged when semitones is 0', () => {
    const s = sessionWithEvents([note(0, 60)]);
    const result = transposeEventsByIndices(s, s.activeTrackId, [0], 0);
    expect(result).toBe(s);
  });

  it('returns session unchanged when indices are empty', () => {
    const s = sessionWithEvents([note(0, 60)]);
    const result = transposeEventsByIndices(s, s.activeTrackId, [], 5);
    expect(result).toBe(s);
  });

  it('creates a single undo entry', () => {
    const s = sessionWithEvents([note(0, 60), note(1, 64), note(2, 67)]);
    const before = s.undoStack.length;
    const result = transposeEventsByIndices(s, s.activeTrackId, [0, 1, 2], 1);
    expect(result.undoStack.length).toBe(before + 1);
  });
});
