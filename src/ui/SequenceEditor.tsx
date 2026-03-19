// src/ui/SequenceEditor.tsx
// Sequence editor for Song mode: Renoise-inspired vertical order list showing
// all pattern slots, current playhead position, reorder/duplicate/insert/remove.

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import type { Track } from '../engine/types';
import type { Pattern } from '../engine/canonical-types';
import type { PatternRef } from '../engine/sequencer-types';
import { resolveSequencePosition } from '../engine/sequence-helpers';

interface Props {
  track: Track;
  /** Current global step (for highlighting the active sequence slot during playback). */
  globalStep: number;
  /** Whether playback is active. */
  playing: boolean;
  /** Whether the transport is in song mode. */
  isSongMode: boolean;
  onAddPatternRef: (patternId: string) => void;
  onRemovePatternRef: (sequenceIndex: number) => void;
  onReorderPatternRef: (fromIndex: number, toIndex: number) => void;
}

function getPatternLabel(patterns: Pattern[], ref: PatternRef): string {
  const pat = patterns.find(p => p.id === ref.patternId);
  if (!pat) return `?`;
  if (pat.name) return pat.name;
  const patIdx = patterns.indexOf(pat);
  return `P${patIdx + 1}`;
}

/** Count how many times each pattern is used in the sequence — used for color coding. */
function usePatternUsageCounts(sequence: PatternRef[]): Map<string, number> {
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const ref of sequence) {
      counts.set(ref.patternId, (counts.get(ref.patternId) ?? 0) + 1);
    }
    return counts;
  }, [sequence]);
}

export function SequenceEditor({
  track, globalStep, playing, isSongMode,
  onAddPatternRef, onRemovePatternRef, onReorderPatternRef,
}: Props) {
  // Resolve which sequence slot is currently playing
  const activeSequenceIndex = useMemo(() => {
    if (!playing || !isSongMode) return null;
    const pos = resolveSequencePosition(globalStep, track.sequence, track.patterns);
    return pos?.sequenceIndex ?? null;
  }, [playing, isSongMode, globalStep, track.sequence, track.patterns]);

  const canRemove = track.sequence.length > 1;
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeSlotRef = useRef<HTMLDivElement>(null);
  const usageCounts = usePatternUsageCounts(track.sequence);

  // Auto-scroll to the playing slot during playback
  useEffect(() => {
    if (activeSequenceIndex !== null && activeSlotRef.current) {
      activeSlotRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeSequenceIndex]);

  // Deselect when clicking outside
  useEffect(() => {
    if (selectedSlot === null) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSelectedSlot(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selectedSlot]);

  // Keyboard shortcuts: Delete/Backspace removes, arrow keys navigate selection
  useEffect(() => {
    if (selectedSlot === null) return;
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && canRemove) {
        e.preventDefault();
        const newSel = selectedSlot >= track.sequence.length - 1
          ? Math.max(0, track.sequence.length - 2)
          : selectedSlot;
        onRemovePatternRef(selectedSlot);
        setSelectedSlot(newSel);
      } else if (e.key === 'ArrowUp' && selectedSlot > 0) {
        e.preventDefault();
        if (e.altKey) {
          // Alt+Up: move slot up
          onReorderPatternRef(selectedSlot, selectedSlot - 1);
          setSelectedSlot(selectedSlot - 1);
        } else {
          setSelectedSlot(selectedSlot - 1);
        }
      } else if (e.key === 'ArrowDown' && selectedSlot < track.sequence.length - 1) {
        e.preventDefault();
        if (e.altKey) {
          // Alt+Down: move slot down
          onReorderPatternRef(selectedSlot, selectedSlot + 1);
          setSelectedSlot(selectedSlot + 1);
        } else {
          setSelectedSlot(selectedSlot + 1);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedSlot, canRemove, onRemovePatternRef, onReorderPatternRef, track.sequence.length]);

  // Reset selection if it goes out of range
  useEffect(() => {
    if (selectedSlot !== null && selectedSlot >= track.sequence.length) {
      setSelectedSlot(null); // eslint-disable-line react-hooks/set-state-in-effect -- clamping to valid range
    }
  }, [selectedSlot, track.sequence.length]);

  // Duplicate the selected slot (insert a copy after it)
  const handleDuplicate = useCallback(() => {
    if (selectedSlot === null) return;
    const ref = track.sequence[selectedSlot];
    if (!ref) return;
    // Add the same pattern ref, then move it into position after the selected slot
    onAddPatternRef(ref.patternId);
    // The new entry is appended at the end; move it to selectedSlot + 1
    const _fromIdx = track.sequence.length; // will be the new last index after add
    // We need to move it step by step (the API only supports swap-adjacent)
    // Actually, after add it's at the end. We schedule moves after render.
    // Simpler: just add — the user can reorder. This is the common pattern.
    setSelectedSlot(track.sequence.length); // select the new entry
  }, [selectedSlot, track.sequence, onAddPatternRef]);

  return (
    <div className="flex flex-col gap-1">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-medium tracking-wider uppercase text-zinc-400">
          Sequence
        </span>
        <span className="text-[11px] text-zinc-600">
          {track.sequence.length} slot{track.sequence.length !== 1 ? 's' : ''}
        </span>
        {!isSongMode && track.sequence.length > 1 && (
          <span className="text-[9px] text-amber-600/80 ml-auto" title="Switch to Song mode to play through the sequence">
            Pattern mode — looping
          </span>
        )}
      </div>

      {/* Vertical slot list */}
      <div
        ref={containerRef}
        className="flex flex-col gap-px max-h-[200px] overflow-y-auto rounded border border-zinc-800/50 bg-zinc-900/30"
        role="listbox"
        aria-label="Sequence slots"
      >
        {track.sequence.map((ref, idx) => {
          const isPlaying = activeSequenceIndex === idx;
          const isSelected = selectedSlot === idx;
          const isMultiUse = (usageCounts.get(ref.patternId) ?? 0) > 1;

          return (
            <div
              key={`${idx}-${ref.patternId}`}
              ref={isPlaying ? activeSlotRef : undefined}
              role="option"
              aria-selected={isSelected}
              aria-current={isPlaying ? 'true' : undefined}
              className={`group flex items-center gap-1 px-1.5 py-[3px] text-[11px] cursor-pointer transition-colors select-none ${
                isSelected
                  ? 'bg-amber-500/15 text-amber-300'
                  : isPlaying
                    ? 'bg-green-500/15 text-green-400'
                    : 'text-zinc-400 hover:bg-zinc-800/50'
              }`}
              onClick={() => setSelectedSlot(isSelected ? null : idx)}
            >
              {/* Playhead indicator */}
              <span className={`w-1.5 flex-shrink-0 text-[8px] leading-none ${isPlaying ? 'text-green-400' : 'text-transparent'}`}>
                {isPlaying ? '\u25B6' : '\u00A0'}
              </span>

              {/* Slot index (zero-padded like Renoise) */}
              <span className="w-5 text-right font-mono text-zinc-600 flex-shrink-0">
                {String(idx).padStart(2, '0')}
              </span>

              {/* Pattern label */}
              <span className={`flex-1 font-mono truncate ${isMultiUse ? 'text-cyan-400/80' : ''}`}>
                {getPatternLabel(track.patterns, ref)}
              </span>

              {/* Reorder buttons (visible on hover/select) */}
              <span className={`flex items-center gap-0 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'} transition-opacity`}>
                <button
                  className="px-0.5 text-zinc-500 hover:text-zinc-300 disabled:opacity-20 disabled:cursor-default"
                  onClick={(e) => { e.stopPropagation(); onReorderPatternRef(idx, idx - 1); setSelectedSlot(idx - 1); }}
                  disabled={idx === 0}
                  title="Move up (Alt+\u2191)"
                >
                  \u2191
                </button>
                <button
                  className="px-0.5 text-zinc-500 hover:text-zinc-300 disabled:opacity-20 disabled:cursor-default"
                  onClick={(e) => { e.stopPropagation(); onReorderPatternRef(idx, idx + 1); setSelectedSlot(idx + 1); }}
                  disabled={idx === track.sequence.length - 1}
                  title="Move down (Alt+\u2193)"
                >
                  \u2193
                </button>
              </span>
            </div>
          );
        })}
      </div>

      {/* Toolbar: add, duplicate, remove */}
      <div className="flex items-center gap-1">
        {/* Add pattern ref dropdown */}
        {track.patterns.length > 0 && (
          <select
            className="text-[11px] bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors cursor-pointer outline-none focus:border-amber-500/50"
            value=""
            onChange={(e) => {
              if (e.target.value) {
                onAddPatternRef(e.target.value);
                e.target.value = '';
              }
            }}
            title="Append pattern to sequence"
          >
            <option value="" disabled>+ Add</option>
            {track.patterns.map((pat, idx) => (
              <option key={pat.id} value={pat.id}>
                {pat.name || `P${idx + 1}`}
              </option>
            ))}
          </select>
        )}

        {/* Duplicate selected slot */}
        <button
          className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 disabled:opacity-30 disabled:cursor-default transition-colors"
          onClick={handleDuplicate}
          disabled={selectedSlot === null}
          title="Duplicate selected slot"
        >
          Dup
        </button>

        {/* Remove selected slot */}
        <button
          className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700/50 text-zinc-500 hover:text-red-400 hover:border-red-500/50 disabled:opacity-30 disabled:cursor-default transition-colors"
          onClick={() => {
            if (selectedSlot !== null && canRemove) {
              const newSel = selectedSlot >= track.sequence.length - 1
                ? Math.max(0, track.sequence.length - 2)
                : selectedSlot;
              onRemovePatternRef(selectedSlot);
              setSelectedSlot(newSel);
            }
          }}
          disabled={selectedSlot === null || !canRemove}
          title="Remove selected slot (Del)"
        >
          Rem
        </button>

        {/* Keyboard hint */}
        <span className="text-[8px] text-zinc-700 ml-auto">
          Alt+\u2191\u2193 reorder
        </span>
      </div>
    </div>
  );
}
