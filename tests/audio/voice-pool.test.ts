import { describe, expect, it, vi } from 'vitest';
import { VoicePool } from '../../src/audio/voice-pool';
import type { PoolVoice } from '../../src/audio/voice-pool';

function mockSynth() {
  return {
    scheduleNote: vi.fn(),
    setModel: vi.fn(),
    setParams: vi.fn(),
    silence: vi.fn(),
    destroy: vi.fn(),
  };
}

function mockGainParam() {
  return {
    value: 0.3,
    setValueAtTime: vi.fn(),
    cancelAndHoldAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
}

function mockAccentGain() {
  return {
    gain: mockGainParam(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function makePoolVoice(overrides?: Partial<PoolVoice>): PoolVoice {
  return {
    synth: mockSynth() as unknown as PoolVoice['synth'],
    accentGain: mockAccentGain() as unknown as GainNode,
    lastNoteTime: 0,
    lastGateOffTime: 0,
    ...overrides,
  };
}

describe('VoicePool', () => {
  it('allocates voices round-robin when all are active', () => {
    const v0 = makePoolVoice({ lastGateOffTime: 10 });
    const v1 = makePoolVoice({ lastGateOffTime: 10 });
    const pool = new VoicePool([v0, v1]);

    // currentTime=5 means both voices have gateOff in the future (active)
    expect(pool.allocate(5)).toBe(v0);
    expect(pool.allocate(5)).toBe(v1);
    expect(pool.allocate(5)).toBe(v0); // wraps around
  });

  it('prefers released voice over active voice', () => {
    const v0 = makePoolVoice({ lastGateOffTime: 2.0 }); // released (gateOff in past)
    const v1 = makePoolVoice({ lastGateOffTime: 5.0 }); // still active (gateOff in future)
    const pool = new VoicePool([v0, v1]);

    // currentTime=3 → v0 is released (2.0 < 3), v1 is active (5.0 >= 3)
    expect(pool.allocate(3)).toBe(v0);
  });

  it('prefers the voice that has been idle longest among released voices', () => {
    const v0 = makePoolVoice({ lastGateOffTime: 2.0 }); // released earlier
    const v1 = makePoolVoice({ lastGateOffTime: 1.0 }); // released even earlier (idle longest)
    const pool = new VoicePool([v0, v1]);

    // Both released, v1 has earlier gateOff → idle longest
    expect(pool.allocate(3)).toBe(v1);
  });

  it('falls back to round-robin when no voices are released', () => {
    const v0 = makePoolVoice({ lastGateOffTime: 0 });
    const v1 = makePoolVoice({ lastGateOffTime: 0 });
    const pool = new VoicePool([v0, v1]);

    // currentTime=0, lastGateOffTime=0 → not released (0 < 0 is false)
    expect(pool.allocate(0)).toBe(v0);
    expect(pool.allocate(0)).toBe(v1);
  });

  it('consecutive scheduleNote calls use different voices', () => {
    const v0 = makePoolVoice();
    const v1 = makePoolVoice();
    const pool = new VoicePool([v0, v1]);

    const noteA = {
      trackId: 'v0',
      time: 1.0,
      gateOffTime: 1.3,
      accent: false,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    };
    const noteB = {
      trackId: 'v0',
      time: 1.1,
      gateOffTime: 1.4,
      accent: true,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    };

    const allocated0 = pool.scheduleNote(noteA, 1);
    const allocated1 = pool.scheduleNote(noteB, 1);

    expect(allocated0).toBe(v0);
    expect(allocated1).toBe(v1);
    expect(v0.synth.scheduleNote).toHaveBeenCalledWith(noteA, 1);
    expect(v1.synth.scheduleNote).toHaveBeenCalledWith(noteB, 1);
  });

  it('accent automation is per-voice (isolated)', () => {
    const v0 = makePoolVoice();
    const v1 = makePoolVoice();
    const pool = new VoicePool([v0, v1]);

    pool.scheduleNote({
      trackId: 'v0', time: 1.0, gateOffTime: 1.3, accent: true,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    }, 1);

    pool.scheduleNote({
      trackId: 'v0', time: 1.1, gateOffTime: 1.4, accent: false,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    }, 1);

    // v0 got accent (0.6 = 0.3 * 2.0), v1 got non-accent (0.3)
    const v0Gain = v0.accentGain.gain as unknown as { setValueAtTime: ReturnType<typeof vi.fn> };
    const v1Gain = v1.accentGain.gain as unknown as { setValueAtTime: ReturnType<typeof vi.fn> };

    expect(v0Gain.setValueAtTime).toHaveBeenCalledWith(0.6, 1.0); // accent boost
    expect(v0Gain.setValueAtTime).toHaveBeenCalledWith(0.3, 1.3); // revert at gate-off
    expect(v1Gain.setValueAtTime).toHaveBeenCalledWith(0.3, 1.1); // no accent
  });

  it('releaseAll affects both voices', () => {
    const v0 = makePoolVoice();
    const v1 = makePoolVoice();
    const pool = new VoicePool([v0, v1]);

    pool.releaseAll(1, 0, 0.05);

    expect(v0.synth.silence).toHaveBeenCalledWith(1);
    expect(v1.synth.silence).toHaveBeenCalledWith(1);
    const v0Gain = v0.accentGain.gain as unknown as {
      cancelAndHoldAtTime: ReturnType<typeof vi.fn>;
      linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    };
    expect(v0Gain.cancelAndHoldAtTime).toHaveBeenCalledWith(0);
    expect(v0Gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 0.05);
  });

  it('silenceAll affects both voices', () => {
    const v0 = makePoolVoice();
    const v1 = makePoolVoice();
    const pool = new VoicePool([v0, v1]);

    pool.silenceAll(1, 0);

    expect(v0.synth.silence).toHaveBeenCalledWith(1);
    expect(v1.synth.silence).toHaveBeenCalledWith(1);
    const v0Gain = v0.accentGain.gain as unknown as {
      cancelAndHoldAtTime: ReturnType<typeof vi.fn>;
      setValueAtTime: ReturnType<typeof vi.fn>;
    };
    expect(v0Gain.cancelAndHoldAtTime).toHaveBeenCalledWith(0);
    expect(v0Gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
  });

  it('restoreBaseline resets both voices to 0.3', () => {
    const v0 = makePoolVoice();
    const v1 = makePoolVoice();
    const pool = new VoicePool([v0, v1]);

    pool.restoreBaseline(5.0);

    const v0Gain = v0.accentGain.gain as unknown as {
      cancelAndHoldAtTime: ReturnType<typeof vi.fn>;
      setValueAtTime: ReturnType<typeof vi.fn>;
    };
    const v1Gain = v1.accentGain.gain as unknown as {
      cancelAndHoldAtTime: ReturnType<typeof vi.fn>;
      setValueAtTime: ReturnType<typeof vi.fn>;
    };
    expect(v0Gain.cancelAndHoldAtTime).toHaveBeenCalledWith(5.0);
    expect(v0Gain.setValueAtTime).toHaveBeenCalledWith(0.3, 5.0);
    expect(v1Gain.cancelAndHoldAtTime).toHaveBeenCalledWith(5.0);
    expect(v1Gain.setValueAtTime).toHaveBeenCalledWith(0.3, 5.0);
  });

  it('setModel broadcasts to both voices', () => {
    const v0 = makePoolVoice();
    const v1 = makePoolVoice();
    const pool = new VoicePool([v0, v1]);

    pool.setModel(5);

    expect(v0.synth.setModel).toHaveBeenCalledWith(5);
    expect(v1.synth.setModel).toHaveBeenCalledWith(5);
  });

  it('setParams broadcasts to both voices', () => {
    const v0 = makePoolVoice();
    const v1 = makePoolVoice();
    const pool = new VoicePool([v0, v1]);

    const params = { harmonics: 0.3, timbre: 0.7, morph: 0.2, note: 0.5 };
    pool.setParams(params);

    expect(v0.synth.setParams).toHaveBeenCalledWith(params);
    expect(v1.synth.setParams).toHaveBeenCalledWith(params);
  });

  it('destroy cleans up both voices', () => {
    const v0 = makePoolVoice();
    const v1 = makePoolVoice();
    const pool = new VoicePool([v0, v1]);

    pool.destroy();

    expect(v0.synth.destroy).toHaveBeenCalled();
    expect(v1.synth.destroy).toHaveBeenCalled();
    expect(v0.accentGain.disconnect).toHaveBeenCalled();
    expect(v1.accentGain.disconnect).toHaveBeenCalled();
  });
});
