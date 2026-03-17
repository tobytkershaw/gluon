// src/ui/AudioLoadMeter.tsx
// Compact audio load indicator for the footer bar.
// Shows a small bar with green/amber/red states based on estimated audio thread load.
import { useAudioLoad } from './useAudioLoad';

interface Props {
  audioContext: AudioContext | null;
}

export function AudioLoadMeter({ audioContext }: Props) {
  const load = useAudioLoad(audioContext);
  const percent = Math.round(load * 100);

  let color: string;
  let label: string;
  if (load >= 0.9) {
    color = '#ef4444'; // red-500
    label = 'Audio overload';
  } else if (load >= 0.7) {
    color = '#f59e0b'; // amber-500
    label = 'Audio load high';
  } else {
    color = '#22c55e'; // green-500
    label = 'Audio load normal';
  }

  return (
    <div
      className="flex items-center gap-1.5 px-1.5 select-none"
      title={`${label}: ${percent}%`}
      aria-label={`Audio load: ${percent}%`}
    >
      <span className="text-[11px] text-zinc-500 font-mono">CPU</span>
      <div className="w-10 h-1.5 bg-zinc-800 rounded-sm overflow-hidden">
        <div
          className="h-full rounded-sm transition-all duration-200"
          style={{
            width: `${Math.max(percent, 8)}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}
