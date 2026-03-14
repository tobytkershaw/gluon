// src/ui/VoiceStage.tsx
import type { Voice } from '../engine/types';
import { getVoiceLabel } from '../engine/voice-labels';
import { VoiceCard } from './VoiceCard';

interface VoiceStageProps {
  voices: Voice[];
  activeVoiceId: string;
  activityMap: Record<string, number>;
  onSelectVoice: (voiceId: string) => void;
  onToggleMute: (voiceId: string) => void;
  onToggleSolo: (voiceId: string) => void;
  onToggleAgency?: (voiceId: string) => void;
}

export function VoiceStage({
  voices, activeVoiceId, activityMap,
  onSelectVoice, onToggleMute, onToggleSolo, onToggleAgency,
}: VoiceStageProps) {
  return (
    <div className="flex gap-1">
      {voices.map((voice, i) => (
        <VoiceCard
          key={voice.id}
          voice={voice}
          label={getVoiceLabel(voice).toUpperCase()}
          isActive={voice.id === activeVoiceId}
          activityTimestamp={activityMap[voice.id] ?? null}
          onClick={() => onSelectVoice(voice.id)}
          onToggleMute={() => onToggleMute(voice.id)}
          onToggleSolo={() => onToggleSolo(voice.id)}
          onToggleAgency={onToggleAgency ? () => onToggleAgency(voice.id) : undefined}
        />
      ))}
    </div>
  );
}
