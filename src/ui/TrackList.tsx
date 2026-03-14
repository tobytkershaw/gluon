// src/ui/TrackList.tsx
// Vertical track sidebar — replaces horizontal VoiceStage in the top bar.
import type { Voice } from '../engine/types';
import { getVoiceLabel } from '../engine/voice-labels';
import { TrackRow } from './TrackRow';

interface Props {
  voices: Voice[];
  activeVoiceId: string;
  activityMap: Record<string, number>;
  onSelectVoice: (voiceId: string) => void;
  onToggleMute: (voiceId: string) => void;
  onToggleSolo: (voiceId: string) => void;
  onToggleAgency: (voiceId: string) => void;
  onRenameVoice?: (voiceId: string, name: string) => void;
}

export function TrackList({
  voices, activeVoiceId, activityMap,
  onSelectVoice, onToggleMute, onToggleSolo, onToggleAgency,
  onRenameVoice,
}: Props) {
  return (
    <div className="w-44 border-l border-zinc-800/40 bg-zinc-950/80 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800/40">
        <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-zinc-600">
          Tracks
        </span>
      </div>

      {/* Voice rows */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {voices.map((voice) => (
          <TrackRow
            key={voice.id}
            voice={voice}
            label={getVoiceLabel(voice)}
            isActive={voice.id === activeVoiceId}
            activityTimestamp={activityMap[voice.id] ?? null}
            onClick={() => onSelectVoice(voice.id)}
            onToggleMute={() => onToggleMute(voice.id)}
            onToggleSolo={() => onToggleSolo(voice.id)}
            onToggleAgency={() => onToggleAgency(voice.id)}
            onRename={onRenameVoice ? (name) => onRenameVoice(voice.id, name) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
