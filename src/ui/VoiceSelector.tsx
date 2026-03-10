// src/ui/VoiceSelector.tsx
import type { Voice } from '../engine/types';

interface Props {
  voices: Voice[];
  activeVoiceId: string;
  onSelectVoice: (voiceId: string) => void;
  onToggleMute: (voiceId: string) => void;
  onToggleSolo: (voiceId: string) => void;
}

const VOICE_LABELS = ['KICK', 'BASS', 'LEAD', 'PAD'];
const AGENCY_BADGE: Record<string, { label: string; color: string }> = {
  OFF: { label: 'OFF', color: 'text-zinc-600' },
  SUGGEST: { label: 'SUG', color: 'text-blue-400' },
  PLAY: { label: 'PLY', color: 'text-amber-400' },
};

export function VoiceSelector({ voices, activeVoiceId, onSelectVoice, onToggleMute, onToggleSolo }: Props) {
  return (
    <div className="flex gap-1">
      {voices.map((voice, i) => {
        const isActive = voice.id === activeVoiceId;
        const badge = AGENCY_BADGE[voice.agency] ?? AGENCY_BADGE.OFF;

        return (
          <div
            key={voice.id}
            className={`flex flex-col gap-1 px-3 py-2 rounded-t-lg cursor-pointer transition-colors ${
              isActive
                ? 'bg-zinc-800 border-t border-x border-zinc-700'
                : 'bg-zinc-900/50 hover:bg-zinc-800/50'
            }`}
            onClick={() => onSelectVoice(voice.id)}
          >
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium tracking-wider ${isActive ? 'text-zinc-200' : 'text-zinc-500'}`}>
                {VOICE_LABELS[i] ?? `V${i}`}
              </span>
              <span className={`text-[10px] ${badge.color}`}>{badge.label}</span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); onToggleMute(voice.id); }}
                className={`text-[10px] px-1 rounded ${
                  voice.muted ? 'bg-red-500/20 text-red-400' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                M
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSolo(voice.id); }}
                className={`text-[10px] px-1 rounded ${
                  voice.solo ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                S
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
