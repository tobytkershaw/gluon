// src/ui/TrackerCheatSheet.tsx
// Keyboard shortcuts cheat sheet overlay for the tracker view.
import { useState, useCallback, useEffect } from 'react';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '\u2318' : 'Ctrl';

interface Binding {
  keys: string;
  description: string;
}

const SECTIONS: { title: string; bindings: Binding[] }[] = [
  {
    title: 'Transport',
    bindings: [
      { keys: 'Space', description: 'Play / Stop' },
      { keys: `${MOD}+Z`, description: 'Undo' },
    ],
  },
  {
    title: 'Navigation',
    bindings: [
      { keys: 'Tab', description: 'Switch view (Control / Tracker)' },
      { keys: `${MOD}+1`, description: 'Control view' },
      { keys: `${MOD}+2`, description: 'Tracker view' },
      { keys: `${MOD}+/`, description: 'Toggle chat sidebar' },
    ],
  },
  {
    title: 'Editing',
    bindings: [
      { keys: 'Double-click', description: 'Edit cell value' },
      { keys: 'Enter', description: 'Commit edit' },
      { keys: 'Escape', description: 'Cancel edit' },
    ],
  },
];

export function TrackerCheatSheet() {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen(o => !o), []);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open]);

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className={`w-6 h-6 flex items-center justify-center rounded text-[11px] font-bold transition-colors ${
          open
            ? 'bg-zinc-700 text-zinc-200'
            : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
        }`}
        title="Keyboard shortcuts"
        aria-label="Show keyboard shortcuts"
      >
        ?
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          {/* Popover */}
          <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-zinc-700/80 bg-zinc-900/95 backdrop-blur-md shadow-xl p-3">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
              Keyboard Shortcuts
            </div>
            {SECTIONS.map(section => (
              <div key={section.title} className="mb-2 last:mb-0">
                <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">
                  {section.title}
                </div>
                {section.bindings.map(b => (
                  <div
                    key={b.keys}
                    className="flex items-center justify-between py-0.5"
                  >
                    <span className="text-[11px] text-zinc-400">
                      {b.description}
                    </span>
                    <kbd className="text-[10px] font-mono text-zinc-300 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 ml-2 whitespace-nowrap">
                      {b.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
