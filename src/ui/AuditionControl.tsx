import type { Track } from '../engine/types';

/** Configuration for an audition session. */
export interface AuditionConfig {
  trackIds: string[];
  barRange: [number, number];
  loop: boolean;
}

interface AuditionControlProps {
  trackIds: string[];
  barRange: [number, number];
  loop: boolean;
  tracks: Track[];
  onStart: (config: AuditionConfig) => void;
  onStop: () => void;
  /** Whether THIS audition is currently active. */
  isPlaying: boolean;
}

/** Default hue when track has no visual identity — evenly distribute by index. */
function getTrackHue(track: Track, allTracks: Track[]): number {
  if (track.visualIdentity?.colour) return track.visualIdentity.colour.hue;
  const idx = allTracks.indexOf(track);
  return (idx * 137.5) % 360; // golden-angle distribution
}

function hslString(hue: number, s: number, l: number): string {
  return `hsl(${Math.round(hue)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

/**
 * Inline audition control rendered within chat messages.
 * Amber play/stop button, track pills, bar range, and optional LOOP badge.
 */
export function AuditionControl({
  trackIds,
  barRange,
  loop,
  tracks,
  onStart,
  onStop,
  isPlaying,
}: AuditionControlProps) {
  const config: AuditionConfig = { trackIds, barRange, loop };

  const handleClick = () => {
    if (isPlaying) {
      onStop();
    } else {
      onStart(config);
    }
  };

  return (
    <div
      className="my-2 flex items-center gap-3 rounded-lg px-3 py-2"
      style={{
        background: 'rgba(39, 39, 42, 0.5)',
        border: '1px solid rgba(63, 63, 70, 0.5)',
        borderLeft: '3px solid rgba(251, 191, 36, 0.6)',
      }}
    >
      {/* Play/Stop button */}
      <button
        onClick={handleClick}
        className="flex items-center justify-center shrink-0 rounded-full transition-all cursor-pointer"
        style={{
          width: 28,
          height: 28,
          background: isPlaying ? 'rgba(251, 191, 36, 0.25)' : 'rgba(251, 191, 36, 0.12)',
          border: `1px solid rgba(251, 191, 36, ${isPlaying ? '0.5' : '0.3'})`,
          color: '#fbbf24',
        }}
        title={isPlaying ? 'Stop audition' : 'Start audition'}
      >
        {isPlaying ? (
          // Stop icon (square)
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1" y="1" width="8" height="8" rx="1" />
          </svg>
        ) : (
          // Play icon (triangle)
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
            <polygon points="0,0 10,6 0,12" />
          </svg>
        )}
      </button>

      {/* Track pills */}
      <div className="flex flex-wrap items-center gap-1">
        {trackIds.map((id) => {
          const track = tracks.find((t) => t.id === id);
          if (!track) return null;
          const hue = getTrackHue(track, tracks);
          return (
            <span
              key={id}
              className="font-mono text-[9px] font-medium tracking-wide leading-tight rounded-[10px]"
              style={{
                padding: '2px 7px',
                background: hslString(hue, 60, 25) + '26', // ~15% opacity
                color: hslString(hue, 70, 65),
                border: `1px solid ${hslString(hue, 60, 40)}4d`, // ~30% opacity
              }}
            >
              {track.name || `Track ${id.slice(0, 4)}`}
            </span>
          );
        })}
      </div>

      {/* Meta: bar range + loop badge */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <span className="font-mono text-[10px] text-zinc-500">
          bars {barRange[0]}&ndash;{barRange[1]}
        </span>
        {loop && (
          <span
            className="font-mono text-[8px] uppercase tracking-widest rounded"
            style={{
              padding: '2px 5px',
              background: 'rgba(251, 191, 36, 0.1)',
              color: '#fbbf24',
              border: '1px solid rgba(251, 191, 36, 0.2)',
            }}
          >
            LOOP
          </span>
        )}
      </div>
    </div>
  );
}
