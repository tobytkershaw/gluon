// src/ui/TrackRow.tsx
// Horizontal track row for the vertical track sidebar.
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Track, ApprovalLevel } from '../engine/types';
import { computeThumbprintColor } from './thumbprint';
import { TrackLevelMeter } from './TrackLevelMeter';

const APPROVAL_DISPLAY: Record<ApprovalLevel, { label: string; color: string; title: string }> = {
  exploratory: { label: '', color: '', title: 'Exploratory — AI may freely edit' },
  liked: { label: 'L', color: 'bg-blue-500/20 text-blue-400', title: 'Liked — AI preserves unless asked' },
  approved: { label: 'A', color: 'bg-emerald-500/20 text-emerald-400', title: 'Approved — AI preserves during expansion' },
  anchor: { label: '#', color: 'bg-purple-500/20 text-purple-400', title: 'Anchor — core identity, changes need confirmation' },
};

interface Props {
  track: Track;
  label: string;
  isActive: boolean;
  /** Whether this track is a bus (send/return mixing). */
  isBus?: boolean;
  /** Whether this is the master bus track. */
  isMasterBus?: boolean;
  /** Per-track analyser node for level metering. */
  analyser?: AnalyserNode | null;
  activityTimestamp: number | null;
  onClick: () => void;
  onToggleMute: () => void;
  onToggleSolo: (additive?: boolean) => void;
  onToggleAgency?: () => void;
  onRename?: (name: string) => void;
  onCycleApproval?: () => void;
  onRemove?: () => void;
  onSetImportance?: (importance: number) => void;
  onSetMusicalRole?: (role: string) => void;
}

export function TrackRow({
  track, label, isActive, isBus, isMasterBus, analyser,
  activityTimestamp,
  onClick, onToggleMute, onToggleSolo, onToggleAgency, onRename, onCycleApproval,
  onRemove, onSetImportance, onSetMusicalRole,
}: Props) {
  const [pulsing, setPulsing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [editingRole, setEditingRole] = useState(false);
  const [roleEditValue, setRoleEditValue] = useState('');
  const roleInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!activityTimestamp) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- timer-driven animation pulse
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), 2000);
    return () => clearTimeout(timer);
  }, [activityTimestamp]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (editingRole) {
      roleInputRef.current?.focus();
      roleInputRef.current?.select();
    }
  }, [editingRole]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && onRename) {
      onRename(trimmed);
    }
    setEditing(false);
  }, [editValue, onRename]);

  const cancelRename = useCallback(() => {
    setEditing(false);
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRename) return;
    setEditValue(label);
    setEditing(true);
  }, [onRename, label]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }, [commitRename, cancelRename]);

  const commitRole = useCallback(() => {
    const trimmed = roleEditValue.trim();
    if (onSetMusicalRole) {
      onSetMusicalRole(trimmed);
    }
    setEditingRole(false);
  }, [roleEditValue, onSetMusicalRole]);

  const cancelRole = useCallback(() => {
    setEditingRole(false);
  }, []);

  const handleRoleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRole();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRole();
    }
  }, [commitRole, cancelRole]);

  const rowRef = useRef<HTMLDivElement>(null);

  // Handle Delete/Backspace on the focused track row
  const handleRowKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!onRemove) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Don't intercept if editing inline
      if (editing || editingRole) return;
      e.preventDefault();
      e.stopPropagation();
      onRemove();
    }
  }, [onRemove, editing, editingRole]);

  const thumbColor = computeThumbprintColor(track);
  const approval = track.approval ?? 'exploratory';
  const approvalInfo = APPROVAL_DISPLAY[approval];

  return (
    <div
      ref={rowRef}
      tabIndex={0}
      className={`group/row relative px-2.5 py-1.5 rounded cursor-pointer transition-colors outline-none ${
        isActive
          ? 'bg-zinc-800 border border-zinc-700 focus:border-zinc-600'
          : isBus
            ? 'bg-zinc-900/60 hover:bg-zinc-800/40 border border-zinc-800/30'
            : 'bg-transparent hover:bg-zinc-800/40 border border-transparent'
      }${isBus && !isMasterBus ? ' ml-1.5 border-l-2 border-l-zinc-700/50' : ''}`}
      onClick={onClick}
      onKeyDown={handleRowKeyDown}
    >
      {/* Activity pulse overlay */}
      <div
        className="absolute inset-0 rounded bg-amber-400/15 pointer-events-none"
        style={{
          opacity: pulsing ? 1 : 0,
          transition: 'opacity 2s ease-out',
        }}
      />

      {/* Main row: dot + label + controls */}
      <div className="flex items-center gap-2">
        {/* Thumbprint dot — bus tracks show a different shape + bus badge */}
        {isBus ? (
          <>
            <div
              className={`w-2 h-2 shrink-0 ${isMasterBus ? 'rounded-sm bg-zinc-500' : 'rounded-sm bg-zinc-600'}`}
              style={{ transition: 'background-color 1s ease' }}
            />
            {!isMasterBus && (
              <span className="text-[6px] font-mono uppercase text-zinc-600 tracking-wider shrink-0 leading-none">
                bus
              </span>
            )}
          </>
        ) : (
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: thumbColor, transition: 'background-color 1s ease' }}
          />
        )}

        {/* Track label */}
        {editing ? (
          <input
            ref={inputRef}
            className="text-[10px] font-mono uppercase tracking-wider flex-1 min-w-0 bg-zinc-900 border border-zinc-600 rounded px-1 py-0 text-zinc-200 outline-none"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            maxLength={20}
          />
        ) : (
          <span
            className={`text-[10px] font-mono uppercase tracking-wider flex-1 truncate ${
              track.muted ? 'text-zinc-600 opacity-50' : isActive ? 'text-zinc-200' : isBus ? 'text-zinc-500 italic' : 'text-zinc-500'
            }`}
            title={label}
            onDoubleClick={handleDoubleClick}
          >
            {label}
          </span>
        )}

        {/* Agency indicator — distinct from thumbprint: clickable text badge */}
        {onToggleAgency && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleAgency(); }}
            title={track.agency === 'OFF' ? 'AI: Protected (click to enable)' : 'AI: Editable (click to protect)'}
            className={`shrink-0 text-[7px] font-mono font-bold uppercase leading-none px-0.5 rounded cursor-pointer transition-colors ${
              track.agency === 'ON'
                ? 'bg-teal-400/20 text-teal-400 hover:bg-teal-400/30'
                : 'bg-zinc-700/30 text-zinc-600 hover:bg-zinc-700/50'
            }`}
          >
            AI
          </button>
        )}

        {/* M / S / Approval buttons */}
        <div className="flex gap-0.5 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
            className={`text-[9px] font-mono w-4 h-4 flex items-center justify-center rounded cursor-pointer transition-colors ${
              track.muted ? 'bg-red-500/20 text-red-400' : 'text-zinc-600 hover:text-zinc-400'
            }`}
            title="Mute"
          >
            M
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSolo(e.shiftKey); }}
            className={`text-[9px] font-mono w-4 h-4 flex items-center justify-center rounded cursor-pointer transition-colors ${
              track.solo ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-600 hover:text-zinc-400'
            }`}
            title="Solo"
          >
            S
          </button>
          {onCycleApproval && approvalInfo.label && (
            <button
              onClick={(e) => { e.stopPropagation(); onCycleApproval(); }}
              title={approvalInfo.title}
              className={`text-[9px] font-mono w-4 h-4 flex items-center justify-center rounded cursor-pointer transition-colors ${approvalInfo.color}`}
            >
              {approvalInfo.label}
            </button>
          )}
          {/* Track removal: select track then press Delete/Backspace */}
        </div>
      </div>

      {/* Per-track level meter */}
      {analyser && <TrackLevelMeter analyser={analyser} />}

      {/* Expanded metadata: importance + musical role (active non-bus tracks only) */}
      {isActive && !isBus && !isMasterBus && (onSetImportance || onSetMusicalRole) && (
        <div className="mt-1.5 space-y-1 px-0.5">
          {/* Importance slider */}
          {onSetImportance && (
            <div className="flex items-center gap-1.5">
              <span className="text-[7px] font-mono uppercase text-zinc-600 w-6 shrink-0">Imp</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={track.importance ?? 0.5}
                onChange={(e) => { e.stopPropagation(); onSetImportance(parseFloat(e.target.value)); }}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 h-1 accent-zinc-500 cursor-pointer"
                title={`Importance: ${Math.round((track.importance ?? 0.5) * 100)}%`}
                aria-label="Track importance"
              />
              <span className="text-[7px] font-mono text-zinc-600 w-5 text-right shrink-0">
                {Math.round((track.importance ?? 0.5) * 100)}
              </span>
            </div>
          )}
          {/* Musical role */}
          {onSetMusicalRole && (
            <div className="flex items-center gap-1.5">
              <span className="text-[7px] font-mono uppercase text-zinc-600 w-6 shrink-0">Role</span>
              {editingRole ? (
                <input
                  ref={roleInputRef}
                  className="text-[8px] font-mono flex-1 min-w-0 bg-zinc-900 border border-zinc-600 rounded px-1 py-0 text-zinc-300 outline-none"
                  value={roleEditValue}
                  onChange={(e) => setRoleEditValue(e.target.value)}
                  onBlur={commitRole}
                  onKeyDown={handleRoleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  maxLength={40}
                  placeholder="e.g. driving rhythm"
                />
              ) : (
                <span
                  className="text-[8px] font-mono text-zinc-500 flex-1 truncate cursor-pointer hover:text-zinc-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRoleEditValue(track.musicalRole ?? '');
                    setEditingRole(true);
                  }}
                  title={track.musicalRole || 'Click to set musical role'}
                >
                  {track.musicalRole || '—'}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
