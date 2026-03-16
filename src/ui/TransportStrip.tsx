// src/ui/TransportStrip.tsx
// Compact inline transport controls for the global top bar.
import { useState, useRef, useEffect } from 'react';
import { DraggableNumber } from './DraggableNumber';

interface Props {
  playing: boolean;
  bpm: number;
  swing: number;
  recordArmed: boolean;
  globalStep: number;
  patternLength: number;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  onTogglePlay: () => void;
  onHardStop: () => void;
  onBpmChange: (bpm: number) => void;
  onSwingChange: (swing: number) => void;
  onToggleRecord: () => void;
  metronomeEnabled: boolean;
  metronomeVolume: number;
  onToggleMetronome: () => void;
  onMetronomeVolumeChange: (v: number) => void;
  onToggleLoop: () => void;
  onLoopStartChange: (step: number) => void;
  onLoopEndChange: (step: number) => void;
}

export function TransportStrip({
  playing, bpm, swing, recordArmed, globalStep, patternLength,
  loopEnabled, loopStart, loopEnd,
  onTogglePlay, onHardStop, onBpmChange, onSwingChange, onToggleRecord,
  metronomeEnabled, metronomeVolume, onToggleMetronome, onMetronomeVolumeChange,
  onToggleLoop, onLoopStartChange, onLoopEndChange,
}: Props) {
  const bar = Math.floor(globalStep / patternLength) + 1;
  const beat = Math.floor(globalStep % patternLength) + 1;

  // Three visual states: inactive, armed (waiting for play), actively recording
  const activelyRecording = recordArmed && playing;

  return (
    <div className="flex items-center gap-3">
      {/* Transport controls: play/pause, hard stop, record, loop — grouped tight */}
      <div className="flex items-center gap-1">
        <button
          onClick={onTogglePlay}
          className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
            playing
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
              : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-200'
          }`}
          title={playing ? 'Pause [Space]' : 'Play [Space]'}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" className="w-3 h-3 fill-current">
              <rect x="3" y="3" width="4" height="10" />
              <rect x="9" y="3" width="4" height="10" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" className="w-3 h-3 fill-current">
              <polygon points="4,2 14,8 4,14" />
            </svg>
          )}
        </button>
        <button
          onClick={onHardStop}
          className="w-6 h-6 rounded-full flex items-center justify-center transition-colors bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-200"
          title="Hard stop — silence all voices [Shift+Space]"
        >
          <svg viewBox="0 0 16 16" className="w-3 h-3 fill-current">
            <rect x="3" y="3" width="10" height="10" />
          </svg>
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
        <button
          onClick={onToggleLoop}
          className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
            loopEnabled
              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
              : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-cyan-400'
          }`}
          title={loopEnabled ? 'Disable loop [L]' : 'Enable loop [L]'}
        >
          {/* Loop icon: two arrows forming a cycle */}
          <svg viewBox="0 0 16 16" className="w-3 h-3 fill-current">
            <path d="M4 4h6l-2-2h3l3 3-3 3h-3l2-2H5v3H3V5a1 1 0 011-1z" />
            <path d="M12 12H6l2 2H5l-3-3 3-3h3l-2 2h5V7h2v4a1 1 0 01-1 1z" />
          </svg>
        </button>
      </div>

      {/* Position */}
      <div className="flex items-baseline gap-1">
        <span className="text-[9px] uppercase tracking-wider text-zinc-600">Pos</span>
        <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
          {bar}:{String(beat).padStart(2, '0')}
        </span>
      </div>

      {/* BPM */}
      <div className="flex items-baseline gap-1">
        <span className="text-[9px] uppercase tracking-wider text-zinc-600">Tempo</span>
        <DraggableNumber
          value={bpm}
          min={20}
          max={300}
          step={0.1}
          decimals={1}
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

      {/* Metronome */}
      <MetronomeButton
        enabled={metronomeEnabled}
        volume={metronomeVolume}
        onToggle={onToggleMetronome}
        onVolumeChange={onMetronomeVolumeChange}
      />

      {/* Loop region — shown when loop is enabled */}
      {loopEnabled && (
        <div className="flex items-baseline gap-1">
          <span className="text-[9px] uppercase tracking-wider text-cyan-600">Loop</span>
          <DraggableNumber
            value={loopStart}
            min={0}
            max={loopEnd - 1}
            step={1}
            decimals={0}
            className="text-cyan-400 hover:text-cyan-300 transition-colors"
            onChange={onLoopStartChange}
          />
          <span className="text-[9px] text-zinc-600">-</span>
          <DraggableNumber
            value={loopEnd}
            min={loopStart + 1}
            max={256}
            step={1}
            decimals={0}
            className="text-cyan-400 hover:text-cyan-300 transition-colors"
            onChange={onLoopEndChange}
          />
        </div>
      )}
    </div>
  );
}

function MetronomeButton({ enabled, volume, onToggle, onVolumeChange }: {
  enabled: boolean;
  volume: number;
  onToggle: () => void;
  onVolumeChange: (v: number) => void;
}) {
  const [showVolume, setShowVolume] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showVolume) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowVolume(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showVolume]);

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <button
        onClick={onToggle}
        onContextMenu={(e) => { e.preventDefault(); setShowVolume(!showVolume); }}
        className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
          enabled
            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
            : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-200'
        }`}
        title={`Metronome ${enabled ? 'ON' : 'OFF'} (right-click for volume)`}
      >
        {/* Metronome icon: simplified pendulum */}
        <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M5 14L8 2L11 14" />
          <line x1="4" y1="14" x2="12" y2="14" />
          <line x1="8" y1="6" x2="11" y2="4" />
        </svg>
      </button>
      {showVolume && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-zinc-900 border border-zinc-700 rounded p-2 z-50 shadow-xl flex items-center gap-2">
          <span className="text-[9px] text-zinc-500 uppercase tracking-wider whitespace-nowrap">Vol</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
            className="w-20 h-1 accent-amber-400"
          />
          <span className="text-[10px] text-zinc-400 tabular-nums w-6 text-right">{Math.round(volume * 100)}</span>
        </div>
      )}
    </div>
  );
}
