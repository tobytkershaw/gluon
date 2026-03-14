// src/ui/TrackRow.tsx
// Horizontal track row for the vertical track sidebar.
import { useState, useEffect } from 'react';
import type { Voice } from '../engine/types';
import { computeThumbprintColor } from './thumbprint';

interface Props {
  voice: Voice;
  label: string;
  isActive: boolean;
  activityTimestamp: number | null;
  onClick: () => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onToggleAgency?: () => void;
}

export function TrackRow({
  voice, label, isActive, activityTimestamp,
  onClick, onToggleMute, onToggleSolo, onToggleAgency,
}: Props) {
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (!activityTimestamp) return;
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), 2000);
    return () => clearTimeout(timer);
  }, [activityTimestamp]);

  const thumbColor = computeThumbprintColor(voice);

  return (
    <div
      className={`relative flex items-center gap-2 px-2.5 py-1.5 rounded cursor-pointer transition-colors ${
        isActive
          ? 'bg-zinc-800 border border-zinc-700'
          : 'bg-transparent hover:bg-zinc-800/40 border border-transparent'
      }`}
      onClick={onClick}
    >
      {/* Activity pulse overlay */}
      <div
        className="absolute inset-0 rounded bg-amber-400/15 pointer-events-none"
        style={{
          opacity: pulsing ? 1 : 0,
          transition: 'opacity 2s ease-out',
        }}
      />

      {/* Thumbprint dot */}
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: thumbColor, transition: 'background-color 1s ease' }}
      />

      {/* Voice label */}
      <span className={`text-[10px] font-mono uppercase tracking-wider flex-1 truncate ${
        voice.muted ? 'text-zinc-600 opacity-50' : isActive ? 'text-zinc-200' : 'text-zinc-500'
      }`}>
        {label}
      </span>

      {/* Agency indicator */}
      {voice.agency === 'ON' && (
        <div className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />
      )}

      {/* M / S / C buttons */}
      <div className="flex gap-0.5 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
          className={`text-[9px] font-mono w-4 h-4 flex items-center justify-center rounded transition-colors ${
            voice.muted ? 'bg-red-500/20 text-red-400' : 'text-zinc-600 hover:text-zinc-400'
          }`}
        >
          M
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}
          className={`text-[9px] font-mono w-4 h-4 flex items-center justify-center rounded transition-colors ${
            voice.solo ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-600 hover:text-zinc-400'
          }`}
        >
          S
        </button>
        {onToggleAgency && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleAgency(); }}
            title={voice.agency === 'OFF' ? 'AI: Protected' : 'AI: Editable'}
            className={`text-[9px] font-mono w-4 h-4 flex items-center justify-center rounded transition-colors ${
              voice.agency === 'OFF'
                ? 'bg-amber-500/20 text-amber-400'
                : 'text-zinc-600 hover:text-zinc-400'
            }`}
          >
            C
          </button>
        )}
      </div>
    </div>
  );
}
