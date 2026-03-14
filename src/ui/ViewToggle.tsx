// src/ui/ViewToggle.tsx
import type { MutableRefObject } from 'react';
import type { ViewMode } from './view-types';

interface Props {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  /** When set on mousedown (before blur), tells in-progress inline edits to discard. */
  cancelEditRef?: MutableRefObject<boolean>;
}

export function ViewToggle({ view, onViewChange, cancelEditRef }: Props) {
  const handleMouseDown = () => {
    if (cancelEditRef) cancelEditRef.current = true;
  };
  const handleClick = (v: ViewMode) => {
    // Clear the cancel flag after blur has had its chance — prevents leak
    // when no edit was active during the mousedown.
    if (cancelEditRef) cancelEditRef.current = false;
    onViewChange(v);
  };

  return (
    <div className="flex gap-0.5 bg-zinc-900 rounded p-0.5">
      <button
        onMouseDown={handleMouseDown}
        onClick={() => handleClick('control')}
        className={`text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
          view === 'control'
            ? 'bg-amber-400/15 text-amber-400'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        Control
      </button>
      <button
        onMouseDown={handleMouseDown}
        onClick={() => handleClick('tracker')}
        className={`text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
          view === 'tracker'
            ? 'bg-amber-400/15 text-amber-400'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        Tracker
      </button>
    </div>
  );
}
