import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrackRow } from '../../src/ui/TrackRow';
import type { Track } from '../../src/engine/types';
import { createEmptyTrack } from '../../src/engine/session';

/** Build a minimal track with overrides. */
function makeTrack(overrides: Partial<Track> = {}): Track {
  return { ...createEmptyTrack('t1'), ...overrides };
}

const noop = () => {};

describe('TrackRow claim controls', () => {
  it('shows unclaimed badge when onToggleClaim provided and track is unclaimed', () => {
    render(
      <TrackRow
        track={makeTrack()}
        label="Track 1"
        isActive={false}
        isExpanded={false}
        activityTimestamp={null}
        onClick={noop}
        onToggleMute={noop}
        onToggleSolo={noop}
        onToggleClaim={noop}
      />,
    );
    expect(screen.getByLabelText(/protection: unclaimed/i)).toBeTruthy();
  });

  it('shows claimed badge when track is claimed', () => {
    render(
      <TrackRow
        track={makeTrack({ claimed: true })}
        label="Track 1"
        isActive={false}
        isExpanded={false}
        activityTimestamp={null}
        onClick={noop}
        onToggleMute={noop}
        onToggleSolo={noop}
        onToggleClaim={noop}
      />,
    );
    expect(screen.getByLabelText(/protection: claimed/i)).toBeTruthy();
  });

  it('shows unclaimed badge when track is unclaimed', () => {
    render(
      <TrackRow
        track={makeTrack({ claimed: false })}
        label="Track 1"
        isActive={false}
        isExpanded={false}
        activityTimestamp={null}
        onClick={noop}
        onToggleMute={noop}
        onToggleSolo={noop}
        onToggleClaim={noop}
      />,
    );
    expect(screen.getByLabelText(/protection: unclaimed/i)).toBeTruthy();
  });

  it('calls onToggleClaim when badge is clicked', () => {
    const onToggle = vi.fn();
    render(
      <TrackRow
        track={makeTrack({ claimed: true })}
        label="Track 1"
        isActive={false}
        isExpanded={false}
        activityTimestamp={null}
        onClick={noop}
        onToggleMute={noop}
        onToggleSolo={noop}
        onToggleClaim={onToggle}
      />,
    );
    fireEvent.click(screen.getByLabelText(/protection: claimed/i));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows claim label in expanded section', () => {
    render(
      <TrackRow
        track={makeTrack({ claimed: true })}
        label="Track 1"
        isActive={false}
        isExpanded={true}
        activityTimestamp={null}
        onClick={noop}
        onToggleMute={noop}
        onToggleSolo={noop}
        onToggleClaim={noop}
      />,
    );
    // The expanded section should show the human label
    expect(screen.getByText('Claimed')).toBeTruthy();
  });
});

describe('TrackRow importance controls', () => {
  it('shows importance tier buttons when expanded and onSetImportance provided', () => {
    render(
      <TrackRow
        track={makeTrack({ importance: 0.5 })}
        label="Track 1"
        isActive={false}
        isExpanded={true}
        activityTimestamp={null}
        onClick={noop}
        onToggleMute={noop}
        onToggleSolo={noop}
        onSetImportance={noop}
      />,
    );
    expect(screen.getByLabelText(/set importance to low/i)).toBeTruthy();
    expect(screen.getByLabelText(/set importance to mid/i)).toBeTruthy();
    expect(screen.getByLabelText(/set importance to high/i)).toBeTruthy();
  });

  it('calls onSetImportance with correct tier value when clicked', () => {
    const onSet = vi.fn();
    render(
      <TrackRow
        track={makeTrack({ importance: 0.2 })}
        label="Track 1"
        isActive={false}
        isExpanded={true}
        activityTimestamp={null}
        onClick={noop}
        onToggleMute={noop}
        onToggleSolo={noop}
        onSetImportance={onSet}
      />,
    );
    fireEvent.click(screen.getByLabelText(/set importance to high/i));
    expect(onSet).toHaveBeenCalledWith(0.9);
  });

  it('does not show importance controls when collapsed', () => {
    render(
      <TrackRow
        track={makeTrack({ importance: 0.5 })}
        label="Track 1"
        isActive={false}
        isExpanded={false}
        activityTimestamp={null}
        onClick={noop}
        onToggleMute={noop}
        onToggleSolo={noop}
        onSetImportance={noop}
      />,
    );
    expect(screen.queryByLabelText(/set importance to low/i)).toBeNull();
  });
});
