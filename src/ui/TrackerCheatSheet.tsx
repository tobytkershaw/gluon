// src/ui/TrackerCheatSheet.tsx
// Floating keyboard shortcuts cheat sheet for the tracker view.
// Shows tracker-specific shortcuts plus key global ones.
import { useEffect, useState } from 'react';
import { SHORTCUT_DEFS } from './useShortcuts';

// Show tracker section + selected global shortcuts relevant while in the tracker
const SHOWN_SECTIONS = new Set(['tracker', 'transport', 'editing']);
const shortcuts = SHORTCUT_DEFS.filter(d => SHOWN_SECTIONS.has(d.section));

export function TrackerCheatSheet() {
  const [open, setOpen] = useState(false);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-5 h-5 flex items-center justify-center rounded text-[11px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        title="Keyboard shortcuts"
        aria-label="Keyboard shortcuts"
      >
        ?
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Popover */}
          <div className="absolute right-0 top-6 z-50 w-56 rounded-lg border border-zinc-700/60 bg-zinc-900 shadow-xl p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Keyboard Shortcuts
            </h3>
            <ul className="space-y-1">
              {shortcuts.map(s => (
                <li key={s.key} className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-400">{s.label}</span>
                  <kbd className="ml-2 px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px] font-mono">
                    {s.key}
                  </kbd>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
