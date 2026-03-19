import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Knob } from './Knob';

beforeAll(() => {
  if (typeof SVGElement.prototype.setPointerCapture !== 'function') {
    SVGElement.prototype.setPointerCapture = () => {};
  }
  if (typeof SVGElement.prototype.releasePointerCapture !== 'function') {
    SVGElement.prototype.releasePointerCapture = () => {};
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Knob', () => {
  it('shows mapped units immediately when a drag starts', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { container } = render(
      <Knob
        value={0.5}
        label="Freq"
        accentColor="amber"
        onChange={() => {}}
        displayMapping={{
          type: 'log',
          min: 20,
          max: 20000,
          unit: 'Hz',
          decimals: 0,
        }}
      />,
    );

    expect(screen.getByText('50')).toBeTruthy();

    const knobSvg = container.querySelector('svg');
    expect(knobSvg).toBeTruthy();

    fireEvent.pointerDown(knobSvg!, {
      pointerId: 1,
      clientY: 100,
    });

    expect(screen.getByText('632 Hz')).toBeTruthy();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('opens ramp popover on Shift+PointerDown when onRampRequest is provided', () => {
    const onRampRequest = vi.fn();
    const { container } = render(
      <Knob
        value={0.5}
        label="Test"
        accentColor="amber"
        onChange={() => {}}
        onRampRequest={onRampRequest}
      />,
    );

    const knobSvg = container.querySelector('svg');
    expect(knobSvg).toBeTruthy();

    // Shift+PointerDown should open popover, not start drag
    fireEvent.pointerDown(knobSvg!, {
      pointerId: 1,
      clientY: 100,
      shiftKey: true,
    });

    expect(screen.getByTestId('ramp-popover')).toBeTruthy();
  });

  it('does not open ramp popover on normal PointerDown', () => {
    const onRampRequest = vi.fn();
    const { container } = render(
      <Knob
        value={0.5}
        label="Test"
        accentColor="amber"
        onChange={() => {}}
        onRampRequest={onRampRequest}
      />,
    );

    const knobSvg = container.querySelector('svg');

    // Normal PointerDown should start drag, not open popover
    fireEvent.pointerDown(knobSvg!, {
      pointerId: 1,
      clientY: 100,
      shiftKey: false,
    });

    expect(screen.queryByTestId('ramp-popover')).toBeNull();
  });

  it('does not open ramp popover on Shift+PointerDown when onRampRequest is not provided', () => {
    const { container } = render(
      <Knob
        value={0.5}
        label="Test"
        accentColor="amber"
        onChange={() => {}}
      />,
    );

    const knobSvg = container.querySelector('svg');

    fireEvent.pointerDown(knobSvg!, {
      pointerId: 1,
      clientY: 100,
      shiftKey: true,
    });

    expect(screen.queryByTestId('ramp-popover')).toBeNull();
  });
});
