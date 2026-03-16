// src/ui/ProjectMenu.tsx
// Dropdown menu for project management — lives in the top bar.
import { useState, useRef, useEffect } from 'react';
import type { ProjectMeta } from '../engine/project-store';
import type { SaveStatus } from './useProjectLifecycle';

interface Props {
  projectName: string;
  projects: ProjectMeta[];
  saveError: boolean;
  saveStatus: SaveStatus;
  onRename: (name: string) => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
  onExportWav?: (bars: number) => void;
  exportingWav?: boolean;
}

export function ProjectMenu({
  projectName, projects, saveError, saveStatus,
  onRename, onNew, onOpen, onDuplicate, onDelete, onExport, onImport,
  onExportWav, exportingWav,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(projectName);
  const [importError, setImportError] = useState<string | null>(null);
  const [wavBarPicker, setWavBarPicker] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reset bar picker when menu closes
  useEffect(() => { if (!open) setWavBarPicker(false); }, [open]);

  // Focus input on edit
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Sync edit value when project changes
  useEffect(() => { setEditValue(projectName); }, [projectName]);

  const commitRename = () => {
    const name = editValue.trim();
    if (name && name !== projectName) onRename(name);
    setEditing(false);
  };

  const handleImportClick = () => { setImportError(null); fileRef.current?.click(); };
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        setImportError(null);
        await onImport(file);
        setOpen(false);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Import failed');
      }
    }
    // Reset so the same file can be re-imported
    e.target.value = '';
  };

  return (
    <div ref={menuRef} className="relative">
      {/* Project name button */}
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

      {/* Dropdown */}
      {open && (
        <div
          className="absolute top-full left-0 mt-1 w-64 bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-2xl shadow-black/50 z-50 overflow-hidden"
          style={{ animation: 'fade-up 0.1s ease-out' }}
        >
          {/* Rename */}
          <div className="px-3 py-2 border-b border-zinc-800/60">
            {editing ? (
              <form onSubmit={(e) => { e.preventDefault(); commitRename(); }} className="flex gap-1.5">
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
                  className="flex-1 bg-zinc-800 text-[11px] font-mono text-zinc-200 rounded px-2 py-1 outline-none border border-zinc-700/50 focus:border-zinc-500 min-w-0"
                />
              </form>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="text-[11px] font-mono text-zinc-300 hover:text-zinc-100 transition-colors w-full text-left truncate"
                title="Click to rename"
              >
                {projectName}
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="py-1">
            <MenuItem label="New project" onClick={() => { onNew(); setOpen(false); }} />
            <MenuItem label="Duplicate" onClick={() => { onDuplicate(); setOpen(false); }} />
            <MenuItem label="Export .gluon" onClick={() => { onExport(); setOpen(false); }} />
            <MenuItem label="Import .gluon" onClick={handleImportClick} />
            <input ref={fileRef} type="file" accept=".gluon,.json" className="hidden" onChange={handleFileChange} />
            {importError && (
              <div className="px-3 py-1.5 text-[10px] font-mono text-red-400/80">{importError}</div>
            )}
            {onExportWav && (
              <>
                <div className="border-t border-zinc-800/60 my-1" />
                {!wavBarPicker ? (
                  <MenuItem
                    label={exportingWav ? 'Exporting...' : 'Export WAV'}
                    onClick={() => { if (!exportingWav) setWavBarPicker(true); }}
                  />
                ) : (
                  <div className="px-3 py-1.5">
                    <div className="text-[9px] font-mono text-zinc-500 mb-1.5">Bars to export</div>
                    <div className="flex gap-1">
                      {[1, 2, 4, 8, 16].map(n => (
                        <button
                          key={n}
                          onClick={() => { onExportWav(n); setWavBarPicker(false); setOpen(false); }}
                          className="flex-1 px-1.5 py-1 text-[10px] font-mono text-zinc-300 bg-zinc-800 rounded hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
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
            <MenuItem label="Delete project" onClick={() => { onDelete(); setOpen(false); }} danger />
          </div>

          {/* Project list */}
          {projects.length > 1 && (
            <>
              <div className="border-t border-zinc-800/60" />
              <div className="py-1 max-h-48 overflow-y-auto chat-scroll">
                <div className="px-3 py-1">
                  <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-zinc-600">Projects</span>
                </div>
                {projects.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { onOpen(p.id); setOpen(false); }}
                    className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800/50 transition-colors"
                  >
                    <span className="text-[10px] font-mono text-zinc-400 truncate flex-1">{p.name}</span>
                    <span className="text-[9px] font-mono text-zinc-700 shrink-0">{relativeTime(p.updatedAt)}</span>
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

  // Show checkmark briefly on save, then fade out
  useEffect(() => {
    if (status === 'saved') {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(timer);
    }
    if (status === 'saving' || status === 'error') {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [status]);

  // Fixed-size container prevents layout shift when indicator appears/disappears
  return (
    <span className="w-2.5 h-2.5 shrink-0 flex items-center justify-center">
      {status === 'error' && (
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" title="Save failed — working in memory" />
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

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-[10px] font-mono transition-colors ${
        danger
          ? 'text-red-400/70 hover:text-red-400 hover:bg-red-500/10'
          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
      }`}
    >
      {label}
    </button>
  );
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
