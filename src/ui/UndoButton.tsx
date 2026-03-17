import { useState, useRef, useEffect } from 'react';
import type { UndoEntry } from '../engine/types';

interface Props {
  onClick: () => void;
  disabled: boolean;
  description?: string;
  undoStack?: UndoEntry[];
}

/** Extract a display description from an UndoEntry. */
function entryDescription(entry: UndoEntry): string {
  return entry.description || entry.kind;
}

/** Format a relative timestamp like "2m ago" or "just now". */
function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function UndoButton({ onClick, disabled, description, undoStack }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const title = description ? `Undo: ${description} (⌘Z)` : 'Undo (⌘Z)';

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const entries = undoStack ?? [];
  const hasHistory = entries.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center">
        {/* Main undo button */}
        <button
          onClick={onClick}
          disabled={disabled}
          className="p-2 rounded-l text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
          title={title}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 8h8a3 3 0 0 1 0 6H8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M6 5L3 8l3 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {/* History dropdown toggle */}
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={!hasHistory}
          className="px-0.5 py-2 rounded-r text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title={hasHistory ? `${entries.length} undo step${entries.length === 1 ? '' : 's'}` : 'No undo history'}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M2 3l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Dropdown panel */}
      {open && hasHistory && (
        <div className="absolute top-full right-0 mt-1 w-64 max-h-72 overflow-y-auto rounded-lg border border-zinc-700/50 bg-zinc-900 shadow-xl z-50">
          <div className="px-3 py-1.5 border-b border-zinc-800/50">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Undo history ({entries.length})
            </span>
          </div>
          <ul className="py-1">
            {/* Show most recent first (top of stack = end of array) */}
            {[...entries].reverse().map((entry, i) => (
              <li
                key={`${entry.timestamp}-${i}`}
                className="px-3 py-1.5 flex items-start gap-2 hover:bg-zinc-800/40 transition-colors"
              >
                <span className="shrink-0 mt-0.5 w-4 text-right text-[10px] tabular-nums text-zinc-600">
                  {entries.length - i}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-zinc-300 leading-tight line-clamp-2">
                    {entryDescription(entry)}
                  </span>
                  <span className="block text-[10px] text-zinc-600 mt-0.5">
                    {timeAgo(entry.timestamp)}
                  </span>
                </div>
                {i === 0 && (
                  <span className="shrink-0 text-[9px] font-medium text-violet-400/70 uppercase tracking-wider mt-0.5">
                    next
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
