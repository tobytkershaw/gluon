// src/ui/ViewToggle.tsx
import type { ViewMode } from './view-types';

interface Props {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

export function ViewToggle({ view, onViewChange }: Props) {
  return (
    <div className="flex gap-0.5 bg-zinc-900 rounded p-0.5">
      <button
        onClick={() => onViewChange('control')}
        className={`text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
          view === 'control'
            ? 'bg-amber-400/15 text-amber-400'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        Control
      </button>
      <button
        onClick={() => onViewChange('tracker')}
        className={`text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
          view === 'tracker'
            ? 'bg-amber-400/15 text-amber-400'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        Track
      </button>
    </div>
  );
}
