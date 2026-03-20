// src/ui/ViewToggle.tsx
import type { MutableRefObject } from 'react';
import type { ViewMode } from './view-types';

interface Props {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  /** When set on mousedown (before blur), tells in-progress inline edits to discard. */
  cancelEditRef?: MutableRefObject<boolean>;
}

const tabs: { key: ViewMode; label: string }[] = [
  { key: 'chat', label: 'Chat' },
  { key: 'surface', label: 'Surface' },
  { key: 'rack', label: 'Rack' },
  { key: 'patch', label: 'Patch' },
  { key: 'tracker', label: 'Tracker' },
];

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
    <div className="flex gap-0.5 bg-zinc-900 rounded p-0.5" role="group" aria-label="View">
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          role="button"
          aria-pressed={view === key}
          onMouseDown={handleMouseDown}
          onClick={() => handleClick(key)}
          className={`text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
            view === key
              ? key === 'chat'
                ? 'bg-violet-400/10 text-violet-400'
                : 'bg-amber-400/10 text-amber-400'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
