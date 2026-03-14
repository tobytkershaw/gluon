// src/ui/VoiceCard.tsx
import { useState, useEffect } from 'react';
import type { Voice } from '../engine/types';
import { computeThumbprintColor } from './thumbprint';

interface VoiceCardProps {
  voice: Voice;
  label: string;
  isActive: boolean;
  activityTimestamp: number | null;
  onClick: () => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onToggleAgency?: () => void;
}

export function VoiceCard({
  voice, label, isActive, activityTimestamp,
  onClick, onToggleMute, onToggleSolo, onToggleAgency,
}: VoiceCardProps) {
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (!activityTimestamp) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- timer-driven animation pulse
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), 2000);
    return () => clearTimeout(timer);
  }, [activityTimestamp]);

  const thumbColor = computeThumbprintColor(voice);

  return (
    <div
      className={`relative flex flex-col items-center gap-0.5 px-2 py-1.5 rounded cursor-pointer transition-colors min-w-[60px] ${
        isActive
          ? 'bg-zinc-800 border border-zinc-700'
          : 'bg-zinc-900/50 hover:bg-zinc-800/50 border border-transparent'
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

      {/* Top row: thumbprint + name + agency */}
      <div className="flex items-center gap-1.5">
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: thumbColor, transition: 'background-color 1s ease' }}
        />
        <span className={`text-[10px] font-medium tracking-wider uppercase ${
          voice.muted ? 'text-zinc-600 opacity-50' : isActive ? 'text-zinc-200' : 'text-zinc-500'
        }`}>
          {label}
        </span>
        {voice.agency === 'ON' && (
          <div className="w-1.5 h-1.5 rounded-full bg-teal-400 flex-shrink-0" />
        )}
      </div>

      {/* M/S buttons */}
      <div className="flex gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
          className={`text-[10px] px-0.5 rounded ${
            voice.muted ? 'bg-red-500/20 text-red-400' : 'text-zinc-600 hover:text-zinc-400'
          }`}
        >
          M
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}
          className={`text-[10px] px-0.5 rounded ${
            voice.solo ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-600 hover:text-zinc-400'
          }`}
        >
          S
        </button>
        {onToggleAgency && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleAgency(); }}
            title={voice.agency === 'OFF' ? 'AI: Protected' : 'AI: Editable'}
            className={`text-[10px] px-0.5 rounded ${
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
