import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../src/engine/types';
import { TransportController } from '../../src/engine/transport-controller';

function makeSession(): Session {
  return {
    tracks: [],
    activeTrackId: 'v0',
    transport: {
      status: 'stopped',
      bpm: 120,
      swing: 0,
      metronome: { enabled: true, volume: 0.5 },
      timeSignature: { numerator: 4, denominator: 4 },
      mode: 'pattern',
      loop: true,
    },
    master: { volume: 0.8, pan: 0 },
    undoStack: [],
    context: { key: null, scale: null, tempo: null, energy: 0.3, density: 0.2 },
    messages: [],
    recentHumanActions: [],
  };
}

function makeAudio() {
  return {
    getCurrentTime: vi.fn(() => 1),
    getState: vi.fn(() => 'running' as const),
    scheduleNote: vi.fn(),
    scheduleClick: vi.fn(),
    restoreBaseline: vi.fn(),
    advanceGeneration: vi.fn()
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(3),
    releaseGeneration: vi.fn(),
    silenceGeneration: vi.fn(),
    silenceMetronome: vi.fn(),
    setMetronomeVolume: vi.fn(),
  } as unknown as import('../../src/audio/audio-engine').AudioEngine;
}

describe('playback live-edit contract', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    {
      name: 'time signature',
      mutate: (session: Session) => {
        session.transport = {
          ...session.transport,
          timeSignature: { numerator: 3, denominator: 4 },
        };
      },
    },
    {
      name: 'transport mode',
      mutate: (session: Session) => {
        session.transport = {
          ...session.transport,
          mode: 'song',
        };
      },
    },
    {
      name: 'loop mode',
      mutate: (session: Session) => {
        session.transport = {
          ...session.transport,
          loop: false,
        };
      },
    },
  ])('restarts scheduler from the current playhead when $name changes mid-play', ({ mutate }) => {
    vi.useFakeTimers();
    const session = makeSession();
    const scheduler = {
      start: vi.fn(),
      stop: vi.fn(),
      invalidateTrack: vi.fn(),
    };
    let schedulerPositionChange: ((step: number) => void) | null = null;
    const audio = makeAudio();

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: ({ onPositionChange }) => {
        schedulerPositionChange = onPositionChange;
        return scheduler;
      },
    });

    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();
    schedulerPositionChange?.(6);

    mutate(session);
    controller.sync();

    expect(scheduler.stop).toHaveBeenCalledTimes(1);
    expect(audio.releaseGeneration).toHaveBeenCalledWith(2);
    expect(scheduler.start).toHaveBeenNthCalledWith(1, expect.any(Number), 0, 1);
    expect(scheduler.start).toHaveBeenNthCalledWith(2, 0, 6, 3);

    controller.dispose();
  });
});
