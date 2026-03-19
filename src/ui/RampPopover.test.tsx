import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { RampPopover } from './RampPopover';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RampPopover', () => {
  it('renders with current value displayed', () => {
    render(
      <RampPopover currentValue={0.42} onStart={vi.fn()} onCancel={vi.fn()} />,
    );
    // Both "Now" and "Target" show 0.42 initially
    expect(screen.getAllByText('0.42').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('ramp-popover')).toBeTruthy();
    expect(screen.getByText('Now')).toBeTruthy();
    expect(screen.getByText('Target')).toBeTruthy();
  });

  it('fires onStart with target and selected duration', () => {
    const onStart = vi.fn();
    render(
      <RampPopover currentValue={0.5} onStart={onStart} onCancel={vi.fn()} />,
    );

    // Select 2s duration
    fireEvent.click(screen.getByTestId('duration-2000'));
    // Click start
    fireEvent.click(screen.getByTestId('ramp-start'));

    expect(onStart).toHaveBeenCalledTimes(1);
    // Default target equals currentValue (0.5), duration 2000
    expect(onStart).toHaveBeenCalledWith(0.5, 2000);
  });

  it('fires onStart with default 1s duration', () => {
    const onStart = vi.fn();
    render(
      <RampPopover currentValue={0.3} onStart={onStart} onCancel={vi.fn()} />,
    );

    // Click start without changing duration (default is 1s = 1000ms)
    fireEvent.click(screen.getByTestId('ramp-start'));

    expect(onStart).toHaveBeenCalledWith(0.3, 1000);
  });

  it('dismisses on Escape key', () => {
    const onCancel = vi.fn();
    render(
      <RampPopover currentValue={0.5} onStart={vi.fn()} onCancel={onCancel} />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows all duration preset buttons', () => {
    render(
      <RampPopover currentValue={0.5} onStart={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.getByTestId('duration-500')).toBeTruthy();
    expect(screen.getByTestId('duration-1000')).toBeTruthy();
    expect(screen.getByTestId('duration-2000')).toBeTruthy();
    expect(screen.getByTestId('duration-5000')).toBeTruthy();
  });
});
