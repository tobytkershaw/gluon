// src/ui/TrackRow.tsx
// Horizontal track row for the vertical track sidebar.
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Track, ApprovalLevel } from '../engine/types';
import { computeThumbprintColor } from './thumbprint';

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
  activityTimestamp: number | null;
  onClick: () => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onToggleAgency?: () => void;
  onRename?: (name: string) => void;
  onCycleApproval?: () => void;
}

export function TrackRow({
  track, label, isActive, activityTimestamp,
  onClick, onToggleMute, onToggleSolo, onToggleAgency, onRename, onCycleApproval,
}: Props) {
  const [pulsing, setPulsing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
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

  const thumbColor = computeThumbprintColor(track);
  const approval = track.approval ?? 'exploratory';
  const approvalInfo = APPROVAL_DISPLAY[approval];

  return (
    <div
      className={`relative flex items-center gap-2 px-2.5 py-1.5 rounded cursor-pointer transition-colors ${
        isActive
          ? 'bg-zinc-800 border border-zinc-700'
          : 'bg-transparent hover:bg-zinc-800/40 border border-transparent'
      }`}
      onClick={onClick}
    >
      {/* Activity pulse overlay */}
      <div
        className="absolute inset-0 rounded bg-amber-400/15 pointer-events-none"
        style={{
          opacity: pulsing ? 1 : 0,
          transition: 'opacity 2s ease-out',
        }}
      />

      {/* Thumbprint dot */}
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: thumbColor, transition: 'background-color 1s ease' }}
      />

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
            track.muted ? 'text-zinc-600 opacity-50' : isActive ? 'text-zinc-200' : 'text-zinc-500'
          }`}
          onDoubleClick={handleDoubleClick}
        >
          {label}
        </span>
      )}

      {/* Agency indicator */}
      {track.agency === 'ON' && (
        <div className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />
      )}

      {/* M / S / C / Approval buttons */}
      <div className="flex gap-0.5 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
          className={`text-[9px] font-mono w-4 h-4 flex items-center justify-center rounded transition-colors ${
            track.muted ? 'bg-red-500/20 text-red-400' : 'text-zinc-600 hover:text-zinc-400'
          }`}
        >
          M
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}
          className={`text-[9px] font-mono w-4 h-4 flex items-center justify-center rounded transition-colors ${
            track.solo ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-600 hover:text-zinc-400'
          }`}
        >
          S
        </button>
        {onToggleAgency && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleAgency(); }}
            title={track.agency === 'OFF' ? 'AI: Protected' : 'AI: Editable'}
            className={`text-[9px] font-mono w-4 h-4 flex items-center justify-center rounded transition-colors ${
              track.agency === 'OFF'
                ? 'bg-amber-500/20 text-amber-400'
                : 'text-zinc-600 hover:text-zinc-400'
            }`}
          >
            C
          </button>
        )}
        {onCycleApproval && approvalInfo.label && (
          <button
            onClick={(e) => { e.stopPropagation(); onCycleApproval(); }}
            title={approvalInfo.title}
            className={`text-[9px] font-mono w-4 h-4 flex items-center justify-center rounded transition-colors ${approvalInfo.color}`}
          >
            {approvalInfo.label}
          </button>
        )}
      </div>
    </div>
  );
}
