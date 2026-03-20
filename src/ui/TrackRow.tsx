// src/ui/TrackRow.tsx
// Horizontal track row for the vertical track sidebar.
// Restyled to match mockup 09-track-sidebar.html.
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Track, Send } from '../engine/types';
import { getTrackLabel } from '../engine/track-labels';
import { computeThumbprintColor } from './thumbprint';
import { TrackLevelMeter } from './TrackLevelMeter';
import { Knob } from './Knob';

const CLAIM_DISPLAY = {
  unclaimed: { label: '\u25CB', color: '', title: 'Unclaimed \u2014 Gluon may freely edit (click to claim)', humanLabel: 'Unclaimed' },
  claimed: { label: '\u270B', color: '', title: 'Claimed \u2014 Gluon will ask before modifying (click to unclaim)', humanLabel: 'Claimed' },
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

/** Display variant for track rows. 'default' = full sidebar row, 'stage' = compact identity card. */
export type TrackRowVariant = 'default' | 'stage';

/** Convert a 0-1 normalised volume to dB display string. */
function volumeToDb(v: number): string {
  if (v <= 0) return '-\u221E';
  const db = 20 * Math.log10(v);
  if (db <= -60) return '-\u221E';
  const rounded = Math.round(db);
  return rounded >= 0 ? `+${rounded} dB` : `${rounded} dB`;
}

/** Convert a 0-1 normalised pan to L/C/R display string. */
function panToDisplay(v: number): string {
  const centered = Math.round((v - 0.5) * 100);
  if (Math.abs(centered) <= 2) return 'C';
  return centered < 0 ? `${Math.abs(centered)}L` : `${centered}R`;
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
  onRename?: (name: string) => void;
  onToggleClaim?: () => void;
  onRemove?: () => void;
  onSetMusicalRole?: (role: string) => void;
  onSetImportance?: (importance: number) => void;
  /** Whether this track is record-armed. */
  recordArmed?: boolean;
  onToggleRecordArm?: () => void;
  /** Whether this track is frozen. */
  frozen?: boolean;
  onToggleFreeze?: () => void;
  /** Available bus tracks for send routing. */
  busTracks?: Track[];
  onAddSend?: (busId: string, level?: number) => void;
  onRemoveSend?: (busId: string) => void;
  onSetSendLevel?: (busId: string, level: number) => void;
  /** Volume (0-1). */
  volume?: number;
  onVolumeChange?: (v: number) => void;
  onVolumeInteractionStart?: () => void;
  onVolumeInteractionEnd?: () => void;
  /** Pan (0-1, 0.5=center). */
  pan?: number;
  onPanChange?: (v: number) => void;
  onPanInteractionStart?: () => void;
  onPanInteractionEnd?: () => void;
  /** Whether this track belongs to a group (renders indented). */
  grouped?: boolean;
  /** Bus input sources display (e.g. "Kick, Lead"). */
  busInputSources?: string;
  /** Display variant. Defaults to 'default'. */
  variant?: TrackRowVariant;
}

export function TrackRow({
  track, label, isActive, isExpanded, onToggleExpand, isBus, isMasterBus, analyser,
  activityTimestamp,
  onClick, onToggleMute, onToggleSolo, onRename, onToggleClaim,
  onRemove, onSetMusicalRole, onSetImportance,
  recordArmed, onToggleRecordArm,
  frozen, onToggleFreeze,
  busTracks, onAddSend, onRemoveSend, onSetSendLevel,
  volume, onVolumeChange, onVolumeInteractionStart, onVolumeInteractionEnd,
  pan, onPanChange, onPanInteractionStart, onPanInteractionEnd,
  grouped,
  busInputSources,
  variant = 'default',
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
  const isClaimed = track.claimed ?? false;
  const claimInfo = isClaimed ? CLAIM_DISPLAY.claimed : CLAIM_DISPLAY.unclaimed;

  const moduleCount = track.surface.modules.length;

  // ── Stage card variant ──────────────────────────────────────────────
  if (variant === 'stage') {
    return (
      <div
        role="listitem"
        aria-selected={isActive}
        aria-label={label}
        tabIndex={0}
        className={`group/card relative px-2.5 py-2 rounded-md cursor-pointer transition-colors outline-none ${
          isActive
            ? 'bg-zinc-800 border border-zinc-600'
            : 'bg-zinc-900/40 hover:bg-zinc-800/50 border border-zinc-800/40'
        }`}
        onClick={onClick}
        onKeyDown={handleRowKeyDown}
      >
        {/* Colored accent bar on the left edge */}
        <div
          className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full"
          style={{ backgroundColor: isBus ? (isMasterBus ? '#71717a' : '#52525b') : thumbColor }}
        />

        {/* Top row: name + mute/solo indicators */}
        <div className="flex items-center gap-1.5 pl-1.5">
          <span
            className={`text-[12px] font-mono uppercase tracking-wider flex-1 truncate leading-tight ${
              track.muted ? 'text-zinc-600 opacity-50' : isActive ? 'text-zinc-200' : 'text-zinc-400'
            }`}
            title={label}
          >
            {label}
          </span>

          {/* Compact mute/solo indicators */}
          <div className="flex gap-0.5 shrink-0">
            {track.muted && (
              <span className="text-[9px] font-mono text-red-400/70 leading-none" title="Muted">M</span>
            )}
            {track.solo && (
              <span className="text-[9px] font-mono text-amber-400/70 leading-none" title="Solo">S</span>
            )}
          </div>
        </div>

        {/* Bottom row: role badge + module count */}
        <div className="flex items-center gap-1.5 pl-1.5 mt-0.5">
          {isBus ? (
            <span className="text-[8px] font-mono uppercase text-zinc-600 tracking-wider leading-none">
              {isMasterBus ? 'master' : 'bus'}
            </span>
          ) : track.musicalRole ? (
            <span className="text-[9px] font-mono text-zinc-500 truncate leading-none" title={track.musicalRole}>
              {track.musicalRole}
            </span>
          ) : (
            <span className="text-[9px] font-mono text-zinc-700 leading-none">{'\u2014'}</span>
          )}
          <div className="flex-1" />
          {moduleCount > 0 && (
            <span
              className="text-[8px] font-mono text-zinc-600 leading-none"
              title={`${moduleCount} surface ${moduleCount === 1 ? 'module' : 'modules'}`}
            >
              {moduleCount}m
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── Default variant (mockup 09 spec) ─────────────────────────────────
  return (
    <div
      ref={rowRef}
      role="listitem"
      aria-selected={isActive}
      aria-label={label}
      tabIndex={0}
      className={`group/row relative flex flex-col rounded-md cursor-pointer mb-px outline-none transition-colors ${
        isActive ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
      }${grouped ? '' : ''}`}
      onClick={onClick}
      onKeyDown={handleRowKeyDown}
    >
      {/* Activity pulse overlay — amber flash fading over 2s */}
      {pulsing && (
        <div
          className="absolute inset-0 rounded-md pointer-events-none"
          style={{
            background: 'rgba(251, 191, 36, 0.08)',
            animation: 'activity-fade 2s ease-out forwards',
          }}
        />
      )}

      {/* Top line: expand + meter + thumb + name/role + controls */}
      <div
        className="flex items-center gap-[5px]"
        style={{ padding: `5px 8px${grouped ? ' 5px 14px' : ''}` }}
      >
        {/* Expand/collapse chevron */}
        {onToggleExpand && !isMasterBus && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
            className="text-[11px] w-[14px] shrink-0 text-center cursor-pointer transition-transform"
            style={{
              color: 'var(--text-faint, #57534e)',
              transform: isExpanded ? 'rotate(90deg)' : 'none',
            }}
            title={isExpanded ? 'Collapse' : 'Expand'}
            aria-label={isExpanded ? 'Collapse track details' : 'Expand track details'}
          >
            {'\u25B8'}
          </button>
        )}

        {/* Vertical level meter */}
        {analyser && <TrackLevelMeter analyser={analyser} orientation="vertical" />}

        {/* Thumbprint dot — round for audio, square for bus */}
        {isBus ? (
          <div
            className="w-2 h-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: 'var(--zinc-600, #57534e)' }}
          />
        ) : (
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: thumbColor }}
          />
        )}

        {/* Track name + role label */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              ref={inputRef}
              className="text-[11px] font-sans font-medium flex-1 min-w-0 w-full bg-zinc-900 border border-zinc-600 rounded px-1 py-0 text-zinc-200 outline-none leading-tight"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              maxLength={20}
            />
          ) : (
            <div
              className="leading-tight truncate text-[11px] font-sans font-medium"
              style={{
                color: track.muted
                  ? 'var(--text-muted, #7c776e)'
                  : isBus
                    ? 'var(--text-secondary, #a8a39a)'
                    : 'var(--text-primary, #e5e2dc)',
                textDecoration: track.muted ? 'line-through' : 'none',
              }}
              title={label}
              onDoubleClick={handleDoubleClick}
            >
              {label}
            </div>
          )}
          {/* Role label */}
          {editingRole ? (
            <input
              ref={roleInputRef}
              className="text-[8px] font-mono w-full min-w-0 bg-zinc-900 border border-zinc-600 rounded px-1 py-0 outline-none leading-tight"
              style={{ color: 'var(--text-faint, #57534e)' }}
              value={roleEditValue}
              onChange={(e) => setRoleEditValue(e.target.value)}
              onBlur={commitRole}
              onKeyDown={handleRoleKeyDown}
              onClick={(e) => e.stopPropagation()}
              maxLength={40}
              placeholder="e.g. bass drum"
            />
          ) : (
            <div
              className="text-[8px] font-mono uppercase tracking-[0.04em] leading-tight truncate cursor-pointer"
              style={{ color: 'var(--text-faint, #57534e)' }}
              onClick={(e) => {
                if (!onSetMusicalRole) return;
                e.stopPropagation();
                setRoleEditValue(track.musicalRole ?? '');
                setEditingRole(true);
              }}
              title={isBus ? 'bus' : (track.musicalRole || 'Click to set role')}
            >
              {isBus ? 'bus' : (track.musicalRole || '\u2014')}
            </div>
          )}
        </div>

        {/* Control buttons: M S R + claim */}
        <div className="flex gap-0.5 items-center shrink-0">
          {/* Mute */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
            className="w-4 h-3.5 rounded-[2px] border border-transparent font-mono text-[7px] flex items-center justify-center cursor-pointer transition-all"
            style={track.muted ? {
              color: 'var(--rose-400, #fb7185)',
              background: 'rgba(251, 113, 133, 0.1)',
            } : {
              color: 'var(--text-faint, #57534e)',
            }}
            title="Mute"
          >
            M
          </button>
          {/* Solo */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSolo(e.shiftKey); }}
            className="w-4 h-3.5 rounded-[2px] border border-transparent font-mono text-[7px] flex items-center justify-center cursor-pointer transition-all"
            style={track.solo ? {
              color: 'var(--amber-400, #fbbf24)',
              background: 'rgba(251, 191, 36, 0.1)',
            } : {
              color: 'var(--text-faint, #57534e)',
            }}
            title="Solo"
          >
            S
          </button>
          {/* Record arm — audio tracks only */}
          {!isBus && onToggleRecordArm && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleRecordArm(); }}
              className="w-4 h-3.5 rounded-[2px] font-mono text-[7px] flex items-center justify-center cursor-pointer transition-all"
              style={recordArmed ? {
                color: 'var(--rose-400, #fb7185)',
                background: 'rgba(251, 113, 133, 0.12)',
                border: '1px solid rgba(251, 113, 133, 0.2)',
              } : {
                color: 'var(--text-faint, #57534e)',
                border: '1px solid transparent',
              }}
              title="Record arm"
            >
              R
            </button>
          )}
          {/* Claim toggle — audio tracks only (buses don't need it) */}
          {!isBus && onToggleClaim && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleClaim(); }}
              title={claimInfo.title}
              className="w-4 h-3.5 rounded-[2px] border border-transparent flex items-center justify-center cursor-pointer transition-all text-[10px]"
              style={isClaimed ? {
                color: '#e07840',
              } : {
                color: 'var(--text-faint, #57534e)',
              }}
              aria-label={`Protection: ${claimInfo.humanLabel}`}
            >
              {claimInfo.label}
            </button>
          )}
        </div>
      </div>

      {/* Expanded section */}
      {isExpanded && !isMasterBus && (
        <div className="flex flex-col gap-2" style={{ padding: '2px 8px 8px 26px' }}>
          {/* Vol + Pan knobs */}
          <div className="flex gap-3 items-end">
            {onVolumeChange && (
              <div className="flex flex-col items-center gap-px">
                <span className="text-[7px] font-mono uppercase tracking-[0.04em]" style={{ color: 'var(--text-faint, #57534e)' }}>Vol</span>
                <Knob
                  value={volume ?? 0.8}
                  label=""
                  accentColor="zinc"
                  onChange={onVolumeChange}
                  onPointerDown={onVolumeInteractionStart}
                  onPointerUp={onVolumeInteractionEnd}
                  size={22}
                />
                <span className="text-[7px] font-mono" style={{ color: 'var(--text-faint, #57534e)' }}>
                  {volumeToDb(volume ?? 0.8)}
                </span>
              </div>
            )}
            {onPanChange && (
              <div className="flex flex-col items-center gap-px">
                <span className="text-[7px] font-mono uppercase tracking-[0.04em]" style={{ color: 'var(--text-faint, #57534e)' }}>Pan</span>
                <Knob
                  value={pan ?? 0.5}
                  label=""
                  accentColor="zinc"
                  onChange={onPanChange}
                  onPointerDown={onPanInteractionStart}
                  onPointerUp={onPanInteractionEnd}
                  size={22}
                />
                <span className="text-[7px] font-mono" style={{ color: 'var(--text-faint, #57534e)' }}>
                  {panToDisplay(pan ?? 0.5)}
                </span>
              </div>
            )}
          </div>

          {/* Sends — audio tracks only */}
          {!isBus && onAddSend && busTracks && (
            <SendSection
              sends={track.sends ?? []}
              busTracks={busTracks}
              trackId={track.id}
              onAddSend={onAddSend}
              onRemoveSend={onRemoveSend}
              onSetSendLevel={onSetSendLevel}
            />
          )}

          {/* Bus input sources indicator — bus tracks only */}
          {isBus && busInputSources && (
            <div className="text-[7px] font-mono" style={{ color: 'var(--text-faint, #57534e)' }}>
              {'\u2190'} {busInputSources}
            </div>
          )}

          {/* Freeze button — audio tracks only */}
          {!isBus && onToggleFreeze && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleFreeze(); }}
              className="flex items-center gap-1 py-0.5 px-1.5 rounded border font-mono text-[7px] uppercase tracking-[0.04em] cursor-pointer transition-all self-start"
              style={frozen ? {
                color: 'var(--cyan-400, #22d3ee)',
                borderColor: 'rgba(34, 211, 238, 0.25)',
                background: 'rgba(34, 211, 238, 0.06)',
              } : {
                color: 'var(--text-faint, #57534e)',
                borderColor: 'var(--border-subtle, rgba(61, 57, 53, 0.3))',
                background: 'none',
              }}
              title={frozen ? 'Unfreeze track' : 'Freeze track'}
            >
              {'\u2744'} {frozen ? 'Frozen' : 'Freeze'}
            </button>
          )}

          {/* Expanded metadata: importance (kept for functional parity) */}
          {!isBus && onSetImportance && (
            <div className="flex items-center gap-1.5">
              <span className="text-[7px] font-mono uppercase tracking-[0.04em] shrink-0" style={{ color: 'var(--text-faint, #57534e)' }} title="Importance">Imp</span>
              <div className="flex gap-0.5">
                {IMPORTANCE_TIERS.map((tier, i) => {
                  const currentTier = importanceTier(track.importance ?? 0.5);
                  const isSelected = currentTier === i;
                  return (
                    <button
                      key={tier.label}
                      onClick={(e) => { e.stopPropagation(); onSetImportance(tierToValue(i as 0 | 1 | 2)); }}
                      className="text-[7px] font-mono px-1 py-0 rounded cursor-pointer transition-colors"
                      style={isSelected ? {
                        background: 'rgba(87, 83, 78, 0.4)',
                        color: 'var(--text-secondary, #a8a39a)',
                      } : {
                        color: 'var(--text-faint, #57534e)',
                      }}
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
        </div>
      )}
    </div>
  );
}

// --- Send routing section (restyled to match mockup) ---

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
    <div className="flex flex-col gap-0.5">
      <span className="text-[7px] font-mono uppercase tracking-[0.04em] mb-px" style={{ color: 'var(--text-faint, #57534e)' }}>Sends</span>

      {/* Existing sends */}
      {sends.map((send) => {
        const bus = busTracks.find((b) => b.id === send.busId);
        const busLabel = bus ? getTrackLabel(bus) : send.busId;
        return (
          <div key={send.busId} className="group/send flex items-center gap-2">
            <span className="text-[8px] font-mono min-w-[32px] truncate" style={{ color: 'var(--text-muted, #7c776e)' }} title={busLabel}>
              {busLabel}
            </span>
            {onSetSendLevel && (
              <Knob
                value={send.level}
                label=""
                accentColor="zinc"
                onChange={(v) => onSetSendLevel(send.busId, v)}
                size={18}
              />
            )}
            <span className="text-[7px] font-mono" style={{ color: 'var(--text-faint, #57534e)' }}>
              {Math.round(send.level * 100) - 100}
            </span>
            {onRemoveSend && (
              <span
                className="text-[8px] cursor-pointer opacity-0 group-hover/send:opacity-100 transition-opacity ml-0.5"
                style={{ color: 'var(--text-faint, #57534e)' }}
                onClick={(e) => { e.stopPropagation(); onRemoveSend(send.busId); }}
              >
                {'\u00D7'}
              </span>
            )}
          </div>
        );
      })}

      {/* + Add send link */}
      {availableBuses.length > 0 && onAddSend && !addOpen && (
        <span
          className="text-[8px] font-mono cursor-pointer py-px"
          style={{ color: 'var(--text-faint, #57534e)' }}
          onClick={(e) => { e.stopPropagation(); setAddOpen(true); }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.color = 'var(--text-muted, #7c776e)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.color = 'var(--text-faint, #57534e)'; }}
        >
          + Add send
        </span>
      )}

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
              className="w-full text-left text-[8px] font-mono hover:bg-zinc-800 rounded px-1 py-0.5 cursor-pointer transition-colors"
              style={{ color: 'var(--text-muted, #7c776e)' }}
            >
              {getTrackLabel(bus)}
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {sends.length === 0 && !addOpen && !(availableBuses.length > 0 && onAddSend) && (
        <span className="text-[7px] font-mono italic" style={{ color: 'var(--text-faint, #57534e)' }}>No sends</span>
      )}
    </div>
  );
}
