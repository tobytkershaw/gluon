// src/ui/TrackerRow.tsx
import { forwardRef, useState, useCallback, useRef, useEffect, type MutableRefObject } from 'react';
import type { MusicalEvent, NoteEvent, TriggerEvent, ParameterEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import { microTimingOffset, formatMicroOffset } from '../engine/micro-timing';

export interface AvailableControl {
  id: string;
  label: string;
}

/** Column indices for keyboard cursor navigation (within the logical layout). */
export type TrackerColumn = 0 | 1 | 2 | 3 | 4;

interface Props {
  event: MusicalEvent;
  /** Note columns for polyphonic rendering (sorted by pitch). Null entries = empty column. */
  noteColumns?: (NoteEvent | null)[];
  /** Total note columns to render (auto-expanded based on max polyphony). */
  maxNoteColumns?: number;
  /** Which note column the cursor is on (null = not on a note column). */
  cursorNoteColumn?: number | null;
  isAtPlayhead: boolean;
  showBeatSeparator: boolean;
  onUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onDelete?: (selector: EventSelector) => void;
  /** Available controls for param lock FX cells. */
  availableControls?: AvailableControl[];
  /** Callback to add a new parameter event (for empty FX cell picker). */
  onAddParamEvent?: (at: number, controlId: string, value: number) => void;
  /** When true, in-progress inline edits should be discarded on blur. */
  cancelEditRef?: MutableRefObject<boolean>;
  /** Whether this row has the keyboard cursor. */
  isCursorRow?: boolean;
  /** Which column the keyboard cursor is on (only meaningful when isCursorRow). */
  cursorColumn?: TrackerColumn;
  /** Incremented by parent to trigger editing on cursorColumn. */
  editRequestCounter?: number;
  /** Whether this row is in the selected range. */
  isSelected?: boolean;
  /** Click handler for row selection (receives shiftKey state). */
  onRowClick?: (shiftKey: boolean) => void;
  /** Whether this row falls within the active loop region. */
  isInLoop?: boolean;
}

// --- Formatting helpers ---

const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}

/**
 * Parse a note name string (e.g. "C-4", "C#3", "F-5", "Db2") to a MIDI number.
 * Returns NaN if the string is not a valid note name.
 */
function parseNoteName(s: string): number {
  // Try MIDI number first
  const n = parseInt(s, 10);
  if (!isNaN(n) && String(n) === s.trim()) return n;

  // Normalize: trim, uppercase
  const trimmed = s.trim().toUpperCase();
  // Match patterns like C-4, C#3, Db2, D-5
  const match = trimmed.match(/^([A-G])([-#B]?)(-?\d)$/);
  if (!match) return NaN;

  const letter = match[1];
  const accidental = match[2];
  const octave = parseInt(match[3], 10);

  const letterToSemitone: Record<string, number> = {
    'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
  };

  let semitone = letterToSemitone[letter];
  if (semitone === undefined) return NaN;

  if (accidental === '#') semitone += 1;
  else if (accidental === 'B') semitone -= 1; // Flat (Db, Eb, etc.)
  // '-' or empty means natural

  const midi = (octave + 1) * 12 + semitone;
  if (midi < 0 || midi > 127) return NaN;
  return midi;
}

function formatPosition(at: number): string {
  const floored = Math.floor(at);
  if (Math.abs(at - floored) < 0.001) return String(floored).padStart(3, ' ');
  return at.toFixed(2).padStart(5, ' ');
}

function abbreviateControlId(controlId: string): string {
  const abbrevs: Record<string, string> = {
    timbre: 'timbr', harmonics: 'harmo', morph: 'morph',
    frequency: 'freq', decay: 'decay', note: 'note',
  };
  return abbrevs[controlId] ?? controlId.slice(0, 5);
}

function kindRowStyle(kind: MusicalEvent['kind']): string {
  switch (kind) {
    case 'trigger': return 'text-amber-300';
    case 'note': return 'text-emerald-300';
    case 'parameter': return 'text-blue-300';
  }
}

function kindGlyph(kind: MusicalEvent['kind']): string {
  switch (kind) {
    case 'trigger': return 'T';
    case 'note': return 'N';
    case 'parameter': return 'P';
  }
}

function selectorFromEvent(event: MusicalEvent): EventSelector {
  if (event.kind === 'parameter') {
    return { at: event.at, kind: 'parameter', controlId: (event as ParameterEvent).controlId };
  }
  if (event.kind === 'note') {
    return { at: event.at, kind: 'note', pitch: (event as NoteEvent).pitch };
  }
  return { at: event.at, kind: event.kind };
}

// --- Inline editable cell ---

function EditableCell({
  value,
  onCommit,
  className,
  parse,
  cancelEditRef,
  validate,
  editRequested,
}: {
  value: string;
  onCommit: (v: number) => void;
  className?: string;
  parse?: (s: string) => number;
  /** When true on blur, discard the draft instead of committing. */
  cancelEditRef?: MutableRefObject<boolean>;
  /** Optional validation — returns true if valid. When false, flash red and stay in edit mode. */
  validate?: (s: string) => boolean;
  /** When this increments, start editing programmatically (from keyboard Enter). */
  editRequested?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const invalidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startEdit = useCallback(() => {
    setDraft(value);
    setEditing(true);
    setInvalid(false);
  }, [value]);

  // Start editing when editRequested changes (keyboard Enter)
  useEffect(() => {
    if (editRequested && editRequested > 0) {
      startEdit();
    }
  }, [editRequested, startEdit]);

  const tryCommit = useCallback(() => {
    if (validate && !validate(draft)) {
      // Flash red
      setInvalid(true);
      if (invalidTimerRef.current) clearTimeout(invalidTimerRef.current);
      invalidTimerRef.current = setTimeout(() => setInvalid(false), 600);
      return; // Stay in edit mode
    }
    setEditing(false);
    setInvalid(false);
    const parsed = parse ? parse(draft) : parseFloat(draft);
    if (!isNaN(parsed)) onCommit(parsed);
  }, [draft, onCommit, parse, validate]);

  const cancel = useCallback(() => {
    setEditing(false);
    setInvalid(false);
  }, []);

  const handleBlur = useCallback(() => {
    if (cancelEditRef?.current) {
      cancelEditRef.current = false;
      cancel();
    } else {
      tryCommit();
    }
  }, [cancelEditRef, cancel, tryCommit]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (invalidTimerRef.current) clearTimeout(invalidTimerRef.current);
    };
  }, []);

  if (editing) {
    return (
      <input
        className={`bg-zinc-800 text-zinc-100 text-[11px] font-mono w-full px-1 py-0 border rounded outline-none transition-colors ${
          invalid ? 'border-red-500' : 'border-zinc-600 focus:border-amber-500/50'
        }`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') tryCommit();
          if (e.key === 'Escape') cancel();
        }}
        autoFocus
      />
    );
  }

  return (
    <span
      className={`cursor-text select-text ${className ?? ''}`}
      onClick={startEdit}
      onDoubleClick={startEdit}
    >
      {value}
    </span>
  );
}

// --- Position editable cell ---

function PositionEditableCell({
  at,
  onCommit,
  cancelEditRef,
  editRequested,
}: {
  at: number;
  onCommit: (newAt: number) => void;
  cancelEditRef?: MutableRefObject<boolean>;
  editRequested?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(Math.floor(at)));

  const startEdit = useCallback(() => {
    setDraft(String(Math.floor(at)));
    setEditing(true);
  }, [at]);

  // Start editing when editRequested changes (keyboard Enter)
  useEffect(() => {
    if (editRequested && editRequested > 0) {
      startEdit();
    }
  }, [editRequested, startEdit]);

  const commit = useCallback(() => {
    setEditing(false);
    const parsed = parseInt(draft, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed !== Math.floor(at)) {
      onCommit(parsed);
    }
  }, [draft, at, onCommit]);

  const cancel = useCallback(() => {
    setEditing(false);
  }, []);

  const handleBlur = useCallback(() => {
    if (cancelEditRef?.current) {
      cancelEditRef.current = false;
      cancel();
    } else {
      commit();
    }
  }, [cancelEditRef, cancel, commit]);

  if (editing) {
    return (
      <input
        className="bg-zinc-800 text-zinc-100 text-[11px] font-mono w-full px-1 py-0 border border-zinc-600 rounded outline-none focus:border-amber-500/50 text-right"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancel();
        }}
        autoFocus
      />
    );
  }

  const microOffset = microTimingOffset(at);
  return (
    <span className="cursor-text" onClick={startEdit}>
      {formatPosition(at)}
      {microOffset !== null && (
        <span className="ml-0.5 text-[9px] text-zinc-600" title="Micro-timing offset from grid">
          {formatMicroOffset(microOffset)}
        </span>
      )}
    </span>
  );
}

// --- Parameter value editable cell (shows 0-100 integer) ---

function ParamValueCell({
  value,
  controlId,
  onCommit,
  cancelEditRef,
  editRequested,
}: {
  value: number;
  controlId: string;
  onCommit: (newVal: number) => void;
  cancelEditRef?: MutableRefObject<boolean>;
  editRequested?: number;
}) {
  // Display value as 0-100 integer
  const displayVal = Math.round(value * 100);
  return (
    <EditableCell
      value={String(displayVal)}
      onCommit={(v) => {
        // Convert 0-100 input back to 0-1
        const clamped = Math.max(0, Math.min(100, Math.round(v)));
        onCommit(clamped / 100);
      }}
      parse={(s) => {
        const n = parseInt(s, 10);
        return isNaN(n) ? NaN : n;
      }}
      cancelEditRef={cancelEditRef}
      editRequested={editRequested}
    />
  );
}

// --- Note column cell (renders a single note within a polyphonic column) ---

function NoteColumnCell({
  note,
  editable,
  onUpdate,
  cancelEditRef,
  editRequested,
  isCursor,
}: {
  note: NoteEvent | null;
  editable: boolean;
  onUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  cancelEditRef?: MutableRefObject<boolean>;
  editRequested?: number;
  isCursor: boolean;
}) {
  if (!note) {
    return (
      <span className="text-zinc-700">---</span>
    );
  }

  const selector = selectorFromEvent(note);

  if (editable && onUpdate) {
    return (
      <EditableCell
        value={midiToNoteName(note.pitch)}
        onCommit={(v) => onUpdate(selector, { pitch: Math.max(0, Math.min(127, v)) })}
        parse={parseNoteName}
        validate={(s) => !isNaN(parseNoteName(s))}
        cancelEditRef={cancelEditRef}
        editRequested={isCursor ? editRequested : undefined}
      />
    );
  }

  return <span>{midiToNoteName(note.pitch)}</span>;
}

// --- Main component ---

export const TrackerRow = forwardRef<HTMLTableRowElement, Props>(
  function TrackerRow({ event, noteColumns, maxNoteColumns = 1, cursorNoteColumn, isAtPlayhead, showBeatSeparator, onUpdate, onDelete, availableControls, onAddParamEvent, cancelEditRef, isCursorRow, cursorColumn, editRequestCounter, isSelected, onRowClick, isInLoop }, ref) {
    const rowColor = kindRowStyle(event.kind);
    const selector = selectorFromEvent(event);
    const editable = !!onUpdate;

    // Derive per-column editRequested from the parent's counter + column match.
    const posEditReq = (isCursorRow && cursorColumn === 0) ? editRequestCounter : undefined;
    const primaryEditReq = (isCursorRow && cursorColumn === 2) ? editRequestCounter : undefined;
    const valueEditReq = (isCursorRow && cursorColumn === 3) ? editRequestCounter : undefined;
    const durEditReq = (isCursorRow && cursorColumn === 4) ? editRequestCounter : undefined;

    // Micro-timing badge (used in non-editable position display)
    const microOffset = microTimingOffset(event.at);

    // Determine if we should render multi-column notes
    const hasNoteColumns = noteColumns && noteColumns.length > 0;
    const isNoteRow = event.kind === 'note' || hasNoteColumns;

    // For non-note rows (trigger/parameter), build the primary data field
    let primaryData: React.ReactNode = '---';
    if (!hasNoteColumns) {
      if (event.kind === 'note') {
        const note = event as NoteEvent;
        if (editable) {
          primaryData = (
            <EditableCell
              value={midiToNoteName(note.pitch)}
              onCommit={(v) => onUpdate(selector, { pitch: Math.max(0, Math.min(127, v)) })}
              parse={parseNoteName}
              validate={(s) => !isNaN(parseNoteName(s))}
              cancelEditRef={cancelEditRef}
              editRequested={primaryEditReq}
            />
          );
        } else {
          primaryData = midiToNoteName(note.pitch);
        }
      } else if (event.kind === 'trigger') {
        const isAccent = (event as TriggerEvent).accent;
        if (editable) {
          primaryData = (
            <span
              className="cursor-pointer hover:text-amber-200 transition-colors"
              onClick={() => onUpdate(selector, { accent: !isAccent })}
              title={isAccent ? 'Click to remove accent' : 'Click to add accent'}
            >
              {isAccent ? 'ACC' : 'TRG'}
            </span>
          );
        } else {
          primaryData = isAccent ? 'ACC' : 'TRG';
        }
      } else if (event.kind === 'parameter') {
        const pe = event as ParameterEvent;
        primaryData = abbreviateControlId(pe.controlId);
      }
    }

    // Value column — show velocity of first note, or trigger/param value
    let valueNode: React.ReactNode = '--';
    if (event.kind === 'note') {
      const vel = (event as NoteEvent).velocity;
      valueNode = editable ? (
        <EditableCell
          value={vel.toFixed(2)}
          onCommit={(v) => onUpdate(selector, { velocity: Math.max(0, Math.min(1, v)) })}
          cancelEditRef={cancelEditRef}
          editRequested={valueEditReq}
        />
      ) : vel.toFixed(2);
    } else if (event.kind === 'trigger') {
      const vel = (event as TriggerEvent).velocity;
      const display = vel !== undefined ? vel.toFixed(2) : '0.80';
      valueNode = editable ? (
        <EditableCell
          value={display}
          onCommit={(v) => onUpdate(selector, { velocity: Math.max(0, Math.min(1, v)) })}
          cancelEditRef={cancelEditRef}
          editRequested={valueEditReq}
        />
      ) : display;
    } else if (event.kind === 'parameter') {
      const v = (event as ParameterEvent).value;
      if (editable && typeof v === 'number') {
        valueNode = (
          <ParamValueCell
            value={v}
            controlId={(event as ParameterEvent).controlId}
            onCommit={(newVal) => onUpdate(selector, { value: newVal } as Partial<MusicalEvent>)}
            cancelEditRef={cancelEditRef}
            editRequested={valueEditReq}
          />
        );
      } else {
        const display = typeof v === 'number' ? String(Math.round(v * 100)) : String(v);
        valueNode = display;
      }
    }

    // Duration column
    let durNode: React.ReactNode = '--';
    if (event.kind === 'note') {
      const dur = (event as NoteEvent).duration;
      durNode = editable ? (
        <EditableCell
          value={dur.toFixed(2)}
          onCommit={(v) => onUpdate(selector, { duration: Math.max(0.01, v) })}
          cancelEditRef={cancelEditRef}
          editRequested={durEditReq}
        />
      ) : dur.toFixed(2);
    } else if (event.kind === 'trigger') {
      const gate = (event as TriggerEvent).gate ?? 1;
      durNode = editable ? (
        <EditableCell
          value={gate.toFixed(2)}
          onCommit={(v) => onUpdate(selector, { gate: Math.max(0.01, v) } as Partial<MusicalEvent>)}
          cancelEditRef={cancelEditRef}
          editRequested={durEditReq}
        />
      ) : gate.toFixed(2);
    }

    // Cursor cell highlight: ring on the active cell
    const cursorCellClass = (col: TrackerColumn) =>
      isCursorRow && cursorColumn === col ? 'ring-1 ring-amber-400/60 rounded-sm bg-amber-500/10' : '';

    // Cursor highlight for individual note columns
    const cursorNoteCellClass = (colIdx: number) =>
      isCursorRow && cursorColumn === 2 && cursorNoteColumn === colIdx ? 'ring-1 ring-amber-400/60 rounded-sm bg-amber-500/10' : '';

    // Build note column cells
    const noteColumnCells: React.ReactNode[] = [];
    if (hasNoteColumns) {
      for (let c = 0; c < maxNoteColumns; c++) {
        const note = c < noteColumns.length ? noteColumns[c] : null;
        noteColumnCells.push(
          <td
            key={`nc-${c}`}
            className={`px-1.5 py-0 w-[3.5rem] tabular-nums text-emerald-300 ${cursorNoteCellClass(c)}`}
          >
            <NoteColumnCell
              note={note}
              editable={editable}
              onUpdate={onUpdate}
              cancelEditRef={cancelEditRef}
              editRequested={primaryEditReq}
              isCursor={isCursorRow === true && cursorNoteColumn === c}
            />
          </td>
        );
      }
    } else {
      // Single column: render primary data, pad remaining columns with empty
      noteColumnCells.push(
        <td key="nc-0" className={`px-1.5 py-0 w-[3.5rem] tabular-nums ${cursorCellClass(2)}`}>
          {primaryData}
        </td>
      );
      for (let c = 1; c < maxNoteColumns; c++) {
        noteColumnCells.push(
          <td key={`nc-${c}`} className="px-1.5 py-0 w-[3.5rem] tabular-nums text-zinc-700">
            {isNoteRow ? '---' : ''}
          </td>
        );
      }
    }

    return (
      <tr
        ref={ref}
        className={`
          group text-[11px] font-mono leading-5 ${rowColor}
          ${isSelected ? 'bg-amber-500/20' : ''}
          ${isAtPlayhead && !isCursorRow && !isSelected ? 'bg-amber-500/15' : ''}
          ${isCursorRow && !isSelected ? 'bg-amber-500/10' : ''}
          ${isInLoop && !isSelected && !isCursorRow && !isAtPlayhead ? 'bg-cyan-500/5' : ''}
          ${!isAtPlayhead && !isCursorRow && !isSelected ? 'hover:bg-zinc-800/30' : ''}
          ${showBeatSeparator ? 'border-t border-zinc-600/30' : ''}
        `}
        style={isInLoop ? { borderLeft: '2px solid rgba(6, 182, 212, 0.3)' } : undefined}
        onClick={(e) => onRowClick?.(e.shiftKey)}
      >
        <td className={`px-1.5 py-0 text-right text-zinc-500 tabular-nums w-[3.5rem] ${cursorCellClass(0)}`}>
          {editable ? (
            <PositionEditableCell
              at={event.at}
              onCommit={(newAt) => {
                // Move event: update the at field
                onUpdate(selector, { at: newAt });
              }}
              cancelEditRef={cancelEditRef}
              editRequested={posEditReq}
            />
          ) : (
            <>
              {formatPosition(event.at)}
              {microOffset !== null && (
                <span className="ml-0.5 text-[9px] text-zinc-600" title="Micro-timing offset from grid">
                  {formatMicroOffset(microOffset)}
                </span>
              )}
            </>
          )}
        </td>
        <td className={`px-1 py-0 text-center font-bold w-6 ${cursorCellClass(1)}`}>
          {kindGlyph(event.kind)}
        </td>
        {noteColumnCells}
        <td className={`px-1.5 py-0 text-right w-12 tabular-nums text-zinc-400 ${cursorCellClass(3)}`}>
          {valueNode}
        </td>
        <td className={`px-1.5 py-0 text-right w-12 tabular-nums text-zinc-500 ${cursorCellClass(4)}`}>
          {durNode}
        </td>
        {onDelete && (
          <td className="px-1 py-0 w-6 text-center">
            <button
              className="text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => onDelete(selector)}
              title="Delete event"
            >
              ×
            </button>
          </td>
        )}
      </tr>
    );
  },
);
