// src/ui/Tracker.tsx
import { useRef, useEffect, useMemo, useState, useCallback, type MutableRefObject } from 'react';
import type { Region, MusicalEvent, ParameterEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import { TrackerRow, type AvailableControl, type TrackerColumn } from './TrackerRow';
import { getEngineByIndex, getProcessorInstrument } from '../audio/instrument-registry';
import type { ProcessorConfig } from '../engine/types';

/** Number of rows to jump for Page Up / Page Down. */
const PAGE_JUMP = 8;

/** Number of navigable columns (Pos, Kind, Note/Primary, Val, Dur). */
const COL_COUNT = 5;

/** Clipboard entry: an event with its step offset relative to the selection start. */
interface ClipboardEntry {
  offset: number;
  event: MusicalEvent;
}

interface Props {
  region: Region;
  currentStep: number;
  playing: boolean;
  /** Engine model index for the track (used to derive available controls). */
  engineModel?: number;
  /** Processor chain for the track (used to derive processor controls). */
  processors?: ProcessorConfig[];
  onUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onDelete?: (selector: EventSelector) => void;
  /** Callback to add a new parameter event (for empty FX cell picker). */
  onAddParamEvent?: (at: number, controlId: string, value: number) => void;
  /** Callback to add a note event at a given step. */
  onAddNote?: (step: number) => void;
  /** When true, in-progress inline edits should be discarded on blur. */
  cancelEditRef?: MutableRefObject<boolean>;
  /** Bulk delete events by indices (for cut/delete selection). */
  onDeleteByIndices?: (indices: number[]) => void;
  /** Paste events at a given step position. */
  onPasteEvents?: (events: MusicalEvent[]) => void;
}

/**
 * Show a beat separator when crossing a beat boundary (every 4 steps).
 */
function shouldShowBeatSeparator(event: MusicalEvent, prevEvent: MusicalEvent | null): boolean {
  if (!prevEvent) return false;
  return Math.floor(event.at / 4) > Math.floor(prevEvent.at / 4);
}

/**
 * Stable key for an event row. Uses the canonical dedup invariants:
 * - triggers: unique per position
 * - notes: unique per position (monophonic)
 * - parameters: unique per (position, controlId)
 */
function eventKey(event: MusicalEvent, index: number): string {
  if (event.kind === 'parameter') {
    return `P-${event.at}-${(event as ParameterEvent).controlId}`;
  }
  return `${event.kind[0].toUpperCase()}-${event.at}-${index}`;
}

/**
 * Compute available controls from the engine model and processor chain.
 */
function computeAvailableControls(
  engineModel?: number,
  processors?: ProcessorConfig[],
): AvailableControl[] {
  const controls: AvailableControl[] = [];

  // Source engine controls (Plaits default: brightness, richness, texture, pitch)
  if (engineModel !== undefined) {
    const engine = getEngineByIndex(engineModel);
    if (engine) {
      for (const ctrl of engine.controls) {
        controls.push({ id: ctrl.id, label: ctrl.name });
      }
    }
  }

  // Processor controls
  if (processors) {
    for (const proc of processors) {
      const inst = getProcessorInstrument(proc.type);
      if (inst && inst.engines.length > 0) {
        // Use the processor's current engine mode
        const engine = inst.engines[proc.model] ?? inst.engines[0];
        for (const ctrl of engine.controls) {
          controls.push({
            id: `${proc.type}.${ctrl.id}`,
            label: `${proc.type}:${ctrl.name}`,
          });
        }
      }
    }
  }

  return controls;
}

export function Tracker({ region, currentStep, playing, engineModel, processors, onUpdate, onDelete, onAddParamEvent, onAddNote, cancelEditRef, onDeleteByIndices, onPasteEvents }: Props) {
  const playheadRef = useRef<HTMLTableRowElement>(null);
  const cursorRowRef = useRef<HTMLTableRowElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Cursor state ---
  const [cursorRow, setCursorRow] = useState(0);
  const [cursorCol, setCursorCol] = useState<TrackerColumn>(2); // Start on Note column
  const [editRequestCounter, setEditRequestCounter] = useState(0);

  // --- Selection state ---
  // anchorRow: where the selection started (set on first Shift+Arrow or Shift+Click)
  // When anchorRow is null, there is no active range selection.
  const [anchorRow, setAnchorRow] = useState<number | null>(null);

  // --- Internal clipboard ---
  const [clipboard, setClipboard] = useState<ClipboardEntry[]>([]);

  useEffect(() => {
    if (playing && playheadRef.current) {
      playheadRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentStep, playing]);

  // Scroll cursor row into view when it changes
  useEffect(() => {
    if (cursorRowRef.current) {
      cursorRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [cursorRow]);

  const events = region.events;
  const playheadAt = currentStep % region.duration;
  const eventCount = events.length;

  // Clamp cursor row when events change (e.g. deletion)
  useEffect(() => {
    if (eventCount > 0 && cursorRow >= eventCount) {
      setCursorRow(eventCount - 1);
    }
  }, [eventCount, cursorRow]);

  // Compute next available step for the add button
  const nextStep = useMemo(() => {
    if (events.length === 0) return 0;
    const lastAt = events[events.length - 1].at;
    return Math.floor(lastAt) + 1;
  }, [events]);

  const availableControls = useMemo(
    () => computeAvailableControls(engineModel, processors),
    [engineModel, processors],
  );

  // --- Selection helpers ---

  /** Compute the [minRow, maxRow] range of the current selection. */
  const getSelectionRange = useCallback((): [number, number] | null => {
    if (anchorRow === null) return null;
    const lo = Math.min(anchorRow, cursorRow);
    const hi = Math.max(anchorRow, cursorRow);
    return [lo, hi];
  }, [anchorRow, cursorRow]);

  /** Get all row indices in the current selection (or just cursor row if no range). */
  const getSelectedIndices = useCallback((): number[] => {
    const range = getSelectionRange();
    if (range) {
      const [lo, hi] = range;
      const indices: number[] = [];
      for (let i = lo; i <= hi; i++) indices.push(i);
      return indices;
    }
    return [cursorRow];
  }, [getSelectionRange, cursorRow]);

  /** Copy events at given indices to internal clipboard. */
  const copyToClipboard = useCallback((indices: number[]) => {
    if (indices.length === 0 || eventCount === 0) return;
    const baseAt = events[indices[0]].at;
    const entries: ClipboardEntry[] = indices
      .filter(i => i >= 0 && i < eventCount)
      .map(i => ({
        offset: events[i].at - baseAt,
        event: { ...events[i] },
      }));
    setClipboard(entries);
  }, [events, eventCount]);

  /** Build paste events from clipboard, offset to the cursor's event position. */
  const buildPasteEvents = useCallback((): MusicalEvent[] => {
    if (clipboard.length === 0 || eventCount === 0) return [];
    const targetAt = cursorRow < eventCount ? events[cursorRow].at : 0;
    return clipboard.map(entry => ({
      ...entry.event,
      at: Math.max(0, targetAt + entry.offset),
    }));
  }, [clipboard, cursorRow, events, eventCount]);

  // --- Keyboard handler ---
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (eventCount === 0) return;

    // Don't intercept when an input element is focused (inline editing)
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const isMod = e.metaKey || e.ctrlKey;

    // --- Clipboard operations (Cmd/Ctrl + C/X/V) ---
    if (isMod && e.key === 'c') {
      e.preventDefault();
      copyToClipboard(getSelectedIndices());
      return;
    }
    if (isMod && e.key === 'x') {
      e.preventDefault();
      const indices = getSelectedIndices();
      copyToClipboard(indices);
      if (onDeleteByIndices) {
        onDeleteByIndices(indices);
        setAnchorRow(null);
      }
      return;
    }
    if (isMod && e.key === 'v') {
      e.preventDefault();
      if (onPasteEvents) {
        const pasteEvents = buildPasteEvents();
        if (pasteEvents.length > 0) {
          onPasteEvents(pasteEvents);
        }
      }
      return;
    }
    // Select all (Cmd/Ctrl + A)
    if (isMod && e.key === 'a') {
      e.preventDefault();
      setAnchorRow(0);
      setCursorRow(eventCount - 1);
      return;
    }

    switch (e.key) {
      case 'ArrowUp': {
        e.preventDefault();
        if (e.shiftKey) {
          // Extend selection upward
          if (anchorRow === null) setAnchorRow(cursorRow);
          setCursorRow(r => Math.max(0, r - 1));
        } else {
          setAnchorRow(null);
          setCursorRow(r => Math.max(0, r - 1));
        }
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        if (e.shiftKey) {
          if (anchorRow === null) setAnchorRow(cursorRow);
          setCursorRow(r => Math.min(eventCount - 1, r + 1));
        } else {
          setAnchorRow(null);
          setCursorRow(r => Math.min(eventCount - 1, r + 1));
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        setCursorCol(c => Math.max(0, c - 1) as TrackerColumn);
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        setCursorCol(c => Math.min(COL_COUNT - 1, c + 1) as TrackerColumn);
        break;
      }
      case 'PageUp': {
        e.preventDefault();
        if (e.shiftKey) {
          if (anchorRow === null) setAnchorRow(cursorRow);
        } else {
          setAnchorRow(null);
        }
        setCursorRow(r => Math.max(0, r - PAGE_JUMP));
        break;
      }
      case 'PageDown': {
        e.preventDefault();
        if (e.shiftKey) {
          if (anchorRow === null) setAnchorRow(cursorRow);
        } else {
          setAnchorRow(null);
        }
        setCursorRow(r => Math.min(eventCount - 1, r + PAGE_JUMP));
        break;
      }
      case 'Home': {
        e.preventDefault();
        if (e.shiftKey) {
          if (anchorRow === null) setAnchorRow(cursorRow);
        } else {
          setAnchorRow(null);
        }
        setCursorRow(0);
        break;
      }
      case 'End': {
        e.preventDefault();
        if (e.shiftKey) {
          if (anchorRow === null) setAnchorRow(cursorRow);
        } else {
          setAnchorRow(null);
        }
        setCursorRow(eventCount - 1);
        break;
      }
      case 'Tab': {
        // Tab cycles columns forward, Shift+Tab cycles backward
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          setCursorCol(c => (c === 0 ? (COL_COUNT - 1) as TrackerColumn : (c - 1) as TrackerColumn));
        } else {
          setCursorCol(c => (c === COL_COUNT - 1 ? 0 as TrackerColumn : (c + 1) as TrackerColumn));
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        // Trigger editing on the current cursor cell
        setEditRequestCounter(c => c + 1);
        break;
      }
      case 'Escape': {
        // Clear selection
        if (anchorRow !== null) {
          e.preventDefault();
          setAnchorRow(null);
        }
        break;
      }
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        const indices = getSelectedIndices();
        if (anchorRow !== null && onDeleteByIndices && indices.length > 0) {
          // Bulk delete selection
          onDeleteByIndices(indices);
          setAnchorRow(null);
        } else if (onDelete && eventCount > 0 && cursorRow < eventCount) {
          // Single delete at cursor
          const event = events[cursorRow];
          const selector = event.kind === 'parameter'
            ? { at: event.at, kind: 'parameter' as const, controlId: (event as ParameterEvent).controlId }
            : { at: event.at, kind: event.kind as 'note' | 'trigger' };
          onDelete(selector);
        }
        break;
      }
      default:
        // Don't prevent default for keys we don't handle
        return;
    }
  }, [eventCount, cursorRow, anchorRow, events, onDelete, onDeleteByIndices, onPasteEvents, copyToClipboard, getSelectedIndices, buildPasteEvents]);

  /** Handle row click — set cursor, optionally extend selection with Shift. */
  const handleRowClick = useCallback((rowIndex: number, shiftKey: boolean) => {
    if (shiftKey) {
      if (anchorRow === null) setAnchorRow(cursorRow);
      setCursorRow(rowIndex);
    } else {
      setAnchorRow(null);
      setCursorRow(rowIndex);
    }
    // Re-focus the container so keyboard shortcuts continue to work
    containerRef.current?.focus();
  }, [anchorRow, cursorRow]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="outline-none h-full"
    >
      <table className="w-full border-collapse select-none">
        <thead>
          <tr className="text-[9px] text-zinc-600 uppercase tracking-widest sticky top-0 bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-800/50">
            <th className="px-1.5 py-1 text-right w-[3.5rem]">Pos</th>
            <th className="px-1 py-1 text-center w-6"></th>
            <th className="px-1.5 py-1 text-left w-[3.5rem]">Note</th>
            <th className="px-1.5 py-1 text-right w-12">Val</th>
            <th className="px-1.5 py-1 text-right w-12">Dur</th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 ? (
            onAddNote ? (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-center">
                  <button
                    className="text-[10px] text-zinc-500 hover:text-amber-400 transition-colors"
                    onClick={() => onAddNote(0)}
                    title="Add note at step 0"
                  >
                    + add note
                  </button>
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-center text-[10px] text-zinc-600 italic">
                  ---
                </td>
              </tr>
            )
          ) : (
            <>
              {events.map((event, i) => {
                const nextAt = i < events.length - 1 ? events[i + 1].at : region.duration;
                const isAtPlayhead = playing && playheadAt >= event.at && playheadAt < nextAt;
                const isCursorRow = i === cursorRow;
                const selRange = getSelectionRange();
                const isSelected = selRange !== null && i >= selRange[0] && i <= selRange[1];

                return (
                  <TrackerRow
                    key={eventKey(event, i)}
                    event={event}
                    isAtPlayhead={isAtPlayhead}
                    showBeatSeparator={shouldShowBeatSeparator(event, i > 0 ? events[i - 1] : null)}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    availableControls={availableControls}
                    onAddParamEvent={onAddParamEvent}
                    cancelEditRef={cancelEditRef}
                    isCursorRow={isCursorRow}
                    cursorColumn={cursorCol}
                    editRequestCounter={isCursorRow ? editRequestCounter : undefined}
                    isSelected={isSelected}
                    onRowClick={(shiftKey) => handleRowClick(i, shiftKey)}
                    ref={isCursorRow ? cursorRowRef : (isAtPlayhead ? playheadRef : undefined)}
                  />
                );
              })}
              {onAddNote && (
                <tr>
                  <td colSpan={5} className="px-4 py-1.5 text-center">
                    <button
                      className="text-[10px] text-zinc-600 hover:text-amber-400 transition-colors"
                      onClick={() => onAddNote(nextStep)}
                      title={`Add note at step ${nextStep}`}
                    >
                      + add note
                    </button>
                  </td>
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
