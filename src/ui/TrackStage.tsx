// src/ui/TrackStage.tsx
import type { Track } from '../engine/types';
import { getTrackLabel } from '../engine/track-labels';
import { TrackCard } from './TrackCard';

interface TrackStageProps {
  tracks: Track[];
  activeTrackId: string;
  activityMap: Record<string, number>;
  onSelectTrack: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onToggleAgency?: (trackId: string) => void;
}

export function TrackStage({
  tracks, activeTrackId, activityMap,
  onSelectTrack, onToggleMute, onToggleSolo, onToggleAgency,
}: TrackStageProps) {
  return (
    <div className="flex gap-1">
      {tracks.map((track, i) => (
        <TrackCard
          key={track.id}
          track={track}
          label={getTrackLabel(track).toUpperCase()}
          isActive={track.id === activeTrackId}
          activityTimestamp={activityMap[track.id] ?? null}
          onClick={() => onSelectTrack(track.id)}
          onToggleMute={() => onToggleMute(track.id)}
          onToggleSolo={() => onToggleSolo(track.id)}
          onToggleAgency={onToggleAgency ? () => onToggleAgency(track.id) : undefined}
        />
      ))}
    </div>
  );
}
