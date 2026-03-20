// src/ui/TrackerRow.tsx
import { forwardRef, useState, useCallback, useRef, useEffect, type MutableRefObject } from 'react';
import type { MusicalEvent, NoteEvent, ParameterEvent, TriggerEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import { microTimingOffset, formatMicroOffset } from '../engine/micro-timing';
import type { SlotRow, FxColumnDef } from './Tracker';

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
  /** Which beat this row belongs to (0-based), for alternating beat tints. */
  beatIndex: number;
  /** Steps per beat for beat-row tinting. Default: 4. */
  stepsPerBeat?: number;
  onUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onDelete?: (selector: EventSelector) => void;
  /** Callback to add a new parameter event (for empty FX cell picker). */
  onAddParamEvent?: (at: number, controlId: string, value: number) => void;
  /** Callback to add a note event at a given step, optionally with a specific pitch. */
  onAddNote?: (step: number, pitch?: number) => void;
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
  /** Double-click handler for play-from-row. */
  onRowDoubleClick?: () => void;
  /** Called when a note cell is hovered (pitch) or unhovered (null). */
  onNotePreview?: (pitch: number | null) => void;
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

/**
 * Filter input characters for note name cells.
 * Only allows characters that can form valid note names: A-G, #, b/B (flat), -, 0-9.
 */
function filterNoteInput(s: string): string {
  return s.replace(/[^A-Ga-g#Bb\-0-9]/g, '');
}

/**
 * Filter input characters for velocity cells.
 * Only allows digits and a decimal point (for 0.0-1.0 range).
 */
function filterVelocityInput(s: string): string {
  return s.replace(/[^0-9.]/g, '');
}

/**
 * Filter input characters for duration cells.
 * Only allows digits and a decimal point.
 */
function filterDurationInput(s: string): string {
  return s.replace(/[^0-9.]/g, '');
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
  onDelete,
  className,
  parse,
  cancelEditRef,
  validate,
  filterInput,
  editRequested,
  placeholder,
  autoCapitalize: autoCapProp,
}: {
  value: string;
  onCommit: (v: number) => void;
  /** Called when the user commits empty or invalid text (clears the cell). */
  onDelete?: () => void;
  className?: string;
  parse?: (s: string) => number;
  /** When true on blur, discard the draft instead of committing. */
  cancelEditRef?: MutableRefObject<boolean>;
  /** Optional validation -- returns true if valid. When false, flash red and stay in edit mode. */
  validate?: (s: string) => boolean;
  /** Optional per-character input filter. Returns the sanitised string (only valid chars). */
  filterInput?: (s: string) => string;
  /** When this increments, start editing programmatically (from keyboard Enter). */
  editRequested?: number;
  /** Default value to show when editing a placeholder cell (e.g. "C-4" for empty note slots). Text is auto-selected. */
  placeholder?: string;
  /** When true, auto-capitalize typed text (for note names). */
  autoCapitalize?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const invalidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectAllOnFocus = useRef(false);

  const startEdit = useCallback(() => {
    // If the cell is a placeholder (e.g. "---"), pre-fill with the placeholder
    // default (e.g. "C-4") and flag for select-all so typing replaces it.
    if (placeholder && (value === '---' || value === '..')) {
      setDraft(placeholder);
      selectAllOnFocus.current = true;
    } else {
      setDraft(value);
      selectAllOnFocus.current = false;
    }
    setEditing(true);
    setInvalid(false);
  }, [value, placeholder]);

  // Start editing when editRequested changes (keyboard Enter)
  useEffect(() => {
    if (editRequested && editRequested > 0) {
      startEdit(); // eslint-disable-line react-hooks/set-state-in-effect -- responding to parent signal
    }
  }, [editRequested, startEdit]);

  const tryCommit = useCallback(() => {
    // Empty text → delete the note/event
    const trimmed = draft.trim();
    if (trimmed === '' || trimmed === '---') {
      setEditing(false);
      setInvalid(false);
      if (onDelete) onDelete();
      return;
    }
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
  }, [draft, onCommit, onDelete, parse, validate]);

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
        className={`bg-transparent text-inherit text-[11px] font-mono w-full px-0 py-0 border-0 outline-none caret-amber-400 transition-colors ${
          invalid ? 'ring-1 ring-red-500 rounded-sm' : ''
        }`}
        style={autoCapProp ? { textTransform: 'uppercase' } : undefined}
        value={draft}
        onChange={(e) => {
          let v = autoCapProp ? e.target.value.toUpperCase() : e.target.value;
          if (filterInput) v = filterInput(v);
          setDraft(v);
        }}
        onFocus={(e) => {
          if (selectAllOnFocus.current) {
            e.currentTarget.select();
            selectAllOnFocus.current = false;
          }
        }}
        onBlur={handleBlur}
        onPaste={filterInput ? (e) => {
          e.preventDefault();
          const pasted = e.clipboardData.getData('text');
          let filtered = autoCapProp ? pasted.toUpperCase() : pasted;
          filtered = filterInput(filtered);
          if (filtered) setDraft(filtered);
        } : undefined}
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
  trigger,
  step,
  editable,
  onUpdate,
  onDelete,
  onAddNote,
  cancelEditRef,
  editRequested,
  isCursor,
  onNotePreview,
}: {
  note: NoteEvent | null;
  /** Trigger event to display when no note is present (column 0 only). */
  trigger?: TriggerEvent | null;
  step: number;
  editable: boolean;
  onUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onDelete?: (selector: EventSelector) => void;
  onAddNote?: (step: number, pitch?: number) => void;
  cancelEditRef?: MutableRefObject<boolean>;
  editRequested?: number;
  isCursor: boolean;
  onNotePreview?: (pitch: number | null) => void;
}) {
  // --- Trigger event (no note, but a trigger exists): show TRG ---
  if (!note && trigger) {
    const _selector = selectorFromEvent(trigger);
    return (
      <span className="text-amber-400 font-medium">
        TRG
      </span>
    );
  }

  // --- Empty cell: type to add a note ---
  if (!note) {
    if (editable && onAddNote) {
      return (
        <EditableCell
          value="---"
          className="text-zinc-600"
          onCommit={(pitch) => onAddNote(step, Math.max(0, Math.min(127, pitch)))}
          parse={parseNoteName}
          validate={(s) => {
            const trimmed = s.trim();
            if (trimmed === '' || trimmed === '---') return true; // allow clearing (no-op for empty)
            return !isNaN(parseNoteName(s));
          }}
          filterInput={filterNoteInput}
          cancelEditRef={cancelEditRef}
          editRequested={isCursor ? editRequested : undefined}
          placeholder="C-4"
          autoCapitalize
        />
      );
    }
    return <span className="text-zinc-600">---</span>;
  }

  // --- Existing note: edit pitch, clear to delete ---
  const selector = selectorFromEvent(note);
  const noteUngated = note.velocity === 0;

  const hoverHandlers = onNotePreview ? {
    onMouseEnter: () => onNotePreview(note.pitch),
    onMouseLeave: () => onNotePreview(null),
  } : {};

  if (editable && onUpdate) {
    return (
      <span
        className={noteUngated ? 'opacity-40 line-through decoration-zinc-500' : ''}
        title={`MIDI ${note.pitch}`}
        {...hoverHandlers}
      >
        <EditableCell
          value={midiToNoteName(note.pitch)}
          onCommit={(v) => onUpdate(selector, { pitch: Math.max(0, Math.min(127, v)) })}
          onDelete={onDelete ? () => onDelete(selector) : undefined}
          parse={parseNoteName}
          validate={(s) => {
            const trimmed = s.trim();
            if (trimmed === '' || trimmed === '---') return true; // allow clearing → delete
            return !isNaN(parseNoteName(s));
          }}
          filterInput={filterNoteInput}
          cancelEditRef={cancelEditRef}
          editRequested={isCursor ? editRequested : undefined}
          autoCapitalize
        />
      </span>
    );
  }

  return (
    <span
      className={noteUngated ? 'opacity-40 line-through decoration-zinc-500' : ''}
      title={`MIDI ${note.pitch}`}
      {...hoverHandlers}
    >
      {midiToNoteName(note.pitch)}
    </span>
  );
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
        className={`text-zinc-600 ${onAddParamEvent ? 'cursor-pointer hover:text-sky-400' : ''}`}
        onClick={onAddParamEvent ? () => onAddParamEvent(step, controlId, 0.5) : undefined}
        title={onAddParamEvent ? `Add ${controlId} lock at step ${step}` : undefined}
      >
        ..
      </span>
    );
  }

  const value = paramEvent.value;
  if (typeof value !== 'number') {
    return <span className="text-sky-400">{String(value).slice(0, 3)}</span>;
  }

  // Display as 0-100 integer (compact format)
  const displayVal = Math.round(value * 100);
  const displayStr = String(displayVal).padStart(2, '0');

  if (editable && onUpdate) {
    const selector = selectorFromEvent(paramEvent);
    return (
      <EditableCell
        value={displayStr}
        className="text-sky-400"
        onCommit={(v) => {
          const clamped = Math.max(0, Math.min(100, Math.round(v)));
          onUpdate(selector, { value: clamped / 100 } as Partial<MusicalEvent>);
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
    isAtPlayhead, showBeatSeparator, beatIndex, stepsPerBeat = 4,
    onUpdate, onDelete, onAddParamEvent, onAddNote,
    cancelEditRef,
    isCursorRow, cursorColumnType, editRequestCounter,
    isSelected, onRowClick, onRowDoubleClick, onNotePreview,
  }, ref) {
    const editable = !!onUpdate;
    const hasNotes = slot.notes.some(n => n !== null);

    // First trigger event (not in slot.notes, but in allEvents)
    const firstTrigger = slot.allEvents.find(
      (e): e is TriggerEvent => e.kind === 'trigger' && (e as TriggerEvent).velocity !== 0,
    ) ?? null;

    // First note for velocity/duration display (fall back to trigger)
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

    // Cursor — row-level highlight, not per-cell
    const cursorCellClass = (_colType: string) => '';
    const cursorNoteCellClass = (_colIdx: number) => '';
    const cursorFxCellClass = (_fxIdx: number) => '';

    // Row text color: primary for steps with content, muted for empty
    const rowColor = (hasNotes || slot.hasGate) ? '' : '';

    // Build note column cells
    const noteColumnCells: React.ReactNode[] = [];
    for (let c = 0; c < maxNoteColumns; c++) {
      const note = c < slot.notes.length ? slot.notes[c] : null;
      noteColumnCells.push(
        <td
          key={`nc-${c}`}
          className={`px-1 py-0 w-10 tabular-nums text-center text-zinc-200 font-medium ${cursorNoteCellClass(c)}`}
        >
          <NoteColumnCell
            note={note}
            trigger={c === 0 ? firstTrigger : null}
            step={slot.step}
            editable={editable}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onAddNote={onAddNote}
            cancelEditRef={cancelEditRef}
            editRequested={noteEditReq}
            isCursor={isCursorRow === true && cursorNoteColumn === c}
            onNotePreview={onNotePreview}
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
          className={`px-1 py-0 w-8 tabular-nums text-right ${cursorFxCellClass(fi)}`}
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

    // Velocity column — show note velocity, or trigger velocity if no note
    let velNode: React.ReactNode = <span className="text-zinc-600">--</span>;
    /** Validate velocity: must be a number in 0.0-1.0 range. */
    const validateVelocity = (s: string): boolean => {
      const trimmed = s.trim();
      if (trimmed === '') return true; // allow clearing
      const n = parseFloat(trimmed);
      return !isNaN(n) && n >= 0 && n <= 1;
    };

    if (firstNote) {
      const vel = firstNote.velocity;
      const selector = selectorFromEvent(firstNote);
      velNode = editable ? (
        <EditableCell
          value={vel.toFixed(2)}
          onCommit={(v) => onUpdate!(selector, { velocity: Math.max(0, Math.min(1, v)) })}
          validate={validateVelocity}
          filterInput={filterVelocityInput}
          cancelEditRef={cancelEditRef}
          editRequested={velEditReq}
        />
      ) : vel.toFixed(2);
    } else if (firstTrigger && firstTrigger.velocity != null) {
      const vel = firstTrigger.velocity;
      const selector = selectorFromEvent(firstTrigger);
      velNode = editable ? (
        <EditableCell
          value={vel.toFixed(2)}
          onCommit={(v) => onUpdate!(selector, { velocity: Math.max(0, Math.min(1, v)) })}
          validate={validateVelocity}
          filterInput={filterVelocityInput}
          cancelEditRef={cancelEditRef}
          editRequested={velEditReq}
        />
      ) : vel.toFixed(2);
    }

    // Duration column — show note duration, or trigger gate if no note
    let durNode: React.ReactNode = <span className="text-zinc-600">--</span>;
    if (firstNote) {
      const dur = firstNote.duration;
      const selector = selectorFromEvent(firstNote);
      durNode = editable ? (
        <EditableCell
          value={dur.toFixed(2)}
          onCommit={(v) => onUpdate!(selector, { duration: Math.max(0.01, v) })}
          filterInput={filterDurationInput}
          cancelEditRef={cancelEditRef}
          editRequested={durEditReq}
        />
      ) : dur.toFixed(2);
    } else if (firstTrigger && firstTrigger.gate != null) {
      const gate = firstTrigger.gate;
      const selector = selectorFromEvent(firstTrigger);
      durNode = editable ? (
        <EditableCell
          value={gate.toFixed(2)}
          onCommit={(v) => onUpdate!(selector, { gate: Math.max(0.01, v) } as Partial<MusicalEvent>)}
          filterInput={filterDurationInput}
          cancelEditRef={cancelEditRef}
          editRequested={durEditReq}
        />
      ) : gate.toFixed(2);
    }

    // Beat row tint: every 4 steps gets a subtle bg per mockup
    const isBeatRow = slot.step % stepsPerBeat === 0;
    const hasContent = hasNotes || slot.hasGate;

    return (
      <tr
        ref={ref}
        className={`
          group text-[11px] font-mono leading-5 relative border-b border-zinc-700/20 ${rowColor}
          ${isCursorRow ? 'outline outline-[1.5px] outline-amber-400 -outline-offset-1' : ''}
          ${isSelected ? 'bg-indigo-500/25' : ''}
          ${isAtPlayhead ? 'bg-amber-400/[0.08]' : ''}
          ${!isAtPlayhead && !isSelected && hasContent ? 'bg-emerald-400/[0.04]' : ''}
          ${!isAtPlayhead && !isSelected && !hasContent && isBeatRow ? 'bg-[rgba(61,57,53,0.08)]' : ''}
          ${!isAtPlayhead && !isCursorRow && !isSelected ? 'hover:bg-zinc-800/30' : ''}
          ${showBeatSeparator ? 'border-t border-zinc-700/40' : ''}
        `}
        onClick={(e) => onRowClick?.(e.shiftKey)}
        onDoubleClick={() => onRowDoubleClick?.()}
      >
        {/* POS column — right-aligned, hex format, text-faint per mockup */}
        <td className={`pl-0.5 pr-1.5 py-0 text-right text-zinc-600 text-[9px] tabular-nums w-8 select-none ${cursorCellClass('pos')}`}>
          {slot.step.toString(16).toUpperCase().padStart(2, '0')}
          {microOffset !== null && (
            <span className="ml-0.5 text-[9px] text-zinc-600" title="Micro-timing offset from grid">
              {formatMicroOffset(microOffset)}
            </span>
          )}
        </td>
        {/* Note columns */}
        {noteColumnCells}
        {/* Vel column */}
        <td className={`px-1 py-0 text-center w-9 tabular-nums text-zinc-400 ${cursorCellClass('vel')}`}>
          {velNode}
        </td>
        {/* Dur column */}
        <td className={`px-1 py-0 text-center w-10 tabular-nums text-zinc-500 ${cursorCellClass('dur')}`}>
          {durNode}
        </td>
        {/* FX columns */}
        {fxColumnCells}
        {/* Delete column spacer (deletion via keyboard Delete/Backspace on cursor row) */}
      </tr>
    );
  },
);
