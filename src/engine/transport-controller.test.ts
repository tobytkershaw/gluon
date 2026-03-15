import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from './types';
import { TransportController } from './transport-controller';
import { createDefaultRegion } from './region-helpers';
import type { ScheduledNote } from './sequencer-types';

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
      releaseGeneration: vi.fn(),
      silenceGeneration: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: () => ({ start: vi.fn(), stop: vi.fn(), invalidateTrack: vi.fn() }),
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
      releaseGeneration: vi.fn(),
      silenceGeneration: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: () => ({ start: vi.fn(), stop: vi.fn(), invalidateTrack: vi.fn() }),
    });

    session.transport = { ...session.transport, status: 'playing', playing: true };
    controller.sync();
    session.transport = { ...session.transport, status: 'paused', playing: false };
    controller.sync();

    expect(audio.releaseGeneration).toHaveBeenCalledWith(2);
    expect(audio.silenceGeneration).not.toHaveBeenCalled();

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
      releaseGeneration: vi.fn(),
      silenceGeneration: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: () => ({ start: vi.fn(), stop: vi.fn(), invalidateTrack: vi.fn() }),
    });

    session.transport = { ...session.transport, status: 'playing', playing: true };
    controller.sync();
    controller.requestHardStop();
    session.transport = { ...session.transport, status: 'stopped', playing: false };
    controller.sync();

    expect(audio.silenceGeneration).toHaveBeenCalledWith(2);
    expect(audio.releaseGeneration).not.toHaveBeenCalledWith(2);

    controller.dispose();
  });

  it('resumes from the paused playhead on a fresh generation', () => {
    vi.useFakeTimers();
    const session = makeSession();
    const scheduler = {
      start: vi.fn(),
      stop: vi.fn(),
      invalidateTrack: vi.fn(),
    };
    let schedulerPositionChange: ((step: number) => void) | null = null;
    const audio = {
      getCurrentTime: vi.fn(() => 1),
      getState: vi.fn(() => 'running' as const),
      scheduleNote: vi.fn(),
      restoreBaseline: vi.fn(),
      advanceGeneration: vi.fn()
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(2)
        .mockReturnValueOnce(3),
      releaseGeneration: vi.fn(),
      silenceGeneration: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

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

    session.transport = { ...session.transport, status: 'playing', playing: true };
    controller.sync();
    schedulerPositionChange?.(8);
    session.transport = { ...session.transport, status: 'paused', playing: false };
    controller.sync();
    session.transport = { ...session.transport, status: 'playing', playing: true };
    controller.sync();

    expect(audio.releaseGeneration).toHaveBeenCalledWith(2);
    expect(scheduler.start).toHaveBeenNthCalledWith(1, expect.any(Number), 0, 1);
    expect(scheduler.start).toHaveBeenNthCalledWith(2, expect.any(Number), 8, 3);

    controller.dispose();
  });

  it('schedules resume notes with the fresh generation before the first scheduler tick', () => {
    vi.useFakeTimers();
    const session = makeSession();
    const scheduledNotes: Array<{ note: ScheduledNote; generation: number }> = [];
    let emitNote: ((note: ScheduledNote) => void) | null = null;
    const scheduler = {
      start: vi.fn((_offset?: number, _startStep?: number, generation?: number) => {
        emitNote?.({
          eventId: `${generation}:v0:r0:0:trigger@0`,
          generation: generation ?? 0,
          trackId: 'v0',
          time: 1,
          gateOffTime: 1.1,
          accent: false,
          params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
          baseParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
        });
      }),
      stop: vi.fn(),
      invalidateTrack: vi.fn(),
    };
    const audio = {
      getCurrentTime: vi.fn(() => 1),
      getState: vi.fn(() => 'running' as const),
      scheduleNote: vi.fn((note: ScheduledNote, generation: number) => {
        scheduledNotes.push({ note, generation });
      }),
      restoreBaseline: vi.fn(),
      advanceGeneration: vi.fn()
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(2)
        .mockReturnValueOnce(3),
      releaseGeneration: vi.fn(),
      silenceGeneration: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: ({ onNote, onPositionChange }) => {
        emitNote = onNote;
        onPositionChange(8);
        return scheduler;
      },
    });

    session.transport = { ...session.transport, status: 'playing', playing: true };
    controller.sync();
    session.transport = { ...session.transport, status: 'paused', playing: false };
    controller.sync();
    scheduledNotes.length = 0;
    session.transport = { ...session.transport, status: 'playing', playing: true };
    controller.sync();

    expect(scheduledNotes).toHaveLength(1);
    expect(scheduledNotes[0]?.note.generation).toBe(3);
    expect(scheduledNotes[0]?.generation).toBe(3);

    controller.dispose();
  });

  it('invalidates a playing track when its region changes', () => {
    vi.useFakeTimers();
    const region = createDefaultRegion('v0', 16);
    region.events = [{ kind: 'trigger', at: 0, velocity: 0.8 }];
    const session: Session = {
      ...makeSession(),
      tracks: [{
        id: 'v0',
        engine: 'plaits',
        model: 0,
        params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
        agency: 'ON',
        muted: false,
        solo: false,
        pattern: { steps: [], length: 16 },
        regions: [region],
        surface: { semanticControls: [], pinnedControls: [], xyAxes: { x: 'timbre', y: 'morph' }, thumbprint: { type: 'static-color' } },
      }],
    };
    const scheduler = {
      start: vi.fn(),
      stop: vi.fn(),
      invalidateTrack: vi.fn(),
    };
    let schedulerPositionChange: ((step: number) => void) | null = null;
    const audio = {
      getCurrentTime: vi.fn(() => 1),
      getState: vi.fn(() => 'running' as const),
      scheduleNote: vi.fn(),
      restoreBaseline: vi.fn(),
      advanceGeneration: vi.fn(() => 1),
      releaseGeneration: vi.fn(),
      silenceGeneration: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

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

    session.transport = { ...session.transport, status: 'playing', playing: true };
    controller.sync();
    schedulerPositionChange?.(6);

    session.tracks[0].regions[0] = {
      ...session.tracks[0].regions[0],
      events: [{ kind: 'trigger', at: 8, velocity: 0.8 }],
    };
    controller.syncArrangement();

    expect(scheduler.invalidateTrack).toHaveBeenCalledWith('v0', 6);

    controller.dispose();
  });
});
