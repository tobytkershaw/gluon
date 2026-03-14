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
}

export function TrackList({
  tracks, activeTrackId, activityMap,
  onSelectTrack, onToggleMute, onToggleSolo, onToggleAgency,
  onRenameTrack,
}: Props) {
  return (
    <div className="w-44 border-l border-zinc-800/40 bg-zinc-950/80 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800/40">
        <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-zinc-600">
          Tracks
        </span>
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
          />
        ))}
      </div>
    </div>
  );
}
