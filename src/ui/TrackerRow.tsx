// src/ui/TrackerRow.tsx
import { forwardRef, useState, useCallback, useRef, useEffect, type MutableRefObject } from 'react';
import type { MusicalEvent, NoteEvent, ParameterEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import { microTimingOffset, formatMicroOffset } from '../engine/micro-timing';
import type { SlotRow, FxColumnDef } from './Tracker';

export interface AvailableControl {
  id: string;
  label: string;
}

interface Props {
  slot: SlotRow;
  /** Total note columns to render (auto-expanded based on max polyphony). */
  maxNoteColumns: number;
  /** FX column definitions derived from the pattern's parameter events. */
  fxColumns: FxColumnDef[];
  /** Which note column the cursor is on (null = not on a note column). */
  cursorNoteColumn?: number | null;
  /** Which FX column the cursor is on (null = not on an FX column). */
  cursorFxColumn?: number | null;
  isAtPlayhead: boolean;
  showBeatSeparator: boolean;
  onUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onDelete?: (selector: EventSelector) => void;
  /** Available controls for param lock FX cells. */
  availableControls?: AvailableControl[];
  /** Callback to add a new parameter event (for empty FX cell picker). */
  onAddParamEvent?: (at: number, controlId: string, value: number) => void;
  /** Callback to add a note event at a given step. */
  onAddNote?: (step: number) => void;
  /** When true, in-progress inline edits should be discarded on blur. */
  cancelEditRef?: MutableRefObject<boolean>;
  /** Whether this row has the keyboard cursor. */
  isCursorRow?: boolean;
  /** Which column type the keyboard cursor is on. */
  cursorColumnType?: 'pos' | 'note' | 'vel' | 'dur' | 'fx';
  /** Incremented by parent to trigger editing on cursorColumn. */
  editRequestCounter?: number;
  /** Whether this row is in the selected range. */
  isSelected?: boolean;
  /** Click handler for row selection (receives shiftKey state). */
  onRowClick?: (shiftKey: boolean) => void;
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
  /** Optional validation -- returns true if valid. When false, flash red and stay in edit mode. */
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

// --- Note column cell (renders a single note within a polyphonic column) ---

function NoteColumnCell({
  note,
  step,
  editable,
  onUpdate,
  onAddNote,
  cancelEditRef,
  editRequested,
  isCursor,
}: {
  note: NoteEvent | null;
  step: number;
  editable: boolean;
  onUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onAddNote?: (step: number) => void;
  cancelEditRef?: MutableRefObject<boolean>;
  editRequested?: number;
  isCursor: boolean;
}) {
  if (!note) {
    return (
      <span
        className={`text-zinc-700 ${onAddNote ? 'cursor-pointer hover:text-zinc-500' : ''}`}
        onClick={onAddNote ? () => onAddNote(step) : undefined}
        title={onAddNote ? `Add note at step ${step}` : undefined}
      >
        ---
      </span>
    );
  }

  const selector = selectorFromEvent(note);
  const noteUngated = note.velocity === 0;

  if (editable && onUpdate) {
    return (
      <span className={noteUngated ? 'opacity-40 line-through decoration-zinc-500' : ''}>
        <EditableCell
          value={midiToNoteName(note.pitch)}
          onCommit={(v) => onUpdate(selector, { pitch: Math.max(0, Math.min(127, v)) })}
          parse={parseNoteName}
          validate={(s) => !isNaN(parseNoteName(s))}
          cancelEditRef={cancelEditRef}
          editRequested={isCursor ? editRequested : undefined}
        />
      </span>
    );
  }

  return <span className={noteUngated ? 'opacity-40 line-through decoration-zinc-500' : ''}>{midiToNoteName(note.pitch)}</span>;
}

// --- FX column cell (compact parameter value) ---

function FxCell({
  paramEvent,
  controlId,
  step,
  editable,
  onUpdate,
  onAddParamEvent,
  cancelEditRef,
  editRequested,
}: {
  paramEvent: ParameterEvent | undefined;
  controlId: string;
  step: number;
  editable: boolean;
  onUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onAddParamEvent?: (at: number, controlId: string, value: number) => void;
  cancelEditRef?: MutableRefObject<boolean>;
  editRequested?: number;
}) {
  if (!paramEvent) {
    // Empty FX cell — clickable to add
    return (
      <span
        className={`text-zinc-700 ${onAddParamEvent ? 'cursor-pointer hover:text-blue-400' : ''}`}
        onClick={onAddParamEvent ? () => onAddParamEvent(step, controlId, 0.5) : undefined}
        title={onAddParamEvent ? `Add ${controlId} lock at step ${step}` : undefined}
      >
        ..
      </span>
    );
  }

  const value = paramEvent.value;
  if (typeof value !== 'number') {
    return <span className="text-blue-300">{String(value).slice(0, 3)}</span>;
  }

  // Display as 0-99 integer (2-char compact format)
  const displayVal = Math.round(value * 99);
  const displayStr = String(displayVal).padStart(2, '0');

  if (editable && onUpdate) {
    const selector = selectorFromEvent(paramEvent);
    return (
      <EditableCell
        value={displayStr}
        className="text-blue-300"
        onCommit={(v) => {
          const clamped = Math.max(0, Math.min(99, Math.round(v)));
          onUpdate(selector, { value: clamped / 99 } as Partial<MusicalEvent>);
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

  return <span className="text-blue-300">{displayStr}</span>;
}

// --- Main component ---

export const TrackerRow = forwardRef<HTMLTableRowElement, Props>(
  function TrackerRow({
    slot, maxNoteColumns, fxColumns,
    cursorNoteColumn, cursorFxColumn,
    isAtPlayhead, showBeatSeparator,
    onUpdate, onDelete, availableControls, onAddParamEvent, onAddNote,
    cancelEditRef,
    isCursorRow, cursorColumnType, editRequestCounter,
    isSelected, onRowClick,
  }, ref) {
    const editable = !!onUpdate;
    const hasNotes = slot.notes.some(n => n !== null);

    // First note for velocity/duration display
    const firstNote = slot.notes.find((n): n is NoteEvent => n !== null) ?? null;

    // Micro-timing indicator
    const microEvents = slot.allEvents.filter(e => e.kind === 'note' || e.kind === 'trigger');
    const microEvent = microEvents[0];
    const microOffset = microEvent ? microTimingOffset(microEvent.at) : null;

    // Derive per-column editRequested from the parent's counter + column match.
    const noteEditReq = (isCursorRow && cursorColumnType === 'note') ? editRequestCounter : undefined;
    const velEditReq = (isCursorRow && cursorColumnType === 'vel') ? editRequestCounter : undefined;
    const durEditReq = (isCursorRow && cursorColumnType === 'dur') ? editRequestCounter : undefined;
    const fxEditReq = (isCursorRow && cursorColumnType === 'fx') ? editRequestCounter : undefined;

    // Cursor cell highlight
    const cursorCellClass = (colType: string) =>
      isCursorRow && cursorColumnType === colType ? 'ring-1 ring-amber-400/60 rounded-sm bg-amber-500/10' : '';

    const cursorNoteCellClass = (colIdx: number) =>
      isCursorRow && cursorColumnType === 'note' && cursorNoteColumn === colIdx ? 'ring-1 ring-amber-400/60 rounded-sm bg-amber-500/10' : '';

    const cursorFxCellClass = (fxIdx: number) =>
      isCursorRow && cursorColumnType === 'fx' && cursorFxColumn === fxIdx ? 'ring-1 ring-amber-400/60 rounded-sm bg-amber-500/10' : '';

    // Row color: emerald for steps with notes, neutral for empty
    const rowColor = hasNotes ? 'text-emerald-300' : 'text-zinc-500';

    // Build note column cells
    const noteColumnCells: React.ReactNode[] = [];
    for (let c = 0; c < maxNoteColumns; c++) {
      const note = c < slot.notes.length ? slot.notes[c] : null;
      noteColumnCells.push(
        <td
          key={`nc-${c}`}
          className={`px-1 py-0 w-[3rem] tabular-nums text-emerald-300 ${cursorNoteCellClass(c)}`}
        >
          <NoteColumnCell
            note={note}
            step={slot.step}
            editable={editable}
            onUpdate={onUpdate}
            onAddNote={onAddNote}
            cancelEditRef={cancelEditRef}
            editRequested={noteEditReq}
            isCursor={isCursorRow === true && cursorNoteColumn === c}
          />
        </td>
      );
    }

    // Build FX column cells
    const fxColumnCells: React.ReactNode[] = fxColumns.map((fx, fi) => {
      const paramEvent = slot.fxValues.get(fx.controlId);
      return (
        <td
          key={`fx-${fi}`}
          className={`px-1 py-0 w-[2.5rem] tabular-nums text-right ${cursorFxCellClass(fi)}`}
        >
          <FxCell
            paramEvent={paramEvent}
            controlId={fx.controlId}
            step={slot.step}
            editable={editable}
            onUpdate={onUpdate}
            onAddParamEvent={onAddParamEvent}
            cancelEditRef={cancelEditRef}
            editRequested={isCursorRow === true && cursorFxColumn === fi ? fxEditReq : undefined}
          />
        </td>
      );
    });

    // Velocity column
    let velNode: React.ReactNode = '--';
    if (firstNote) {
      const vel = firstNote.velocity;
      const selector = selectorFromEvent(firstNote);
      velNode = editable ? (
        <EditableCell
          value={vel.toFixed(2)}
          onCommit={(v) => onUpdate!(selector, { velocity: Math.max(0, Math.min(1, v)) })}
          cancelEditRef={cancelEditRef}
          editRequested={velEditReq}
        />
      ) : vel.toFixed(2);
    }

    // Duration column
    let durNode: React.ReactNode = '--';
    if (firstNote) {
      const dur = firstNote.duration;
      const selector = selectorFromEvent(firstNote);
      durNode = editable ? (
        <EditableCell
          value={dur.toFixed(2)}
          onCommit={(v) => onUpdate!(selector, { duration: Math.max(0.01, v) })}
          cancelEditRef={cancelEditRef}
          editRequested={durEditReq}
        />
      ) : dur.toFixed(2);
    }

    return (
      <tr
        ref={ref}
        className={`
          group text-[11px] font-mono leading-5 ${rowColor}
          ${isSelected ? 'bg-amber-500/20' : ''}
          ${isAtPlayhead && !isCursorRow && !isSelected ? 'bg-amber-500/15' : ''}
          ${isCursorRow && !isSelected ? 'bg-amber-500/10' : ''}
          ${!isAtPlayhead && !isCursorRow && !isSelected ? 'hover:bg-zinc-800/30' : ''}
          ${showBeatSeparator ? 'border-t border-zinc-600/30' : ''}
        `}
        onClick={(e) => onRowClick?.(e.shiftKey)}
      >
        {/* POS column — left-aligned */}
        <td className={`px-1 py-0 text-left text-zinc-500 tabular-nums w-[2.5rem] ${cursorCellClass('pos')}`}>
          {String(slot.step).padStart(2, '\u2007')}
          {microOffset !== null && (
            <span className="ml-0.5 text-[9px] text-zinc-600" title="Micro-timing offset from grid">
              {formatMicroOffset(microOffset)}
            </span>
          )}
        </td>
        {/* Note columns */}
        {noteColumnCells}
        {/* Vel column */}
        <td className={`px-1 py-0 text-right w-[2.5rem] tabular-nums text-zinc-400 ${cursorCellClass('vel')}`}>
          {velNode}
        </td>
        {/* Dur column */}
        <td className={`px-1 py-0 text-right w-[2.5rem] tabular-nums text-zinc-500 ${cursorCellClass('dur')}`}>
          {durNode}
        </td>
        {/* FX columns */}
        {fxColumnCells}
        {/* Delete button */}
        {onDelete && slot.allEvents.length > 0 && (
          <td className="px-1 py-0 w-6 text-center">
            <button
              className="text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => {
                const firstEvent = slot.allEvents[0];
                onDelete(selectorFromEvent(firstEvent));
              }}
              title="Delete event"
            >
              x
            </button>
          </td>
        )}
      </tr>
    );
  },
);
