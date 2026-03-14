// src/ui/TransportStrip.tsx
// Compact inline transport controls for the global top bar.
import { DraggableNumber } from './DraggableNumber';

interface Props {
  playing: boolean;
  bpm: number;
  swing: number;
  recording: boolean;
  globalStep: number;
  patternLength: number;
  onTogglePlay: () => void;
  onBpmChange: (bpm: number) => void;
  onSwingChange: (swing: number) => void;
  onToggleRecord: () => void;
}

export function TransportStrip({
  playing, bpm, swing, recording, globalStep, patternLength,
  onTogglePlay, onBpmChange, onSwingChange, onToggleRecord,
}: Props) {
  const bar = Math.floor(globalStep / patternLength) + 1;
  const beat = (globalStep % patternLength) + 1;

  return (
    <div className="flex items-center gap-2">
      {/* Play / Stop */}
      <button
        onClick={onTogglePlay}
        className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
          playing
            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
            : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-200'
        }`}
        title={playing ? 'Stop' : 'Play'}
      >
        {playing ? (
          <svg viewBox="0 0 16 16" className="w-3 h-3 fill-current">
            <rect x="3" y="3" width="10" height="10" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" className="w-3 h-3 fill-current">
            <polygon points="4,2 14,8 4,14" />
          </svg>
        )}
      </button>

      {/* BPM */}
      <DraggableNumber
        value={bpm}
        min={40}
        max={250}
        step={1}
        decimals={0}
        className="text-zinc-200 hover:text-amber-400 transition-colors"
        onChange={onBpmChange}
      />

      {/* Swing */}
      <DraggableNumber
        value={Math.round(swing * 100)}
        min={0}
        max={100}
        step={0.5}
        decimals={0}
        suffix="%"
        className="text-zinc-400 hover:text-amber-400 transition-colors"
        onChange={(pct) => onSwingChange(pct / 100)}
      />

      {/* Position */}
      <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
        {bar}.{beat}
      </span>

      {/* Record */}
      <button
        onClick={onToggleRecord}
        className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
          recording
            ? 'bg-red-500/30 text-red-400 border border-red-500/50 animate-pulse'
            : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-red-400'
        }`}
        title={recording ? 'Stop Recording' : 'Record'}
      >
        <div className={`w-2 h-2 rounded-full ${recording ? 'bg-red-500' : 'bg-current'}`} />
      </button>
    </div>
  );
}
