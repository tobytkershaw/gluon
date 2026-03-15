import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from './types';
import { TransportController } from './transport-controller';

function makeSession(): Session {
  return {
    tracks: [],
    activeTrackId: 'v0',
    transport: { status: 'stopped', bpm: 120, swing: 0, playing: false },
    master: { volume: 0.8, pan: 0 },
    undoStack: [],
    context: { key: null, scale: null, tempo: null, energy: 0.3, density: 0.2 },
    messages: [],
    recentHumanActions: [],
  };
}

describe('TransportController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts a new generation when playback begins', () => {
    vi.useFakeTimers();
    const session = makeSession();
    const audio = {
      getCurrentTime: vi.fn(() => 1),
      getState: vi.fn(() => 'running' as const),
      scheduleNote: vi.fn(),
      restoreBaseline: vi.fn(),
      advanceGeneration: vi.fn(() => 1),
      releaseAll: vi.fn(),
      silenceAll: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
    });

    session.transport = { ...session.transport, status: 'playing', playing: true };
    controller.sync();

    expect(audio.advanceGeneration).toHaveBeenCalledTimes(1);
    expect(audio.restoreBaseline).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it('releases current generation on pause', () => {
    vi.useFakeTimers();
    const session = makeSession();
    const audio = {
      getCurrentTime: vi.fn(() => 1),
      getState: vi.fn(() => 'running' as const),
      scheduleNote: vi.fn(),
      restoreBaseline: vi.fn(),
      advanceGeneration: vi.fn()
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(2),
      releaseAll: vi.fn(),
      silenceAll: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
    });

    session.transport = { ...session.transport, status: 'playing', playing: true };
    controller.sync();
    session.transport = { ...session.transport, status: 'paused', playing: false };
    controller.sync();

    expect(audio.releaseAll).toHaveBeenCalledWith(2);
    expect(audio.silenceAll).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('silences current generation on hard stop', () => {
    vi.useFakeTimers();
    const session = makeSession();
    const audio = {
      getCurrentTime: vi.fn(() => 1),
      getState: vi.fn(() => 'running' as const),
      scheduleNote: vi.fn(),
      restoreBaseline: vi.fn(),
      advanceGeneration: vi.fn()
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(2),
      releaseAll: vi.fn(),
      silenceAll: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
    });

    session.transport = { ...session.transport, status: 'playing', playing: true };
    controller.sync();
    controller.requestHardStop();
    session.transport = { ...session.transport, status: 'stopped', playing: false };
    controller.sync();

    expect(audio.silenceAll).toHaveBeenCalledWith(2);
    expect(audio.releaseAll).not.toHaveBeenCalledWith(2);

    controller.dispose();
  });
});
