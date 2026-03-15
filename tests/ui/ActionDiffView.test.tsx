import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActionDiffView } from '../../src/ui/ActionDiffView';
import type { ActionLogEntry } from '../../src/engine/types';

function renderEntry(entry: ActionLogEntry) {
  render(<ActionDiffView entry={entry} />);
}

describe('ActionDiffView', () => {
  it('renders master changes explicitly', () => {
    renderEntry({
      trackId: '',
      trackLabel: 'MASTER',
      description: 'fallback master text',
      diff: { kind: 'master-change', field: 'volume', from: 0.8, to: 0.65 },
    });

    expect(screen.getByText('MASTER')).toBeTruthy();
    expect(screen.getByText('volume')).toBeTruthy();
    expect(screen.getByText('0.65')).toBeTruthy();
    expect(screen.queryByText('fallback master text')).toBeNull();
  });

  it('renders surface diff kinds explicitly', () => {
    const entries: ActionLogEntry[] = [
      {
        trackId: 'v0',
        trackLabel: 'KICK',
        description: 'fallback surface set',
        diff: { kind: 'surface-set', controlCount: 3, description: 'performance skin' },
      },
      {
        trackId: 'v0',
        trackLabel: 'KICK',
        description: 'fallback pin',
        diff: { kind: 'surface-pin', moduleId: 'osc', controlId: 'brightness' },
      },
      {
        trackId: 'v0',
        trackLabel: 'KICK',
        description: 'fallback unpin',
        diff: { kind: 'surface-unpin', moduleId: 'osc', controlId: 'brightness' },
      },
      {
        trackId: 'v0',
        trackLabel: 'KICK',
        description: 'fallback axes',
        diff: { kind: 'surface-label-axes', x: 'brightness', y: 'texture' },
      },
    ];

    for (const entry of entries) {
      renderEntry(entry);
    }

    expect(screen.getByText('surface')).toBeTruthy();
    expect(screen.getByText('3 controls')).toBeTruthy();
    expect(screen.getByText('pin')).toBeTruthy();
    expect(screen.getByText('unpin')).toBeTruthy();
    expect(screen.getByText('axes')).toBeTruthy();
    expect(screen.queryByText('fallback surface set')).toBeNull();
    expect(screen.queryByText('fallback pin')).toBeNull();
    expect(screen.queryByText('fallback unpin')).toBeNull();
    expect(screen.queryByText('fallback axes')).toBeNull();
  });
});
