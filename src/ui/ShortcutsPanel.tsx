// src/ui/ShortcutsPanel.tsx
// Global keyboard shortcuts reference overlay, toggled via Cmd+?.
import { useEffect } from 'react';
import { SHORTCUT_DEFS, type ShortcutDef } from './useShortcuts';

const SECTION_LABELS: Record<ShortcutDef['section'], string> = {
  transport: 'Transport',
  view: 'View',
  mixing: 'Mixing',
  editing: 'Editing',
  tracker: 'Tracker',
};

const SECTION_ORDER: ShortcutDef['section'][] = ['transport', 'mixing', 'view', 'editing', 'tracker'];

interface Props {
  onClose: () => void;
}

export function ShortcutsPanel({ onClose }: Props) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const grouped = new Map<ShortcutDef['section'], ShortcutDef[]>();
  for (const def of SHORTCUT_DEFS) {
    const list = grouped.get(def.section) ?? [];
    list.push(def);
    grouped.set(def.section, list);
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto w-[480px] max-h-[80vh] overflow-y-auto rounded-xl border border-zinc-700/60 bg-zinc-900 shadow-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-200 tracking-wide">
              Keyboard Shortcuts
            </h2>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              aria-label="Close"
            >
              <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="4" x2="12" y2="12" />
                <line x1="12" y1="4" x2="4" y2="12" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {SECTION_ORDER.map(section => {
              const defs = grouped.get(section);
              if (!defs || defs.length === 0) return null;
              return (
                <div key={section}>
                  <h3 className="text-[9px] font-semibold uppercase tracking-widest text-zinc-500 mb-1.5">
                    {SECTION_LABELS[section]}
                  </h3>
                  <ul className="space-y-0.5">
                    {defs.map(def => (
                      <li key={def.key} className="flex items-center justify-between text-[11px] py-0.5">
                        <span className="text-zinc-400">{def.label}</span>
                        <kbd className="ml-2 shrink-0 px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px] font-mono">
                          {def.key}
                        </kbd>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
