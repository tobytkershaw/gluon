import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from './types';
import { TransportController } from './transport-controller';
import { createDefaultPattern } from './region-helpers';

function makeSession(): Session {
  return {
    tracks: [],
    activeTrackId: 'v0',
    transport: { status: 'stopped', bpm: 120, swing: 0 },
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
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: () => ({ start: vi.fn(), stop: vi.fn(), invalidateTrack: vi.fn() }),
    });

    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();

    expect(audio.advanceGeneration).toHaveBeenCalledTimes(1);
    expect(audio.restoreBaseline).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it('starts playback when constructed after session already flipped to playing', () => {
    vi.useFakeTimers();
    const session = makeSession();
    session.transport = { ...session.transport, status: 'playing' };
    const scheduler = {
      start: vi.fn(),
      stop: vi.fn(),
      invalidateTrack: vi.fn(),
    };
    const audio = {
      getCurrentTime: vi.fn(() => 1),
      getState: vi.fn(() => 'running' as const),
      scheduleNote: vi.fn(),
      restoreBaseline: vi.fn(),
      advanceGeneration: vi.fn(() => 1),
      releaseGeneration: vi.fn(),
      silenceGeneration: vi.fn(),
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: () => scheduler,
    });

    controller.sync();

    expect(audio.advanceGeneration).toHaveBeenCalledTimes(1);
    expect(audio.restoreBaseline).toHaveBeenCalledTimes(1);
    expect(scheduler.start).toHaveBeenCalledWith(expect.any(Number), 0, 1);

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
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: () => ({ start: vi.fn(), stop: vi.fn(), invalidateTrack: vi.fn() }),
    });

    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();
    session.transport = { ...session.transport, status: 'paused' };
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
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: () => ({ start: vi.fn(), stop: vi.fn(), invalidateTrack: vi.fn() }),
    });

    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();
    controller.requestHardStop();
    session.transport = { ...session.transport, status: 'stopped' };
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
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
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

    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();
    schedulerPositionChange?.(8);
    session.transport = { ...session.transport, status: 'paused' };
    controller.sync();
    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();

    expect(audio.releaseGeneration).toHaveBeenCalledWith(2);
    expect(scheduler.start).toHaveBeenNthCalledWith(1, expect.any(Number), 0, 1);
    expect(scheduler.start).toHaveBeenNthCalledWith(2, expect.any(Number), 8, 3);

    controller.dispose();
  });

  it('does not replay a stale playFromStep when transport settings change during playback', () => {
    vi.useFakeTimers();
    const session = makeSession();
    const scheduler = {
      start: vi.fn(),
      stop: vi.fn(),
      invalidateTrack: vi.fn(),
    };
    const audio = {
      getCurrentTime: vi.fn(() => 1),
      getState: vi.fn(() => 'running' as const),
      scheduleNote: vi.fn(),
      restoreBaseline: vi.fn(),
      advanceGeneration: vi.fn(() => 1),
      releaseGeneration: vi.fn(),
      silenceGeneration: vi.fn(),
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: () => scheduler,
    });

    session.transport = { ...session.transport, status: 'playing', playFromStep: 8 };
    controller.sync();

    expect(scheduler.start).toHaveBeenCalledTimes(1);
    expect(scheduler.start).toHaveBeenLastCalledWith(expect.any(Number), 8, 1);

    // A later transport settings sync should not restart playback from the stale cursor request.
    session.transport = { ...session.transport, bpm: 132 };
    controller.sync();

    expect(scheduler.start).toHaveBeenCalledTimes(1);
    expect(audio.releaseGeneration).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('delays parameter events until their scheduled audio time', () => {
    vi.useFakeTimers();
    const session = makeSession();
    let currentTime = 1;
    let schedulerParameterEvent: ((trackId: string, controlId: string, value: number | string | boolean, time: number) => void) | null = null;
    const onParameterEvent = vi.fn();
    const audio = {
      getCurrentTime: vi.fn(() => currentTime),
      getState: vi.fn(() => 'running' as const),
      scheduleNote: vi.fn(),
      restoreBaseline: vi.fn(),
      advanceGeneration: vi.fn(() => 1),
      releaseGeneration: vi.fn(),
      silenceGeneration: vi.fn(),
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      onParameterEvent,
      createScheduler: ({ onParameterEvent: internalCb }) => {
        schedulerParameterEvent = internalCb ?? null;
        return { start: vi.fn(), stop: vi.fn(), invalidateTrack: vi.fn() };
      },
    });

    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();

    schedulerParameterEvent?.('v0', 'timbre', 0.8, 1.25);
    expect(onParameterEvent).not.toHaveBeenCalled();

    vi.advanceTimersByTime(249);
    expect(onParameterEvent).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onParameterEvent).toHaveBeenCalledWith('v0', 'timbre', 0.8);

    controller.dispose();
  });

  it('cancels queued parameter events when playback stops', () => {
    vi.useFakeTimers();
    const session = makeSession();
    let currentTime = 1;
    let schedulerParameterEvent: ((trackId: string, controlId: string, value: number | string | boolean, time: number) => void) | null = null;
    const onParameterEvent = vi.fn();
    const audio = {
      getCurrentTime: vi.fn(() => currentTime),
      getState: vi.fn(() => 'running' as const),
      scheduleNote: vi.fn(),
      restoreBaseline: vi.fn(),
      advanceGeneration: vi.fn()
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(2),
      releaseGeneration: vi.fn(),
      silenceGeneration: vi.fn(),
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      onParameterEvent,
      createScheduler: ({ onParameterEvent: internalCb }) => {
        schedulerParameterEvent = internalCb ?? null;
        return { start: vi.fn(), stop: vi.fn(), invalidateTrack: vi.fn() };
      },
    });

    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();

    schedulerParameterEvent?.('v0', 'timbre', 0.8, 1.25);
    session.transport = { ...session.transport, status: 'stopped' };
    controller.sync();

    vi.advanceTimersByTime(300);
    expect(onParameterEvent).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('restores metronome volume on play after stop silenced it', () => {
    vi.useFakeTimers();
    const session = makeSession();
    session.transport = {
      ...session.transport,
      metronome: { enabled: true, volume: 0.7 },
    };
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
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: () => ({ start: vi.fn(), stop: vi.fn(), invalidateTrack: vi.fn() }),
    });

    // Play → stop (silences metronome) → play again
    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();
    session.transport = { ...session.transport, status: 'stopped' };
    controller.sync();

    expect(audio.silenceMetronome).toHaveBeenCalled();

    // Play again — should restore volume
    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();

    expect(audio.setMetronomeVolume).toHaveBeenCalledWith(0.7);

    controller.dispose();
  });

  it('silences metronome on pause', () => {
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
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: () => ({ start: vi.fn(), stop: vi.fn(), invalidateTrack: vi.fn() }),
    });

    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();
    session.transport = { ...session.transport, status: 'paused' };
    controller.sync();

    expect(audio.silenceMetronome).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it('pause → resume: notes from first tick use the new generation', () => {
    // When the scheduler starts, it fires tick() synchronously. The onNote
    // callback in TransportController passes this.runtime.generation to
    // audio.scheduleNote(). If runtime.generation hasn't been updated yet
    // (still the pause generation), notes get the wrong generation — causing
    // the audio engine to misroute them and produce duplicate triggers.
    vi.useFakeTimers();
    const session = makeSession();
    const noteGenerations: number[] = [];
    const scheduler = {
      start: vi.fn(),
      stop: vi.fn(),
      invalidateTrack: vi.fn(),
    };
    let capturedOnNote: ((note: import('./sequencer-types').ScheduledNote) => void) | null = null;
    let schedulerPositionChange: ((step: number) => void) | null = null;
    const audio = {
      getCurrentTime: vi.fn(() => 1),
      getState: vi.fn(() => 'running' as const),
      scheduleNote: vi.fn((_note: unknown, generation: number) => {
        noteGenerations.push(generation);
      }),
      scheduleClick: vi.fn(),
      restoreBaseline: vi.fn(),
      advanceGeneration: vi.fn()
        .mockReturnValueOnce(1)   // play
        .mockReturnValueOnce(2)   // pause
        .mockReturnValueOnce(3),  // resume
      releaseGeneration: vi.fn(),
      silenceGeneration: vi.fn(),
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: ({ onNote, onPositionChange }) => {
        capturedOnNote = onNote;
        schedulerPositionChange = onPositionChange;
        // When start() is called, simulate the synchronous first tick by
        // firing a note immediately (this is what the real Scheduler does).
        return {
          ...scheduler,
          start: vi.fn((_offset?: number, _step?: number, _gen?: number) => {
            if (capturedOnNote) {
              capturedOnNote({
                trackId: 'v0',
                time: 1.1,
                gateOffTime: 1.2,
                accent: false,
                params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
                generation: _gen,
                eventId: `${_gen}:v0:r1:0:trigger@0`,
              });
            }
          }),
          stop: scheduler.stop,
          invalidateTrack: scheduler.invalidateTrack,
        };
      },
    });

    // Play (generation 1) — note the bug also affects first play:
    // runtime.generation is 0 (initial) when the first tick fires.
    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();
    // Fixed: first-play notes now use the correct generation
    expect(noteGenerations[0]).toBe(1);

    // Advance playhead, then pause
    schedulerPositionChange?.(8);
    session.transport = { ...session.transport, status: 'paused' };
    controller.sync();

    // Resume (should use generation 3)
    noteGenerations.length = 0;
    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();

    // The note fired during scheduler.start()'s synchronous first tick
    // must be passed to scheduleNote with the NEW generation (3), not
    // the stale pause generation (2).
    expect(noteGenerations).toEqual([3]);

    controller.dispose();
  });

  it('silences metronome on stop', () => {
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
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: () => ({ start: vi.fn(), stop: vi.fn(), invalidateTrack: vi.fn() }),
    });

    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();
    session.transport = { ...session.transport, status: 'stopped' };
    controller.sync();

    expect(audio.silenceMetronome).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it('clears _patternDirty after syncArrangement reads it', () => {
    vi.useFakeTimers();
    const region = createDefaultPattern('v0', 16);
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
        stepGrid: { steps: [], length: 16 },
        patterns: [region],
        surface: { semanticControls: [], pinnedControls: [], xyAxes: { x: 'timbre', y: 'morph' }, thumbprint: { type: 'static-color' } },
      }],
    };
    const scheduler = {
      start: vi.fn(),
      stop: vi.fn(),
      invalidateTrack: vi.fn(),
    };
    const audio = {
      getCurrentTime: vi.fn(() => 1),
      getState: vi.fn(() => 'running' as const),
      scheduleNote: vi.fn(),
      restoreBaseline: vi.fn(),
      advanceGeneration: vi.fn(() => 1),
      releaseGeneration: vi.fn(),
      silenceGeneration: vi.fn(),
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
    } as unknown as import('../audio/audio-engine').AudioEngine;

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: vi.fn(() => ({})),
      createScheduler: () => scheduler,
    });

    // First syncArrangement seeds trackSeen
    controller.syncArrangement();

    // Simulate recording: set _patternDirty
    session.tracks[0]._patternDirty = true;

    // Start playback so invalidation path fires
    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();
    controller.syncArrangement();

    // The flag should be cleared after syncArrangement
    expect(session.tracks[0]._patternDirty).toBe(false);

    // A second syncArrangement should NOT re-invalidate (flag was cleared)
    scheduler.invalidateTrack.mockClear();
    controller.syncArrangement();
    expect(scheduler.invalidateTrack).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('invalidates a playing track when its region changes', () => {
    vi.useFakeTimers();
    const region = createDefaultPattern('v0', 16);
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
        stepGrid: { steps: [], length: 16 },
        patterns: [region],
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
      silenceMetronome: vi.fn(),
      setMetronomeVolume: vi.fn(),
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

    session.transport = { ...session.transport, status: 'playing' };
    controller.sync();
    schedulerPositionChange?.(6);

    session.tracks[0].patterns[0] = {
      ...session.tracks[0].patterns[0],
      events: [{ kind: 'trigger', at: 8, velocity: 0.8 }],
    };
    session.tracks[0]._patternDirty = true;
    controller.syncArrangement();

    expect(scheduler.invalidateTrack).toHaveBeenCalledWith('v0', 6);

    controller.dispose();
  });
});
