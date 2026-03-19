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
});
