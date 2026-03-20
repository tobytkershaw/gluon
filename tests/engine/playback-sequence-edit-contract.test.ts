import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../src/engine/types';
import { TransportController } from '../../src/engine/transport-controller';
import {
  addPattern,
  addPatternRef,
  clearSequenceAutomation,
  createSession,
  removePatternRef,
  reorderPatternRef,
  setSequenceAutomation,
} from '../../src/engine/session';

function makeSession(): Session {
  const base = createSession();
  return {
    ...base,
    transport: {
      ...base.transport,
      status: 'stopped',
      mode: 'song',
    },
  };
}

function makeAudio() {
  return {
    getCurrentTime: vi.fn(() => 1),
    getState: vi.fn(() => 'running' as const),
    scheduleNote: vi.fn(),
    scheduleClick: vi.fn(),
    restoreBaseline: vi.fn(),
    advanceGeneration: vi.fn(() => 1),
    releaseGeneration: vi.fn(),
    silenceGeneration: vi.fn(),
    silenceMetronome: vi.fn(),
    setMetronomeVolume: vi.fn(),
  } as unknown as import('../../src/audio/audio-engine').AudioEngine;
}

describe('playback sequence-edit contract', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    {
      name: 'addPatternRef',
      mutate: (session: Session, trackId: string, extraPatternId: string) => addPatternRef(session, trackId, extraPatternId),
    },
    {
      name: 'removePatternRef',
      mutate: (session: Session, trackId: string) => removePatternRef(session, trackId, 1),
    },
    {
      name: 'reorderPatternRef',
      mutate: (session: Session, trackId: string) => reorderPatternRef(session, trackId, 0, 1),
    },
    {
      name: 'setSequenceAutomation',
      mutate: (session: Session, trackId: string) => setSequenceAutomation(session, trackId, 'timbre', [
        { at: 0, value: 0.2 },
        { at: 16, value: 0.8 },
      ]),
    },
    {
      name: 'clearSequenceAutomation',
      mutate: (session: Session, trackId: string) => {
        const withAutomation = setSequenceAutomation(session, trackId, 'timbre', [
          { at: 0, value: 0.2 },
          { at: 16, value: 0.8 },
        ]);
        return clearSequenceAutomation(withAutomation, trackId, 'timbre');
      },
    },
  ])('invalidates the playing track after $name', ({ mutate }) => {
    vi.useFakeTimers();
    let session = makeSession();
    const trackId = session.activeTrackId;
    session = addPattern(session, trackId)!;
    const extraPatternId = session.tracks[0].patterns[1].id;
    session = addPatternRef(session, trackId, extraPatternId);

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
    schedulerPositionChange?.(10);

    session = mutate(session, trackId, extraPatternId);
    expect(session.tracks[0]._patternDirty).toBe(true);

    controller.syncArrangement();

    expect(scheduler.invalidateTrack).toHaveBeenCalledWith(trackId, 10);
    expect(session.tracks[0]._patternDirty).toBe(false);

    controller.dispose();
  });
});
