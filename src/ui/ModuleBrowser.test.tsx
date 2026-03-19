import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from '../engine/session';
import { ModuleBrowser } from './ModuleBrowser';

describe('ModuleBrowser', () => {
  it('shows the updated Beads description', () => {
    const session = createSession();
    const activeTrack = session.tracks[0];

    render(
      <ModuleBrowser
        activeTrack={activeTrack}
        onAddProcessor={vi.fn()}
        onAddModulator={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Granular, delay, wavetable synth — Clouds successor')).toBeTruthy();
  });
});
