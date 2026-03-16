// src/ui/TrackList.tsx
// Vertical track sidebar — replaces horizontal TrackStage in the top bar.
import type { Track } from '../engine/types';
import { getTrackLabel } from '../engine/track-labels';
import { TrackRow } from './TrackRow';

interface Props {
  tracks: Track[];
  activeTrackId: string;
  activityMap: Record<string, number>;
  onSelectTrack: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onToggleAgency: (trackId: string) => void;
  onRenameTrack?: (trackId: string, name: string) => void;
  onCycleApproval?: (trackId: string) => void;
  onChangeVolume?: (trackId: string, value: number) => void;
  onChangePan?: (trackId: string, value: number) => void;
  onAddTrack?: () => void;
  onRemoveTrack?: (trackId: string) => void;
  maxTracks?: number;
}

export function TrackList({
  tracks, activeTrackId, activityMap,
  onSelectTrack, onToggleMute, onToggleSolo, onToggleAgency,
  onRenameTrack, onCycleApproval, onChangeVolume, onChangePan,
  onAddTrack, onRemoveTrack, maxTracks = 16,
}: Props) {
  const canAdd = tracks.length < maxTracks;
  const canRemove = tracks.length > 1;

  return (
    <div className="w-44 border-l border-zinc-800/40 bg-zinc-950/80 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800/40 flex items-center justify-between">
        <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-zinc-600">
          Tracks
        </span>
        {onAddTrack && (
          <button
            onClick={onAddTrack}
            disabled={!canAdd}
            className={`text-[10px] font-mono w-4 h-4 flex items-center justify-center rounded transition-colors ${
              canAdd
                ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
                : 'text-zinc-700 cursor-not-allowed'
            }`}
            title={canAdd ? 'Add track' : `Maximum ${maxTracks} tracks`}
          >
            +
          </button>
        )}
      </div>

      {/* Track rows */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            label={getTrackLabel(track)}
            isActive={track.id === activeTrackId}
            activityTimestamp={activityMap[track.id] ?? null}
            onClick={() => onSelectTrack(track.id)}
            onToggleMute={() => onToggleMute(track.id)}
            onToggleSolo={() => onToggleSolo(track.id)}
            onToggleAgency={() => onToggleAgency(track.id)}
            onRename={onRenameTrack ? (name) => onRenameTrack(track.id, name) : undefined}
            onCycleApproval={onCycleApproval ? () => onCycleApproval(track.id) : undefined}
            onChangeVolume={onChangeVolume ? (v) => onChangeVolume(track.id, v) : undefined}
            onChangePan={onChangePan ? (v) => onChangePan(track.id, v) : undefined}
            onRemove={onRemoveTrack && canRemove ? () => onRemoveTrack(track.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
