// src/ui/ChatView.tsx
import type { Session, Voice } from '../engine/types';
import type { ViewMode } from './view-types';
import { ViewToggle } from './ViewToggle';
import { VoiceStage } from './VoiceStage';
import { UndoButton } from './UndoButton';
import { ApiKeyInput } from './ApiKeyInput';
import { ChatPanel } from './ChatPanel';

interface Props {
  session: Session;
  activeVoice: Voice;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  apiConfigured: boolean;
  onApiKey: (key: string) => void;
  onSelectVoice: (voiceId: string) => void;
  onToggleMute: (voiceId: string) => void;
  onToggleSolo: (voiceId: string) => void;
  onToggleAgency: (voiceId: string) => void;
  onUndo: () => void;
  onSend: (message: string) => void;
  onTogglePlay: () => void;
  playing: boolean;
  bpm: number;
  isThinking?: boolean;
  isListening?: boolean;
  activityMap: Record<string, number>;
}

export function ChatView({
  session, view, onViewChange, apiConfigured, onApiKey,
  onSelectVoice, onToggleMute, onToggleSolo, onToggleAgency, onUndo, onSend,
  onTogglePlay, playing, bpm, isThinking = false, isListening = false,
  activityMap,
}: Props) {
  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800/50">
        <ViewToggle view={view} onViewChange={onViewChange} />

        {/* Compact play/stop + BPM */}
        <button
          onClick={onTogglePlay}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
            playing
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
              : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-200'
          }`}
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
        <span className="text-zinc-400 text-xs font-mono tabular-nums">{bpm}</span>

        <VoiceStage
          voices={session.voices}
          activeVoiceId={session.activeVoiceId}
          activityMap={activityMap}
          onSelectVoice={onSelectVoice}
          onToggleMute={onToggleMute}
          onToggleSolo={onToggleSolo}
          onToggleAgency={onToggleAgency}
        />

        <div className="flex-1" />
        <UndoButton
          onClick={onUndo}
          disabled={session.undoStack.length === 0}
          description={session.undoStack.length > 0 ? session.undoStack[session.undoStack.length - 1].description : undefined}
        />
      </div>

      {/* API key: expanded when not configured, collapsed pill when configured */}
      <div className="px-4 py-2">
        <ApiKeyInput onSubmit={onApiKey} isConfigured={apiConfigured} />
      </div>

      {/* Main chat area */}
      <div className="flex-1 min-h-0 flex justify-center">
        <div className="w-full max-w-2xl flex flex-col min-h-0 px-4 py-2">
          <ChatPanel messages={session.messages} onSend={onSend} isThinking={isThinking} isListening={isListening} />
        </div>
      </div>
    </div>
  );
}
