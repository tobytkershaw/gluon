// src/ui/Tracker.tsx
import { useRef, useEffect, useMemo, useState, useCallback, type MutableRefObject } from 'react';
import type { Region, MusicalEvent, NoteEvent, ParameterEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import { TrackerRow, type AvailableControl, type TrackerColumn } from './TrackerRow';
import { getEngineByIndex, getProcessorInstrument } from '../audio/instrument-registry';
import type { ProcessorConfig } from '../engine/types';

/** Number of rows to jump for Page Up / Page Down. */
const PAGE_JUMP = 8;

/** Maximum note columns per step (Renoise-style polyphony limit). */
const MAX_NOTE_COLUMNS = 4;

/** Clipboard entry: an event with its step offset relative to the selection start. */
interface ClipboardEntry {
  offset: number;
  event: MusicalEvent;
}

/**
 * A step group: all events at the same step position, with notes split into columns.
 * This is the unit of rendering — one step group = one visual row in the tracker.
 */
interface StepGroup {
  /** The step position (event.at). */
  at: number;
  /** Note events sorted by pitch, assigned to columns 0..N-1. */
  notes: (NoteEvent | null)[];
  /** Non-note events (triggers, parameters) at this step. */
  otherEvents: MusicalEvent[];
  /** All events at this step, in their original order from the region. */
  allEvents: MusicalEvent[];
  /** Indices into the flat region.events array for all events in this group. */
  eventIndices: number[];
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
  /** Transport-level loop region (step range). */
  loopEnabled?: boolean;
  loopStart?: number;
  loopEnd?: number;
}

const AT_TOLERANCE = 0.001;

function sameAt(a: number, b: number): boolean {
  return Math.abs(a - b) < AT_TOLERANCE;
}

/**
 * Group region events by step position into StepGroups.
 * Notes at the same step are split into columns (sorted by pitch).
 * Returns { groups, maxNoteColumns }.
 */
function buildStepGroups(events: MusicalEvent[]): { groups: StepGroup[]; maxNoteColumns: number } {
  if (events.length === 0) return { groups: [], maxNoteColumns: 1 };

  const groups: StepGroup[] = [];
  let maxNoteColumns = 1;

  let i = 0;
  while (i < events.length) {
    const at = events[i].at;
    const allEvents: MusicalEvent[] = [];
    const eventIndices: number[] = [];
    const notes: NoteEvent[] = [];
    const otherEvents: MusicalEvent[] = [];

    // Collect all events at this position
    while (i < events.length && sameAt(events[i].at, at)) {
      allEvents.push(events[i]);
      eventIndices.push(i);
      if (events[i].kind === 'note') {
        notes.push(events[i] as NoteEvent);
      } else {
        otherEvents.push(events[i]);
      }
      i++;
    }

    // Sort notes by pitch for stable column assignment
    notes.sort((a, b) => a.pitch - b.pitch);
    const columnCount = Math.min(notes.length, MAX_NOTE_COLUMNS);
    if (columnCount > maxNoteColumns) maxNoteColumns = columnCount;

    // Pad notes array to column count (null for empty columns)
    const paddedNotes: (NoteEvent | null)[] = [];
    for (let c = 0; c < columnCount; c++) {
      paddedNotes.push(c < notes.length ? notes[c] : null);
    }

    groups.push({ at, notes: paddedNotes, otherEvents, allEvents, eventIndices });
  }

  return { groups, maxNoteColumns };
}

/**
 * Show a beat separator when crossing a beat boundary (every 4 steps).
 */
function shouldShowBeatSeparator(currentAt: number, prevAt: number | null): boolean {
  if (prevAt === null) return false;
  return Math.floor(currentAt / 4) > Math.floor(prevAt / 4);
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

/**
 * Compute the number of navigable columns based on note column count.
 * Layout: Pos | Kind | [NoteCol1 | NoteCol2 | ...] | Val | Dur
 * For TrackerRow compatibility, we pass the "primary" event (first note or trigger/param).
 */
function getColCount(noteColumns: number): number {
  // Pos(0) + Kind(1) + noteColumns + Val + Dur
  return 2 + noteColumns + 2;
}

export function Tracker({ region, currentStep, playing, engineModel, processors, onUpdate, onDelete, onAddParamEvent, onAddNote, cancelEditRef, onDeleteByIndices, onPasteEvents, loopEnabled, loopStart, loopEnd }: Props) {
  const playheadRef = useRef<HTMLTableRowElement>(null);
  const cursorRowRef = useRef<HTMLTableRowElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Cursor state ---
  // cursorRow indexes into stepGroups (not flat events)
  const [cursorRow, setCursorRow] = useState(0);
  const [cursorCol, setCursorCol] = useState<number>(2); // Start on first Note column
  const [editRequestCounter, setEditRequestCounter] = useState(0);

  // --- Selection state ---
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

  // Build step groups and determine column count
  const { groups, maxNoteColumns } = useMemo(() => buildStepGroups(events), [events]);
  const groupCount = groups.length;
  const colCount = getColCount(maxNoteColumns);

  // Clamp cursor row when groups change (e.g. deletion)
  useEffect(() => {
    if (groupCount > 0 && cursorRow >= groupCount) {
      setCursorRow(groupCount - 1);
    }
  }, [groupCount, cursorRow]);

  // Clamp cursor column when note columns change
  useEffect(() => {
    if (cursorCol >= colCount) {
      setCursorCol(colCount - 1);
    }
  }, [colCount, cursorCol]);

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

  const getSelectionRange = useCallback((): [number, number] | null => {
    if (anchorRow === null) return null;
    const lo = Math.min(anchorRow, cursorRow);
    const hi = Math.max(anchorRow, cursorRow);
    return [lo, hi];
  }, [anchorRow, cursorRow]);

  /** Get all flat event indices for the selected step groups. */
  const getSelectedEventIndices = useCallback((): number[] => {
    const range = getSelectionRange();
    if (range) {
      const [lo, hi] = range;
      const indices: number[] = [];
      for (let i = lo; i <= hi; i++) {
        if (i < groups.length) {
          indices.push(...groups[i].eventIndices);
        }
      }
      return indices;
    }
    if (cursorRow < groups.length) {
      return [...groups[cursorRow].eventIndices];
    }
    return [];
  }, [getSelectionRange, cursorRow, groups]);

  /** Copy events from selected step groups to internal clipboard. */
  const copyToClipboard = useCallback((indices: number[]) => {
    if (indices.length === 0 || events.length === 0) return;
    const baseAt = events[indices[0]].at;
    const entries: ClipboardEntry[] = indices
      .filter(i => i >= 0 && i < events.length)
      .map(i => ({
        offset: events[i].at - baseAt,
        event: { ...events[i] },
      }));
    setClipboard(entries);
  }, [events]);

  /** Build paste events from clipboard, offset to the cursor's step position. */
  const buildPasteEvents = useCallback((): MusicalEvent[] => {
    if (clipboard.length === 0 || groups.length === 0) return [];
    const targetAt = cursorRow < groups.length ? groups[cursorRow].at : 0;
    return clipboard.map(entry => ({
      ...entry.event,
      at: Math.max(0, targetAt + entry.offset),
    }));
  }, [clipboard, cursorRow, groups]);

  // --- Determine which note column the cursor is on (if any) ---
  // Columns: 0=Pos, 1=Kind, 2..2+maxNoteColumns-1=NoteColumns, 2+maxNoteColumns=Val, 2+maxNoteColumns+1=Dur
  const getNoteColumnIndex = useCallback((col: number): number | null => {
    if (col >= 2 && col < 2 + maxNoteColumns) return col - 2;
    return null;
  }, [maxNoteColumns]);

  // Map cursorCol to TrackerRow column type for the primary event rendering
  const getTrackerColumn = useCallback((col: number): TrackerColumn => {
    if (col === 0) return 0; // Pos
    if (col === 1) return 1; // Kind
    if (col >= 2 && col < 2 + maxNoteColumns) return 2; // Note (any note column)
    if (col === 2 + maxNoteColumns) return 3; // Val
    if (col === 2 + maxNoteColumns + 1) return 4; // Dur
    return 2;
  }, [maxNoteColumns]);

  // --- Keyboard handler ---
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (groupCount === 0) return;

    // Don't intercept when an input element is focused (inline editing)
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const isMod = e.metaKey || e.ctrlKey;

    // --- Clipboard operations (Cmd/Ctrl + C/X/V) ---
    if (isMod && e.key === 'c') {
      e.preventDefault();
      copyToClipboard(getSelectedEventIndices());
      return;
    }
    if (isMod && e.key === 'x') {
      e.preventDefault();
      const indices = getSelectedEventIndices();
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
      setCursorRow(groupCount - 1);
      return;
    }

    switch (e.key) {
      case 'ArrowUp': {
        e.preventDefault();
        if (e.shiftKey) {
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
          setCursorRow(r => Math.min(groupCount - 1, r + 1));
        } else {
          setAnchorRow(null);
          setCursorRow(r => Math.min(groupCount - 1, r + 1));
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        setCursorCol(c => Math.max(0, c - 1));
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        setCursorCol(c => Math.min(colCount - 1, c + 1));
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
        setCursorRow(r => Math.min(groupCount - 1, r + PAGE_JUMP));
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
        setCursorRow(groupCount - 1);
        break;
      }
      case 'Tab': {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          setCursorCol(c => (c === 0 ? colCount - 1 : c - 1));
        } else {
          setCursorCol(c => (c === colCount - 1 ? 0 : c + 1));
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        setEditRequestCounter(c => c + 1);
        break;
      }
      case 'Escape': {
        if (anchorRow !== null) {
          e.preventDefault();
          setAnchorRow(null);
        }
        break;
      }
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        const eventIndices = getSelectedEventIndices();
        if (anchorRow !== null && onDeleteByIndices && eventIndices.length > 0) {
          onDeleteByIndices(eventIndices);
          setAnchorRow(null);
        } else if (onDelete && groupCount > 0 && cursorRow < groupCount) {
          const group = groups[cursorRow];
          // If cursor is on a specific note column, delete just that note
          const noteColIdx = getNoteColumnIndex(cursorCol);
          if (noteColIdx !== null && noteColIdx < group.notes.length && group.notes[noteColIdx]) {
            const note = group.notes[noteColIdx]!;
            const selector: EventSelector = { at: note.at, kind: 'note' as const, pitch: note.pitch };
            onDelete(selector);
          } else if (group.allEvents.length > 0) {
            // Delete the primary event of the group
            const event = group.allEvents[0];
            let selector: EventSelector;
            if (event.kind === 'parameter') {
              selector = { at: event.at, kind: 'parameter' as const, controlId: (event as ParameterEvent).controlId };
            } else if (event.kind === 'note') {
              selector = { at: event.at, kind: 'note' as const, pitch: (event as NoteEvent).pitch };
            } else {
              selector = { at: event.at, kind: 'trigger' as const };
            }
            onDelete(selector);
          }
        }
        break;
      }
      default:
        return;
    }
  }, [groupCount, cursorRow, cursorCol, anchorRow, groups, onDelete, onDeleteByIndices, onPasteEvents, copyToClipboard, getSelectedEventIndices, buildPasteEvents, colCount, getNoteColumnIndex]);

  /** Handle row click — set cursor, optionally extend selection with Shift. */
  const handleRowClick = useCallback((rowIndex: number, shiftKey: boolean) => {
    if (shiftKey) {
      if (anchorRow === null) setAnchorRow(cursorRow);
      setCursorRow(rowIndex);
    } else {
      setAnchorRow(null);
      setCursorRow(rowIndex);
    }
    containerRef.current?.focus();
  }, [anchorRow, cursorRow]);

  // Build note column headers
  const noteColumnHeaders = useMemo(() => {
    const headers: React.ReactNode[] = [];
    for (let c = 0; c < maxNoteColumns; c++) {
      headers.push(
        <th key={`note-${c}`} className="px-1.5 py-1 text-left w-[3.5rem]">
          {maxNoteColumns > 1 ? `N${c + 1}` : 'Note'}
        </th>
      );
    }
    return headers;
  }, [maxNoteColumns]);

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
            {noteColumnHeaders}
            <th className="px-1.5 py-1 text-right w-12">Val</th>
            <th className="px-1.5 py-1 text-right w-12">Dur</th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 ? (
            onAddNote ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-3 text-center">
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
                <td colSpan={colCount} className="px-4 py-3 text-center text-[10px] text-zinc-600 italic">
                  ---
                </td>
              </tr>
            )
          ) : (
            <>
              {groups.map((group, gi) => {
                const nextAt = gi < groups.length - 1 ? groups[gi + 1].at : region.duration;
                const isAtPlayhead = playing && playheadAt >= group.at && playheadAt < nextAt;
                const isCursor = gi === cursorRow;
                const selRange = getSelectionRange();
                const isSelected = selRange !== null && gi >= selRange[0] && gi <= selRange[1];
                const showBeatSep = shouldShowBeatSeparator(group.at, gi > 0 ? groups[gi - 1].at : null);
                const isInLoop = loopEnabled === true
                  && loopStart != null && loopEnd != null
                  && group.at >= loopStart && group.at < loopEnd;

                // The "primary" event for the row is the first note (if any) or the first other event
                const primaryEvent = group.notes.find(n => n !== null) ?? group.otherEvents[0] ?? group.allEvents[0];
                if (!primaryEvent) return null;

                // Map cursor column to TrackerRow column for the primary event
                const trackerCol = getTrackerColumn(cursorCol);

                return (
                  <TrackerRow
                    key={`step-${group.at}`}
                    event={primaryEvent}
                    noteColumns={group.notes}
                    maxNoteColumns={maxNoteColumns}
                    cursorNoteColumn={isCursor ? getNoteColumnIndex(cursorCol) : null}
                    isAtPlayhead={isAtPlayhead}
                    showBeatSeparator={showBeatSep}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    availableControls={availableControls}
                    onAddParamEvent={onAddParamEvent}
                    cancelEditRef={cancelEditRef}
                    isCursorRow={isCursor}
                    cursorColumn={trackerCol}
                    editRequestCounter={isCursor ? editRequestCounter : undefined}
                    isSelected={isSelected}
                    isInLoop={isInLoop}
                    onRowClick={(shiftKey) => handleRowClick(gi, shiftKey)}
                    ref={isCursor ? cursorRowRef : (isAtPlayhead ? playheadRef : undefined)}
                  />
                );
              })}
              {onAddNote && (
                <tr>
                  <td colSpan={colCount} className="px-4 py-1.5 text-center">
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
