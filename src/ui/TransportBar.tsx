// src/ui/TransportBar.tsx
import { useState, useCallback } from 'react';

interface Props {
  playing: boolean;
  bpm: number;
  swing: number;
  recording: boolean;
  globalStep: number;
  patternLength: number;
  onTogglePlay: () => void;
  onHardStop: () => void;
  onBpmChange: (bpm: number) => void;
  onSwingChange: (swing: number) => void;
  onToggleRecord: () => void;
}

export function TransportBar({
  playing, bpm, swing, recording, globalStep, patternLength,
  onTogglePlay, onHardStop, onBpmChange, onSwingChange, onToggleRecord,
}: Props) {
  const [editingBpm, setEditingBpm] = useState(false);
  const [bpmInput, setBpmInput] = useState(String(bpm));

  const currentStep = Math.floor(globalStep % patternLength);
  const currentBar = Math.floor(globalStep / patternLength) + 1;

  const handleBpmSubmit = useCallback(() => {
    const parsed = parseInt(bpmInput, 10);
    if (!isNaN(parsed)) onBpmChange(parsed);
    setEditingBpm(false);
  }, [bpmInput, onBpmChange]);

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-zinc-900 rounded-lg border border-zinc-800">
      <button
        onClick={onTogglePlay}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
          playing
            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
            : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-200'
        }`}
        title={playing ? 'Pause (tails ring out) [Space]' : 'Play [Space]'}
      >
        {playing ? (
          <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current">
            <rect x="3" y="3" width="4" height="10" />
            <rect x="9" y="3" width="4" height="10" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current">
            <polygon points="4,2 14,8 4,14" />
          </svg>
        )}
      </button>
      <button
        onClick={onHardStop}
        className="w-10 h-10 rounded-full flex items-center justify-center transition-colors bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-200"
        title="Hard stop — silence all voices [Shift+Space]"
      >
        <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current">
          <rect x="3" y="3" width="10" height="10" />
        </svg>
      </button>

      <div className="flex items-center gap-2">
        <span className="text-zinc-500 text-xs uppercase tracking-wider">BPM</span>
        {editingBpm ? (
          <input
            type="number"
            value={bpmInput}
            onChange={(e) => setBpmInput(e.target.value)}
            onBlur={handleBpmSubmit}
            onKeyDown={(e) => e.key === 'Enter' && handleBpmSubmit()}
            className="w-14 bg-zinc-800 text-zinc-100 text-sm px-2 py-1 rounded border border-zinc-600 outline-none"
            autoFocus
            min={60}
            max={200}
          />
        ) : (
          <button
            onClick={() => { setBpmInput(String(bpm)); setEditingBpm(true); }}
            className="text-zinc-200 text-sm font-mono tabular-nums hover:text-amber-400 transition-colors"
          >
            {bpm}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-zinc-500 text-xs uppercase tracking-wider">Swing</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(swing * 100)}
          onChange={(e) => onSwingChange(Number(e.target.value) / 100)}
          className="w-16 accent-amber-500"
        />
        <span className="text-zinc-400 text-xs font-mono w-8">
          {Math.round(swing * 100)}%
        </span>
      </div>

      <div className="flex-1" />

      {playing && (
        <span className="text-zinc-400 text-sm font-mono tabular-nums">
          {currentBar}:{String(currentStep + 1).padStart(2, '0')}
        </span>
      )}

      <button
        onClick={onToggleRecord}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          recording
            ? 'bg-red-500/30 text-red-400 border border-red-500/50 animate-pulse'
            : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-red-400'
        }`}
        title={recording ? 'Stop Recording' : 'Record'}
      >
        <div className={`w-3 h-3 rounded-full ${recording ? 'bg-red-500' : 'bg-current'}`} />
      </button>
    </div>
  );
}
