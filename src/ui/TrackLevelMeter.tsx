// src/ui/TrackLevelMeter.tsx
// Thin horizontal level meter for the track sidebar.
import { useTrackLevel } from './useTrackLevel';

interface Props {
  analyser: AnalyserNode | null;
}

/** Color for a given level (0-1). */
function levelColor(level: number): string {
  if (level > 0.9) return '#ef4444'; // red-500
  if (level > 0.6) return '#f59e0b'; // amber-500
  return '#22c55e'; // green-500
}

export function TrackLevelMeter({ analyser }: Props) {
  const level = useTrackLevel(analyser);

  return (
    <div
      className="w-full h-1 bg-zinc-800/60 rounded-full overflow-hidden mt-0.5"
      title={`Level: ${Math.round(level * 100)}%`}
    >
      <div
        className="h-full rounded-full transition-none"
        style={{
          width: `${level * 100}%`,
          backgroundColor: levelColor(level),
        }}
      />
    </div>
  );
}
