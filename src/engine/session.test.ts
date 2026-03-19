import { describe, it, expect } from 'vitest';
import { createSession, addTrack, nextTrackName, renameTrack, removeTrack } from './session';
import { applyUndo } from './primitives';

describe('nextTrackName', () => {
  it('returns T2 when session has one track named T1', () => {
    const session = createSession(); // default session has T1
    expect(nextTrackName(session)).toBe('T2');
  });

  it('returns T1 if no tracks have T-numbered names', () => {
    const session = createSession();
    // Rename the default track so T1 is free
    const renamed = renameTrack(session, session.tracks[0].id, 'Kick');
    expect(nextTrackName(renamed)).toBe('T1');
  });

  it('skips names already in use', () => {
    let session = createSession(); // T1
    session = addTrack(session)!;  // T2
    session = addTrack(session)!;  // T3
    expect(nextTrackName(session)).toBe('T4');
  });

  it('fills gaps when a middle name is freed', () => {
    let session = createSession(); // T1
    session = addTrack(session)!;  // T2
    session = addTrack(session)!;  // T3
    // Rename T2 to something else, freeing it
    const t2 = session.tracks.find(t => t.name === 'T2')!;
    session = renameTrack(session, t2.id, 'Snare');
    expect(nextTrackName(session)).toBe('T2');
  });

  it('skips a name that exists from a user rename', () => {
    let session = createSession(); // T1
    // Rename T1 to T4 — now T4 is taken by rename
    session = renameTrack(session, session.tracks[0].id, 'T4');
    session = addTrack(session)!; // should get T1 (not T4)
    const newTrack = session.tracks.find(t => t.name === 'T1');
    expect(newTrack).toBeDefined();
    // Next should be T2 (T1 and T4 both taken)
    expect(nextTrackName(session)).toBe('T2');
  });
});

describe('addTrack auto-naming', () => {
  it('first added track gets T2 (session starts with T1)', () => {
    const session = createSession();
    const result = addTrack(session)!;
    const newTrack = result.tracks.find(t => t.name === 'T2');
    expect(newTrack).toBeDefined();
  });

  it('successive adds increment: T2, T3, T4', () => {
    let session = createSession(); // T1
    session = addTrack(session)!;
    session = addTrack(session)!;
    session = addTrack(session)!;
    const names = session.tracks.filter(t => t.name?.startsWith('T')).map(t => t.name);
    expect(names).toContain('T1');
    expect(names).toContain('T2');
    expect(names).toContain('T3');
    expect(names).toContain('T4');
  });

  it('bus tracks do not get auto-named', () => {
    const session = createSession();
    const result = addTrack(session, 'bus')!;
    const busTrack = result.tracks.find(t => t.kind === 'bus' && t.id !== 'master-bus');
    expect(busTrack).toBeDefined();
    expect(busTrack!.name).toBeUndefined();
  });
});

describe('removeTrack sidechain cleanup', () => {
  function sessionWithSidechain() {
    let session = createSession(); // T1
    session = addTrack(session)!;  // T2
    session = addTrack(session)!;  // T3
    const t1 = session.tracks[0]; // audio track (sidechain source)
    const t2 = session.tracks[1]; // audio track (has compressor with sidechain)
    // Add a compressor to T2 that sidechains from T1
    const compressor = {
      id: 'comp-1',
      type: 'compressor',
      model: 0,
      params: { threshold: 0.5, ratio: 0.5, attack: 0.2, release: 0.3 },
      sidechainSourceId: t1.id,
    };
    session = {
      ...session,
      tracks: session.tracks.map(t =>
        t.id === t2.id ? { ...t, processors: [compressor] } : t,
      ),
    };
    return { session, sourceId: t1.id, scTrackId: t2.id };
  }

  it('clears sidechainSourceId when source track is removed', () => {
    const { session, sourceId, scTrackId } = sessionWithSidechain();
    const result = removeTrack(session, sourceId)!;
    expect(result).not.toBeNull();
    const scTrack = result.tracks.find(t => t.id === scTrackId)!;
    const comp = scTrack.processors!.find(p => p.id === 'comp-1')!;
    expect(comp.sidechainSourceId).toBeUndefined();
  });

  it('preserves sidechain when a different track is removed', () => {
    const { session, sourceId, scTrackId } = sessionWithSidechain();
    // Remove T3 (not the sidechain source)
    const t3 = session.tracks[2];
    const result = removeTrack(session, t3.id)!;
    expect(result).not.toBeNull();
    const scTrack = result.tracks.find(t => t.id === scTrackId)!;
    const comp = scTrack.processors!.find(p => p.id === 'comp-1')!;
    expect(comp.sidechainSourceId).toBe(sourceId);
  });

  it('records affectedSidechains in the undo snapshot', () => {
    const { session, sourceId } = sessionWithSidechain();
    const result = removeTrack(session, sourceId)!;
    const snapshot = result.undoStack[result.undoStack.length - 1];
    expect(snapshot.kind).toBe('track-remove');
    if (snapshot.kind === 'track-remove') {
      expect(snapshot.affectedSidechains).toBeDefined();
      expect(snapshot.affectedSidechains!.length).toBe(1);
      expect(snapshot.affectedSidechains![0].prevSourceId).toBe(sourceId);
    }
  });

  it('undo restores sidechain references', () => {
    const { session, sourceId, scTrackId } = sessionWithSidechain();
    const removed = removeTrack(session, sourceId)!;
    // Verify sidechain is cleared
    const compAfterRemove = removed.tracks.find(t => t.id === scTrackId)!.processors!.find(p => p.id === 'comp-1')!;
    expect(compAfterRemove.sidechainSourceId).toBeUndefined();
    // Undo
    const undone = applyUndo(removed);
    const scTrack = undone.tracks.find(t => t.id === scTrackId)!;
    const comp = scTrack.processors!.find(p => p.id === 'comp-1')!;
    expect(comp.sidechainSourceId).toBe(sourceId);
  });
});
