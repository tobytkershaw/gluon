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
    expect(result.transport).toEqual({ bpm: 120, swing: 0 });
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

  it('compresses parameter locks', () => {
    let s = createSession();
    const vid = s.voices[0].id;
    s = setStepParamLock(s, vid, 5, { timbre: 0.8 });

    const result = compressState(s);
    expect(result.voices[0].pattern.locks).toEqual({ '5': { timbre: 0.8 } });
  });

  it('includes human message when provided', () => {
    const session = createSession();
    const result = compressState(session, 'hello');
    expect(result.human_message).toBe('hello');
  });
});
