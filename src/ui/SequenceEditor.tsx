// src/ui/SequenceEditor.tsx
// Sequence editor for Song mode: edit the per-track arrangement of pattern refs.

import { useMemo } from 'react';
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
      <div className="flex flex-wrap items-center gap-1">
        {track.sequence.map((ref, idx) => {
          const isPlaying = activeSequenceIndex === idx;
          return (
            <div
              key={`${idx}-${ref.patternId}`}
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                isPlaying
                  ? 'bg-green-500/20 text-green-400 border-green-500/40'
                  : 'bg-zinc-800/60 text-zinc-400 border-zinc-700/50'
              }`}
            >
              {/* Move up (left) */}
              <button
                className="text-zinc-600 hover:text-zinc-300 disabled:opacity-30 disabled:cursor-default transition-colors"
                onClick={() => onReorderPatternRef(idx, idx - 1)}
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
                onClick={() => onReorderPatternRef(idx, idx + 1)}
                disabled={idx === track.sequence.length - 1}
                title="Move right"
              >
                &rarr;
              </button>

              {/* Remove */}
              <button
                className="text-zinc-600 hover:text-red-400 disabled:opacity-30 disabled:cursor-default transition-colors ml-0.5"
                onClick={() => onRemovePatternRef(idx)}
                disabled={!canRemove}
                title={canRemove ? 'Remove from sequence' : 'Cannot remove the last slot'}
              >
                x
              </button>
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
