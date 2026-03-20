// src/ui/TrackList.tsx
// Vertical track sidebar — restyled to match mockup 09-track-sidebar.html.
import { useCallback } from 'react';
import type { Track, TrackKind } from '../engine/types';
import { getTrackKind, getOrderedTracks, MASTER_BUS_ID } from '../engine/types';
import { getTrackLabel } from '../engine/track-labels';
import { TrackRow } from './TrackRow';
import type { TrackRowVariant } from './TrackRow';
import { TrackLevelMeter } from './TrackLevelMeter';
import { Knob } from './Knob';
import type { AudioEngine } from '../audio/audio-engine';

interface Props {
  tracks: Track[];
  activeTrackId: string;
  /** IDs of tracks whose sidebar rows are expanded (accordion-style). */
  expandedTrackIds?: string[];
  activityMap: Record<string, number>;
  onSelectTrack: (trackId: string) => void;
  onToggleTrackExpanded?: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string, additive?: boolean) => void;
  onRenameTrack?: (trackId: string, name: string) => void;
  onToggleClaim?: (trackId: string) => void;
  onAddTrack?: (kind?: TrackKind) => void;
  onRemoveTrack?: (trackId: string) => void;
  onSetMusicalRole?: (trackId: string, role: string) => void;
  onSetImportance?: (trackId: string, importance: number) => void;
  onAddSend?: (trackId: string, busId: string, level?: number) => void;
  onRemoveSend?: (trackId: string, busId: string) => void;
  onSetSendLevel?: (trackId: string, busId: string, level: number) => void;
  maxTracks?: number;
  /** Audio engine ref for per-track analyser access. */
  audioEngine?: AudioEngine | null;
  /** Master bus volume (0-1). */
  masterVolume?: number;
  /** Master bus stereo analysers for the anchored meter. */
  masterStereoAnalysers?: [AnalyserNode, AnalyserNode] | null;
  onMasterVolumeChange?: (v: number) => void;
  onMasterInteractionStart?: () => void;
  onMasterInteractionEnd?: () => void;
  /** Display variant for track rows. Defaults to 'default'. */
  variant?: TrackRowVariant;
}

export function TrackList({
  tracks, activeTrackId, expandedTrackIds, activityMap,
  onSelectTrack, onToggleTrackExpanded, onToggleMute, onToggleSolo,
  onRenameTrack, onToggleClaim,
  onAddTrack, onRemoveTrack, onSetMusicalRole, onSetImportance,
  onAddSend, onRemoveSend, onSetSendLevel,
  maxTracks = 16,
  audioEngine, masterVolume, masterStereoAnalysers, onMasterVolumeChange,
  onMasterInteractionStart, onMasterInteractionEnd,
  variant = 'default',
}: Props) {
  const canAdd = tracks.length < maxTracks;

  // Order tracks: audio -> buses -> master bus
  const ordered = getOrderedTracks({ tracks } as { tracks: Track[] });
  const audioTracks = ordered.filter(t => getTrackKind(t) === 'audio');
  const busTracks = ordered.filter(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID);
  const masterBus = ordered.find(t => t.id === MASTER_BUS_ID);

  // Can only remove if more than 1 audio track remains (bus removal is separate)
  const canRemoveAudio = audioTracks.length > 1;

  // All bus tracks (including master) for send target selection
  const allBusTracks = ordered.filter(t => getTrackKind(t) === 'bus');

  const handleMasterVolumeChange = useCallback((v: number) => {
    onMasterVolumeChange?.(v);
  }, [onMasterVolumeChange]);

  return (
    <div
      className="flex flex-col min-h-0 h-full"
      style={{
        width: 200,
        background: 'var(--bg-surface, #1c1917)',
        borderRight: '1px solid var(--border, rgba(61, 57, 53, 0.6))',
        flexShrink: 0,
      }}
    >
      {/* Sidebar header */}
      <div
        className="flex items-center justify-between"
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle, rgba(61, 57, 53, 0.3))',
        }}
      >
        <span
          className="font-mono uppercase"
          style={{
            fontSize: 9,
            letterSpacing: '0.08em',
            color: 'var(--text-faint, #57534e)',
          }}
        >
          {variant === 'stage' ? 'Stage' : 'Tracks'}
        </span>
        <div className="flex gap-0.5">
          {onAddTrack && (
            <>
              <button
                onClick={() => onAddTrack('audio')}
                disabled={!canAdd}
                className="font-mono cursor-pointer transition-all rounded"
                style={{
                  padding: '2px 6px',
                  fontSize: 8,
                  border: '1px solid var(--border-subtle, rgba(61, 57, 53, 0.3))',
                  background: 'none',
                  color: canAdd ? 'var(--text-muted, #7c776e)' : 'var(--text-faint, #57534e)',
                  opacity: canAdd ? 1 : 0.5,
                }}
                title={canAdd ? 'Add audio track' : `Maximum ${maxTracks} tracks`}
              >
                + Track
              </button>
              <button
                onClick={() => onAddTrack('bus')}
                disabled={!canAdd}
                className="font-mono cursor-pointer transition-all rounded"
                style={{
                  padding: '2px 6px',
                  fontSize: 8,
                  border: '1px solid var(--border-subtle, rgba(61, 57, 53, 0.3))',
                  background: 'none',
                  color: canAdd ? 'var(--text-muted, #7c776e)' : 'var(--text-faint, #57534e)',
                  opacity: canAdd ? 1 : 0.5,
                }}
                title={canAdd ? 'Add bus track' : `Maximum ${maxTracks} tracks`}
              >
                + Bus
              </button>
            </>
          )}
        </div>
      </div>

      {/* Audio track rows — scrollable */}
      <div className="flex-1 overflow-y-auto" style={{ padding: 4 }} role="list" aria-label="Tracks">
        {audioTracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            label={getTrackLabel(track)}
            isActive={track.id === activeTrackId}
            isExpanded={(expandedTrackIds ?? []).includes(track.id)}
            onToggleExpand={onToggleTrackExpanded ? () => onToggleTrackExpanded(track.id) : undefined}
            analyser={audioEngine?.getTrackAnalyser(track.id) ?? null}
            activityTimestamp={activityMap[track.id] ?? null}
            onClick={() => onSelectTrack(track.id)}
            onToggleMute={() => onToggleMute(track.id)}
            onToggleSolo={(additive) => onToggleSolo(track.id, additive)}
            variant={variant}

            onRename={onRenameTrack ? (name) => onRenameTrack(track.id, name) : undefined}
            onToggleClaim={onToggleClaim ? () => onToggleClaim(track.id) : undefined}
            onRemove={onRemoveTrack && canRemoveAudio ? () => onRemoveTrack(track.id) : undefined}
            onSetMusicalRole={onSetMusicalRole ? (r) => onSetMusicalRole(track.id, r) : undefined}
            onSetImportance={onSetImportance ? (v) => onSetImportance(track.id, v) : undefined}
            busTracks={allBusTracks}
            onAddSend={onAddSend ? (busId, level) => onAddSend(track.id, busId, level) : undefined}
            onRemoveSend={onRemoveSend ? (busId) => onRemoveSend(track.id, busId) : undefined}
            onSetSendLevel={onSetSendLevel ? (busId, level) => onSetSendLevel(track.id, busId, level) : undefined}
          />
        ))}
      </div>

      {/* Bus tracks — separated section at bottom above master */}
      {busTracks.length > 0 && (
        <div
          className="shrink-0"
          style={{
            borderTop: '1px solid var(--border-subtle, rgba(61, 57, 53, 0.3))',
            padding: 4,
          }}
        >
          {busTracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              label={getTrackLabel(track)}
              isActive={track.id === activeTrackId}
              isExpanded={(expandedTrackIds ?? []).includes(track.id)}
              onToggleExpand={onToggleTrackExpanded ? () => onToggleTrackExpanded(track.id) : undefined}
              isBus
              analyser={audioEngine?.getTrackAnalyser(track.id) ?? null}
              activityTimestamp={activityMap[track.id] ?? null}
              onClick={() => onSelectTrack(track.id)}
              onToggleMute={() => onToggleMute(track.id)}
              onToggleSolo={(additive) => onToggleSolo(track.id, additive)}
              variant={variant}

              onRename={onRenameTrack ? (name) => onRenameTrack(track.id, name) : undefined}
              onRemove={onRemoveTrack ? () => onRemoveTrack(track.id) : undefined}
              busTracks={allBusTracks}
              onAddSend={onAddSend ? (busId, level) => onAddSend(track.id, busId, level) : undefined}
              onRemoveSend={onRemoveSend ? (busId) => onRemoveSend(track.id, busId) : undefined}
              onSetSendLevel={onSetSendLevel ? (busId, level) => onSetSendLevel(track.id, busId, level) : undefined}
            />
          ))}
        </div>
      )}

      {/* Master bus — anchored at bottom */}
      {masterBus && (
        <div
          className="shrink-0"
          style={{
            borderTop: '1px solid var(--border-subtle, rgba(61, 57, 53, 0.3))',
            padding: '8px 12px',
          }}
        >
          <div className="flex items-center gap-2">
            {/* Master meter */}
            {audioEngine && (
              <TrackLevelMeter
                analyser={audioEngine.getTrackAnalyser(masterBus.id) ?? null}
                orientation="vertical"
              />
            )}
            <span
              className="font-mono uppercase font-medium"
              style={{
                fontSize: 9,
                letterSpacing: '0.06em',
                color: 'var(--text-muted, #7c776e)',
              }}
            >
              Master
            </span>
            <div className="flex-1" />
            {/* Master volume knob */}
            {onMasterVolumeChange && (
              <Knob
                value={masterVolume ?? 0.8}
                label=""
                accentColor="zinc"
                onChange={handleMasterVolumeChange}
                onPointerDown={onMasterInteractionStart}
                onPointerUp={onMasterInteractionEnd}
                size={20}
              />
            )}
          </div>
          {/* Stereo level meter for master bus */}
          {masterStereoAnalysers && (
            <MasterBusMeter stereoAnalysers={masterStereoAnalysers} />
          )}
        </div>
      )}
    </div>
  );
}

/** Thin horizontal stereo level meter for the master bus in the sidebar. */
function MasterBusMeter({ stereoAnalysers }: { stereoAnalysers: [AnalyserNode, AnalyserNode] }) {
  return (
    <div className="flex gap-0.5 mt-1 px-1">
      <TrackLevelMeter analyser={stereoAnalysers[0]} />
      <TrackLevelMeter analyser={stereoAnalysers[1]} />
    </div>
  );
}
