// tests/engine/session.test.ts
import { describe, it, expect } from 'vitest';
import {
  createSession, setAgency, updateTrackParams, setModel,
  setActiveTrack, toggleMute, toggleSolo, setTransportBpm, setTransportSwing, togglePlaying,
  addTrackProcessor, removeTrackProcessor, updateProcessorParams, setProcessorModel,
} from '../../src/engine/session';
import { getTrack } from '../../src/engine/types';

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

  it('adds a processor to a track', () => {
    const s = createSession();
    const vid = s.activeTrackId;
    const proc = { id: 'rings-0', type: 'rings' as const, model: 0, params: { structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 } };
    const updated = addTrackProcessor(s, vid, proc);
    const track = getTrack(updated, vid);
    expect(track.processors).toHaveLength(1);
    expect(track.processors![0].id).toBe('rings-0');
  });

  it('removes a processor from a track', () => {
    const s = createSession();
    const vid = s.activeTrackId;
    const proc = { id: 'rings-0', type: 'rings' as const, model: 0, params: { structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 } };
    let state = addTrackProcessor(s, vid, proc);
    state = removeTrackProcessor(state, vid, 'rings-0');
    expect(getTrack(state, vid).processors).toHaveLength(0);
  });

  it('updates processor params', () => {
    const s = createSession();
    const vid = s.activeTrackId;
    const proc = { id: 'rings-0', type: 'rings' as const, model: 0, params: { structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 } };
    let state = addTrackProcessor(s, vid, proc);
    state = updateProcessorParams(state, vid, 'rings-0', { brightness: 0.8 });
    expect(getTrack(state, vid).processors![0].params.brightness).toBe(0.8);
    expect(getTrack(state, vid).processors![0].params.structure).toBe(0.5);
  });

  it('sets processor model', () => {
    const s = createSession();
    const vid = s.activeTrackId;
    const proc = { id: 'rings-0', type: 'rings' as const, model: 0, params: { structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 } };
    let state = addTrackProcessor(s, vid, proc);
    state = setProcessorModel(state, vid, 'rings-0', 3);
    expect(getTrack(state, vid).processors![0].model).toBe(3);
  });
});
