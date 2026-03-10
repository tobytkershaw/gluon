import { describe, it, expect } from 'vitest';
import { createSession, setLeash, setAgency, updateVoiceParams, setModel } from '../../src/engine/session';

describe('Session', () => {
  it('creates a default session', () => {
    const session = createSession();
    expect(session.leash).toBe(0.5);
    expect(session.voice.agency).toBe('SUGGEST');
    expect(session.voice.params.timbre).toBe(0.5);
    expect(session.undoStack).toEqual([]);
    expect(session.pending).toEqual([]);
    expect(session.messages).toEqual([]);
    expect(session.recentHumanActions).toEqual([]);
  });

  it('sets leash, clamped to 0-1', () => {
    let s = createSession();
    s = setLeash(s, 0.75);
    expect(s.leash).toBe(0.75);
    s = setLeash(s, -0.5);
    expect(s.leash).toBe(0);
    s = setLeash(s, 1.5);
    expect(s.leash).toBe(1);
  });

  it('sets agency', () => {
    let s = createSession();
    s = setAgency(s, 'PLAY');
    expect(s.voice.agency).toBe('PLAY');
    s = setAgency(s, 'OFF');
    expect(s.voice.agency).toBe('OFF');
  });

  it('updates voice params immutably', () => {
    const s1 = createSession();
    const s2 = updateVoiceParams(s1, { timbre: 0.8 });
    expect(s2.voice.params.timbre).toBe(0.8);
    expect(s1.voice.params.timbre).toBe(0.5);
  });

  it('sets model', () => {
    let s = createSession();
    s = setModel(s, 5);
    expect(s.voice.model).toBe(5);
    expect(s.voice.engine).toBe('plaits:wavetable');
  });
});
