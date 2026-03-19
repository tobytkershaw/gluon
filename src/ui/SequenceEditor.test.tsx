import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { SequenceEditor } from './SequenceEditor';
import { createSession, addPattern } from '../engine/session';
import { getTrack } from '../engine/types';

describe('SequenceEditor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes a human path for sequence automation editing', () => {
    let session = createSession();
    const trackId = session.activeTrackId;
    session = addPattern(session, trackId)!;
    const track = getTrack(session, trackId);
    const onSetSequenceAutomation = vi.fn();

    const promptMock = vi.fn()
      .mockReturnValueOnce('timbre')
      .mockReturnValueOnce('1.1.1:0.2:linear, 2.1.1:0.8');
    Object.defineProperty(window, 'prompt', {
      value: promptMock,
      configurable: true,
      writable: true,
    });

    render(
      <SequenceEditor
        track={track}
        globalStep={0}
        playing={false}
        isSongMode={true}
        onAddPatternRef={vi.fn()}
        onRemovePatternRef={vi.fn()}
        onReorderPatternRef={vi.fn()}
        onSetSequenceAutomation={onSetSequenceAutomation}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));

    expect(onSetSequenceAutomation).toHaveBeenCalledWith('timbre', [
      { at: 0, value: 0.2, interpolation: 'linear' },
      { at: 16, value: 0.8 },
    ]);
  });
});
