import { describe, it, expect } from 'vitest';
import { createSession, addTrack } from '../../src/engine/session';
import { MASTER_BUS_ID } from '../../src/engine/types';

describe('addTrack returns correct new track ID', () => {
  it('audio track ID is not master-bus', () => {
    const session = createSession();
    const result = addTrack(session, 'audio');
    expect(result).not.toBeNull();
    // activeTrackId should point to the new track
    expect(result!.activeTrackId).not.toBe(MASTER_BUS_ID);
    // The new track should exist in the tracks array
    const newTrack = result!.tracks.find(t => t.id === result!.activeTrackId);
    expect(newTrack).toBeDefined();
  });

  it('bus track ID is not master-bus', () => {
    const session = createSession();
    const result = addTrack(session, 'bus');
    expect(result).not.toBeNull();
    expect(result!.activeTrackId).not.toBe(MASTER_BUS_ID);
    const newTrack = result!.tracks.find(t => t.id === result!.activeTrackId);
    expect(newTrack).toBeDefined();
    expect(newTrack!.kind).toBe('bus');
  });

  it('new bus track is not last in array (master-bus is)', () => {
    const session = createSession();
    const result = addTrack(session, 'bus');
    expect(result).not.toBeNull();
    const lastTrack = result!.tracks[result!.tracks.length - 1];
    expect(lastTrack.id).toBe(MASTER_BUS_ID);
    // The new bus is before master-bus
    const newBusIndex = result!.tracks.findIndex(t => t.id === result!.activeTrackId);
    expect(newBusIndex).toBeLessThan(result!.tracks.length - 1);
  });

  it('new audio track is not last in array when buses exist', () => {
    let session = createSession();
    // Add a bus first
    session = addTrack(session, 'bus')!;
    // Now add an audio track
    const result = addTrack(session, 'audio');
    expect(result).not.toBeNull();
    const lastTrack = result!.tracks[result!.tracks.length - 1];
    expect(lastTrack.id).toBe(MASTER_BUS_ID);
    // The old bug: tracks[tracks.length - 1] would return master-bus as the "new" track ID
    expect(result!.activeTrackId).not.toBe(MASTER_BUS_ID);
  });
});
