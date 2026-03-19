// src/ui/TrackList.tsx
// Vertical track sidebar — replaces horizontal TrackStage in the top bar.
import { useCallback } from 'react';
import type { Track, TrackKind } from '../engine/types';
import { getTrackKind, getOrderedTracks, MASTER_BUS_ID } from '../engine/types';
import { getTrackLabel } from '../engine/track-labels';
import { TrackRow } from './TrackRow';
import { TrackLevelMeter } from './TrackLevelMeter';
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
  onCycleApproval?: (trackId: string) => void;
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
}

export function TrackList({
  tracks, activeTrackId, expandedTrackIds, activityMap,
  onSelectTrack, onToggleTrackExpanded, onToggleMute, onToggleSolo,
  onRenameTrack, onCycleApproval,
  onAddTrack, onRemoveTrack, onSetMusicalRole, onSetImportance,
  onAddSend, onRemoveSend, onSetSendLevel,
  maxTracks = 16,
  audioEngine, masterVolume, masterStereoAnalysers, onMasterVolumeChange,
}: Props) {
  const canAdd = tracks.length < maxTracks;

  // Order tracks: audio → buses → master bus
  const ordered = getOrderedTracks({ tracks } as { tracks: Track[] });
  const audioTracks = ordered.filter(t => getTrackKind(t) === 'audio');
  const busTracks = ordered.filter(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID);
  const masterBus = ordered.find(t => t.id === MASTER_BUS_ID);

  // Can only remove if more than 1 audio track remains (bus removal is separate)
  const canRemoveAudio = audioTracks.length > 1;

  // All bus tracks (including master) for send target selection
  const allBusTracks = ordered.filter(t => getTrackKind(t) === 'bus');

  const handleVolumeInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onMasterVolumeChange?.(parseFloat(e.target.value));
  }, [onMasterVolumeChange]);

  return (
    <div className="w-48 border-l border-zinc-800/60 bg-zinc-900/60 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800/40 flex items-center justify-between">
        <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600">
          Tracks
        </span>
        <div className="flex gap-1">
          {onAddTrack && (
            <button
              onClick={() => onAddTrack('audio')}
              disabled={!canAdd}
              className={`text-[11px] font-mono px-1.5 h-4 flex items-center justify-center rounded cursor-pointer transition-colors ${
                canAdd
                  ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
                  : 'text-zinc-700 cursor-not-allowed'
              }`}
              title={canAdd ? 'Add audio track' : `Maximum ${maxTracks} tracks`}
            >
              + Track
            </button>
          )}
          {onAddTrack && (
            <button
              onClick={() => onAddTrack('bus')}
              disabled={!canAdd}
              className={`text-[11px] font-mono px-1.5 h-4 flex items-center justify-center rounded cursor-pointer transition-colors ${
                canAdd
                  ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
                  : 'text-zinc-700 cursor-not-allowed'
              }`}
              title={canAdd ? 'Add bus track' : `Maximum ${maxTracks} tracks`}
            >
              + Bus
            </button>
          )}
        </div>
      </div>

      {/* Track rows — scrollable */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {/* Audio tracks */}
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

            onRename={onRenameTrack ? (name) => onRenameTrack(track.id, name) : undefined}
            onCycleApproval={onCycleApproval ? () => onCycleApproval(track.id) : undefined}
            onRemove={onRemoveTrack && canRemoveAudio ? () => onRemoveTrack(track.id) : undefined}
            onSetMusicalRole={onSetMusicalRole ? (r) => onSetMusicalRole(track.id, r) : undefined}
            onSetImportance={onSetImportance ? (v) => onSetImportance(track.id, v) : undefined}
            busTracks={allBusTracks}
            onAddSend={onAddSend ? (busId, level) => onAddSend(track.id, busId, level) : undefined}
            onRemoveSend={onRemoveSend ? (busId) => onRemoveSend(track.id, busId) : undefined}
            onSetSendLevel={onSetSendLevel ? (busId, level) => onSetSendLevel(track.id, busId, level) : undefined}
          />
        ))}

        {/* Separator between audio and bus tracks */}
        {busTracks.length > 0 && audioTracks.length > 0 && (
          <div className="border-t border-zinc-800/40 my-1" />
        )}

        {/* Bus tracks (non-master) */}
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

            onRename={onRenameTrack ? (name) => onRenameTrack(track.id, name) : undefined}
            onRemove={onRemoveTrack ? () => onRemoveTrack(track.id) : undefined}
            busTracks={allBusTracks}
            onAddSend={onAddSend ? (busId, level) => onAddSend(track.id, busId, level) : undefined}
            onRemoveSend={onRemoveSend ? (busId) => onRemoveSend(track.id, busId) : undefined}
            onSetSendLevel={onSetSendLevel ? (busId, level) => onSetSendLevel(track.id, busId, level) : undefined}
          />
        ))}
      </div>

      {/* Master bus — anchored at bottom, outside scrollable area */}
      {masterBus && (
        <div className="border-t border-zinc-800/40 p-1.5 shrink-0">
          <TrackRow
            track={masterBus}
            label={getTrackLabel(masterBus)}
            isActive={masterBus.id === activeTrackId}
            isExpanded={false}
            isBus
            isMasterBus
            analyser={audioEngine?.getTrackAnalyser(masterBus.id) ?? null}
            activityTimestamp={activityMap[masterBus.id] ?? null}
            onClick={() => onSelectTrack(masterBus.id)}
            onToggleMute={() => onToggleMute(masterBus.id)}
            onToggleSolo={(additive) => onToggleSolo(masterBus.id, additive)}
          />
          {/* Master volume slider + stereo meter */}
          <div className="flex items-center gap-1.5 mt-1 px-1">
            <span className="text-[9px] font-mono uppercase text-zinc-600 shrink-0">Vol</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={masterVolume ?? 0.8}
              onChange={handleVolumeInput}
              onClick={(e) => e.stopPropagation()}
              className="master-volume-slider flex-1 h-1 cursor-pointer"
              title={`Master volume: ${Math.round((masterVolume ?? 0.8) * 100)}%`}
              aria-label="Master volume"
            />
            <span className="text-[10px] font-mono text-zinc-600 w-5 text-right shrink-0 tabular-nums">
              {Math.round((masterVolume ?? 0.8) * 100)}
            </span>
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
