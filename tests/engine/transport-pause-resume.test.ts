import { describe, expect, it, vi } from 'vitest';
import { TransportController } from '../../src/engine/transport-controller';
import type { Session, Track } from '../../src/engine/types';
import type { AudioEngine } from '../../src/audio/audio-engine';
import type { ScheduledNote } from '../../src/engine/sequencer-types';

function makeTrack(id: string): Track {
  return {
    id,
    name: id,
    source: { type: 'plaits', model: 0, controls: {} },
    processors: [],
    modulators: [],
    agency: 'OFF',
    mute: false,
    solo: false,
    patterns: [{
      id: `${id}-region`,
      trackId: id,
      startBeat: 0,
      duration: 4,
      events: [
        { kind: 'trigger', at: 0, velocity: 1.0, accent: false },
        { kind: 'trigger', at: 1, velocity: 1.0, accent: false },
        { kind: 'trigger', at: 2, velocity: 1.0, accent: true },
        { kind: 'trigger', at: 3, velocity: 1.0, accent: false },
      ],
    }],
  } as Track;
}

function makeSession(status: 'stopped' | 'playing' | 'paused' = 'stopped'): Session {
  return {
    id: 'test-session',
    tracks: [makeTrack('t0')],
    transport: { playing: status === 'playing', status, bpm: 120, swing: 0 },
    masterVolume: 0.8,
    masterPan: 0,
  } as Session;
}

function makeMockAudio(): AudioEngine {
  let gen = 0;
  return {
    advanceGeneration: vi.fn(() => ++gen),
    getGeneration: vi.fn(() => gen),
    getCurrentTime: vi.fn(() => 0),
    getState: vi.fn(() => 'running' as AudioContextState),
    scheduleNote: vi.fn(),
    releaseGeneration: vi.fn(),
    silenceGeneration: vi.fn(),
    restoreBaseline: vi.fn(),
  } as unknown as AudioEngine;
}

describe('TransportController pause/resume', () => {
  it('pause → resume restarts from paused position with a fresh generation', () => {
    let session = makeSession('stopped');
    const audio = makeMockAudio();
    const onPositionChange = vi.fn();
    let schedulerStartCalls: { startStep: number; generation: number }[] = [];
    // Capture the internal onPositionChange so we can simulate the scheduler reporting position
    let internalOnPositionChange: (step: number) => void = () => {};

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange,
      getHeldParams: () => ({}),
      createScheduler: ({ onNote, onPositionChange: internalCb }) => {
        internalOnPositionChange = internalCb;
        return {
          start: vi.fn((_, startStep, generation) => {
            schedulerStartCalls.push({ startStep: startStep ?? 0, generation: generation ?? 0 });
            onNote({
              eventId: `note-gen-${generation}`,
              generation,
              trackId: 't0',
              time: 0.1,
              gateOffTime: 0.2,
              accent: false,
              params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
            });
          }),
          stop: vi.fn(),
          invalidateTrack: vi.fn(),
        };
      },
    });

    // Transition stopped → playing (generation 1)
    session = { ...session, transport: { ...session.transport, status: 'playing', playing: true } };
    controller.sync();
    expect(audio.restoreBaseline).toHaveBeenCalledTimes(1);
    expect(schedulerStartCalls).toHaveLength(1);
    expect(schedulerStartCalls[0].generation).toBe(1);

    // Simulate scheduler reporting playback is at step 8
    internalOnPositionChange(8);

    // Pause
    session = { ...session, transport: { ...session.transport, status: 'paused', playing: false } };
    controller.sync();
    expect(audio.releaseGeneration).toHaveBeenCalledTimes(1);

    // Resume from pause
    schedulerStartCalls = [];
    session = { ...session, transport: { ...session.transport, status: 'playing', playing: true } };
    controller.sync();

    // Should have advanced generation and resumed from step 8
    expect(audio.restoreBaseline).toHaveBeenCalledTimes(2);
    expect(schedulerStartCalls).toHaveLength(1);
    expect(schedulerStartCalls[0].startStep).toBe(8); // resumes from paused position
    expect(schedulerStartCalls[0].generation).toBe(3); // gen 1 (play), 2 (pause), 3 (resume)
  });

  it('stop → play restarts from step 0', () => {
    let session = makeSession('stopped');
    const audio = makeMockAudio();
    const onPositionChange = vi.fn();
    let schedulerStartCalls: { startStep: number; generation: number }[] = [];

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange,
      getHeldParams: () => ({}),
      createScheduler: ({ onNote }) => ({
        start: vi.fn((_, startStep, generation) => {
          schedulerStartCalls.push({ startStep: startStep ?? 0, generation: generation ?? 0 });
          onNote({
            eventId: `note-gen-${generation}`,
            generation,
            trackId: 't0',
            time: 0.1,
            gateOffTime: 0.2,
            accent: false,
            params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
          });
        }),
        stop: vi.fn(),
        invalidateTrack: vi.fn(),
      }),
    });

    // Start playing
    session = { ...session, transport: { ...session.transport, status: 'playing', playing: true } };
    controller.sync();
    onPositionChange(12);

    // Stop
    session = { ...session, transport: { ...session.transport, status: 'stopped', playing: false } };
    controller.sync();
    expect(onPositionChange).toHaveBeenLastCalledWith(0);

    // Play again
    schedulerStartCalls = [];
    session = { ...session, transport: { ...session.transport, status: 'playing', playing: true } };
    controller.sync();

    expect(schedulerStartCalls).toHaveLength(1);
    expect(schedulerStartCalls[0].startStep).toBe(0); // starts from 0 after stop
  });

  it('hard stop (requestHardStop) uses silenceGeneration instead of releaseGeneration', () => {
    let session = makeSession('stopped');
    const audio = makeMockAudio();

    const controller = new TransportController({
      audio,
      getSession: () => session,
      onPositionChange: vi.fn(),
      getHeldParams: () => ({}),
      createScheduler: () => ({
        start: vi.fn(),
        stop: vi.fn(),
        invalidateTrack: vi.fn(),
      }),
    });

    // Start playing first
    session = { ...session, transport: { ...session.transport, status: 'playing', playing: true } };
    controller.sync();

    // Request hard stop then stop
    controller.requestHardStop();
    session = { ...session, transport: { ...session.transport, status: 'stopped', playing: false } };
    controller.sync();

    expect(audio.silenceGeneration).toHaveBeenCalled();
    expect(audio.releaseGeneration).not.toHaveBeenCalled();
  });
});
