import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrackLevelMeter } from './TrackLevelMeter';

describe('TrackLevelMeter', () => {
  it('keeps a visible shell when no analyser is available', () => {
    render(<TrackLevelMeter analyser={null} orientation="vertical" />);

    const meter = screen.getByLabelText('Level meter unavailable');
    expect(meter).toBeTruthy();
    expect(meter.className).toContain('border-zinc-700/70');
  });

  it('renders a normal readable shell horizontally by default', () => {
    render(<TrackLevelMeter analyser={null} />);

    const meter = screen.getByLabelText('Level meter unavailable');
    expect(meter).toBeTruthy();
    expect(meter.className).toContain('h-1.5');
  });
});
