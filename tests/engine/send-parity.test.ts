// tests/engine/send-parity.test.ts
// Human capability parity tests for send routing.
// Every operation the AI can perform on sends must be achievable via
// the same session helpers the UI calls. This proves the human path exists.

import { describe, it, expect } from 'vitest';
import {
  createSession, addTrack,
  addSend, removeSend, setSendLevel,
} from '../../src/engine/session';
import { applyUndo } from '../../src/engine/primitives';
import { MASTER_BUS_ID, getTrackKind } from '../../src/engine/types';

// ---------------------------------------------------------------------------
// Parity: human can create sends
// ---------------------------------------------------------------------------

describe('Send parity: human can create sends', () => {
  it('human can create a send from an audio track to a bus', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks.find(t => getTrackKind(t) === 'audio')!.id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;

    const result = addSend(s, audioId, busId);
    expect(result).not.toBeNull();
    const track = result!.tracks.find(t => t.id === audioId)!;
    expect(track.sends).toHaveLength(1);
    expect(track.sends![0].busId).toBe(busId);
    expect(track.sends![0].level).toBe(1.0);
  });

  it('human can create a send to the master bus', () => {
    const s = createSession();
    const audioId = s.tracks.find(t => getTrackKind(t) === 'audio')!.id;

    const result = addSend(s, audioId, MASTER_BUS_ID);
    expect(result).not.toBeNull();
    expect(result!.tracks.find(t => t.id === audioId)!.sends![0].busId).toBe(MASTER_BUS_ID);
  });

  it('human can create a send with a custom level', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks.find(t => getTrackKind(t) === 'audio')!.id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;

    const result = addSend(s, audioId, busId, 0.5);
    expect(result).not.toBeNull();
    expect(result!.tracks.find(t => t.id === audioId)!.sends![0].level).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Parity: human can remove sends
// ---------------------------------------------------------------------------

describe('Send parity: human can remove sends', () => {
  it('human can remove an existing send', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks.find(t => getTrackKind(t) === 'audio')!.id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    s = addSend(s, audioId, busId)!;
    expect(s.tracks.find(t => t.id === audioId)!.sends).toHaveLength(1);

    const result = removeSend(s, audioId, busId);
    expect(result).not.toBeNull();
    expect(result!.tracks.find(t => t.id === audioId)!.sends).toHaveLength(0);
  });

  it('removing a send leaves other sends intact', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks.find(t => getTrackKind(t) === 'audio')!.id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    s = addSend(s, audioId, busId)!;
    s = addSend(s, audioId, MASTER_BUS_ID)!;
    expect(s.tracks.find(t => t.id === audioId)!.sends).toHaveLength(2);

    s = removeSend(s, audioId, busId)!;
    const sends = s.tracks.find(t => t.id === audioId)!.sends!;
    expect(sends).toHaveLength(1);
    expect(sends[0].busId).toBe(MASTER_BUS_ID);
  });
});

// ---------------------------------------------------------------------------
// Parity: human can edit send levels
// ---------------------------------------------------------------------------

describe('Send parity: human can edit send levels', () => {
  it('human can change a send level', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks.find(t => getTrackKind(t) === 'audio')!.id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    s = addSend(s, audioId, busId, 1.0)!;

    s = setSendLevel(s, audioId, busId, 0.3);
    expect(s.tracks.find(t => t.id === audioId)!.sends![0].level).toBe(0.3);
  });

  it('send level is clamped to 0-1', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks.find(t => getTrackKind(t) === 'audio')!.id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    s = addSend(s, audioId, busId)!;

    s = setSendLevel(s, audioId, busId, -0.5);
    expect(s.tracks.find(t => t.id === audioId)!.sends![0].level).toBe(0);

    s = setSendLevel(s, audioId, busId, 2.0);
    expect(s.tracks.find(t => t.id === audioId)!.sends![0].level).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Parity: all send operations are undoable
// ---------------------------------------------------------------------------

describe('Send parity: all operations are undoable', () => {
  it('addSend is undoable', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks.find(t => getTrackKind(t) === 'audio')!.id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    s = addSend(s, audioId, busId)!;
    expect(s.tracks.find(t => t.id === audioId)!.sends).toHaveLength(1);

    s = applyUndo(s);
    expect(s.tracks.find(t => t.id === audioId)!.sends ?? []).toHaveLength(0);
  });

  it('removeSend is undoable', () => {
    let s = createSession();
    s = addTrack(s, 'bus')!;
    const audioId = s.tracks.find(t => getTrackKind(t) === 'audio')!.id;
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
    const audioId = s.tracks.find(t => getTrackKind(t) === 'audio')!.id;
    const busId = s.tracks.find(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID)!.id;
    s = addSend(s, audioId, busId, 1.0)!;
    s = setSendLevel(s, audioId, busId, 0.3);

    s = applyUndo(s);
    expect(s.tracks.find(t => t.id === audioId)!.sends![0].level).toBe(1.0);
  });
});
