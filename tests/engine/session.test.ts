// tests/engine/session.test.ts
import { describe, it, expect } from 'vitest';
import {
  createSession, setAgency, updateVoiceParams, setModel,
  setActiveVoice, toggleMute, toggleSolo, setTransportBpm, setTransportSwing, togglePlaying,
  addVoiceProcessor, removeVoiceProcessor, updateProcessorParams, setProcessorModel,
} from '../../src/engine/session';
import { getVoice } from '../../src/engine/types';

describe('Session (Phase 2)', () => {
  it('creates a session with 4 voices', () => {
    const session = createSession();
    expect(session.voices).toHaveLength(4);
    expect(session.activeVoiceId).toBe(session.voices[0].id);
    expect(session.transport).toEqual({ playing: false, bpm: 120, swing: 0 });
  });

  it('voice 0 is model 13 (kick), voice 1 is model 0 (bass), voice 2 is model 2 (lead), voice 3 is model 4 (pad)', () => {
    const session = createSession();
    expect(session.voices[0].model).toBe(13);
    expect(session.voices[1].model).toBe(0);
    expect(session.voices[2].model).toBe(2);
    expect(session.voices[3].model).toBe(4);
  });

  it('each voice has a 16-step default pattern', () => {
    const session = createSession();
    for (const voice of session.voices) {
      expect(voice.pattern.length).toBe(16);
      expect(voice.pattern.steps).toHaveLength(16);
      expect(voice.muted).toBe(false);
      expect(voice.solo).toBe(false);
    }
  });

  it('creates voices with agency ON by default', () => {
    const s = createSession();
    for (const voice of s.voices) {
      expect(voice.agency).toBe('ON');
    }
  });

  it('sets agency on active voice', () => {
    let s = createSession();
    s = setAgency(s, s.activeVoiceId, 'OFF');
    const voice = s.voices.find(v => v.id === s.activeVoiceId)!;
    expect(voice.agency).toBe('OFF');
  });

  it('updates voice params by voiceId', () => {
    const s1 = createSession();
    const vid = s1.voices[1].id;
    const s2 = updateVoiceParams(s1, vid, { timbre: 0.8 });
    expect(s2.voices.find(v => v.id === vid)!.params.timbre).toBe(0.8);
    expect(s1.voices.find(v => v.id === vid)!.params.timbre).toBe(0.5);
  });

  it('sets model by voiceId', () => {
    const s1 = createSession();
    const vid = s1.voices[0].id;
    const s2 = setModel(s1, vid, 5);
    expect(s2.voices.find(v => v.id === vid)!.model).toBe(5);
  });

  it('switches active voice', () => {
    const s1 = createSession();
    const s2 = setActiveVoice(s1, s1.voices[2].id);
    expect(s2.activeVoiceId).toBe(s1.voices[2].id);
  });

  it('toggles mute', () => {
    const s1 = createSession();
    const vid = s1.voices[0].id;
    const s2 = toggleMute(s1, vid);
    expect(s2.voices.find(v => v.id === vid)!.muted).toBe(true);
    const s3 = toggleMute(s2, vid);
    expect(s3.voices.find(v => v.id === vid)!.muted).toBe(false);
  });

  it('toggles solo', () => {
    const s1 = createSession();
    const vid = s1.voices[1].id;
    const s2 = toggleSolo(s1, vid);
    expect(s2.voices.find(v => v.id === vid)!.solo).toBe(true);
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

  it('adds a processor to a voice', () => {
    const s = createSession();
    const vid = s.activeVoiceId;
    const proc = { id: 'rings-0', type: 'rings' as const, model: 0, params: { structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 } };
    const updated = addVoiceProcessor(s, vid, proc);
    const voice = getVoice(updated, vid);
    expect(voice.processors).toHaveLength(1);
    expect(voice.processors![0].id).toBe('rings-0');
  });

  it('removes a processor from a voice', () => {
    const s = createSession();
    const vid = s.activeVoiceId;
    const proc = { id: 'rings-0', type: 'rings' as const, model: 0, params: { structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 } };
    let state = addVoiceProcessor(s, vid, proc);
    state = removeVoiceProcessor(state, vid, 'rings-0');
    expect(getVoice(state, vid).processors).toHaveLength(0);
  });

  it('updates processor params', () => {
    const s = createSession();
    const vid = s.activeVoiceId;
    const proc = { id: 'rings-0', type: 'rings' as const, model: 0, params: { structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 } };
    let state = addVoiceProcessor(s, vid, proc);
    state = updateProcessorParams(state, vid, 'rings-0', { brightness: 0.8 });
    expect(getVoice(state, vid).processors![0].params.brightness).toBe(0.8);
    expect(getVoice(state, vid).processors![0].params.structure).toBe(0.5);
  });

  it('sets processor model', () => {
    const s = createSession();
    const vid = s.activeVoiceId;
    const proc = { id: 'rings-0', type: 'rings' as const, model: 0, params: { structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 } };
    let state = addVoiceProcessor(s, vid, proc);
    state = setProcessorModel(state, vid, 'rings-0', 3);
    expect(getVoice(state, vid).processors![0].model).toBe(3);
  });
});
