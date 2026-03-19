// tests/engine/sequence-editor.test.ts
import { describe, it, expect } from 'vitest';
import { createSession, addPattern, addPatternRef, removePatternRef, reorderPatternRef, setSequenceAutomation, clearSequenceAutomation } from '../../src/engine/session';
import { getTrack } from '../../src/engine/types';
import { applyUndo } from '../../src/engine/primitives';

function setupSession() {
  // Create session with one track, add a second pattern so we have two
  let session = createSession();
  const trackId = session.activeTrackId;
  session = addPattern(session, trackId)!;
  // Now the track has 2 patterns and sequence = [ref0, ref1]
  return { session, trackId };
}

describe('addPatternRef', () => {
  it('appends a pattern ref to the sequence', () => {
    const { session, trackId } = setupSession();
    const track = getTrack(session, trackId);
    const patternId = track.patterns[0].id;
    const before = track.sequence.length;

    const result = addPatternRef(session, trackId, patternId);
    const after = getTrack(result, trackId);

    expect(after.sequence.length).toBe(before + 1);
    expect(after.sequence[after.sequence.length - 1].patternId).toBe(patternId);
  });

  it('pushes an undo snapshot', () => {
    const { session, trackId } = setupSession();
    const track = getTrack(session, trackId);
    const patternId = track.patterns[0].id;
    const undoBefore = session.undoStack.length;

    const result = addPatternRef(session, trackId, patternId);
    expect(result.undoStack.length).toBe(undoBefore + 1);
    expect(result.undoStack[result.undoStack.length - 1]).toMatchObject({ kind: 'sequence-edit' });
  });

  it('undo restores previous sequence', () => {
    const { session, trackId } = setupSession();
    const track = getTrack(session, trackId);
    const patternId = track.patterns[0].id;
    const prevSequence = track.sequence.map(r => ({ ...r }));

    const result = addPatternRef(session, trackId, patternId);
    const undone = applyUndo(result);
    const undoneTrack = getTrack(undone, trackId);

    expect(undoneTrack.sequence).toEqual(prevSequence);
  });

  it('marks track dirty for scheduler invalidation', () => {
    const { session, trackId } = setupSession();
    const track = getTrack(session, trackId);
    const patternId = track.patterns[0].id;

    const result = addPatternRef(session, trackId, patternId);
    expect(getTrack(result, trackId)._patternDirty).toBe(true);
  });

  it('no-ops if track does not exist', () => {
    const { session } = setupSession();
    const result = addPatternRef(session, 'nonexistent', 'whatever');
    expect(result).toBe(session);
  });

  it('no-ops if pattern does not exist on track', () => {
    const { session, trackId } = setupSession();
    const result = addPatternRef(session, trackId, 'nonexistent-pattern');
    expect(result).toBe(session);
  });
});

describe('removePatternRef', () => {
  it('removes a ref by index', () => {
    const { session, trackId } = setupSession();
    const track = getTrack(session, trackId);
    const before = track.sequence.length;
    expect(before).toBeGreaterThan(1);

    const result = removePatternRef(session, trackId, 0);
    const after = getTrack(result, trackId);
    expect(after.sequence.length).toBe(before - 1);
  });

  it('prevents empty sequence (no-ops when only one ref)', () => {
    // Start with a fresh session that has only one pattern and one ref
    const session = createSession();
    const trackId = session.activeTrackId;
    const track = getTrack(session, trackId);
    expect(track.sequence.length).toBe(1);

    const result = removePatternRef(session, trackId, 0);
    expect(result).toBe(session); // should be unchanged
  });

  it('marks track dirty for scheduler invalidation', () => {
    const { session, trackId } = setupSession();
    const result = removePatternRef(session, trackId, 0);
    expect(getTrack(result, trackId)._patternDirty).toBe(true);
  });

  it('no-ops for out-of-range index', () => {
    const { session, trackId } = setupSession();
    const result = removePatternRef(session, trackId, 999);
    expect(result).toBe(session);
  });

  it('no-ops for negative index', () => {
    const { session, trackId } = setupSession();
    const result = removePatternRef(session, trackId, -1);
    expect(result).toBe(session);
  });

  it('pushes an undo snapshot', () => {
    const { session, trackId } = setupSession();
    const undoBefore = session.undoStack.length;

    const result = removePatternRef(session, trackId, 0);
    expect(result.undoStack.length).toBe(undoBefore + 1);
    expect(result.undoStack[result.undoStack.length - 1]).toMatchObject({ kind: 'sequence-edit' });
  });

  it('undo restores previous sequence', () => {
    const { session, trackId } = setupSession();
    const track = getTrack(session, trackId);
    const prevSequence = track.sequence.map(r => ({ ...r }));

    const result = removePatternRef(session, trackId, 0);
    const undone = applyUndo(result);
    expect(getTrack(undone, trackId).sequence).toEqual(prevSequence);
  });
});

describe('reorderPatternRef', () => {
  it('moves a ref from one position to another', () => {
    const { session, trackId } = setupSession();
    const track = getTrack(session, trackId);
    const firstRef = track.sequence[0];
    const secondRef = track.sequence[1];

    const result = reorderPatternRef(session, trackId, 0, 1);
    const after = getTrack(result, trackId);

    expect(after.sequence[0].patternId).toBe(secondRef.patternId);
    expect(after.sequence[1].patternId).toBe(firstRef.patternId);
  });

  it('marks track dirty for scheduler invalidation', () => {
    const { session, trackId } = setupSession();
    const result = reorderPatternRef(session, trackId, 0, 1);
    expect(getTrack(result, trackId)._patternDirty).toBe(true);
  });

  it('no-ops when fromIndex === toIndex', () => {
    const { session, trackId } = setupSession();
    const result = reorderPatternRef(session, trackId, 0, 0);
    expect(result).toBe(session);
  });

  it('no-ops for out-of-range indices', () => {
    const { session, trackId } = setupSession();
    expect(reorderPatternRef(session, trackId, -1, 0)).toBe(session);
    expect(reorderPatternRef(session, trackId, 0, 999)).toBe(session);
  });

  it('pushes an undo snapshot', () => {
    const { session, trackId } = setupSession();
    const undoBefore = session.undoStack.length;

    const result = reorderPatternRef(session, trackId, 0, 1);
    expect(result.undoStack.length).toBe(undoBefore + 1);
    expect(result.undoStack[result.undoStack.length - 1]).toMatchObject({ kind: 'sequence-edit' });
  });

  it('undo restores previous sequence', () => {
    const { session, trackId } = setupSession();
    const track = getTrack(session, trackId);
    const prevSequence = track.sequence.map(r => ({ ...r }));

    const result = reorderPatternRef(session, trackId, 0, 1);
    const undone = applyUndo(result);
    expect(getTrack(undone, trackId).sequence).toEqual(prevSequence);
  });
});

describe('sequence automation', () => {
  it('writes automation across multiple sequence refs', () => {
    let session = createSession();
    const trackId = session.activeTrackId;
    session = addPattern(session, trackId)!;
    const track = getTrack(session, trackId);
    const [firstPattern, secondPattern] = track.patterns;
    session = setSequenceAutomation(session, trackId, 'timbre', [
      { at: 0, value: 0.2, interpolation: 'linear' },
      { at: firstPattern.duration + secondPattern.duration, value: 0.8 },
    ]);

    const updated = getTrack(session, trackId);
    expect(updated.sequence[0].automation?.[0].controlId).toBe('timbre');
    expect(updated.sequence[0].automation?.[0].points[0]).toMatchObject({ at: 0, value: 0.2 });
    expect(updated.sequence[0].automation?.[0].points.at(-1)).toMatchObject({ at: firstPattern.duration });
    expect(updated.sequence[1].automation?.[0].points[0]).toMatchObject({ at: 0, value: 0.5 });
    expect(updated.sequence[1].automation?.[0].points.at(-1)).toMatchObject({ at: secondPattern.duration, value: 0.8 });
  });

  it('undo restores the previous sequence automation state', () => {
    let session = createSession();
    const trackId = session.activeTrackId;
    session = addPattern(session, trackId)!;
    const prevSequence = getTrack(session, trackId).sequence.map(ref => ({ ...ref }));

    session = setSequenceAutomation(session, trackId, 'morph', [
      { at: 0, value: 0.1, interpolation: 'linear' },
      { at: 32, value: 0.7 },
    ]);
    const undone = applyUndo(session);

    expect(getTrack(undone, trackId).sequence).toEqual(prevSequence);
  });

  it('clears sequence automation for a control without touching other refs', () => {
    let session = createSession();
    const trackId = session.activeTrackId;
    session = addPattern(session, trackId)!;
    session = setSequenceAutomation(session, trackId, 'harmonics', [
      { at: 0, value: 0.2, interpolation: 'linear' },
      { at: 32, value: 0.6 },
    ]);

    session = clearSequenceAutomation(session, trackId, 'harmonics');
    const updated = getTrack(session, trackId);

    expect(updated.sequence.every(ref => !(ref.automation?.some(lane => lane.controlId === 'harmonics')))).toBe(true);
  });
});
