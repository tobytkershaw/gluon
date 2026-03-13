// src/ui/TrackerView.tsx
// Thin shell: top bar + full-height Tracker + ChatPanel
import type { Session, Voice } from '../engine/types';
import type { MusicalEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import type { ViewMode } from './view-types';
import { getModelName } from '../audio/instrument-registry';
import { ViewToggle } from './ViewToggle';
import { VoiceStage } from './VoiceStage';
import { UndoButton } from './UndoButton';
import { TransportBar } from './TransportBar';
import { ChatPanel } from './ChatPanel';
import { Tracker } from './Tracker';

interface Props {
  session: Session;
  activeVoice: Voice;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  activityMap: Record<string, number>;
  // Transport
  playing: boolean;
  bpm: number;
  swing: number;
  recording: boolean;
  globalStep: number;
  onTogglePlay: () => void;
  onBpmChange: (bpm: number) => void;
  onSwingChange: (swing: number) => void;
  onToggleRecord: () => void;
  // Voice
  onSelectVoice: (voiceId: string) => void;
  onToggleMute: (voiceId: string) => void;
  onToggleSolo: (voiceId: string) => void;
  onToggleAgency?: (voiceId: string) => void;
  // Tracker editing
  onEventUpdate: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onEventDelete: (selector: EventSelector) => void;
  // Undo + Chat
  onUndo: () => void;
  onSend: (message: string) => void;
  isThinking?: boolean;
  isListening?: boolean;
}

export function TrackerView({
  session, activeVoice, view, onViewChange, activityMap,
  playing, bpm, swing, recording, globalStep,
  onTogglePlay, onBpmChange, onSwingChange, onToggleRecord,
  onSelectVoice, onToggleMute, onToggleSolo, onToggleAgency,
  onEventUpdate, onEventDelete,
  onUndo, onSend, isThinking = false, isListening = false,
}: Props) {
  const currentStep = Math.floor(globalStep % activeVoice.pattern.length);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800/50">
        <ViewToggle view={view} onViewChange={onViewChange} />
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

      {/* Main content: tracker left, chat right */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col gap-3 p-4">
          {/* Voice header */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium tracking-wider uppercase text-zinc-300">
              {activeVoice.id}
            </span>
            <span className="text-[10px] text-zinc-500">
              {getModelName(activeVoice.model)}
            </span>
          </div>

          <TransportBar
            playing={playing}
            bpm={bpm}
            swing={swing}
            recording={recording}
            globalStep={globalStep}
            patternLength={activeVoice.pattern.length}
            onTogglePlay={onTogglePlay}
            onBpmChange={onBpmChange}
            onSwingChange={onSwingChange}
            onToggleRecord={onToggleRecord}
          />

          {/* Full-height tracker scroll container */}
          <div className="flex-1 min-h-0 overflow-y-auto rounded border border-zinc-800/50 bg-zinc-900/40">
            {activeVoice.regions.length > 0 ? (
              <Tracker
                region={activeVoice.regions[0]}
                currentStep={currentStep}
                playing={playing}
                onUpdate={onEventUpdate}
                onDelete={onEventDelete}
              />
            ) : (
              <div className="px-4 py-8 text-center text-[10px] text-zinc-600 italic">
                No regions
              </div>
            )}
          </div>
        </div>

        {/* Chat panel — right side */}
        <div className="w-80 border-l border-zinc-800/50 flex flex-col min-h-0">
          <ChatPanel
            messages={session.messages}
            onSend={onSend}
            isThinking={isThinking}
            isListening={isListening}
          />
        </div>
      </div>
    </div>
  );
}
