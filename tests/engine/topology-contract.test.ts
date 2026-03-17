// tests/engine/topology-contract.test.ts
// Contract tests for topology invariants: master bus lifecycle, send routing
// constraints, and track ordering guarantees.
//
// These tests define the intended topology contract explicitly so that docs,
// tests, PatchView scope, and engine behavior all agree on the truth.
// See #562.

import { describe, it, expect } from 'vitest';
import {
  createSession, addTrack, removeTrack,
  addSend, removeSend, setSendLevel,
} from '../../src/engine/session';
import { applyUndo } from '../../src/engine/primitives';
import { MASTER_BUS_ID, getTrackKind } from '../../src/engine/types';

// ---------------------------------------------------------------------------
// Master bus lifecycle invariants
// ---------------------------------------------------------------------------

describe('Topology contract: master bus lifecycle', () => {
  it('session always starts with a master bus as the last track', () => {
    const s = createSession();
    const last = s.tracks[s.tracks.length - 1];
    expect(last.id).toBe(MASTER_BUS_ID);
    expect(last.kind).toBe('bus');
  });

  it('master bus cannot be removed', () => {
    const s = createSession();
    const result = removeTrack(s, MASTER_BUS_ID);
    expect(result).toBeNull();
  });

  it('master bus remains last after adding audio tracks', () => {
    let s = createSession();
    s = addTrack(s, 'audio')!;
    s = addTrack(s, 'audio')!;
    const last = s.tracks[s.tracks.length - 1];
    expect(last.id).toBe(MASTER_BUS_ID);
  });

  it('master bus remains last after adding bus tracks', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const last = s.tracks[s.tracks.length - 1];
    expect(last.id).toBe(MASTER_BUS_ID);
    // The new bus should be before master
    const newBus = s.tracks[s.tracks.length - 2];
    expect(getTrackKind(newBus)).toBe('bus');
    expect(newBus.id).not.toBe(MASTER_BUS_ID);
  });

  it('track ordering is audio -> bus -> master after mixed additions', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    s = addTrack(s, 'audio')!;
    s = addTrack(s, 'bus')!;
    s = addTrack(s, 'audio')!;

    const kinds = s.tracks.map(t => {
      if (t.id === MASTER_BUS_ID) return 'master';
      return getTrackKind(t);
    });

    // All audio tracks come first, then buses, then master
    let seenBus = false;
    let seenMaster = false;
    for (const k of kinds) {
      if (k === 'bus') seenBus = true;
      if (k === 'master') seenMaster = true;
      if (k === 'audio' && seenBus) {
        throw new Error('Audio track found after bus track');
      }
      if (k === 'audio' && seenMaster) {
        throw new Error('Audio track found after master');
      }
      if (k === 'bus' && seenMaster) {
        throw new Error('Bus track found after master');
      }
    }
    // Master should be last
    expect(kinds[kinds.length - 1]).toBe('master');
  });

  it('removing a track preserves master bus position', () => {
    let s = createSession();
    s = addTrack(s, 'audio')!;
    const trackToRemove = s.tracks[0].id;
    s = removeTrack(s, trackToRemove)!;
    const last = s.tracks[s.tracks.length - 1];
    expect(last.id).toBe(MASTER_BUS_ID);
  });

  it('undoing track add preserves master bus as last', () => {
    let s = createSession();
    s = addTrack(s, 'audio')!;
    s = applyUndo(s);
    const last = s.tracks[s.tracks.length - 1];
    expect(last.id).toBe(MASTER_BUS_ID);
  });
});

// ---------------------------------------------------------------------------
// Send routing constraints
// ---------------------------------------------------------------------------

describe('Topology contract: send routing', () => {
  it('can add a send from an audio track to a bus', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks[0].id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    const result = addSend(s, audioId, busId);
    expect(result).not.toBeNull();
    const track = result!.tracks.find(t => t.id === audioId)!;
    expect(track.sends).toHaveLength(1);
    expect(track.sends![0].busId).toBe(busId);
  });

  it('can send to the master bus', () => {
    const s = createSession();
    const audioId = s.tracks[0].id;
    const result = addSend(s, audioId, MASTER_BUS_ID);
    expect(result).not.toBeNull();
    const track = result!.tracks.find(t => t.id === audioId)!;
    expect(track.sends).toHaveLength(1);
    expect(track.sends![0].busId).toBe(MASTER_BUS_ID);
  });

  it('rejects send to non-bus target', () => {
    let s = createSession();
    s = addTrack(s, 'audio')!;
    const audio1 = s.tracks[0].id;
    const audio2 = s.tracks[1].id;
    const result = addSend(s, audio1, audio2);
    expect(result).toBeNull();
  });

  it('rejects self-send', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    const result = addSend(s, busId, busId);
    expect(result).toBeNull();
  });

  it('rejects duplicate sends to the same bus', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks[0].id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    s = addSend(s, audioId, busId)!;
    const result = addSend(s, audioId, busId);
    expect(result).toBeNull();
  });

  it('send level is clamped to 0-1', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks[0].id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    s = addSend(s, audioId, busId, 1.5)!;
    expect(s.tracks.find(t => t.id === audioId)!.sends![0].level).toBe(1);
  });

  it('removeSend removes the correct send', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks[0].id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    s = addSend(s, audioId, busId)!;
    s = addSend(s, audioId, MASTER_BUS_ID)!;
    expect(s.tracks.find(t => t.id === audioId)!.sends).toHaveLength(2);

    s = removeSend(s, audioId, busId)!;
    const sends = s.tracks.find(t => t.id === audioId)!.sends!;
    expect(sends).toHaveLength(1);
    expect(sends[0].busId).toBe(MASTER_BUS_ID);
  });

  it('setSendLevel updates the level', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks[0].id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    s = addSend(s, audioId, busId)!;
    s = setSendLevel(s, audioId, busId, 0.5);
    expect(s.tracks.find(t => t.id === audioId)!.sends![0].level).toBe(0.5);
  });

  it('removing a bus cleans up sends from other tracks', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks[0].id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    s = addSend(s, audioId, busId)!;
    expect(s.tracks.find(t => t.id === audioId)!.sends).toHaveLength(1);

    s = removeTrack(s, busId)!;
    const sends = s.tracks.find(t => t.id === audioId)!.sends ?? [];
    expect(sends).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Send undo contract
// ---------------------------------------------------------------------------

describe('Topology contract: send undo', () => {
  it('addSend is undoable', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks[0].id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    // Clear the undo from addTrack
    const undoLen = s.undoStack.length;
    s = addSend(s, audioId, busId)!;
    expect(s.undoStack.length).toBe(undoLen + 1);

    s = applyUndo(s);
    const sends = s.tracks.find(t => t.id === audioId)!.sends ?? [];
    expect(sends).toHaveLength(0);
  });

  it('removeSend is undoable', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks[0].id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    s = addSend(s, audioId, busId)!;
    s = removeSend(s, audioId, busId)!;
    expect(s.tracks.find(t => t.id === audioId)!.sends).toHaveLength(0);

    s = applyUndo(s);
    const sends = s.tracks.find(t => t.id === audioId)!.sends ?? [];
    expect(sends).toHaveLength(1);
    expect(sends[0].busId).toBe(busId);
  });

  it('setSendLevel is undoable', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks[0].id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    s = addSend(s, audioId, busId, 1.0)!;
    s = setSendLevel(s, audioId, busId, 0.3);

    s = applyUndo(s);
    expect(s.tracks.find(t => t.id === audioId)!.sends![0].level).toBe(1.0);
  });
});
