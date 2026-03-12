import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.fn();
const fallbackCtor = vi.fn();

vi.mock('../../src/audio/plaits-synth', () => ({
  PlaitsSynth: {
    create: createMock,
  },
}));

vi.mock('../../src/audio/web-audio-synth', () => ({
  WebAudioSynth: fallbackCtor,
}));

describe('createPreferredSynth', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
    fallbackCtor.mockReset();
  });

  it('uses Plaits when worklet init succeeds', async () => {
    const plaits = { kind: 'plaits' };
    createMock.mockResolvedValue(plaits);

    const { createPreferredSynth } = await import('../../src/audio/create-synth');

    const result = await createPreferredSynth({} as AudioContext, {} as AudioNode);

    expect(result).toBe(plaits);
    expect(fallbackCtor).not.toHaveBeenCalled();
  });

  it('falls back to WebAudioSynth when Plaits init fails', async () => {
    const fallback = { kind: 'fallback' };
    createMock.mockRejectedValue(new Error('worklet failed'));
    fallbackCtor.mockImplementation(function MockWebAudioSynth() {
      return fallback;
    });

    const { createPreferredSynth } = await import('../../src/audio/create-synth');

    const result = await createPreferredSynth({} as AudioContext, {} as AudioNode);

    expect(result).toBe(fallback);
    expect(fallbackCtor).toHaveBeenCalledOnce();
  });
});
