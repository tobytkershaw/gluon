// src/ui/TrackerRow.tsx
// Slot-centric tracker row: one row per step position.
// Empty steps show dashes; filled steps show event data.
import { forwardRef, useState, useCallback, useRef, useEffect, type MutableRefObject } from 'react';
import type { MusicalEvent, NoteEvent, TriggerEvent, ParameterEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import { microTimingOffset, formatMicroOffset } from '../engine/micro-timing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which column is focused in the grid */
export type TrackerColumn = 'note' | 'vel' | 'dur' | 'fx';

export interface SlotData {
  /** The note or trigger event at this step, if any */
  noteOrTrigger: NoteEvent | TriggerEvent | null;
  /** Parameter events at this step */
  paramEvents: ParameterEvent[];
}

interface Props {
  step: number;
  slot: SlotData;
  isAtPlayhead: boolean;
  showBeatSeparator: boolean;
  isCursorRow: boolean;
  cursorColumn: TrackerColumn | null;
  onUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onDelete?: (selector: EventSelector) => void;
  onAddEvent?: (step: number, event: MusicalEvent) => void;
  onCursorMove?: (row: number, col: TrackerColumn) => void;
  cancelEditRef?: MutableRefObject<boolean>;
}

// ---------------------------------------------------------------------------
// Note name helpers
// ---------------------------------------------------------------------------

const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}

/**
 * Parse a note name string to a MIDI number.
 * Handles: "C4", "C-4", "c4", "C#4", "Db4", "F#3", "B-4" (B natural),
 * and raw MIDI integers like "60".
 */
export function parseNoteName(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;

  // Try raw MIDI integer first
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return n >= 0 && n <= 127 ? n : null;
  }

  // Note name pattern: letter + optional accidental + optional separator + octave
  const match = trimmed.match(/^([A-Ga-g])(#|b)?-?(\d)$/);
  if (!match) return null;

  const letter = match[1].toUpperCase();
  const accidental = match[2] || '';
  const octave = parseInt(match[3], 10);

  const letterSemitones: Record<string, number> = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
  };

  const base = letterSemitones[letter];
  if (base === undefined) return null;

  let semitone = base;
  if (accidental === '#') semitone += 1;
  else if (accidental === 'b') semitone -= 1;

  const midi = (octave + 1) * 12 + semitone;
  return midi >= 0 && midi <= 127 ? midi : null;
}

function abbreviateControlId(controlId: string): string {
  const abbrevs: Record<string, string> = {
    brightness: 'brite', richness: 'rich', texture: 'textr',
    pitch: 'pitch', decay: 'decay', harmonics: 'harmo',
    timbre: 'timbr', morph: 'morph', note: 'note',
  };
  return abbrevs[controlId] ?? controlId.slice(0, 5);
}

function selectorFromEvent(event: MusicalEvent): EventSelector {
  if (event.kind === 'parameter') {
    return { at: event.at, kind: 'parameter', controlId: (event as ParameterEvent).controlId };
  }
  return { at: event.at, kind: event.kind };
}

// ---------------------------------------------------------------------------
// Inline editable cell
// ---------------------------------------------------------------------------

function EditableCell({
  value,
  onCommit,
  className,
  parse,
  cancelEditRef,
  editing,
  onStartEdit,
  onStopEdit,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  parse?: (s: string) => number;
  cancelEditRef?: MutableRefObject<boolean>;
  editing?: boolean;
  onStartEdit?: () => void;
  onStopEdit?: () => void;
}) {
  const [localEditing, setLocalEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const isEditing = editing !== undefined ? editing : localEditing;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEdit = useCallback(() => {
    setDraft(value);
    if (onStartEdit) onStartEdit();
    else setLocalEditing(true);
  }, [value, onStartEdit]);

  const commit = useCallback(() => {
    if (onStopEdit) onStopEdit();
    else setLocalEditing(false);
    onCommit(draft);
  }, [draft, onCommit, onStopEdit]);

  const cancel = useCallback(() => {
    if (onStopEdit) onStopEdit();
    else setLocalEditing(false);
  }, [onStopEdit]);

  const handleBlur = useCallback(() => {
    if (cancelEditRef?.current) {
      cancelEditRef.current = false;
      cancel();
    } else {
      commit();
    }
  }, [cancelEditRef, cancel, commit]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="bg-zinc-800 text-zinc-100 text-[11px] font-mono w-full px-1 py-0 border border-zinc-600 rounded outline-none focus:border-amber-500/50"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          // Stop arrow keys from propagating to grid navigation
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.stopPropagation();
          }
        }}
      />
    );
  }

  return (
    <span
      className={`cursor-text select-text ${className ?? ''}`}
      onClick={startEdit}
    >
      {value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Empty cell (click to create)
// ---------------------------------------------------------------------------

function EmptyNoteCell({
  step,
  onAddEvent,
  cancelEditRef,
  isFocused,
}: {
  step: number;
  onAddEvent?: (step: number, event: MusicalEvent) => void;
  cancelEditRef?: MutableRefObject<boolean>;
  isFocused: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const startEdit = useCallback(() => {
    if (!onAddEvent) return;
    setDraft('');
    setEditing(true);
  }, [onAddEvent]);

  // Enter on a focused empty cell starts editing
  useEffect(() => {
    // This is handled by keyboard navigation in parent
  }, [isFocused]);

  const commit = useCallback(() => {
    setEditing(false);
    if (!onAddEvent || !draft.trim()) return;

    const input = draft.trim().toUpperCase();

    if (input === 'TRG') {
      onAddEvent(step, { kind: 'trigger', at: step, velocity: 0.8, accent: false });
      return;
    }
    if (input === 'ACC') {
      onAddEvent(step, { kind: 'trigger', at: step, velocity: 1.0, accent: true });
      return;
    }

    const midi = parseNoteName(draft.trim());
    if (midi !== null) {
      onAddEvent(step, { kind: 'note', at: step, pitch: midi, velocity: 0.8, duration: 1.0 });
    }
  }, [draft, step, onAddEvent]);

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
        ref={inputRef}
        className="bg-zinc-800 text-zinc-100 text-[11px] font-mono w-full px-1 py-0 border border-zinc-600 rounded outline-none focus:border-amber-500/50"
        value={draft}
        placeholder="C-4"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.stopPropagation();
          }
        }}
      />
    );
  }

  return (
    <span
      className="text-zinc-600 cursor-text"
      onClick={startEdit}
    >
      ---
    </span>
  );
}

function EmptyFxCell({
  step,
  onAddEvent,
  cancelEditRef,
}: {
  step: number;
  onAddEvent?: (step: number, event: MusicalEvent) => void;
  cancelEditRef?: MutableRefObject<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const startEdit = useCallback(() => {
    if (!onAddEvent) return;
    setDraft('');
    setEditing(true);
  }, [onAddEvent]);

  const commit = useCallback(() => {
    setEditing(false);
    if (!onAddEvent || !draft.trim()) return;

    // Parse "controlId value" format, e.g. "brightness 50"
    const parts = draft.trim().split(/\s+/);
    if (parts.length >= 2) {
      const controlId = parts[0];
      const value = parseFloat(parts[1]);
      if (!isNaN(value)) {
        onAddEvent(step, {
          kind: 'parameter',
          at: step,
          controlId,
          value: value / 100, // Convert 0-100 display to 0-1 internal
        });
      }
    }
  }, [draft, step, onAddEvent]);

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
        ref={inputRef}
        className="bg-zinc-800 text-zinc-100 text-[11px] font-mono w-full px-1 py-0 border border-zinc-600 rounded outline-none focus:border-amber-500/50"
        value={draft}
        placeholder="ctrl val"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.stopPropagation();
          }
        }}
      />
    );
  }

  return (
    <span
      className="text-zinc-600 cursor-text"
      onClick={startEdit}
    >
      ---
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const TrackerRow = forwardRef<HTMLTableRowElement, Props>(
  function TrackerRow({
    step, slot, isAtPlayhead, showBeatSeparator,
    isCursorRow, cursorColumn,
    onUpdate, onDelete, onAddEvent, onCursorMove, cancelEditRef,
  }, ref) {
    const { noteOrTrigger, paramEvents } = slot;
    const hasEvent = noteOrTrigger !== null;
    const editable = !!onUpdate;

    // Determine row color based on event type
    const rowColor = hasEvent
      ? noteOrTrigger!.kind === 'trigger' ? 'text-amber-300' : 'text-emerald-300'
      : '';

    // Micro-timing badge (only for events with fractional positions)
    const microOffset = hasEvent ? microTimingOffset(noteOrTrigger!.at) : null;

    // Cell focus helpers
    const cellClass = (col: TrackerColumn) => {
      const focused = isCursorRow && cursorColumn === col;
      return focused ? 'ring-1 ring-amber-500/50 rounded-sm' : '';
    };

    const handleCellClick = (col: TrackerColumn) => {
      onCursorMove?.(step, col);
    };

    // --- NOTE column ---
    let noteNode: React.ReactNode;
    if (hasEvent) {
      const ev = noteOrTrigger!;
      const selector = selectorFromEvent(ev);
      if (ev.kind === 'note') {
        const note = ev as NoteEvent;
        noteNode = editable ? (
          <EditableCell
            value={midiToNoteName(note.pitch)}
            onCommit={(v) => {
              // Try note name first, then MIDI integer
              const midi = parseNoteName(v);
              if (midi !== null) {
                onUpdate(selector, { pitch: midi });
              }
            }}
            cancelEditRef={cancelEditRef}
          />
        ) : midiToNoteName(note.pitch);
      } else {
        // Trigger
        const trigger = ev as TriggerEvent;
        noteNode = trigger.accent ? 'ACC' : 'TRG';
      }
    } else {
      noteNode = (
        <EmptyNoteCell
          step={step}
          onAddEvent={onAddEvent}
          cancelEditRef={cancelEditRef}
          isFocused={isCursorRow && cursorColumn === 'note'}
        />
      );
    }

    // --- VEL column ---
    let velNode: React.ReactNode;
    if (hasEvent) {
      const ev = noteOrTrigger!;
      const selector = selectorFromEvent(ev);
      const vel = ev.kind === 'note'
        ? (ev as NoteEvent).velocity
        : (ev as TriggerEvent).velocity ?? 0.8;
      const display = Math.round(vel * 100).toString();
      velNode = editable ? (
        <EditableCell
          value={display}
          onCommit={(v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n)) {
              onUpdate(selector, { velocity: Math.max(0, Math.min(1, n / 100)) });
            }
          }}
          cancelEditRef={cancelEditRef}
        />
      ) : display;
    } else {
      velNode = <span className="text-zinc-600">--</span>;
    }

    // --- DUR column ---
    let durNode: React.ReactNode;
    if (hasEvent && noteOrTrigger!.kind === 'note') {
      const note = noteOrTrigger as NoteEvent;
      const selector = selectorFromEvent(note);
      const display = note.duration.toFixed(1);
      durNode = editable ? (
        <EditableCell
          value={display}
          onCommit={(v) => {
            const n = parseFloat(v);
            if (!isNaN(n)) {
              onUpdate(selector, { duration: Math.max(0.01, n) });
            }
          }}
          cancelEditRef={cancelEditRef}
        />
      ) : display;
    } else {
      durNode = <span className="text-zinc-600">--</span>;
    }

    // --- FX column ---
    let fxNode: React.ReactNode;
    if (paramEvents.length > 0) {
      const pe = paramEvents[0]; // Show first parameter event
      const selector = selectorFromEvent(pe);
      const valDisplay = typeof pe.value === 'number'
        ? Math.round(pe.value * 100).toString()
        : String(pe.value);
      const display = `${abbreviateControlId(pe.controlId)} ${valDisplay}`;

      fxNode = editable && typeof pe.value === 'number' ? (
        <EditableCell
          value={display}
          onCommit={(v) => {
            // Parse "ctrl val" format
            const parts = v.trim().split(/\s+/);
            if (parts.length >= 2) {
              const newVal = parseFloat(parts[parts.length - 1]);
              if (!isNaN(newVal)) {
                onUpdate(selector, { value: newVal / 100 } as Partial<MusicalEvent>);
              }
            }
          }}
          cancelEditRef={cancelEditRef}
          className="text-blue-300"
        />
      ) : <span className="text-blue-300">{display}</span>;
    } else {
      fxNode = (
        <EmptyFxCell
          step={step}
          onAddEvent={onAddEvent}
          cancelEditRef={cancelEditRef}
        />
      );
    }

    // --- Delete handler ---
    const handleDelete = () => {
      if (!onDelete) return;
      // Delete note/trigger first if present
      if (hasEvent) {
        onDelete(selectorFromEvent(noteOrTrigger!));
      } else if (paramEvents.length > 0) {
        onDelete(selectorFromEvent(paramEvents[0]));
      }
    };

    return (
      <tr
        ref={ref}
        className={`
          group text-[11px] font-mono leading-5 ${rowColor}
          ${isAtPlayhead ? 'bg-amber-500/15' : 'hover:bg-zinc-800/30'}
          ${showBeatSeparator ? 'border-t border-zinc-600/30' : ''}
        `}
      >
        {/* ROW number */}
        <td className="px-1.5 py-0 text-right text-zinc-500 tabular-nums w-10">
          {String(step).padStart(2, '0')}
          {microOffset !== null && (
            <span className="ml-0.5 text-[9px] text-zinc-600" title="Micro-timing offset from grid">
              {formatMicroOffset(microOffset)}
            </span>
          )}
        </td>

        {/* NOTE */}
        <td
          className={`px-1.5 py-0 w-16 tabular-nums ${cellClass('note')}`}
          onClick={() => handleCellClick('note')}
        >
          {noteNode}
        </td>

        {/* VEL */}
        <td
          className={`px-1.5 py-0 text-right w-10 tabular-nums text-zinc-400 ${cellClass('vel')}`}
          onClick={() => handleCellClick('vel')}
        >
          {velNode}
        </td>

        {/* DUR */}
        <td
          className={`px-1.5 py-0 text-right w-10 tabular-nums text-zinc-500 ${cellClass('dur')}`}
          onClick={() => handleCellClick('dur')}
        >
          {durNode}
        </td>

        {/* FX */}
        <td
          className={`px-1.5 py-0 w-20 tabular-nums ${cellClass('fx')}`}
          onClick={() => handleCellClick('fx')}
        >
          {fxNode}
        </td>

        {/* Delete button */}
        {onDelete && (hasEvent || paramEvents.length > 0) && (
          <td className="px-1 py-0 w-6 text-center">
            <button
              className="text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={handleDelete}
              title="Delete event"
            >
              x
            </button>
          </td>
        )}
        {/* Empty spacer cell when no delete button to keep alignment */}
        {onDelete && !hasEvent && paramEvents.length === 0 && (
          <td className="px-1 py-0 w-6" />
        )}
      </tr>
    );
  },
);
