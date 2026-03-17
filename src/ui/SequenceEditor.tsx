// src/ui/SequenceEditor.tsx
// Sequence editor for Song mode: edit the per-track arrangement of pattern refs.

import { useMemo, useState, useRef, useEffect } from 'react';
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

function getPatternLabel(patterns: Pattern[], ref: PatternRef, index: number): string {
  const pat = patterns.find(p => p.id === ref.patternId);
  if (!pat) return `? (${ref.patternId})`;
  if (pat.name) return pat.name;
  const patIdx = patterns.indexOf(pat);
  return `P${patIdx + 1}`;
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

  // Delete/Backspace key removes selected slot
  useEffect(() => {
    if (selectedSlot === null || !canRemove) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
        e.preventDefault();
        onRemovePatternRef(selectedSlot);
        setSelectedSlot(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedSlot, canRemove, onRemovePatternRef]);

  // Reset selection if it goes out of range
  useEffect(() => {
    if (selectedSlot !== null && selectedSlot >= track.sequence.length) {
      setSelectedSlot(null);
    }
  }, [selectedSlot, track.sequence.length]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium tracking-wider uppercase text-zinc-400">
          Sequence
        </span>
        <span className="text-[10px] text-zinc-600">
          {track.sequence.length} slot{track.sequence.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Sequence slots */}
      <div ref={containerRef} className="flex flex-wrap items-center gap-1">
        {track.sequence.map((ref, idx) => {
          const isPlaying = activeSequenceIndex === idx;
          const isSlotSelected = selectedSlot === idx;
          return (
            <div
              key={`${idx}-${ref.patternId}`}
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] border transition-colors cursor-pointer ${
                isSlotSelected
                  ? 'bg-red-500/10 text-red-300 border-red-500/50 ring-1 ring-red-500/30'
                  : isPlaying
                    ? 'bg-green-500/20 text-green-400 border-green-500/40'
                    : 'bg-zinc-800/60 text-zinc-400 border-zinc-700/50'
              }`}
              onClick={() => setSelectedSlot(isSlotSelected ? null : idx)}
            >
              {/* Move up (left) */}
              <button
                className="text-zinc-600 hover:text-zinc-300 disabled:opacity-30 disabled:cursor-default transition-colors"
                onClick={(e) => { e.stopPropagation(); onReorderPatternRef(idx, idx - 1); }}
                disabled={idx === 0}
                title="Move left"
              >
                &larr;
              </button>

              <span className="px-1 select-none">
                {getPatternLabel(track.patterns, ref, idx)}
              </span>

              {/* Move down (right) */}
              <button
                className="text-zinc-600 hover:text-zinc-300 disabled:opacity-30 disabled:cursor-default transition-colors"
                onClick={(e) => { e.stopPropagation(); onReorderPatternRef(idx, idx + 1); }}
                disabled={idx === track.sequence.length - 1}
                title="Move right"
              >
                &rarr;
              </button>

              {/* Slot removal: select slot (click) then press Delete/Backspace */}
            </div>
          );
        })}

        {/* Add pattern ref dropdown */}
        {track.patterns.length > 0 && (
          <select
            className="text-[10px] bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors cursor-pointer outline-none focus:border-amber-500/50"
            value=""
            onChange={(e) => {
              if (e.target.value) {
                onAddPatternRef(e.target.value);
                e.target.value = '';
              }
            }}
            title="Add pattern to sequence"
          >
            <option value="" disabled>+ Add</option>
            {track.patterns.map((pat, idx) => (
              <option key={pat.id} value={pat.id}>
                {pat.name || `P${idx + 1}`}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
