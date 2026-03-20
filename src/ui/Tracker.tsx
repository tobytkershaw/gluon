// src/ui/Tracker.tsx
import { useRef, useEffect, useMemo, useState, useCallback, type MutableRefObject } from 'react';
import type { Pattern, MusicalEvent, NoteEvent, ParameterEvent, TriggerEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import { TrackerRow } from './TrackerRow';
import { keyToMidi, isPianoKey, BASE_MIDI_LOWER, OCTAVE } from './keyboard-piano-map';

/** Number of rows to jump for Page Up / Page Down. */
const PAGE_JUMP = 8;

/** Maximum note columns per step (Renoise-style polyphony limit). */
const MAX_NOTE_COLUMNS = 4;

/** Clipboard entry: an event with its step offset relative to the selection start. */
interface ClipboardEntry {
  offset: number;
  event: MusicalEvent;
}

/** FX column definition: one per unique controlId found in the pattern's parameter events. */
export interface FxColumnDef {
  controlId: string;
  label: string;
  fullName: string;
}

/**
 * A slot: one row per integer step position (0 to pattern.length - 1).
 * Empty steps have no events but are still rendered as rows with placeholders.
 */
export interface SlotRow {
  /** The integer step position (row index). */
  step: number;
  /** Note events sorted by pitch, assigned to columns 0..N-1. Null for empty. */
  notes: (NoteEvent | null)[];
  /** Parameter events at this step, keyed by controlId. */
  fxValues: Map<string, ParameterEvent>;
  /** All events at this step (notes + params + triggers), original order. */
  allEvents: MusicalEvent[];
  /** Indices into the flat pattern.events array for all events at this step. */
  eventIndices: number[];
  /** Whether this step has any note/trigger (gate-bearing) events. */
  hasGate: boolean;
}

interface Props {
  region: Pattern;
  /** Current playhead step (integer), or null when the playhead is in a different pattern (song mode). */
  playheadStep: number | null;
  playing: boolean;
  onUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onDelete?: (selector: EventSelector) => void;
  /** Callback to add a new parameter event (for empty FX cell picker). */
  onAddParamEvent?: (at: number, controlId: string, value: number) => void;
  /** Callback to add a note event at a given step, optionally with a specific pitch. */
  onAddNote?: (step: number, pitch?: number) => void;
  /** When true, in-progress inline edits should be discarded on blur. */
  cancelEditRef?: MutableRefObject<boolean>;
  /** Bulk delete events by indices (for cut/delete selection). */
  onDeleteByIndices?: (indices: number[]) => void;
  /** Paste events at a given step position. */
  onPasteEvents?: (events: MusicalEvent[]) => void;
  /** Transpose events at the given indices by semitones (for selection transpose). */
  onTransposeByIndices?: (indices: number[], semitones: number) => void;
  /** Report cursor step position changes (for play-from-cursor). */
  onCursorStepChange?: (step: number) => void;
  /** Steps per beat for beat separators (derived from time signature). Default: 4. */
  stepsPerBeat?: number;
  /** Called when a note cell is hovered (pitch) or unhovered (null). */
  onNotePreview?: (pitch: number | null) => void;
  /** Called when a row is double-clicked (play-from-row). */
  onPlayFromRow?: (step: number) => void;
  /** Called when the selection range changes. stepRange is [lo, hi] inclusive, eventIndices are flat indices into region.events. Null when no selection. */
  onSelectionChange?: (selection: { stepRange: [number, number]; eventIndices: number[] } | null) => void;
}

/**
 * Build a slot-based grid: one SlotRow per integer step (0..duration-1).
 * Events are grouped into their nearest integer step.
 * Notes are separated from parameter events; triggers are treated as notes.
 * Returns { slots, maxNoteColumns, fxColumns }.
 *
 * Note: the slot model does not support inline position editing — event
 * repositioning is handled via delete + add-at-new-step. This is a deliberate
 * trade-off for the simpler, more robust grid-based display.
 */
function buildSlotGrid(events: MusicalEvent[], duration: number): {
  slots: SlotRow[];
  maxNoteColumns: number;
  fxColumns: FxColumnDef[];
} {
  const stepCount = Math.max(1, Math.ceil(duration));

  // Initialize empty slots
  const slots: SlotRow[] = Array.from({ length: stepCount }, (_, i) => ({
    step: i,
    notes: [],
    fxValues: new Map(),
    allEvents: [],
    eventIndices: [],
    hasGate: false,
  }));

  let maxNoteColumns = 1;
  const fxControlIds = new Set<string>();

  // Assign events to their nearest integer step
  for (let ei = 0; ei < events.length; ei++) {
    const event = events[ei];
    const step = Math.floor(event.at);
    if (step < 0 || step >= stepCount) continue;

    const slot = slots[step];
    slot.allEvents.push(event);
    slot.eventIndices.push(ei);

    if (event.kind === 'note') {
      slot.notes.push(event as NoteEvent);
      slot.hasGate = true;
    } else if (event.kind === 'trigger') {
      // Treat triggers as gate-bearing but don't add them to note columns.
      // velocity=0 sentinels (note-off) should not count as active gates.
      if ((event as TriggerEvent).velocity !== 0) slot.hasGate = true;
    } else if (event.kind === 'parameter') {
      const pe = event as ParameterEvent;
      slot.fxValues.set(pe.controlId, pe);
      fxControlIds.add(pe.controlId);
    }
  }

  // Sort notes by pitch within each slot and compute maxNoteColumns
  for (const slot of slots) {
    slot.notes.sort((a, b) => (a?.pitch ?? 0) - (b?.pitch ?? 0));
    const noteCount = Math.min(slot.notes.length, MAX_NOTE_COLUMNS);
    if (noteCount > maxNoteColumns) maxNoteColumns = noteCount;
  }

  // Pad notes to the max column count
  for (const slot of slots) {
    const padded: (NoteEvent | null)[] = [];
    for (let c = 0; c < maxNoteColumns; c++) {
      padded.push(c < slot.notes.length ? slot.notes[c] : null);
    }
    slot.notes = padded;
  }

  // Build FX column definitions from all unique controlIds
  const fxColumns: FxColumnDef[] = Array.from(fxControlIds).sort().map(controlId => ({
    controlId,
    label: abbreviateControlId(controlId),
    fullName: humanizeControlId(controlId),
  }));

  return { slots, maxNoteColumns, fxColumns };
}

/** Abbreviate a controlId for FX column headers (max 5 chars). */
function abbreviateControlId(controlId: string): string {
  const abbrevs: Record<string, string> = {
    timbre: 'TBR', harmonics: 'HRM', morph: 'MRP',
    frequency: 'FRQ', decay: 'DEC', note: 'NTE',
    brightness: 'BRT', position: 'POS', damping: 'DMP',
    structure: 'STR', texture: 'TXT',
  };
  // Handle dotted paths like "rings.position"
  const parts = controlId.split('.');
  const lastPart = parts[parts.length - 1];
  return abbrevs[lastPart] ?? lastPart.slice(0, 3).toUpperCase();
}

/** Return a human-readable name for a controlId (used in tooltips). */
function humanizeControlId(controlId: string): string {
  const parts = controlId.split('.');
  const lastPart = parts[parts.length - 1];
  return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
}

/**
 * Show a beat separator when crossing a beat boundary.
 * stepsPerBeat defaults to 4 (quarter notes in standard 16th-note grid).
 */
function shouldShowBeatSeparator(step: number, stepsPerBeat = 4): boolean {
  if (step === 0) return false;
  return step % stepsPerBeat === 0;
}


/**
 * Compute total navigable columns.
 * Layout: Pos | [Ch1 | Ch2 | ...] | Vel | Dur | [FX1 | FX2 | ...]
 */
function getColCount(noteColumns: number, fxColumns: number): number {
  // Pos(0) + noteColumns + Vel + Dur + fxColumns
  return 1 + noteColumns + 2 + fxColumns;
}

export function Tracker({ region, playheadStep, playing, onUpdate, onDelete, onAddParamEvent, onAddNote, cancelEditRef, onDeleteByIndices, onPasteEvents, onTransposeByIndices, onCursorStepChange, stepsPerBeat = 4, onNotePreview, onPlayFromRow, onSelectionChange }: Props) {
  const playheadRef = useRef<HTMLTableRowElement>(null);
  const cursorRowRef = useRef<HTMLTableRowElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Cursor state ---
  // cursorRow indexes into slots (step index)
  const [cursorRow, setCursorRow] = useState(0);
  const [cursorCol, setCursorCol] = useState<number>(1); // Start on first note column (Ch1)
  const [editRequestCounter, setEditRequestCounter] = useState(0);

  // --- Selection state ---
  const [anchorRow, setAnchorRow] = useState<number | null>(null);

  // --- Internal clipboard ---
  const [clipboard, setClipboard] = useState<ClipboardEntry[]>([]);

  // --- Octave offset for keyboard-as-piano entry ---
  const [octaveOffset, setOctaveOffset] = useState(0);

  useEffect(() => {
    if (playing && playheadStep !== null && playheadRef.current) {
      playheadRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [playheadStep, playing]);

  // Scroll cursor row into view when it changes
  useEffect(() => {
    if (cursorRowRef.current) {
      cursorRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [cursorRow]);

  const playheadAt = playheadStep !== null ? playheadStep % region.duration : null;

  // Build slot-based grid
  const { slots, maxNoteColumns, fxColumns } = useMemo(
    () => buildSlotGrid(region.events, region.duration),
    [region],
  );
  const rowCount = slots.length;
  const colCount = getColCount(maxNoteColumns, fxColumns.length);

  // Clamp cursor row when slots change
  useEffect(() => {
    if (rowCount > 0 && cursorRow >= rowCount) {
      setCursorRow(rowCount - 1); // eslint-disable-line react-hooks/set-state-in-effect -- clamping to valid range
    }
  }, [rowCount, cursorRow]);

  // Clamp cursor column when columns change
  useEffect(() => {
    if (cursorCol >= colCount) {
      setCursorCol(colCount - 1); // eslint-disable-line react-hooks/set-state-in-effect -- clamping to valid range
    }
  }, [colCount, cursorCol]);

  // Report cursor step to parent for play-from-cursor
  useEffect(() => {
    if (onCursorStepChange && cursorRow < slots.length) {
      onCursorStepChange(slots[cursorRow].step);
    }
  }, [cursorRow, slots, onCursorStepChange]);

  // --- Selection helpers ---

  const getSelectionRange = useCallback((): [number, number] | null => {
    if (anchorRow === null) return null;
    const lo = Math.min(anchorRow, cursorRow);
    const hi = Math.max(anchorRow, cursorRow);
    return [lo, hi];
  }, [anchorRow, cursorRow]);

  /** Get all flat event indices for the selected slots. */
  const getSelectedEventIndices = useCallback((): number[] => {
    const range = getSelectionRange();
    if (range) {
      const [lo, hi] = range;
      const indices: number[] = [];
      for (let i = lo; i <= hi; i++) {
        if (i < slots.length) {
          indices.push(...slots[i].eventIndices);
        }
      }
      return indices;
    }
    if (cursorRow < slots.length) {
      return [...slots[cursorRow].eventIndices];
    }
    return [];
  }, [getSelectionRange, cursorRow, slots]);

  // --- Report selection changes to parent ---
  useEffect(() => {
    if (!onSelectionChange) return;
    const range = getSelectionRange();
    if (range) {
      const [lo, hi] = range;
      const indices: number[] = [];
      for (let i = lo; i <= hi; i++) {
        if (i < slots.length) indices.push(...slots[i].eventIndices);
      }
      onSelectionChange({ stepRange: [lo, hi], eventIndices: indices });
    } else {
      onSelectionChange(null);
    }
  }, [anchorRow, cursorRow, slots, onSelectionChange, getSelectionRange]);

  /** Copy events from selected slots to internal clipboard. */
  const copyToClipboard = useCallback((indices: number[]) => {
    if (indices.length === 0 || region.events.length === 0) return;
    const baseAt = region.events[indices[0]].at;
    const entries: ClipboardEntry[] = indices
      .filter(i => i >= 0 && i < region.events.length)
      .map(i => ({
        offset: region.events[i].at - baseAt,
        event: { ...region.events[i] },
      }));
    setClipboard(entries);
  }, [region]);

  /** Build paste events from clipboard, offset to the cursor's step position. */
  const buildPasteEvents = useCallback((): MusicalEvent[] => {
    if (clipboard.length === 0 || slots.length === 0) return [];
    const targetAt = cursorRow < slots.length ? slots[cursorRow].step : 0;
    return clipboard.map(entry => ({
      ...entry.event,
      at: Math.max(0, targetAt + entry.offset),
    }));
  }, [clipboard, cursorRow, slots]);

  // --- Column index mapping ---
  // Layout: Pos(0) | Ch1(1) .. ChN(maxNoteColumns) | Vel(1+maxNoteColumns) | Dur(2+maxNoteColumns) | FX1(3+maxNoteColumns) .. FXN
  const getNoteColumnIndex = useCallback((col: number): number | null => {
    if (col >= 1 && col < 1 + maxNoteColumns) return col - 1;
    return null;
  }, [maxNoteColumns]);

  const getFxColumnIndex = useCallback((col: number): number | null => {
    const fxStart = 1 + maxNoteColumns + 2; // after Pos + notes + Vel + Dur
    if (col >= fxStart && col < fxStart + fxColumns.length) return col - fxStart;
    return null;
  }, [maxNoteColumns, fxColumns.length]);

  /** Map a cursor column index to a column type for TrackerRow. */
  const getColumnType = useCallback((col: number): 'pos' | 'note' | 'vel' | 'dur' | 'fx' => {
    if (col === 0) return 'pos';
    if (col >= 1 && col < 1 + maxNoteColumns) return 'note';
    if (col === 1 + maxNoteColumns) return 'vel';
    if (col === 2 + maxNoteColumns) return 'dur';
    return 'fx';
  }, [maxNoteColumns]);

  // Preview note when cursor moves to a cell with a note
  useEffect(() => {
    if (!onNotePreview || cursorRow >= slots.length) return;
    const noteColIdx = getNoteColumnIndex(cursorCol);
    if (noteColIdx === null) return;
    const slot = slots[cursorRow];
    const note = noteColIdx < slot.notes.length ? slot.notes[noteColIdx] : null;
    if (note) {
      onNotePreview(note.pitch);
    }
  }, [cursorRow, cursorCol, slots, onNotePreview, getNoteColumnIndex]);

  // --- Keyboard handler ---
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (rowCount === 0) return;

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
    // --- Batch transpose (Cmd/Ctrl + Shift + Up/Down on selection) ---
    if (isMod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && onTransposeByIndices) {
      const indices = getSelectedEventIndices();
      if (indices.length > 0) {
        e.preventDefault();
        const semitones = e.key === 'ArrowUp' ? 1 : -1;
        onTransposeByIndices(indices, semitones);
        return;
      }
    }

    // Select all (Cmd/Ctrl + A)
    if (isMod && e.key === 'a') {
      e.preventDefault();
      setAnchorRow(0);
      setCursorRow(rowCount - 1);
      return;
    }

    // --- Keyboard-as-piano note entry (Renoise-style) ---
    // When cursor is on a note column, piano keys enter notes directly.
    // Octave shift: -/= keys adjust octave when on a note column.
    const cursorColumnType = getColumnType(cursorCol);
    if (!isMod && !e.altKey && cursorColumnType === 'note') {
      // Octave shift
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setOctaveOffset(o => Math.max(o - 1, -4));
        return;
      }
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setOctaveOffset(o => Math.min(o + 1, 4));
        return;
      }

      // Piano key → MIDI note
      if (isPianoKey(e.key)) {
        const midi = keyToMidi(e.key, octaveOffset);
        if (midi !== undefined && cursorRow < slots.length) {
          e.preventDefault();
          const slot = slots[cursorRow];
          const noteColIdx = getNoteColumnIndex(cursorCol);
          const existingNote = noteColIdx !== null && noteColIdx < slot.notes.length ? slot.notes[noteColIdx] : null;

          if (existingNote && onUpdate) {
            // Update existing note's pitch
            const selector: EventSelector = { at: existingNote.at, kind: 'note' as const, pitch: existingNote.pitch };
            onUpdate(selector, { pitch: midi });
          } else if (onAddNote) {
            // Add new note at this step
            onAddNote(slot.step, midi);
          }
          // Immediate audible feedback before cursor advance (#723)
          if (onNotePreview) onNotePreview(midi);
          // Auto-advance cursor to next row (standard Renoise behavior)
          setCursorRow(r => Math.min(rowCount - 1, r + 1));
          return;
        }
      }
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
          setCursorRow(r => Math.min(rowCount - 1, r + 1));
        } else {
          setAnchorRow(null);
          setCursorRow(r => Math.min(rowCount - 1, r + 1));
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
        setCursorRow(r => Math.min(rowCount - 1, r + PAGE_JUMP));
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
        setCursorRow(rowCount - 1);
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
        } else if (onDelete && rowCount > 0 && cursorRow < slots.length) {
          const slot = slots[cursorRow];
          // If cursor is on a specific note column, delete just that note
          const noteColIdx = getNoteColumnIndex(cursorCol);
          if (noteColIdx !== null && noteColIdx < slot.notes.length && slot.notes[noteColIdx]) {
            const note = slot.notes[noteColIdx]!;
            const selector: EventSelector = { at: note.at, kind: 'note' as const, pitch: note.pitch };
            onDelete(selector);
          } else {
            // If cursor is on an FX column, delete that specific parameter event
            const fxColIdx = getFxColumnIndex(cursorCol);
            if (fxColIdx !== null && fxColIdx < fxColumns.length) {
              const controlId = fxColumns[fxColIdx].controlId;
              const paramEvent = slot.fxValues.get(controlId);
              if (paramEvent) {
                const selector: EventSelector = { at: paramEvent.at, kind: 'parameter' as const, controlId };
                onDelete(selector);
              }
            } else {
              // Default: delete the first note/trigger event in this slot
              const gateEvent = slot.allEvents.find(e => e.kind === 'note' || e.kind === 'trigger');
              if (gateEvent) {
                let selector: EventSelector;
                if (gateEvent.kind === 'note') {
                  selector = { at: gateEvent.at, kind: 'note' as const, pitch: (gateEvent as NoteEvent).pitch };
                } else {
                  selector = { at: gateEvent.at, kind: 'trigger' as const };
                }
                onDelete(selector);
              }
            }
          }
        }
        break;
      }
      default:
        return;
    }
  }, [rowCount, cursorRow, cursorCol, anchorRow, slots, onDelete, onDeleteByIndices, onPasteEvents, onTransposeByIndices, copyToClipboard, getSelectedEventIndices, buildPasteEvents, colCount, getNoteColumnIndex, getFxColumnIndex, fxColumns, getColumnType, octaveOffset, onUpdate, onAddNote, onNotePreview]);

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

  // Build note column headers (Ch1, Ch2, Ch3, Ch4)
  const noteColumnHeaders = useMemo(() => {
    const headers: React.ReactNode[] = [];
    for (let c = 0; c < maxNoteColumns; c++) {
      headers.push(
        <th key={`note-${c}`} className="px-1 py-0.5 text-center w-10 whitespace-nowrap">
          Ch{c + 1}
        </th>
      );
    }
    return headers;
  }, [maxNoteColumns]);

  // Build FX column headers
  const fxColumnHeaders = useMemo(() => {
    return fxColumns.map((fx, i) => (
      <th key={`fx-${i}`} className="px-1 py-0.5 text-center w-8 whitespace-nowrap" title={fx.fullName}>
        {fx.label}
      </th>
    ));
  }, [fxColumns]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      data-shortcut-scope="tracker"
      className="outline-none h-full"
    >
      <div className="flex items-center gap-2 px-1 py-0.5 text-[9px] text-zinc-500 font-mono sticky top-0 bg-zinc-900/95 backdrop-blur-sm z-10">
        <span title="Base octave for keyboard-as-piano entry (-/= to shift)">Oct:{Math.floor(BASE_MIDI_LOWER / OCTAVE) - 1 + octaveOffset}</span>
      </div>
      <table className="border-collapse select-none font-mono text-[11px]">
        <thead>
          <tr className="text-[9px] text-zinc-500 uppercase tracking-wider font-medium sticky top-0 bg-zinc-900 border-b border-zinc-700/60 z-[2]">
            <th className="px-1 py-0.5 text-center w-8 whitespace-nowrap">Pos</th>
            {noteColumnHeaders}
            <th className="px-1 py-0.5 text-center w-9 whitespace-nowrap">Vel</th>
            <th className="px-1 py-0.5 text-center w-10 whitespace-nowrap">Dur</th>
            {fxColumnHeaders}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot, si) => {
            const isAtPlayhead = playing && playheadAt !== null
              && Math.floor(playheadAt) === slot.step;
            const isCursor = si === cursorRow;
            const selRange = getSelectionRange();
            const isSelected = selRange !== null && si >= selRange[0] && si <= selRange[1];
            const showBeatSep = shouldShowBeatSeparator(slot.step, stepsPerBeat);
            const beatIndex = Math.floor(slot.step / stepsPerBeat);

            const cursorNoteCol = isCursor ? getNoteColumnIndex(cursorCol) : null;
            const cursorFxCol = isCursor ? getFxColumnIndex(cursorCol) : null;
            const colType = isCursor ? getColumnType(cursorCol) : 'pos';

            return (
              <TrackerRow
                key={slot.step}
                slot={slot}
                maxNoteColumns={maxNoteColumns}
                fxColumns={fxColumns}
                cursorNoteColumn={cursorNoteCol}
                cursorFxColumn={cursorFxCol}
                isAtPlayhead={isAtPlayhead}
                showBeatSeparator={showBeatSep}
                beatIndex={beatIndex}
                stepsPerBeat={stepsPerBeat}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onAddParamEvent={onAddParamEvent}
                onAddNote={onAddNote}
                cancelEditRef={cancelEditRef}
                isCursorRow={isCursor}
                cursorColumnType={colType}
                editRequestCounter={isCursor ? editRequestCounter : undefined}
                isSelected={isSelected}
                onRowClick={(shiftKey) => handleRowClick(si, shiftKey)}
                onRowDoubleClick={onPlayFromRow ? () => onPlayFromRow(slot.step) : undefined}
                onNotePreview={onNotePreview}
                ref={isCursor ? cursorRowRef : (isAtPlayhead ? playheadRef : undefined)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
