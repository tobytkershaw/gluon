// tests/engine/session.test.ts
import { describe, it, expect } from 'vitest';
import {
  createSession, setAgency, updateTrackParams, setModel,
  setActiveTrack, toggleMute, toggleSolo, setTransportBpm, setTransportSwing, togglePlaying,
} from '../../src/engine/session';

describe('Session (Phase 2)', () => {
  it('creates a session with 4 tracks', () => {
    const session = createSession();
    expect(session.tracks).toHaveLength(4);
    expect(session.activeTrackId).toBe(session.tracks[0].id);
    expect(session.transport).toEqual({ playing: false, bpm: 120, swing: 0 });
  });

  it('track 0 is model 13 (kick), track 1 is model 0 (bass), track 2 is model 2 (lead), track 3 is model 4 (pad)', () => {
    const session = createSession();
    expect(session.tracks[0].model).toBe(13);
    expect(session.tracks[1].model).toBe(0);
    expect(session.tracks[2].model).toBe(2);
    expect(session.tracks[3].model).toBe(4);
  });

  it('each track has a 16-step default pattern', () => {
    const session = createSession();
    for (const track of session.tracks) {
      expect(track.pattern.length).toBe(16);
      expect(track.pattern.steps).toHaveLength(16);
      expect(track.muted).toBe(false);
      expect(track.solo).toBe(false);
    }
  });

  it('creates tracks with agency ON by default', () => {
    const s = createSession();
    for (const track of s.tracks) {
      expect(track.agency).toBe('ON');
    }
  });

  it('sets agency on active track', () => {
    let s = createSession();
    s = setAgency(s, s.activeTrackId, 'OFF');
    const track = s.tracks.find(v => v.id === s.activeTrackId)!;
    expect(track.agency).toBe('OFF');
  });

  it('updates track params by trackId', () => {
    const s1 = createSession();
    const vid = s1.tracks[1].id;
    const s2 = updateTrackParams(s1, vid, { timbre: 0.8 });
    expect(s2.tracks.find(v => v.id === vid)!.params.timbre).toBe(0.8);
    expect(s1.tracks.find(v => v.id === vid)!.params.timbre).toBe(0.5);
  });

  it('sets model by trackId', () => {
    const s1 = createSession();
    const vid = s1.tracks[0].id;
    const s2 = setModel(s1, vid, 5);
    expect(s2.tracks.find(v => v.id === vid)!.model).toBe(5);
  });

  it('switches active track', () => {
    const s1 = createSession();
    const s2 = setActiveTrack(s1, s1.tracks[2].id);
    expect(s2.activeTrackId).toBe(s1.tracks[2].id);
  });

  it('toggles mute', () => {
    const s1 = createSession();
    const vid = s1.tracks[0].id;
    const s2 = toggleMute(s1, vid);
    expect(s2.tracks.find(v => v.id === vid)!.muted).toBe(true);
    const s3 = toggleMute(s2, vid);
    expect(s3.tracks.find(v => v.id === vid)!.muted).toBe(false);
  });

  it('toggles solo', () => {
    const s1 = createSession();
    const vid = s1.tracks[1].id;
    const s2 = toggleSolo(s1, vid);
    expect(s2.tracks.find(v => v.id === vid)!.solo).toBe(true);
  });

  it('sets transport BPM clamped to 60-200', () => {
    let s = createSession();
    s = setTransportBpm(s, 140);
    expect(s.transport.bpm).toBe(140);
    s = setTransportBpm(s, 30);
    expect(s.transport.bpm).toBe(60);
    s = setTransportBpm(s, 300);
    expect(s.transport.bpm).toBe(200);
  });

  it('sets transport swing clamped to 0-1', () => {
    let s = createSession();
    s = setTransportSwing(s, 0.5);
    expect(s.transport.swing).toBe(0.5);
    s = setTransportSwing(s, -1);
    expect(s.transport.swing).toBe(0);
  });

  it('toggles playing', () => {
    let s = createSession();
    s = togglePlaying(s);
    expect(s.transport.playing).toBe(true);
    s = togglePlaying(s);
    expect(s.transport.playing).toBe(false);
  });

});
