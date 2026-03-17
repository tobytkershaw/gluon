// tests/engine/sequence-editor.test.ts
import { describe, it, expect } from 'vitest';
import { createSession, addPattern, addPatternRef, removePatternRef, reorderPatternRef } from '../../src/engine/session';
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
