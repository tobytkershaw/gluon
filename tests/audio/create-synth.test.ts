import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_DEGRADED_EVENT } from '../../src/audio/runtime-events';

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
  let nowSpy: ReturnType<typeof vi.spyOn>;
  const ctx = {} as AudioContext;
  const output = {} as AudioNode;

  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
    fallbackCtor.mockReset();
    nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(0);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('uses Plaits when worklet init succeeds', async () => {
    const plaits = { kind: 'plaits' };
    createMock.mockResolvedValue(plaits);

    const { createPreferredSynth } = await import('../../src/audio/create-synth');

    const result = await createPreferredSynth(ctx, output);

    expect(result).toBe(plaits);
    expect(fallbackCtor).not.toHaveBeenCalled();
  });

  it('falls back to WebAudioSynth when Plaits init fails', async () => {
    const fallback = { kind: 'fallback' };
    createMock.mockRejectedValue(new Error('worklet failed'));
    fallbackCtor.mockImplementation(function MockWebAudioSynth() {
      return fallback;
    });
    const degradedListener = vi.fn();
    window.addEventListener(AUDIO_DEGRADED_EVENT, degradedListener as EventListener);

    const { createPreferredSynth } = await import('../../src/audio/create-synth');

    const result = await createPreferredSynth(ctx, output);

    expect(result).toBe(fallback);
    expect(fallbackCtor).toHaveBeenCalledOnce();
    expect(degradedListener).toHaveBeenCalledTimes(1);
    const event = degradedListener.mock.calls[0][0] as CustomEvent<{ message: string; source: string }>;
    expect(event.detail).toMatchObject({
      message: 'Plaits init failed, falling back to WebAudioSynth.',
      source: 'synth-fallback',
    });

    window.removeEventListener(AUDIO_DEGRADED_EVENT, degradedListener as EventListener);
  });

  it('backs off repeated Plaits startup failures within the cooldown window', async () => {
    const firstFallback = { kind: 'fallback-1' };
    const secondFallback = { kind: 'fallback-2' };
    const thirdPlaits = { kind: 'plaits-2' };
    createMock
      .mockRejectedValueOnce(new Error('worklet failed'))
      .mockResolvedValueOnce(thirdPlaits);
    fallbackCtor
      .mockImplementationOnce(function MockWebAudioSynth() {
        return firstFallback;
      })
      .mockImplementationOnce(function MockWebAudioSynth() {
        return secondFallback;
      });

    const { createPreferredSynth } = await import('../../src/audio/create-synth');

    const first = await createPreferredSynth(ctx, output);
    expect(first).toBe(firstFallback);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(fallbackCtor).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(1_000);
    const second = await createPreferredSynth(ctx, output);
    expect(second).toBe(secondFallback);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(fallbackCtor).toHaveBeenCalledTimes(2);

    nowSpy.mockReturnValue(31_000);
    const third = await createPreferredSynth(ctx, output);
    expect(third).toBe(thirdPlaits);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(fallbackCtor).toHaveBeenCalledTimes(2);
  });
});
