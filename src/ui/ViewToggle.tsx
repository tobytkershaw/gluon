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

  const chatTab = tabs[0]; // 'chat'
  const instrumentTabs = tabs.slice(1);

  return (
    <div className="flex items-center gap-2" role="group" aria-label="View">
      <button
        key={chatTab.key}
        role="button"
        aria-pressed={view === chatTab.key}
        onMouseDown={handleMouseDown}
        onClick={() => handleClick(chatTab.key)}
        className={`text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
          view === chatTab.key
            ? 'bg-violet-400/10 text-violet-400'
            : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
        }`}
      >
        {chatTab.label}
      </button>
      <div className="w-px h-4 bg-zinc-700/60" />
      <div className="flex gap-0.5 bg-zinc-900 rounded p-0.5">
        {instrumentTabs.map(({ key, label }) => (
          <button
            key={key}
            role="button"
            aria-pressed={view === key}
            onMouseDown={handleMouseDown}
            onClick={() => handleClick(key)}
            className={`text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
              view === key
                ? 'bg-amber-400/10 text-amber-400'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
