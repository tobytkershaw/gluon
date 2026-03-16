// src/ui/Tracker.tsx
// Slot-centric tracker grid: one row per step position (Renoise/M8 model).
// The canonical data model (Region.events) is unchanged — this is a projection.
import { useRef, useEffect, useState, useCallback, type MutableRefObject } from 'react';
import type { Region, MusicalEvent, NoteEvent, TriggerEvent, ParameterEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import { TrackerRow, type SlotData, type TrackerColumn } from './TrackerRow';

interface Props {
  region: Region;
  currentStep: number;
  playing: boolean;
  onUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onDelete?: (selector: EventSelector) => void;
  onAddEvent?: (step: number, event: MusicalEvent) => void;
  /** When true, in-progress inline edits should be discarded on blur. */
  cancelEditRef?: MutableRefObject<boolean>;
}

// ---------------------------------------------------------------------------
// Slot projection: map events to step positions
// ---------------------------------------------------------------------------

function buildSlots(region: Region): SlotData[] {
  const patternLength = Math.max(1, Math.floor(region.duration));
  const slots: SlotData[] = Array.from({ length: patternLength }, () => ({
    noteOrTrigger: null,
    paramEvents: [],
  }));

  for (const event of region.events) {
    const step = Math.floor(event.at);
    if (step < 0 || step >= patternLength) continue;

    if (event.kind === 'note' || event.kind === 'trigger') {
      // First note/trigger at this step wins (events are sorted by `at`)
      if (!slots[step].noteOrTrigger) {
        slots[step].noteOrTrigger = event as NoteEvent | TriggerEvent;
      }
    } else if (event.kind === 'parameter') {
      slots[step].paramEvents.push(event as ParameterEvent);
    }
  }

  return slots;
}

// ---------------------------------------------------------------------------
// Column order for keyboard navigation
// ---------------------------------------------------------------------------

const COLUMNS: TrackerColumn[] = ['note', 'vel', 'dur', 'fx'];

export function Tracker({ region, currentStep, playing, onUpdate, onDelete, onAddEvent, cancelEditRef }: Props) {
  const playheadRef = useRef<HTMLTableRowElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cursor state
  const [cursorRow, setCursorRow] = useState(0);
  const [cursorCol, setCursorCol] = useState<TrackerColumn>('note');

  // Build slot data from events
  const slots = buildSlots(region);
  const patternLength = slots.length;

  // Auto-scroll playhead into view
  useEffect(() => {
    if (playing && playheadRef.current) {
      playheadRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentStep, playing]);

  // Cursor movement handler from row clicks
  const handleCursorMove = useCallback((row: number, col: TrackerColumn) => {
    setCursorRow(row);
    setCursorCol(col);
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const colIdx = COLUMNS.indexOf(cursorCol);

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        setCursorRow(r => Math.max(0, r - 1));
        break;
      case 'ArrowDown':
        e.preventDefault();
        setCursorRow(r => Math.min(patternLength - 1, r + 1));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (colIdx > 0) setCursorCol(COLUMNS[colIdx - 1]);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (colIdx < COLUMNS.length - 1) setCursorCol(COLUMNS[colIdx + 1]);
        break;
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        if (!onDelete) break;
        const slot = slots[cursorRow];
        if (slot.noteOrTrigger && (cursorCol === 'note' || cursorCol === 'vel' || cursorCol === 'dur')) {
          const selector: EventSelector = slot.noteOrTrigger.kind === 'parameter'
            ? { at: slot.noteOrTrigger.at, kind: 'parameter', controlId: (slot.noteOrTrigger as unknown as ParameterEvent).controlId }
            : { at: slot.noteOrTrigger.at, kind: slot.noteOrTrigger.kind };
          onDelete(selector);
        } else if (cursorCol === 'fx' && slot.paramEvents.length > 0) {
          const pe = slot.paramEvents[0];
          onDelete({ at: pe.at, kind: 'parameter', controlId: pe.controlId });
        }
        break;
      }
    }
  }, [cursorRow, cursorCol, patternLength, onDelete, slots]);

  // Focus the container to receive keyboard events
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const playheadAt = currentStep % Math.floor(region.duration);

  return (
    <div
      ref={containerRef}
      className="outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <table className="w-full border-collapse select-none font-mono">
        <thead>
          <tr className="text-[9px] text-zinc-600 uppercase tracking-widest sticky top-0 bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-800/50 z-10">
            <th className="px-1.5 py-1 text-right w-10">Row</th>
            <th className="px-1.5 py-1 text-left w-16">Note</th>
            <th className="px-1.5 py-1 text-right w-10">Vel</th>
            <th className="px-1.5 py-1 text-right w-10">Dur</th>
            <th className="px-1.5 py-1 text-left w-20">FX</th>
            {onDelete && <th className="w-6" />}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot, step) => {
            const isAtPlayhead = playing && playheadAt === step;
            const showBeatSeparator = step > 0 && step % 4 === 0;

            return (
              <TrackerRow
                key={step}
                step={step}
                slot={slot}
                isAtPlayhead={isAtPlayhead}
                showBeatSeparator={showBeatSeparator}
                isCursorRow={cursorRow === step}
                cursorColumn={cursorRow === step ? cursorCol : null}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onAddEvent={onAddEvent}
                onCursorMove={handleCursorMove}
                cancelEditRef={cancelEditRef}
                ref={isAtPlayhead ? playheadRef : undefined}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
