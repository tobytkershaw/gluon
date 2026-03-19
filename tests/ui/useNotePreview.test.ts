import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNotePreview } from '../../src/ui/useNotePreview';
import type { AudioEngine } from '../../src/audio/audio-engine';
import type { Track } from '../../src/engine/types';

function mockAudioEngine(overrides: Partial<AudioEngine> = {}): AudioEngine {
  return {
    isRunning: true,
    getCurrentTime: () => 100,
    scheduleNote: vi.fn(),
    releaseTrack: vi.fn(),
    ...overrides,
  } as unknown as AudioEngine;
}

const stubTrack: Track = {
  id: 'track-1',
  name: 'Test',
  kind: 'audio',
  params: { note: 0.5, timbre: 0.5, morph: 0.5, harmonics: 0.5, level: 0.7 },
} as unknown as Track;

describe('useNotePreview', () => {
  it('schedules a note when transport is stopped', () => {
    const engine = mockAudioEngine();
    const ref = { current: engine };
    const { result } = renderHook(() => useNotePreview(ref as any, stubTrack, 'stopped'));

    result.current.previewNote(60);

    expect(engine.scheduleNote).toHaveBeenCalledTimes(1);
  });

  it('suppresses preview when transport is playing (#1007)', () => {
    const engine = mockAudioEngine();
    const ref = { current: engine };
    const { result } = renderHook(() => useNotePreview(ref as any, stubTrack, 'playing'));

    result.current.previewNote(60);

    expect(engine.scheduleNote).not.toHaveBeenCalled();
  });

  it('schedules a note when transport is paused', () => {
    const engine = mockAudioEngine();
    const ref = { current: engine };
    const { result } = renderHook(() => useNotePreview(ref as any, stubTrack, 'paused'));

    result.current.previewNote(60);

    expect(engine.scheduleNote).toHaveBeenCalledTimes(1);
  });

  it('does not schedule when audio engine is not running', () => {
    const engine = mockAudioEngine({ isRunning: false });
    const ref = { current: engine };
    const { result } = renderHook(() => useNotePreview(ref as any, stubTrack, 'stopped'));

    result.current.previewNote(60);

    expect(engine.scheduleNote).not.toHaveBeenCalled();
  });

  it('does not schedule when no active track', () => {
    const engine = mockAudioEngine();
    const ref = { current: engine };
    const { result } = renderHook(() => useNotePreview(ref as any, null, 'stopped'));

    result.current.previewNote(60);

    expect(engine.scheduleNote).not.toHaveBeenCalled();
  });
});
