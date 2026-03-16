import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrackerRow, type SlotData, parseNoteName } from '../../src/ui/TrackerRow';

describe('TrackerRow', () => {
  it('shows trigger rows clearly and allows editing trigger velocity', () => {
    const onUpdate = vi.fn();
    const slot: SlotData = {
      noteOrTrigger: { kind: 'trigger', at: 0, velocity: 0.8 },
      paramEvents: [],
    };

    render(
      <table>
        <tbody>
          <TrackerRow
            step={0}
            slot={slot}
            isAtPlayhead={false}
            showBeatSeparator={false}
            isCursorRow={false}
            cursorColumn={null}
            onUpdate={onUpdate}
          />
        </tbody>
      </table>,
    );

    expect(screen.getByText('TRG')).toBeTruthy();

    // Velocity is now displayed as 0-100 integer
    fireEvent.click(screen.getByText('80'));
    const input = screen.getByDisplayValue('80');
    fireEvent.change(input, { target: { value: '55' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdate).toHaveBeenCalledWith(
      { at: 0, kind: 'trigger' },
      { velocity: 0.55 },
    );
  });

  it('enters edit mode on single click for note rows', () => {
    const onUpdate = vi.fn();
    const slot: SlotData = {
      noteOrTrigger: { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 },
      paramEvents: [],
    };

    render(
      <table>
        <tbody>
          <TrackerRow
            step={0}
            slot={slot}
            isAtPlayhead={false}
            showBeatSeparator={false}
            isCursorRow={false}
            cursorColumn={null}
            onUpdate={onUpdate}
          />
        </tbody>
      </table>,
    );

    // Velocity is now displayed as 0-100 integer
    fireEvent.click(screen.getByText('80'));
    expect(screen.getByDisplayValue('80')).toBeTruthy();
  });

  it('renders empty slots with placeholder dashes', () => {
    const slot: SlotData = {
      noteOrTrigger: null,
      paramEvents: [],
    };

    render(
      <table>
        <tbody>
          <TrackerRow
            step={5}
            slot={slot}
            isAtPlayhead={false}
            showBeatSeparator={false}
            isCursorRow={false}
            cursorColumn={null}
          />
        </tbody>
      </table>,
    );

    // Row number should be zero-padded
    expect(screen.getByText('05')).toBeTruthy();
    // Empty note cell shows ---
    expect(screen.getAllByText('---').length).toBeGreaterThanOrEqual(1);
    // Empty vel/dur cells show --
    expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(2);
  });

  it('shows note names instead of MIDI numbers', () => {
    const slot: SlotData = {
      noteOrTrigger: { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 },
      paramEvents: [],
    };

    render(
      <table>
        <tbody>
          <TrackerRow
            step={0}
            slot={slot}
            isAtPlayhead={false}
            showBeatSeparator={false}
            isCursorRow={false}
            cursorColumn={null}
          />
        </tbody>
      </table>,
    );

    expect(screen.getByText('C-4')).toBeTruthy();
  });

  it('shows parameter events in FX column', () => {
    const slot: SlotData = {
      noteOrTrigger: null,
      paramEvents: [{ kind: 'parameter', at: 3, controlId: 'brightness', value: 0.5 }],
    };

    render(
      <table>
        <tbody>
          <TrackerRow
            step={3}
            slot={slot}
            isAtPlayhead={false}
            showBeatSeparator={false}
            isCursorRow={false}
            cursorColumn={null}
          />
        </tbody>
      </table>,
    );

    expect(screen.getByText('brite 50')).toBeTruthy();
  });
});

describe('parseNoteName', () => {
  it('parses standard note names', () => {
    expect(parseNoteName('C4')).toBe(60);
    expect(parseNoteName('C-4')).toBe(60);
    expect(parseNoteName('c4')).toBe(60);
  });

  it('parses sharps', () => {
    expect(parseNoteName('C#4')).toBe(61);
    expect(parseNoteName('F#3')).toBe(54);
  });

  it('parses flats', () => {
    expect(parseNoteName('Db4')).toBe(61);
    expect(parseNoteName('Gb3')).toBe(54);
  });

  it('handles B- as B natural (Renoise convention)', () => {
    expect(parseNoteName('B-4')).toBe(71);
  });

  it('parses raw MIDI integers', () => {
    expect(parseNoteName('60')).toBe(60);
    expect(parseNoteName('0')).toBe(0);
    expect(parseNoteName('127')).toBe(127);
  });

  it('returns null for invalid input', () => {
    expect(parseNoteName('')).toBeNull();
    expect(parseNoteName('XYZ')).toBeNull();
    expect(parseNoteName('128')).toBeNull();
  });
});
