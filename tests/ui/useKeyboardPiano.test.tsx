import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../../src/engine/session';
import { useKeyboardPiano } from '../../src/ui/useKeyboardPiano';

function buildAudio() {
  return {
    isRunning: true,
    getCurrentTime: vi.fn(() => 12.5),
    scheduleNote: vi.fn(),
    releaseTrack: vi.fn(),
  };
}

describe('useKeyboardPiano', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.focus();
  });

  it('auditions a mapped key and releases the track on keyup', () => {
    const session = createSession();
    const audio = buildAudio();
    const audioRef = { current: audio };
    const globalStepRef = { current: 0 };
    const onRecordEvents = vi.fn();

    renderHook(() => useKeyboardPiano(audioRef as never, session, false, globalStepRef as never, onRecordEvents));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', bubbles: true }));
    });

    expect(audio.scheduleNote).toHaveBeenCalledOnce();
    expect(audio.scheduleNote).toHaveBeenCalledWith(expect.objectContaining({
      trackId: session.activeTrackId,
      time: 12.5,
      gateOffTime: 42.5,
      accent: false,
      params: expect.objectContaining({ note: expect.any(Number) }),
    }));
    expect(audio.releaseTrack).toHaveBeenCalledWith(session.activeTrackId);
    expect(onRecordEvents).not.toHaveBeenCalled();
  });

  it('records note events while armed and transport is playing', () => {
    const session = {
      ...createSession(),
      transport: {
        ...createSession().transport,
        status: 'playing' as const,
      },
    };
    const audio = buildAudio();
    const audioRef = { current: audio };
    const globalStepRef = { current: 4 };
    const onRecordEvents = vi.fn();

    renderHook(() => useKeyboardPiano(audioRef as never, session, true, globalStepRef as never, onRecordEvents));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
      globalStepRef.current = 6;
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', bubbles: true }));
    });

    expect(onRecordEvents).toHaveBeenCalledWith(session.activeTrackId, [{
      kind: 'note',
      at: 4,
      pitch: 48,
      velocity: 0.7,
      duration: 2,
    }]);
  });

  it('finalizes held notes when recording stops before keyup', () => {
    const base = createSession();
    const playingSession = {
      ...base,
      transport: { ...base.transport, status: 'playing' as const },
    };
    const stoppedSession = {
      ...playingSession,
      transport: { ...playingSession.transport, status: 'stopped' as const },
    };
    const audio = buildAudio();
    const audioRef = { current: audio };
    const globalStepRef = { current: 1 };
    const onRecordEvents = vi.fn();

    const { rerender } = renderHook(
      ({ session, recordArmed }) => useKeyboardPiano(audioRef as never, session, recordArmed, globalStepRef as never, onRecordEvents),
      { initialProps: { session: playingSession, recordArmed: true } },
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
      globalStepRef.current = 3;
    });

    rerender({ session: stoppedSession, recordArmed: true });

    expect(onRecordEvents).toHaveBeenCalledWith(base.activeTrackId, [{
      kind: 'note',
      at: 1,
      pitch: 60,
      velocity: 0.7,
      duration: 2,
    }]);
  });

  it('shifts octave with - and = within bounds', () => {
    const session = createSession();
    const audioRef = { current: buildAudio() };
    const globalStepRef = { current: 0 };
    const onRecordEvents = vi.fn();

    const { result } = renderHook(() =>
      useKeyboardPiano(audioRef as never, session, false, globalStepRef as never, onRecordEvents),
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
    });

    expect(result.current.octaveOffset).toBe(1);
  });

  it('ignores piano input while typing in a text field', () => {
    const session = createSession();
    const audio = buildAudio();
    const audioRef = { current: audio };
    const globalStepRef = { current: 0 };
    const onRecordEvents = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    renderHook(() => useKeyboardPiano(audioRef as never, session, false, globalStepRef as never, onRecordEvents));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', bubbles: true }));
    });

    expect(audio.scheduleNote).not.toHaveBeenCalled();
    expect(audio.releaseTrack).not.toHaveBeenCalled();
  });
});
