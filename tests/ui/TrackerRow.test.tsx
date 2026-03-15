import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrackerRow } from '../../src/ui/TrackerRow';

describe('TrackerRow', () => {
  it('shows trigger rows clearly and allows editing trigger velocity', () => {
    const onUpdate = vi.fn();

    render(
      <table>
        <tbody>
          <TrackerRow
            event={{ kind: 'trigger', at: 0, velocity: 0.8 }}
            isAtPlayhead={false}
            showBeatSeparator={false}
            onUpdate={onUpdate}
          />
        </tbody>
      </table>,
    );

    expect(screen.getByText('TRG')).toBeTruthy();

    fireEvent.click(screen.getByText('0.80'));
    const input = screen.getByDisplayValue('0.80');
    fireEvent.change(input, { target: { value: '0.55' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdate).toHaveBeenCalledWith(
      { at: 0, kind: 'trigger' },
      { velocity: 0.55 },
    );
  });

  it('enters edit mode on single click for note rows', () => {
    const onUpdate = vi.fn();

    render(
      <table>
        <tbody>
          <TrackerRow
            event={{ kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 }}
            isAtPlayhead={false}
            showBeatSeparator={false}
            onUpdate={onUpdate}
          />
        </tbody>
      </table>,
    );

    fireEvent.click(screen.getByText('0.80'));
    expect(screen.getByDisplayValue('0.80')).toBeTruthy();
  });
});
