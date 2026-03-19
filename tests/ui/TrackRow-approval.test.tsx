import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrackRow } from '../../src/ui/TrackRow';
import type { Track, ApprovalLevel } from '../../src/engine/types';
import { createEmptyTrack } from '../../src/engine/session';

/** Build a minimal track with overrides. */
function makeTrack(overrides: Partial<Track> = {}): Track {
  return { ...createEmptyTrack('t1'), ...overrides };
}

const noop = () => {};

describe('TrackRow approval controls', () => {
  it('shows approval badge for exploratory (draft) when onCycleApproval provided', () => {
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
        onCycleApproval={noop}
      />,
    );
    // The exploratory badge should render with aria-label containing "Draft"
    expect(screen.getByLabelText(/protection: draft/i)).toBeTruthy();
  });

  it('shows correct badge for each approval level', () => {
    const levels: Array<{ level: ApprovalLevel; label: string }> = [
      { level: 'exploratory', label: 'Draft' },
      { level: 'liked', label: 'Keeper' },
      { level: 'approved', label: 'Locked' },
      { level: 'anchor', label: 'Anchor' },
    ];

    for (const { level, label } of levels) {
      const { unmount } = render(
        <TrackRow
          track={makeTrack({ approval: level })}
          label="Track 1"
          isActive={false}
          isExpanded={false}
          activityTimestamp={null}
          onClick={noop}
          onToggleMute={noop}
          onToggleSolo={noop}
          onCycleApproval={noop}
        />,
      );
      expect(screen.getByLabelText(new RegExp(`protection: ${label}`, 'i'))).toBeTruthy();
      unmount();
    }
  });

  it('calls onCycleApproval when badge is clicked', () => {
    const onCycle = vi.fn();
    render(
      <TrackRow
        track={makeTrack({ approval: 'liked' })}
        label="Track 1"
        isActive={false}
        isExpanded={false}
        activityTimestamp={null}
        onClick={noop}
        onToggleMute={noop}
        onToggleSolo={noop}
        onCycleApproval={onCycle}
      />,
    );
    fireEvent.click(screen.getByLabelText(/protection: keeper/i));
    expect(onCycle).toHaveBeenCalledOnce();
  });

  it('shows approval label in expanded section', () => {
    render(
      <TrackRow
        track={makeTrack({ approval: 'approved' })}
        label="Track 1"
        isActive={false}
        isExpanded={true}
        activityTimestamp={null}
        onClick={noop}
        onToggleMute={noop}
        onToggleSolo={noop}
        onCycleApproval={noop}
      />,
    );
    // The expanded section should show the human label
    expect(screen.getByText('Locked')).toBeTruthy();
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
