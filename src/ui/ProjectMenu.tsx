// src/ui/ProjectMenu.tsx
// Dropdown menu for project management - lives in the top bar.
import { useState, useRef, useEffect } from 'react';
import type { ProjectMeta } from '../engine/project-store';
import type { SaveStatus } from './useProjectLifecycle';

interface Props {
  projectName: string;
  projects: ProjectMeta[];
  saveError: boolean;
  saveStatus: SaveStatus;
  projectActionError?: string | null;
  onRename: (name: string) => Promise<boolean> | boolean;
  onNew: () => Promise<boolean> | boolean;
  onOpen: (id: string) => Promise<boolean> | boolean;
  onDuplicate: () => Promise<boolean> | boolean;
  onDelete: () => Promise<boolean> | boolean;
  onExport: () => Promise<boolean> | boolean;
  onImport: (file: File) => Promise<boolean> | boolean;
  onExportWav?: (bars: number) => void;
  exportingWav?: boolean;
}

export function ProjectMenu({
  projectName, projects, saveError, saveStatus, projectActionError = null,
  onRename, onNew, onOpen, onDuplicate, onDelete, onExport, onImport,
  onExportWav, exportingWav,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(projectName);
  const [wavBarPicker, setWavBarPicker] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => { if (!open) setWavBarPicker(false); }, [open]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => { setEditValue(projectName); }, [projectName]);

  const persistenceActionsUnavailable = saveError;

  const commitRename = async () => {
    const name = editValue.trim();
    if (!name || name === projectName) {
      setEditing(false);
      return;
    }
    const ok = await onRename(name);
    if (ok !== false) {
      setEditing(false);
    }
  };

  const handleAction = async (action: () => Promise<boolean> | boolean, closeOnSuccess = true) => {
    if (persistenceActionsUnavailable) return false;
    const ok = await action();
    if (ok !== false && closeOnSuccess) {
      setOpen(false);
    }
    return ok !== false;
  };

  const handleImportClick = () => {
    if (persistenceActionsUnavailable) return;
    fileRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleAction(() => onImport(file));
    }
    e.target.value = '';
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-800/50 transition-colors group"
      >
        <SaveIndicator status={saveStatus} />
        <span className="text-[11px] font-mono text-zinc-300 group-hover:text-zinc-100 truncate max-w-[160px]">
          {projectName}
        </span>
        <svg viewBox="0 0 16 16" className="w-2.5 h-2.5 text-zinc-600 shrink-0">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 w-64 bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-2xl shadow-black/50 z-50 overflow-hidden"
          style={{ animation: 'fade-up 0.1s ease-out' }}
        >
          {(persistenceActionsUnavailable || projectActionError) && (
            <div className="px-3 py-2 border-b border-zinc-800/60 space-y-1">
              {persistenceActionsUnavailable && (
                <div className="text-[11px] font-mono text-amber-400/90">
                  Working in memory: save/open/import/duplicate/delete are unavailable until IndexedDB recovers. Export remains available for rescue.
                </div>
              )}
              {projectActionError && (
                <div className="text-[11px] font-mono text-red-400/90 break-words">
                  {projectActionError}
                </div>
              )}
            </div>
          )}

          <div className="px-3 py-2 border-b border-zinc-800/60">
            {editing ? (
              <form onSubmit={(e) => { e.preventDefault(); void commitRename(); }} className="flex gap-1.5">
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => { void commitRename(); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
                  className="flex-1 bg-zinc-800 text-[11px] font-mono text-zinc-200 rounded px-2 py-1 outline-none border border-zinc-700/50 focus:border-zinc-500 min-w-0"
                />
              </form>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="text-[11px] font-mono text-zinc-300 hover:text-zinc-100 transition-colors w-full text-left truncate"
                title="Click to rename"
                disabled={persistenceActionsUnavailable}
              >
                {projectName}
              </button>
            )}
          </div>

          <div className="py-1">
            <MenuItem label="New project" disabled={persistenceActionsUnavailable} onClick={() => handleAction(() => onNew())} />
            <MenuItem label="Duplicate" disabled={persistenceActionsUnavailable} onClick={() => handleAction(() => onDuplicate())} />
            <MenuItem label="Export .gluon" onClick={() => { void onExport(); setOpen(false); }} />
            <MenuItem label="Import .gluon" disabled={persistenceActionsUnavailable} onClick={handleImportClick} />
            <input ref={fileRef} type="file" accept=".gluon,.json" className="hidden" onChange={handleFileChange} />
            {onExportWav && (
              <>
                <div className="border-t border-zinc-800/60 my-1" />
                {!wavBarPicker ? (
                  <MenuItem
                    label={exportingWav ? 'Exporting...' : 'Export WAV'}
                    disabled={false}
                    onClick={() => { if (!exportingWav) setWavBarPicker(true); }}
                  />
                ) : (
                  <div className="px-3 py-1.5">
                    <div className="text-[11px] font-mono text-zinc-500 mb-1.5">Bars to export</div>
                    <div className="flex gap-1">
                      {[1, 2, 4, 8, 16].map(n => (
                        <button
                          key={n}
                          onClick={() => { onExportWav(n); setWavBarPicker(false); setOpen(false); }}
                          className="flex-1 px-1.5 py-1 text-[11px] font-mono text-zinc-300 bg-zinc-800 rounded hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="border-t border-zinc-800/60 my-1" />
            <MenuItem label="Delete project" disabled={persistenceActionsUnavailable} onClick={() => handleAction(() => onDelete())} danger />
          </div>

          {projects.length > 1 && (
            <>
              <div className="border-t border-zinc-800/60" />
              <div className="py-1 max-h-48 overflow-y-auto chat-scroll">
                <div className="px-3 py-1">
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-600">Projects</span>
                </div>
                {projects.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { void handleAction(() => onOpen(p.id)); }}
                    disabled={persistenceActionsUnavailable}
                    className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="text-[11px] font-mono text-zinc-400 truncate flex-1">{p.name}</span>
                    <span className="text-[11px] font-mono text-zinc-700 shrink-0">{relativeTime(p.updatedAt)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (status === 'saved') {
      setVisible(true); // eslint-disable-line react-hooks/set-state-in-effect -- notification timer
      const timer = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(timer);
    }
    if (status === 'saving' || status === 'error') {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [status]);

  return (
    <span className="w-2.5 h-2.5 shrink-0 flex items-center justify-center">
      {status === 'error' && (
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" title="IndexedDB unavailable; working in memory" />
      )}
      {status === 'saving' && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-amber-400"
          style={{ animation: 'pulse-soft 1s ease-in-out infinite' }}
          title="Saving..."
        />
      )}
      {status === 'saved' && visible && (
        <svg viewBox="0 0 16 16" className="w-2.5 h-2.5 text-emerald-500/70 transition-opacity duration-500" title="Saved">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

function MenuItem({
  label, onClick, danger, disabled,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors ${
        disabled
          ? 'text-zinc-600 cursor-not-allowed'
          : danger
            ? 'text-red-400 hover:bg-red-950/30'
            : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100'
      }`}
    >
      {label}
    </button>
  );
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
