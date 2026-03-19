// src/ui/TransportStrip.tsx
// Compact inline transport controls for the global top bar.
import { useState, useRef, useEffect } from 'react';
import type { TransportMode } from '../engine/sequencer-types';
import { DraggableNumber } from './DraggableNumber';

export interface ABControlsProps {
  abActive: 'a' | 'b' | null;
  onAbCapture: () => void;
  onAbToggle: () => void;
  onAbClear: () => void;
}

/** Standalone A/B comparison controls — rendered in the top-right collaboration zone. */
export function ABControls({ abActive, onAbCapture, onAbToggle, onAbClear }: ABControlsProps) {
  return (
    <div className="flex items-center gap-0.5">
      {abActive === null ? (
        <button
          onClick={onAbCapture}
          className="h-5 px-1.5 rounded text-[12px] font-medium tracking-wider uppercase transition-colors bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-200"
          title="Snapshot current state as A"
        >
          A/B
        </button>
      ) : (
        <>
          <button
            onClick={onAbToggle}
            className={`h-5 w-5 rounded-l text-[11px] font-bold transition-colors border ${
              abActive === 'a'
                ? 'bg-violet-500/25 text-violet-300 border-violet-500/50'
                : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-200'
            }`}
            title="Switch to A"
          >
            A
          </button>
          <button
            onClick={onAbToggle}
            className={`h-5 w-5 rounded-r text-[11px] font-bold transition-colors border border-l-0 ${
              abActive === 'b'
                ? 'bg-violet-500/25 text-violet-300 border-violet-500/50'
                : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-200'
            }`}
            title="Switch to B"
          >
            B
          </button>
          <button
            onClick={onAbClear}
            className="h-5 w-4 rounded text-[11px] transition-colors bg-zinc-800 text-zinc-600 border border-zinc-700 hover:text-zinc-300 ml-0.5"
            title="Discard A/B snapshot"
          >
            x
          </button>
        </>
      )}
    </div>
  );
}

interface Props {
  playing: boolean;
  bpm: number;
  swing: number;
  recordArmed: boolean;
  globalStep: number;
  patternLength: number;
  transportMode: TransportMode;
  loop: boolean;
  onTogglePlay: () => void;
  onHardStop: () => void;
  onBpmChange: (bpm: number) => void;
  onSwingChange: (swing: number) => void;
  onToggleRecord: () => void;
  metronomeEnabled: boolean;
  metronomeVolume: number;
  onToggleMetronome: () => void;
  onMetronomeVolumeChange: (v: number) => void;
  onLoopChange: (loop: boolean) => void;
  onTransportModeChange: (mode: TransportMode) => void;
  // Time signature
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  onTimeSignatureChange: (numerator: number, denominator: number) => void;
}

export function TransportStrip({
  playing, bpm, swing, recordArmed, globalStep, patternLength: _patternLength,
  transportMode, loop,
  onTogglePlay, onHardStop, onBpmChange, onSwingChange, onToggleRecord,
  metronomeEnabled, metronomeVolume, onToggleMetronome, onMetronomeVolumeChange,
  onLoopChange, onTransportModeChange,
  timeSignatureNumerator, timeSignatureDenominator, onTimeSignatureChange,
}: Props) {
  const beatsPerBar = timeSignatureNumerator || 4;
  const currentBeat = Math.floor(globalStep) + 1;
  const bar = Math.floor((currentBeat - 1) / beatsPerBar) + 1;
  const beat = ((currentBeat - 1) % beatsPerBar) + 1;

  // In pattern mode, loop is inherently on — the button is visually locked.
  const isPatternMode = transportMode === 'pattern';
  const loopEnabled = isPatternMode ? true : loop;

  // Three visual states: inactive, armed (waiting for play), actively recording
  const activelyRecording = recordArmed && playing;

  return (
    <div className="flex items-center gap-3">
      {/* Transport controls: play/pause, hard stop, record */}
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
        {/* Loop / Cycle toggle */}
        <button
          onClick={() => { if (!isPatternMode) onLoopChange(!loop); }}
          className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
            loopEnabled
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
              : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-200'
          } ${isPatternMode ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={isPatternMode ? 'Loop locked in pattern mode' : loopEnabled ? 'Loop ON — click to disable' : 'Loop OFF — click to enable'}
          disabled={isPatternMode}
        >
          {/* Loop icon: circular arrows */}
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 3H5a3 3 0 0 0-3 3v1" />
            <path d="M5 13h6a3 3 0 0 0 3-3V9" />
            <polyline points="9,1 11,3 9,5" />
            <polyline points="7,11 5,13 7,15" />
          </svg>
        </button>
        {/* Pattern / Song mode */}
        <button
          onClick={() => onTransportModeChange(transportMode === 'pattern' ? 'song' : 'pattern')}
          className={`h-6 px-1.5 rounded-full flex items-center justify-center transition-colors text-[11px] font-bold tracking-wider ${
            transportMode === 'song'
              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
              : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-200'
          }`}
          title={transportMode === 'pattern' ? 'Pattern mode (loops active pattern) — click for Song mode' : 'Song mode (plays sequence) — click for Pattern mode'}
        >
          {transportMode === 'song' ? 'SONG' : 'PAT'}
        </button>
      </div>

      {/* Playhead position — prominent bar:beat display */}
      <div className="flex items-center gap-0.5 font-mono tabular-nums">
        <span className="text-lg font-semibold text-zinc-200 leading-none">
          {String(bar).padStart(3, '\u2007')}
        </span>
        <span className="text-lg font-semibold text-zinc-500 leading-none">:</span>
        <span className="text-lg font-semibold text-zinc-300 leading-none">
          {String(beat).padStart(2, '0')}
        </span>
      </div>

      {/* BPM — large readout with co-located time signature */}
      <div className="flex items-baseline gap-1.5">
        <div className="flex items-baseline gap-0.5 [&>span]:!text-lg [&>input]:!text-lg">
          <DraggableNumber
            value={bpm}
            min={20}
            max={300}
            step={1}
            decimals={0}
            editDecimals={1}
            className="!text-lg text-zinc-100 hover:text-amber-400 transition-colors font-semibold"
            onChange={onBpmChange}
          />
          <span className="!text-[11px] uppercase tracking-wider text-zinc-600 ml-0.5 font-normal">bpm</span>
        </div>
        <TimeSignatureControl
          numerator={timeSignatureNumerator}
          denominator={timeSignatureDenominator}
          onChange={onTimeSignatureChange}
        />
      </div>

      {/* Swing */}
      <div className="flex items-baseline gap-1">
        <span className="text-[11px] uppercase tracking-wider text-zinc-600">Swing</span>
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
          <span className="text-[11px] text-zinc-500 uppercase tracking-wider whitespace-nowrap">Vol</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
            className="w-20 h-1 accent-amber-400"
          />
          <span className="text-[11px] text-zinc-400 tabular-nums w-6 text-right">{Math.round(volume * 100)}</span>
        </div>
      )}
    </div>
  );
}

/** Common time signatures for the dropdown. */
const TIME_SIGNATURES: [number, number][] = [
  [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4],
  [3, 8], [5, 8], [6, 8], [7, 8], [9, 8], [12, 8],
];

function TimeSignatureControl({ numerator, denominator, onChange }: {
  numerator: number;
  denominator: number;
  onChange: (numerator: number, denominator: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-baseline gap-1">
      <button
        onClick={() => setOpen(!open)}
        className="font-mono text-xs text-zinc-400 hover:text-amber-400 transition-colors tabular-nums"
        title="Time signature"
      >
        {numerator}/{denominator}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-700 rounded p-1.5 z-50 shadow-xl flex gap-2 min-w-max">
          {/* /4 column */}
          <div className="flex flex-col gap-0.5">
            {TIME_SIGNATURES.filter(([, d]) => d === 4).map(([n, d]) => (
              <button
                key={`${n}/${d}`}
                onClick={() => { onChange(n, d); setOpen(false); }}
                className={`px-2 py-0.5 rounded text-[11px] font-mono tabular-nums transition-colors whitespace-nowrap ${
                  n === numerator && d === denominator
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                }`}
              >
                {n}/{d}
              </button>
            ))}
          </div>
          {/* /8 column */}
          <div className="flex flex-col gap-0.5">
            {TIME_SIGNATURES.filter(([, d]) => d === 8).map(([n, d]) => (
              <button
                key={`${n}/${d}`}
                onClick={() => { onChange(n, d); setOpen(false); }}
                className={`px-2 py-0.5 rounded text-[11px] font-mono tabular-nums transition-colors whitespace-nowrap ${
                  n === numerator && d === denominator
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                }`}
              >
                {n}/{d}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
