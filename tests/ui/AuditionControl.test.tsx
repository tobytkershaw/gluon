import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuditionControl } from '../../src/ui/AuditionControl';
import type { Track } from '../../src/engine/types';

function makeTrack(id: string, name: string): Track {
  return {
    id,
    name,
    engine: 'plaits',
    model: 0,
    params: {},
    stepGrid: [],
    patterns: [{ id: 'p1', name: 'A', events: [], duration: 16 }],
    sequence: [],
    muted: false,
    solo: false,
    volume: 0.8,
    pan: 0,
    surface: { modules: [], thumbprint: { seed: 0, style: 'geometric' } },
  };
}

const tracks: Track[] = [
  makeTrack('kick', 'Kick'),
  makeTrack('bass', 'Bass'),
  makeTrack('hats', 'Hats'),
];

describe('AuditionControl', () => {
  it('renders track pills with track names', () => {
    render(
      <AuditionControl
        trackIds={['kick', 'bass']}
        barRange={[1, 2]}
        loop={true}
        tracks={tracks}
        onStart={vi.fn()}
        onStop={vi.fn()}
        isPlaying={false}
      />,
    );
    expect(screen.getByText('Kick')).toBeTruthy();
    expect(screen.getByText('Bass')).toBeTruthy();
  });

  it('shows bar range', () => {
    const { container } = render(
      <AuditionControl
        trackIds={['kick']}
        barRange={[1, 4]}
        loop={false}
        tracks={tracks}
        onStart={vi.fn()}
        onStop={vi.fn()}
        isPlaying={false}
      />,
    );
    expect(container.textContent).toContain('bars 1');
    expect(container.textContent).toContain('4');
  });

  it('shows LOOP badge when loop is true', () => {
    render(
      <AuditionControl
        trackIds={['kick']}
        barRange={[1, 2]}
        loop={true}
        tracks={tracks}
        onStart={vi.fn()}
        onStop={vi.fn()}
        isPlaying={false}
      />,
    );
    expect(screen.getByText('LOOP')).toBeTruthy();
  });

  it('hides LOOP badge when loop is false', () => {
    render(
      <AuditionControl
        trackIds={['kick']}
        barRange={[1, 2]}
        loop={false}
        tracks={tracks}
        onStart={vi.fn()}
        onStop={vi.fn()}
        isPlaying={false}
      />,
    );
    expect(screen.queryByText('LOOP')).toBeNull();
  });

  it('calls onStart with config when play button clicked', () => {
    const onStart = vi.fn();
    render(
      <AuditionControl
        trackIds={['kick', 'bass']}
        barRange={[1, 2]}
        loop={true}
        tracks={tracks}
        onStart={onStart}
        onStop={vi.fn()}
        isPlaying={false}
      />,
    );
    fireEvent.click(screen.getByTitle('Start audition'));
    expect(onStart).toHaveBeenCalledWith({
      trackIds: ['kick', 'bass'],
      barRange: [1, 2],
      loop: true,
    });
  });

  it('calls onStop when stop button clicked during playback', () => {
    const onStop = vi.fn();
    render(
      <AuditionControl
        trackIds={['kick']}
        barRange={[1, 2]}
        loop={true}
        tracks={tracks}
        onStart={vi.fn()}
        onStop={onStop}
        isPlaying={true}
      />,
    );
    fireEvent.click(screen.getByTitle('Stop audition'));
    expect(onStop).toHaveBeenCalled();
  });

  it('skips tracks not found in the tracks array', () => {
    render(
      <AuditionControl
        trackIds={['kick', 'nonexistent']}
        barRange={[1, 2]}
        loop={true}
        tracks={tracks}
        onStart={vi.fn()}
        onStop={vi.fn()}
        isPlaying={false}
      />,
    );
    expect(screen.getByText('Kick')).toBeTruthy();
    // 'nonexistent' should not render a pill — only 1 pill total
    const pills = screen.queryAllByText(/^(Kick|Bass|Hats)$/);
    expect(pills).toHaveLength(1);
  });
});
