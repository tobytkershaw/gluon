// src/ui/TrackLevelMeter.tsx
// Per-track level meter for the track sidebar.
// Supports vertical (left-edge bar) and horizontal (bottom bar) orientations.
import { useTrackLevel } from './useTrackLevel';

interface Props {
  analyser: AnalyserNode | null;
  /** Orientation: 'vertical' renders a left-edge bar, 'horizontal' a bottom bar. Default 'horizontal'. */
  orientation?: 'vertical' | 'horizontal';
  /** Keep a visible meter shell even before the analyser is ready. */
  showShellWhenUnavailable?: boolean;
}

/** Color for a given level (0-1). */
function levelColor(level: number): string {
  if (level > 0.9) return '#ef4444'; // red-500
  if (level > 0.6) return '#f59e0b'; // amber-500
  return '#22c55e'; // green-500
}

export function TrackLevelMeter({
  analyser,
  orientation = 'horizontal',
  showShellWhenUnavailable = true,
}: Props) {
  const level = useTrackLevel(analyser);
  const title = analyser
    ? `Level: ${Math.round(level * 100)}%`
    : 'Level meter unavailable';

  if (orientation === 'vertical') {
    return (
      <div
        className={`w-1 h-5 rounded-full overflow-hidden flex flex-col justify-end shrink-0 border ${
          showShellWhenUnavailable
            ? 'bg-zinc-900/80 border-zinc-700/70'
            : 'bg-zinc-800/60 border-transparent'
        }`}
        title={title}
        aria-label={title}
      >
        <div
          className="w-full rounded-full transition-none"
          style={{
            height: `${level * 100}%`,
            backgroundColor: level > 0 ? levelColor(level) : 'transparent',
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`w-full h-1.5 rounded-full overflow-hidden mt-0.5 border ${
        showShellWhenUnavailable
          ? 'bg-zinc-900/80 border-zinc-800/70'
          : 'bg-zinc-800/60 border-transparent'
      }`}
      title={title}
      aria-label={title}
    >
      <div
        className="h-full rounded-full transition-none"
        style={{
          width: `${level * 100}%`,
          backgroundColor: level > 0 ? levelColor(level) : 'transparent',
        }}
      />
    </div>
  );
}
