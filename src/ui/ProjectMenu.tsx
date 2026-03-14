// src/ui/ProjectMenu.tsx
// Dropdown menu for project management — lives in the top bar.
import { useState, useRef, useEffect } from 'react';
import type { ProjectMeta } from '../engine/project-store';

interface Props {
  projectName: string;
  projects: ProjectMeta[];
  saveError: boolean;
  onRename: (name: string) => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
}

export function ProjectMenu({
  projectName, projects, saveError,
  onRename, onNew, onOpen, onDuplicate, onDelete, onExport, onImport,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(projectName);
  const [importError, setImportError] = useState<string | null>(null);
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
        {saveError && (
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" title="Save failed — working in memory" />
        )}
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
