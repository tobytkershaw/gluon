import { describe, expect, it } from 'vitest';
import { addTrack, createSession } from './session';
import { getTrackKind, MASTER_BUS_ID } from './types';
import { isTrackAudibleInMixer } from './sequencer-helpers';

function makeTwoTrackSession() {
  const session = addTrack(createSession());
  const audioTracks = session.tracks.filter(track => getTrackKind(track) === 'audio');
  expect(audioTracks).toHaveLength(2);
  return { session, audioTracks };
}

describe('isTrackAudibleInMixer', () => {
  it('mutes only explicitly muted tracks when nothing is soloed', () => {
    const { session, audioTracks } = makeTwoTrackSession();
    const [first, second] = audioTracks;
    const tracks = session.tracks.map(track =>
      track.id === second.id ? { ...track, muted: true } : track,
    );

    expect(isTrackAudibleInMixer(tracks, first.id)).toBe(true);
    expect(isTrackAudibleInMixer(tracks, second.id)).toBe(false);
  });

  it('makes soloed tracks audible and silences non-soloed tracks', () => {
    const { session, audioTracks } = makeTwoTrackSession();
    const [first, second] = audioTracks;
    const tracks = session.tracks.map(track =>
      track.id === first.id ? { ...track, solo: true } : track,
    );

    expect(isTrackAudibleInMixer(tracks, first.id)).toBe(true);
    expect(isTrackAudibleInMixer(tracks, second.id)).toBe(false);
    expect(isTrackAudibleInMixer(tracks, MASTER_BUS_ID)).toBe(false);
  });

  it('lets solo override mute for the soloed track itself', () => {
    const { session, audioTracks } = makeTwoTrackSession();
    const [first, second] = audioTracks;
    const tracks = session.tracks.map(track =>
      track.id === first.id ? { ...track, muted: true, solo: true } : track,
    );

    expect(isTrackAudibleInMixer(tracks, first.id)).toBe(true);
    expect(isTrackAudibleInMixer(tracks, second.id)).toBe(false);
  });
});
