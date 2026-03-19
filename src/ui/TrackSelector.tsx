// src/ui/TrackSelector.tsx
import type { Track } from '../engine/types';
import { getTrackLabel } from '../engine/track-labels';

interface Props {
  tracks: Track[];
  activeTrackId: string;
  onSelectTrack: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string, additive?: boolean) => void;
  compact?: boolean;
}

export function TrackSelector({ tracks, activeTrackId, onSelectTrack, onToggleMute, onToggleSolo, compact }: Props) {
  return (
    <div className="flex gap-1">
      {tracks.map((track) => {
        const isActive = track.id === activeTrackId;
        const label = getTrackLabel(track).toUpperCase();

        if (compact) {
          return (
            <div
              key={track.id}
              className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors ${
                isActive
                  ? 'bg-zinc-800 border border-zinc-700'
                  : 'bg-zinc-900/50 hover:bg-zinc-800/50'
              }`}
              onClick={() => onSelectTrack(track.id)}
            >
              <span className={`text-[11px] font-medium tracking-wider ${isActive ? 'text-zinc-200' : 'text-zinc-500'}`}>
                {label}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleMute(track.id); }}
                className={`text-[11px] px-0.5 rounded ${
                  track.muted ? 'bg-red-500/20 text-red-400' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                M
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSolo(track.id, e.shiftKey); }}
                className={`text-[11px] px-0.5 rounded ${
                  track.solo ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                S
              </button>
            </div>
          );
        }

        return (
          <div
            key={track.id}
            className={`flex flex-col gap-1 px-3 py-2 rounded-t-lg cursor-pointer transition-colors ${
              isActive
                ? 'bg-zinc-800 border-t border-x border-zinc-700'
                : 'bg-zinc-900/50 hover:bg-zinc-800/50'
            }`}
            onClick={() => onSelectTrack(track.id)}
          >
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium tracking-wider ${isActive ? 'text-zinc-200' : 'text-zinc-500'}`}>
                {label}
              </span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); onToggleMute(track.id); }}
                className={`text-[11px] px-1 rounded ${
                  track.muted ? 'bg-red-500/20 text-red-400' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                M
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSolo(track.id, e.shiftKey); }}
                className={`text-[11px] px-1 rounded ${
                  track.solo ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                S
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
