// src/ui/TransportStrip.tsx
// Compact inline transport controls for the global top bar.
import { DraggableNumber } from './DraggableNumber';

interface Props {
  playing: boolean;
  bpm: number;
  swing: number;
  recordArmed: boolean;
  globalStep: number;
  patternLength: number;
  onTogglePlay: () => void;
  onBpmChange: (bpm: number) => void;
  onSwingChange: (swing: number) => void;
  onToggleRecord: () => void;
}

export function TransportStrip({
  playing, bpm, swing, recordArmed, globalStep, patternLength,
  onTogglePlay, onBpmChange, onSwingChange, onToggleRecord,
}: Props) {
  const bar = Math.floor(globalStep / patternLength) + 1;
  const beat = (globalStep % patternLength) + 1;

  // Three visual states: inactive, armed (waiting for play), actively recording
  const activelyRecording = recordArmed && playing;

  return (
    <div className="flex items-center gap-3">
      {/* Transport controls: play, record — grouped tight */}
      <div className="flex items-center gap-1">
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
        <button
          onClick={onToggleRecord}
          className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
            activelyRecording
              ? 'bg-red-500/30 text-red-400 border border-red-500/50 animate-pulse'
              : recordArmed
                ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-red-400'
          }`}
          title={activelyRecording ? 'Disarm Recording' : recordArmed ? 'Disarm Recording' : 'Arm Recording'}
        >
          <div className={`w-2 h-2 rounded-full ${
            activelyRecording ? 'bg-red-500' : recordArmed ? 'bg-red-400' : 'bg-current'
          }`} />
        </button>
      </div>

      {/* Position */}
      <div className="flex items-baseline gap-1">
        <span className="text-[9px] uppercase tracking-wider text-zinc-600">Pos</span>
        <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
          {bar}.{beat}
        </span>
      </div>

      {/* BPM */}
      <div className="flex items-baseline gap-1">
        <span className="text-[9px] uppercase tracking-wider text-zinc-600">Tempo</span>
        <DraggableNumber
          value={bpm}
          min={40}
          max={250}
          step={1}
          decimals={0}
          className="text-zinc-200 hover:text-amber-400 transition-colors"
          onChange={onBpmChange}
        />
      </div>

      {/* Swing */}
      <div className="flex items-baseline gap-1">
        <span className="text-[9px] uppercase tracking-wider text-zinc-600">Swing</span>
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
      </div>
    </div>
  );
}
