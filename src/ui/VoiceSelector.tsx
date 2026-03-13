// src/ui/VoiceSelector.tsx
import type { Voice } from '../engine/types';
import { VOICE_LABELS } from '../engine/voice-labels';

interface Props {
  voices: Voice[];
  activeVoiceId: string;
  onSelectVoice: (voiceId: string) => void;
  onToggleMute: (voiceId: string) => void;
  onToggleSolo: (voiceId: string) => void;
  onToggleAgency?: (voiceId: string) => void;
  compact?: boolean;
}

const AGENCY_BADGE: Record<string, { label: string; color: string }> = {
  OFF: { label: '\u{1F512}', color: 'text-amber-400' },
  ON:  { label: '',   color: '' },
};

export function VoiceSelector({ voices, activeVoiceId, onSelectVoice, onToggleMute, onToggleSolo, onToggleAgency, compact }: Props) {
  return (
    <div className="flex gap-1">
      {voices.map((voice, i) => {
        const isActive = voice.id === activeVoiceId;
        const badge = AGENCY_BADGE[voice.agency] ?? AGENCY_BADGE.OFF;
        const label = VOICE_LABELS[voice.id]?.toUpperCase() ?? `V${i}`;

        if (compact) {
          return (
            <div
              key={voice.id}
              className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors ${
                isActive
                  ? 'bg-zinc-800 border border-zinc-700'
                  : 'bg-zinc-900/50 hover:bg-zinc-800/50'
              }`}
              onClick={() => onSelectVoice(voice.id)}
            >
              <span className={`text-[10px] font-medium tracking-wider ${isActive ? 'text-zinc-200' : 'text-zinc-500'}`}>
                {label}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleMute(voice.id); }}
                className={`text-[10px] px-0.5 rounded ${
                  voice.muted ? 'bg-red-500/20 text-red-400' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                M
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSolo(voice.id); }}
                className={`text-[10px] px-0.5 rounded ${
                  voice.solo ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                S
              </button>
              {onToggleAgency && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleAgency(voice.id); }}
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
          );
        }

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
                {label}
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
