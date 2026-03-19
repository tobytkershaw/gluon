import { describe, it, expect } from 'vitest';
import { createSession, addTrack } from './session';
import { applyUndo, applyRedo } from './primitives';
import type {
  Session,
  ChordProgressionSnapshot,
  SidechainSnapshot,
} from './types';

// ---------------------------------------------------------------------------
// Bug 1: Redo broken for chord-progression and sidechain snapshots
// ---------------------------------------------------------------------------

describe('redo for chord-progression snapshots', () => {
  it('redo restores the chord progression that was undone', () => {
    let session = createSession();

    // Simulate setting a chord progression with an undo snapshot
    const original: Array<{ bar: number; chord: string }> = [
      { bar: 1, chord: 'Am' },
      { bar: 3, chord: 'F' },
    ];
    const updated: Array<{ bar: number; chord: string }> = [
      { bar: 1, chord: 'C' },
      { bar: 3, chord: 'G' },
    ];

    // Start with an existing progression
    session = { ...session, chordProgression: original };

    // Push a snapshot that records the change to `updated`
    const snapshot: ChordProgressionSnapshot = {
      kind: 'chord-progression',
      prevChordProgression: original,
      timestamp: Date.now(),
      description: 'set chord progression',
    };
    session = {
      ...session,
      chordProgression: updated,
      undoStack: [...session.undoStack, snapshot],
    };

    // Undo should restore original
    const afterUndo = applyUndo(session);
    expect(afterUndo.chordProgression).toEqual(original);

    // Redo should restore updated
    const afterRedo = applyRedo(afterUndo);
    expect(afterRedo.chordProgression).toEqual(updated);
  });
});

describe('redo for sidechain snapshots', () => {
  it('redo restores the sidechain source that was undone', () => {
    let session = createSession();
    const trackId = session.tracks[0].id;

    // Add a processor with a sidechain source
    const processor = {
      id: 'comp-1',
      type: 'compressor',
      model: 0,
      params: {},
      sidechainSourceId: 'track-2',
    };

    session = {
      ...session,
      tracks: session.tracks.map(t =>
        t.id === trackId ? { ...t, processors: [processor] } : t,
      ),
    };

    // Push a snapshot that records the sidechain change (prev was undefined)
    const snapshot: SidechainSnapshot = {
      kind: 'sidechain',
      targetTrackId: trackId,
      processorId: 'comp-1',
      prevSourceId: undefined,
      timestamp: Date.now(),
      description: 'set sidechain',
    };
    session = { ...session, undoStack: [...session.undoStack, snapshot] };

    // Undo: should clear the sidechain (restore prevSourceId = undefined)
    const afterUndo = applyUndo(session);
    const undoneProc = afterUndo.tracks
      .find(t => t.id === trackId)!
      .processors!.find(p => p.id === 'comp-1')!;
    expect(undoneProc.sidechainSourceId).toBeUndefined();

    // Redo: should restore sidechain to 'track-2'
    const afterRedo = applyRedo(afterUndo);
    const redoneProc = afterRedo.tracks
      .find(t => t.id === trackId)!
      .processors!.find(p => p.id === 'comp-1')!;
    expect(redoneProc.sidechainSourceId).toBe('track-2');
  });
});

// ---------------------------------------------------------------------------
// Bug 2: track-add undo doesn't restore activeTrackId
// ---------------------------------------------------------------------------

describe('track-add undo restores activeTrackId', () => {
  it('undo of addTrack restores the previously active track', () => {
    const session = createSession();
    const originalActiveId = session.activeTrackId;

    // Add a track — activeTrackId changes to the new track
    const afterAdd = addTrack(session)!;
    expect(afterAdd.activeTrackId).not.toBe(originalActiveId);

    // Undo — should restore the original activeTrackId, not pick the last track
    const afterUndo = applyUndo(afterAdd);
    expect(afterUndo.activeTrackId).toBe(originalActiveId);
  });

  it('redo of undone addTrack switches active back to the new track', () => {
    const session = createSession();
    const afterAdd = addTrack(session)!;
    const newTrackId = afterAdd.activeTrackId;

    const afterUndo = applyUndo(afterAdd);
    const afterRedo = applyRedo(afterUndo);

    // The re-added track should exist and be active
    expect(afterRedo.tracks.some(t => t.id === newTrackId)).toBe(true);
    expect(afterRedo.activeTrackId).toBe(newTrackId);
  });
});
