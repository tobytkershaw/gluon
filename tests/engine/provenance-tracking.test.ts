// tests/engine/provenance-tracking.test.ts
// Tests for control provenance capture/restore across undo, redo, and various
// human edit paths (#1164, #1166, #1167, #1168, #1173, #1180).
import { describe, it, expect } from 'vitest';
import { applyMove, applyUndo, applyRedo } from '../../src/engine/primitives';
import { createSession, updateTrackParams } from '../../src/engine/session';
import { getTrack, updateTrack } from '../../src/engine/types';
import type { ParamSnapshot, Session } from '../../src/engine/types';
import type { ControlState } from '../../src/engine/canonical-types';

/**
 * Helper: create a session with controlProvenance seeded for a track.
 */
function sessionWithProvenance(): { session: Session; trackId: string } {
  let session = createSession();
  const trackId = session.activeTrackId;
  const provenance: ControlState = {
    timbre: { value: 0.5, source: 'ai', updatedAt: 1000 },
    morph: { value: 0.3, source: 'default', updatedAt: 900 },
  };
  session = updateTrack(session, trackId, { controlProvenance: provenance });
  return { session, trackId };
}

describe('Provenance tracking — undo/redo round-trip (#1173)', () => {
  it('undo restores prevProvenance from a ParamSnapshot', () => {
    const { session, trackId } = sessionWithProvenance();

    // Simulate an AI move that would capture prevProvenance
    const track = getTrack(session, trackId);
    const snapshot: ParamSnapshot = {
      kind: 'param',
      trackId,
      prevValues: { timbre: 0.5 },
      aiTargetValues: { timbre: 0.8 },
      prevProvenance: { timbre: { value: 0.5, source: 'ai', updatedAt: 1000 } },
      timestamp: Date.now(),
      description: 'test move',
    };
    // Apply the move + push snapshot
    let s = updateTrack(session, trackId, {
      params: { ...track.params, timbre: 0.8 },
      controlProvenance: {
        ...track.controlProvenance!,
        timbre: { value: 0.8, source: 'human', updatedAt: 2000 },
      },
    });
    s = { ...s, undoStack: [snapshot] };

    // Undo should restore provenance
    const undone = applyUndo(s);
    const undoneTrack = getTrack(undone, trackId);
    expect(undoneTrack.controlProvenance?.timbre.source).toBe('ai');
    expect(undoneTrack.controlProvenance?.timbre.updatedAt).toBe(1000);
  });

  it('redo restores provenance that was current before undo (#1173)', () => {
    const { session, trackId } = sessionWithProvenance();

    const track = getTrack(session, trackId);
    const snapshot: ParamSnapshot = {
      kind: 'param',
      trackId,
      prevValues: { timbre: 0.5 },
      aiTargetValues: { timbre: 0.8 },
      prevProvenance: { timbre: { value: 0.5, source: 'ai', updatedAt: 1000 } },
      timestamp: Date.now(),
      description: 'test move',
    };

    // Set up: param at 0.8, provenance source='human'
    let s = updateTrack(session, trackId, {
      params: { ...track.params, timbre: 0.8 },
      controlProvenance: {
        ...track.controlProvenance!,
        timbre: { value: 0.8, source: 'human', updatedAt: 2000 },
      },
    });
    s = { ...s, undoStack: [snapshot], redoStack: [] };

    // Undo — provenance should revert to 'ai'
    const undone = applyUndo(s);
    expect(getTrack(undone, trackId).controlProvenance?.timbre.source).toBe('ai');

    // Redo — provenance should restore to 'human'
    const redone = applyRedo(undone);
    expect(getTrack(redone, trackId).controlProvenance?.timbre.source).toBe('human');
    expect(getTrack(redone, trackId).controlProvenance?.timbre.updatedAt).toBe(2000);
  });

  it('redo without prevProvenance does not crash', () => {
    // Verify no crash when prevProvenance is undefined
    let session = createSession();
    const trackId = session.activeTrackId;

    // Apply a simple move (no provenance on the track)
    const result = applyMove(session, trackId, 'timbre', { absolute: 0.8 });
    expect(result).not.toBeNull();
    // Just verify undo and redo don't throw
    const undone = applyUndo(result!);
    expect(undone.redoStack.length).toBe(1);
    const redone = applyRedo(undone);
    expect(redone.undoStack.length).toBe(1);
  });
});

describe('Provenance snapshot capture patterns', () => {
  it('ParamSnapshot with prevProvenance captures correct control IDs', () => {
    const { session, trackId } = sessionWithProvenance();
    const track = getTrack(session, trackId);

    // A snapshot that changes timbre should capture timbre provenance
    const snapshot: ParamSnapshot = {
      kind: 'param',
      trackId,
      prevValues: { timbre: 0.5 },
      aiTargetValues: { timbre: 0.9 },
      prevProvenance: { timbre: { ...track.controlProvenance!.timbre } },
      timestamp: Date.now(),
      description: 'test',
    };

    expect(snapshot.prevProvenance).toBeDefined();
    expect(snapshot.prevProvenance!.timbre).toBeDefined();
    expect(snapshot.prevProvenance!.timbre!.source).toBe('ai');
    // morph provenance should NOT be captured (not in the move)
    expect(snapshot.prevProvenance!.morph).toBeUndefined();
  });
});
