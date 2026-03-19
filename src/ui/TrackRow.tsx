// src/ui/TrackRow.tsx
// Horizontal track row for the vertical track sidebar.
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Track, ApprovalLevel, Send } from '../engine/types';
import { getTrackLabel } from '../engine/track-labels';
import { computeThumbprintColor } from './thumbprint';
import { TrackLevelMeter } from './TrackLevelMeter';

const APPROVAL_DISPLAY: Record<ApprovalLevel, { label: string; color: string; title: string; humanLabel: string }> = {
  exploratory: { label: '\u25CB', color: 'bg-zinc-700/30 text-zinc-600', title: 'Draft — Gluon may freely edit (click to promote)', humanLabel: 'Draft' },
  liked: { label: '\u2661', color: 'bg-amber-500/20 text-amber-400', title: 'Keeper — Gluon preserves unless asked (click to promote)', humanLabel: 'Keeper' },
  approved: { label: '\u25C9', color: 'bg-teal-500/20 text-teal-400', title: 'Locked — Gluon preserves during expansion (click to promote)', humanLabel: 'Locked' },
  anchor: { label: '\u2693', color: 'bg-purple-500/20 text-purple-400', title: 'Anchor — core identity, changes need confirmation (click to cycle)', humanLabel: 'Anchor' },
};

/** Map importance 0-1 to a 3-tier display: low / mid / high. */
const IMPORTANCE_TIERS = [
  { label: 'Low', threshold: 0.33 },
  { label: 'Mid', threshold: 0.66 },
  { label: 'High', threshold: 1.01 },
] as const;

function importanceTier(value: number): 0 | 1 | 2 {
  if (value <= 0.33) return 0;
  if (value <= 0.66) return 1;
  return 2;
}

function tierToValue(tier: 0 | 1 | 2): number {
  return [0.2, 0.5, 0.9][tier];
}

interface Props {
  track: Track;
  label: string;
  isActive: boolean;
  /** Whether this track row is expanded (shows sends, metadata). Independent of selection. */
  isExpanded: boolean;
  /** Toggle expand/collapse for this track row. */
  onToggleExpand?: () => void;
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
  onSetMusicalRole?: (role: string) => void;
  onSetImportance?: (importance: number) => void;
  /** Available bus tracks for send routing. */
  busTracks?: Track[];
  onAddSend?: (busId: string, level?: number) => void;
  onRemoveSend?: (busId: string) => void;
  onSetSendLevel?: (busId: string, level: number) => void;
}

export function TrackRow({
  track, label, isActive, isExpanded, onToggleExpand, isBus, isMasterBus, analyser,
  activityTimestamp,
  onClick, onToggleMute, onToggleSolo, onToggleAgency, onRename, onCycleApproval,
  onRemove, onSetMusicalRole, onSetImportance,
  busTracks, onAddSend, onRemoveSend, onSetSendLevel,
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

      {/* Main row: chevron + meter + dot + label + controls */}
      <div className="flex items-center gap-2">
        {/* Expand/collapse chevron */}
        {onToggleExpand && !isMasterBus && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
            className="text-[8px] text-zinc-600 hover:text-zinc-400 w-3 h-3 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
            title={isExpanded ? 'Collapse' : 'Expand'}
            aria-label={isExpanded ? 'Collapse track details' : 'Expand track details'}
          >
            {isExpanded ? '\u25BC' : '\u25B6'}
          </button>
        )}

        {/* Per-track vertical level meter — always visible */}
        {analyser && <TrackLevelMeter analyser={analyser} orientation="vertical" />}

        {/* Thumbprint dot — bus tracks show a different shape + bus badge */}
        {isBus ? (
          <>
            <div
              className={`w-2 h-2 shrink-0 ${isMasterBus ? 'rounded-sm bg-zinc-500' : 'rounded-sm bg-zinc-600'}`}
              style={{ transition: 'background-color 1s ease' }}
            />
            {!isMasterBus && (
              <span className="text-[8px] font-mono uppercase text-zinc-600 tracking-wider shrink-0 leading-none">
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
            className="text-[12px] font-mono uppercase tracking-wider flex-1 min-w-0 bg-zinc-900 border border-zinc-600 rounded px-1 py-0 text-zinc-200 outline-none"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            maxLength={20}
          />
        ) : (
          <span
            className={`text-[12px] font-mono uppercase tracking-wider flex-1 truncate ${
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
            title={track.agency === 'OFF' ? 'Gluon agency — protected from Gluon edits (click to allow)' : 'Gluon agency — Gluon may modify this track (click to protect)'}
            className={`shrink-0 text-[9px] font-mono font-bold uppercase leading-none px-0.5 rounded cursor-pointer transition-colors ${
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
            className={`text-[11px] font-mono w-4 h-4 flex items-center justify-center rounded cursor-pointer transition-colors ${
              track.muted ? 'bg-red-500/20 text-red-400' : 'text-zinc-600 hover:text-zinc-400'
            }`}
            title="Mute"
          >
            M
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSolo(e.shiftKey); }}
            className={`text-[11px] font-mono w-4 h-4 flex items-center justify-center rounded cursor-pointer transition-colors ${
              track.solo ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-600 hover:text-zinc-400'
            }`}
            title="Solo"
          >
            S
          </button>
          {onCycleApproval && (
            <button
              onClick={(e) => { e.stopPropagation(); onCycleApproval(); }}
              title={approvalInfo.title}
              className={`text-[11px] font-mono w-4 h-4 flex items-center justify-center rounded cursor-pointer transition-colors ${approvalInfo.color}`}
              aria-label={`Protection: ${approvalInfo.humanLabel}`}
            >
              {approvalInfo.label}
            </button>
          )}
          {/* Track removal: select track then press Delete/Backspace */}
        </div>
      </div>

      {/* Expanded sends section (expanded non-master tracks only) */}
      {isExpanded && !isMasterBus && onAddSend && busTracks && (
        <SendSection
          sends={track.sends ?? []}
          busTracks={busTracks}
          trackId={track.id}
          onAddSend={onAddSend}
          onRemoveSend={onRemoveSend}
          onSetSendLevel={onSetSendLevel}
        />
      )}

      {/* Expanded metadata: approval, importance, musical role (expanded non-bus tracks only) */}
      {isExpanded && !isBus && !isMasterBus && (
        <div className="mt-1.5 space-y-1 px-0.5">
          {/* Approval level — full label with cycle control */}
          {onCycleApproval && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono uppercase text-zinc-600 w-6 shrink-0" title="Protection level — how much Gluon should preserve this track">Prot</span>
              <button
                onClick={(e) => { e.stopPropagation(); onCycleApproval(); }}
                className={`text-[10px] font-mono px-1 py-0 rounded cursor-pointer transition-colors ${approvalInfo.color} hover:brightness-125`}
                title={approvalInfo.title}
                aria-label={`Protection: ${approvalInfo.humanLabel}`}
              >
                {approvalInfo.humanLabel}
              </button>
            </div>
          )}
          {/* Importance — 3-tier selector */}
          {onSetImportance && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono uppercase text-zinc-600 w-6 shrink-0" title="Importance — how prominent this track is in the mix">Imp</span>
              <div className="flex gap-0.5">
                {IMPORTANCE_TIERS.map((tier, i) => {
                  const currentTier = importanceTier(track.importance ?? 0.5);
                  const isSelected = currentTier === i;
                  return (
                    <button
                      key={tier.label}
                      onClick={(e) => { e.stopPropagation(); onSetImportance(tierToValue(i as 0 | 1 | 2)); }}
                      className={`text-[9px] font-mono px-1 py-0 rounded cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-zinc-600/40 text-zinc-300'
                          : 'text-zinc-600 hover:text-zinc-400'
                      }`}
                      title={`${tier.label} importance (${Math.round(tierToValue(i as 0 | 1 | 2) * 100)}%)`}
                      aria-label={`Set importance to ${tier.label.toLowerCase()}`}
                    >
                      {tier.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {/* Musical role */}
          {onSetMusicalRole && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono uppercase text-zinc-600 w-6 shrink-0" title="Musical Role — what this track contributes (e.g. driving rhythm, bass, lead)">Role</span>
              {editingRole ? (
                <input
                  ref={roleInputRef}
                  className="text-[10px] font-mono flex-1 min-w-0 bg-zinc-900 border border-zinc-600 rounded px-1 py-0 text-zinc-300 outline-none"
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
                  className="text-[10px] font-mono text-zinc-500 flex-1 truncate cursor-pointer hover:text-zinc-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRoleEditValue(track.musicalRole ?? '');
                    setEditingRole(true);
                  }}
                  title={track.musicalRole || 'Click to set musical role'}
                >
                  {track.musicalRole || '\u2014'}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Send routing section ---

interface SendSectionProps {
  sends: Send[];
  busTracks: Track[];
  trackId: string;
  onAddSend?: (busId: string, level?: number) => void;
  onRemoveSend?: (busId: string) => void;
  onSetSendLevel?: (busId: string, level: number) => void;
}

function SendSection({ sends, busTracks, trackId, onAddSend, onRemoveSend, onSetSendLevel }: SendSectionProps) {
  const [addOpen, setAddOpen] = useState(false);

  // Bus targets that don't already have a send (and exclude self)
  const availableBuses = busTracks.filter(
    (bus) => bus.id !== trackId && !sends.some((s) => s.busId === bus.id),
  );

  return (
    <div className="mt-1.5 px-0.5 space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono uppercase text-zinc-600 tracking-wider">Sends</span>
        {availableBuses.length > 0 && onAddSend && (
          <button
            onClick={(e) => { e.stopPropagation(); setAddOpen(!addOpen); }}
            className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 cursor-pointer transition-colors"
            title="Add send"
          >
            +
          </button>
        )}
      </div>

      {/* Existing sends */}
      {sends.map((send) => {
        const bus = busTracks.find((b) => b.id === send.busId);
        const busLabel = bus ? getTrackLabel(bus) : send.busId;
        return (
          <div key={send.busId} className="flex items-center gap-1">
            <span className="text-[10px] font-mono text-zinc-500 w-10 truncate shrink-0" title={busLabel}>
              {busLabel}
            </span>
            {onSetSendLevel && (
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={send.level}
                onChange={(e) => { e.stopPropagation(); onSetSendLevel(send.busId, parseFloat(e.target.value)); }}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 h-1 accent-zinc-500 cursor-pointer"
                title={`Send level: ${Math.round(send.level * 100)}%`}
                aria-label={`Send level to ${busLabel}`}
              />
            )}
            <span className="text-[9px] font-mono text-zinc-600 w-4 text-right shrink-0 tabular-nums">
              {Math.round(send.level * 100)}
            </span>
            {onRemoveSend && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveSend(send.busId); }}
                className="text-[10px] font-mono text-zinc-700 hover:text-red-400 cursor-pointer transition-colors shrink-0"
                title={`Remove send to ${busLabel}`}
              >
                x
              </button>
            )}
          </div>
        );
      })}

      {/* Add send dropdown */}
      {addOpen && availableBuses.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-700 rounded p-0.5 space-y-0.5">
          {availableBuses.map((bus) => (
            <button
              key={bus.id}
              onClick={(e) => {
                e.stopPropagation();
                onAddSend?.(bus.id);
                setAddOpen(false);
              }}
              className="w-full text-left text-[10px] font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded px-1 py-0.5 cursor-pointer transition-colors"
            >
              {getTrackLabel(bus)}
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {sends.length === 0 && !addOpen && (
        <span className="text-[9px] font-mono text-zinc-700 italic">No sends</span>
      )}
    </div>
  );
}
