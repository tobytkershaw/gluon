// src/ui/TrackerRow.tsx
import { forwardRef, useState, useCallback } from 'react';
import type { MusicalEvent, NoteEvent, TriggerEvent, ParameterEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';

interface Props {
  event: MusicalEvent;
  isAtPlayhead: boolean;
  showBeatSeparator: boolean;
  onUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onDelete?: (selector: EventSelector) => void;
}

// --- Formatting helpers ---

const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}

function formatPosition(at: number): string {
  const floored = Math.floor(at);
  if (Math.abs(at - floored) < 0.001) return String(floored).padStart(3, ' ');
  return at.toFixed(2).padStart(5, ' ');
}

function abbreviateControlId(controlId: string): string {
  const abbrevs: Record<string, string> = {
    brightness: 'brite', richness: 'rich', texture: 'textr',
    pitch: 'pitch', decay: 'decay', harmonics: 'harmo',
    timbre: 'timbr', morph: 'morph', note: 'note',
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
  return { at: event.at, kind: event.kind };
}

// --- Inline editable cell ---

function EditableCell({
  value,
  onCommit,
  className,
  parse,
}: {
  value: string;
  onCommit: (v: number) => void;
  className?: string;
  parse?: (s: string) => number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const startEdit = useCallback(() => {
    setDraft(value);
    setEditing(true);
  }, [value]);

  const commit = useCallback(() => {
    setEditing(false);
    const parsed = parse ? parse(draft) : parseFloat(draft);
    if (!isNaN(parsed)) onCommit(parsed);
  }, [draft, onCommit, parse]);

  const cancel = useCallback(() => {
    setEditing(false);
  }, []);

  if (editing) {
    return (
      <input
        className="bg-zinc-800 text-zinc-100 text-[11px] font-mono w-full px-1 py-0 border border-zinc-600 rounded outline-none focus:border-amber-500/50"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancel();
        }}
        autoFocus
      />
    );
  }

  return (
    <span
      className={`cursor-text ${className ?? ''}`}
      onDoubleClick={startEdit}
    >
      {value}
    </span>
  );
}

// --- Main component ---

export const TrackerRow = forwardRef<HTMLTableRowElement, Props>(
  function TrackerRow({ event, isAtPlayhead, showBeatSeparator, onUpdate, onDelete }, ref) {
    const rowColor = kindRowStyle(event.kind);
    const selector = selectorFromEvent(event);
    const editable = !!onUpdate;

    // Primary data field
    let primaryData: React.ReactNode = '---';
    if (event.kind === 'note') {
      const note = event as NoteEvent;
      if (editable) {
        primaryData = (
          <EditableCell
            value={midiToNoteName(note.pitch)}
            onCommit={(v) => onUpdate(selector, { pitch: Math.max(0, Math.min(127, v)) })}
            parse={(s) => {
              // Try parsing as MIDI number first
              const n = parseInt(s, 10);
              if (!isNaN(n)) return n;
              return NaN;
            }}
          />
        );
      } else {
        primaryData = midiToNoteName(note.pitch);
      }
    } else if (event.kind === 'trigger') {
      primaryData = (event as TriggerEvent).accent ? 'ACC' : '---';
    } else if (event.kind === 'parameter') {
      primaryData = abbreviateControlId((event as ParameterEvent).controlId);
    }

    // Value column
    let valueNode: React.ReactNode = '--';
    if (event.kind === 'note') {
      const vel = (event as NoteEvent).velocity;
      valueNode = editable ? (
        <EditableCell
          value={vel.toFixed(2)}
          onCommit={(v) => onUpdate(selector, { velocity: Math.max(0, Math.min(1, v)) })}
        />
      ) : vel.toFixed(2);
    } else if (event.kind === 'trigger') {
      const vel = (event as TriggerEvent).velocity;
      valueNode = vel !== undefined ? vel.toFixed(2) : '--';
    } else if (event.kind === 'parameter') {
      const v = (event as ParameterEvent).value;
      const display = typeof v === 'number' ? v.toFixed(2) : String(v);
      valueNode = editable && typeof v === 'number' ? (
        <EditableCell
          value={display}
          onCommit={(newVal) => onUpdate(selector, { value: newVal } as Partial<MusicalEvent>)}
        />
      ) : display;
    }

    // Duration column
    let durNode: React.ReactNode = '--';
    if (event.kind === 'note') {
      const dur = (event as NoteEvent).duration;
      durNode = editable ? (
        <EditableCell
          value={dur.toFixed(2)}
          onCommit={(v) => onUpdate(selector, { duration: Math.max(0.01, v) })}
        />
      ) : dur.toFixed(2);
    }

    return (
      <tr
        ref={ref}
        className={`
          group text-[11px] font-mono leading-5 ${rowColor}
          ${isAtPlayhead ? 'bg-amber-500/15' : 'hover:bg-zinc-800/30'}
          ${showBeatSeparator ? 'border-t border-zinc-600/30' : ''}
        `}
      >
        <td className="px-1.5 py-0 text-right text-zinc-500 tabular-nums w-[3.5rem]">
          {formatPosition(event.at)}
        </td>
        <td className="px-1 py-0 text-center font-bold w-6">
          {kindGlyph(event.kind)}
        </td>
        <td className="px-1.5 py-0 w-[3.5rem] tabular-nums">
          {primaryData}
        </td>
        <td className="px-1.5 py-0 text-right w-12 tabular-nums text-zinc-400">
          {valueNode}
        </td>
        <td className="px-1.5 py-0 text-right w-12 tabular-nums text-zinc-500">
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
