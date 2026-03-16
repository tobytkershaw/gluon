// src/ui/TrackList.tsx
// Vertical track sidebar — replaces horizontal TrackStage in the top bar.
import type { Track, TrackKind } from '../engine/types';
import { getTrackKind, getOrderedTracks, MASTER_BUS_ID } from '../engine/types';
import { getTrackLabel } from '../engine/track-labels';
import { TrackRow } from './TrackRow';

interface Props {
  tracks: Track[];
  activeTrackId: string;
  activityMap: Record<string, number>;
  onSelectTrack: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string, additive?: boolean) => void;
  onToggleAgency: (trackId: string) => void;
  onRenameTrack?: (trackId: string, name: string) => void;
  onCycleApproval?: (trackId: string) => void;
  onAddTrack?: (kind?: TrackKind) => void;
  onRemoveTrack?: (trackId: string) => void;
  maxTracks?: number;
}

export function TrackList({
  tracks, activeTrackId, activityMap,
  onSelectTrack, onToggleMute, onToggleSolo, onToggleAgency,
  onRenameTrack, onCycleApproval,
  onAddTrack, onRemoveTrack, maxTracks = 16,
}: Props) {
  const canAdd = tracks.length < maxTracks;

  // Order tracks: audio → buses → master bus
  const ordered = getOrderedTracks({ tracks } as { tracks: Track[] });
  const audioTracks = ordered.filter(t => getTrackKind(t) === 'audio');
  const busTracks = ordered.filter(t => getTrackKind(t) === 'bus' && t.id !== MASTER_BUS_ID);
  const masterBus = ordered.find(t => t.id === MASTER_BUS_ID);

  // Can only remove if more than 1 audio track remains (bus removal is separate)
  const canRemoveAudio = audioTracks.length > 1;

  return (
    <div className="w-44 border-l border-zinc-800/40 bg-zinc-950/80 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800/40 flex items-center justify-between">
        <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-zinc-600">
          Tracks
        </span>
        <div className="flex gap-1">
          {onAddTrack && (
            <button
              onClick={() => onAddTrack('audio')}
              disabled={!canAdd}
              className={`text-[9px] font-mono px-1.5 h-4 flex items-center justify-center rounded cursor-pointer transition-colors ${
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
              className={`text-[9px] font-mono px-1.5 h-4 flex items-center justify-center rounded cursor-pointer transition-colors ${
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

      {/* Track rows */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {/* Audio tracks */}
        {audioTracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            label={getTrackLabel(track)}
            isActive={track.id === activeTrackId}
            activityTimestamp={activityMap[track.id] ?? null}
            onClick={() => onSelectTrack(track.id)}
            onToggleMute={() => onToggleMute(track.id)}
            onToggleSolo={(additive) => onToggleSolo(track.id, additive)}
            onToggleAgency={() => onToggleAgency(track.id)}
            onRename={onRenameTrack ? (name) => onRenameTrack(track.id, name) : undefined}
            onCycleApproval={onCycleApproval ? () => onCycleApproval(track.id) : undefined}
            onRemove={onRemoveTrack && canRemoveAudio ? () => onRemoveTrack(track.id) : undefined}
          />
        ))}

        {/* Separator between audio and bus tracks */}
        {(busTracks.length > 0 || masterBus) && audioTracks.length > 0 && (
          <div className="border-t border-zinc-800/40 my-1" />
        )}

        {/* Bus tracks (non-master) */}
        {busTracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            label={getTrackLabel(track)}
            isActive={track.id === activeTrackId}
            isBus
            activityTimestamp={activityMap[track.id] ?? null}
            onClick={() => onSelectTrack(track.id)}
            onToggleMute={() => onToggleMute(track.id)}
            onToggleSolo={(additive) => onToggleSolo(track.id, additive)}
            onToggleAgency={() => onToggleAgency(track.id)}
            onRename={onRenameTrack ? (name) => onRenameTrack(track.id, name) : undefined}
            onRemove={onRemoveTrack ? () => onRemoveTrack(track.id) : undefined}
          />
        ))}

        {/* Master bus — always visible at bottom */}
        {masterBus && (
          <TrackRow
            key={masterBus.id}
            track={masterBus}
            label={getTrackLabel(masterBus)}
            isActive={masterBus.id === activeTrackId}
            isBus
            isMasterBus
            activityTimestamp={activityMap[masterBus.id] ?? null}
            onClick={() => onSelectTrack(masterBus.id)}
            onToggleMute={() => onToggleMute(masterBus.id)}
            onToggleSolo={(additive) => onToggleSolo(masterBus.id, additive)}
          />
        )}
      </div>
    </div>
  );
}
