import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrackerRow } from '../../src/ui/TrackerRow';
import type { SlotRow, FxColumnDef } from '../../src/ui/Tracker';
import type { NoteEvent, ParameterEvent } from '../../src/engine/canonical-types';

/** Helper to build a minimal SlotRow for testing. */
function makeSlot(overrides: Partial<SlotRow> = {}): SlotRow {
  return {
    step: 0,
    notes: [],
    fxValues: new Map(),
    allEvents: [],
    eventIndices: [],
    hasGate: false,
    ...overrides,
  };
}

describe('TrackerRow', () => {
  it('renders an empty slot row with --- placeholders', () => {
    render(
      <table>
        <tbody>
          <TrackerRow
            slot={makeSlot({ step: 3 })}
            maxNoteColumns={1}
            fxColumns={[]}
            isAtPlayhead={false}
            showBeatSeparator={false}
          />
        </tbody>
      </table>,
    );

    // Should show position and --- for the empty note column
    expect(screen.getByText('---')).toBeTruthy();
  });

  it('renders a note event and allows editing velocity', () => {
    const onUpdate = vi.fn();
    const note: NoteEvent = { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 };

    render(
      <table>
        <tbody>
          <TrackerRow
            slot={makeSlot({
              step: 0,
              notes: [note],
              allEvents: [note],
              eventIndices: [0],
              hasGate: true,
            })}
            maxNoteColumns={1}
            fxColumns={[]}
            isAtPlayhead={false}
            showBeatSeparator={false}
            onUpdate={onUpdate}
          />
        </tbody>
      </table>,
    );

    // Should show note name C-4
    expect(screen.getByText('C-4')).toBeTruthy();

    // Click on velocity to edit
    fireEvent.click(screen.getByText('0.80'));
    expect(screen.getByDisplayValue('0.80')).toBeTruthy();
  });

  it('renders FX columns for parameter events', () => {
    const paramEvent: ParameterEvent = {
      kind: 'parameter', at: 0, controlId: 'timbre', value: 0.5,
    };
    const fxValues = new Map<string, ParameterEvent>();
    fxValues.set('timbre', paramEvent);

    const fxColumns: FxColumnDef[] = [{ controlId: 'timbre', label: 'TBR' }];

    render(
      <table>
        <tbody>
          <TrackerRow
            slot={makeSlot({
              step: 0,
              fxValues,
              allEvents: [paramEvent],
              eventIndices: [0],
            })}
            maxNoteColumns={1}
            fxColumns={fxColumns}
            isAtPlayhead={false}
            showBeatSeparator={false}
          />
        </tbody>
      </table>,
    );

    // FX value should be displayed as a compact 2-digit number (0.5 * 99 = ~50)
    expect(screen.getByText('50')).toBeTruthy();
  });

  it('shows empty FX cells as clickable placeholders', () => {
    const onAddParamEvent = vi.fn();
    const fxColumns: FxColumnDef[] = [{ controlId: 'timbre', label: 'TBR' }];

    render(
      <table>
        <tbody>
          <TrackerRow
            slot={makeSlot({ step: 2 })}
            maxNoteColumns={1}
            fxColumns={fxColumns}
            isAtPlayhead={false}
            showBeatSeparator={false}
            onAddParamEvent={onAddParamEvent}
          />
        </tbody>
      </table>,
    );

    // Click on the empty FX cell
    const placeholder = screen.getByText('..');
    fireEvent.click(placeholder);

    expect(onAddParamEvent).toHaveBeenCalledWith(2, 'timbre', 0.5);
  });

  it('builds a slot-based grid with fixed row count', async () => {
    // This tests the full Tracker component integration
    const { Tracker } = await import('../../src/ui/Tracker');
    const note: NoteEvent = { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 };

    render(
      <Tracker
        region={{
          id: 'p0',
          kind: 'pattern',
          duration: 4,
          events: [note],
        }}
        playheadStep={null}
        playing={false}
      />,
    );

    // Should have 4 rows (one per step), with the note at step 0
    // The note at step 0 shows 'C-4', other rows show '---'
    const dashes = screen.getAllByText('---');
    expect(dashes.length).toBe(3); // steps 1, 2, 3 are empty
    expect(screen.getByText('C-4')).toBeTruthy();
  });

  it('derives FX columns from parameter events in the pattern', async () => {
    const { Tracker } = await import('../../src/ui/Tracker');
    const note: NoteEvent = { kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 };
    const param: ParameterEvent = { kind: 'parameter', at: 0, controlId: 'timbre', value: 0.75 };

    render(
      <Tracker
        region={{
          id: 'p0',
          kind: 'pattern',
          duration: 4,
          events: [note, param],
        }}
        playheadStep={null}
        playing={false}
      />,
    );

    // FX column header should be visible
    expect(screen.getByText('TBR')).toBeTruthy();
    // FX value should be displayed (0.75 * 99 = ~74)
    expect(screen.getByText('74')).toBeTruthy();
  });
});
