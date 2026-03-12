// tests/ai/state-compression.test.ts
import { describe, it, expect } from 'vitest';
import { compressState } from '../../src/ai/state-compression';
import { createSession } from '../../src/engine/session';
import { toggleStepGate, toggleStepAccent, setStepParamLock } from '../../src/engine/pattern-primitives';

describe('State Compression (Phase 2)', () => {
  it('compresses multi-voice session', () => {
    const session = createSession();
    const result = compressState(session);
    expect(result.voices).toHaveLength(4);
    expect(result.voices[0].model).toBe('analog_bass_drum');
    expect(result.transport).toEqual({ bpm: 120, swing: 0, playing: false });
    expect(result.activeVoiceId).toBe(session.activeVoiceId);
  });

  it('compresses pattern with active steps', () => {
    let s = createSession();
    const vid = s.voices[0].id;
    s = toggleStepGate(s, vid, 0);
    s = toggleStepGate(s, vid, 4);
    s = toggleStepGate(s, vid, 8);
    s = toggleStepGate(s, vid, 12);

    const result = compressState(s);
    expect(result.voices[0].pattern.active_steps).toEqual([0, 4, 8, 12]);
  });

  it('compresses accented steps', () => {
    let s = createSession();
    const vid = s.voices[0].id;
    s = toggleStepGate(s, vid, 0);
    s = toggleStepAccent(s, vid, 0);

    const result = compressState(s);
    expect(result.voices[0].pattern.accents).toEqual([0]);
  });

  it('compresses parameter locks with semantic names', () => {
    let s = createSession();
    const vid = s.voices[0].id;
    s = setStepParamLock(s, vid, 5, { timbre: 0.8 });

    const result = compressState(s);
    expect(result.voices[0].pattern.locks).toEqual({ '5': { brightness: 0.8 } });
  });

  it('uses semantic param names for voice params', () => {
    const session = createSession();
    const result = compressState(session);
    const paramKeys = Object.keys(result.voices[0].params);
    expect(paramKeys).toEqual(['brightness', 'richness', 'texture', 'pitch']);
  });

  it('preserves structured recent human actions', () => {
    const session = createSession();
    const now = Date.now();
    session.recentHumanActions = [
      { voiceId: 'v0', param: 'timbre', from: 0.3, to: 0.7, timestamp: now - 2000 },
      { voiceId: 'v1', param: 'harmonics', from: 0.5, to: 0.1, timestamp: now - 500 },
    ];
    const result = compressState(session);
    expect(result.recent_human_actions).toHaveLength(2);
    expect(result.recent_human_actions[0].voiceId).toBe('v0');
    expect(result.recent_human_actions[0].param).toBe('brightness');
    expect(result.recent_human_actions[0].from).toBe(0.3);
    expect(result.recent_human_actions[0].to).toBe(0.7);
    expect(result.recent_human_actions[0].age_ms).toBeGreaterThan(1500);
    expect(result.recent_human_actions[1].param).toBe('richness');
  });

  it('does not include human_message field', () => {
    const session = createSession();
    const result = compressState(session);
    expect(result).not.toHaveProperty('human_message');
  });
});
