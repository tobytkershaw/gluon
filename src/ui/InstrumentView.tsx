// src/ui/InstrumentView.tsx
// Thin shell: top bar + ExpandedVoice + ChatPanel
import type { Session, Voice, SequencerViewKind } from '../engine/types';
import type { MusicalEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import type { ViewMode } from './view-types';
import type { Agency } from '../engine/types';
import { ViewToggle } from './ViewToggle';
import { VoiceStage } from './VoiceStage';
import { UndoButton } from './UndoButton';
import { ChatPanel } from './ChatPanel';
import { ExpandedVoice } from './ExpandedVoice';

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
  // Params
  onParamChange: (timbre: number, morph: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  onModelChange: (model: number) => void;
  onAgencyChange: (agency: Agency) => void;
  onNoteChange: (note: number) => void;
  onHarmonicsChange: (harmonics: number) => void;
  // Processor editing
  selectedProcessorId: string | null;
  onSelectProcessor: (processorId: string | null) => void;
  onProcessorParamChange: (processorId: string, param: string, value: number) => void;
  onProcessorInteractionStart: (processorId: string) => void;
  onProcessorInteractionEnd: (processorId: string) => void;
  onProcessorModelChange: (processorId: string, model: number) => void;
  onRemoveProcessor: (processorId: string) => void;
  // Pattern
  stepPage: number;
  onStepToggle: (stepIndex: number) => void;
  onStepAccent: (stepIndex: number) => void;
  selectedStep: number | null;
  onStepSelect: (stepIndex: number | null) => void;
  onPatternLength: (length: number) => void;
  onPageChange: (page: number) => void;
  onClearPattern: () => void;
  // Tracker editing
  onEventUpdate?: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onEventDelete?: (selector: EventSelector) => void;
  // Views
  onAddView?: (kind: SequencerViewKind) => void;
  onRemoveView?: (viewId: string) => void;
  // Undo + Chat
  onUndo: () => void;
  onSend: (message: string) => void;
  isThinking?: boolean;
  isListening?: boolean;
  // Deep view
  deepViewModuleId: string | null;
  onOpenDeepView: (moduleId: string | null) => void;
  // Audio
  analyser: AnalyserNode | null;
}

export function InstrumentView({
  session, activeVoice, view, onViewChange, activityMap,
  playing, bpm, swing, recording, globalStep,
  onTogglePlay, onBpmChange, onSwingChange, onToggleRecord,
  onSelectVoice, onToggleMute, onToggleSolo,
  onParamChange, onInteractionStart, onInteractionEnd,
  onModelChange, onAgencyChange, onNoteChange, onHarmonicsChange,
  selectedProcessorId, onSelectProcessor,
  onProcessorParamChange, onProcessorInteractionStart, onProcessorInteractionEnd,
  onProcessorModelChange, onRemoveProcessor,
  onEventUpdate, onEventDelete, onAddView, onRemoveView,
  stepPage, onStepToggle, onStepAccent, selectedStep, onStepSelect,
  onPatternLength, onPageChange, onClearPattern,
  onUndo, onSend, isThinking = false, isListening = false,
  deepViewModuleId, onOpenDeepView,
  analyser,
}: Props) {
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
        />
        <div className="flex-1" />
        <UndoButton
          onClick={onUndo}
          disabled={session.undoStack.length === 0}
          description={session.undoStack.length > 0 ? session.undoStack[session.undoStack.length - 1].description : undefined}
        />
      </div>

      {/* Main content: instrument left, chat right */}
      <div className="flex-1 min-h-0 flex">
        <ExpandedVoice
          session={session}
          activeVoice={activeVoice}
          playing={playing}
          bpm={bpm}
          swing={swing}
          recording={recording}
          globalStep={globalStep}
          onTogglePlay={onTogglePlay}
          onBpmChange={onBpmChange}
          onSwingChange={onSwingChange}
          onToggleRecord={onToggleRecord}
          onParamChange={onParamChange}
          onInteractionStart={onInteractionStart}
          onInteractionEnd={onInteractionEnd}
          onModelChange={onModelChange}
          onAgencyChange={onAgencyChange}
          onNoteChange={onNoteChange}
          onHarmonicsChange={onHarmonicsChange}
          selectedProcessorId={selectedProcessorId}
          onSelectProcessor={onSelectProcessor}
          onProcessorParamChange={onProcessorParamChange}
          onProcessorInteractionStart={onProcessorInteractionStart}
          onProcessorInteractionEnd={onProcessorInteractionEnd}
          onProcessorModelChange={onProcessorModelChange}
          onRemoveProcessor={onRemoveProcessor}
          stepPage={stepPage}
          onStepToggle={onStepToggle}
          onStepAccent={onStepAccent}
          selectedStep={selectedStep}
          onStepSelect={onStepSelect}
          onPatternLength={onPatternLength}
          onPageChange={onPageChange}
          onClearPattern={onClearPattern}
          onEventUpdate={onEventUpdate}
          onEventDelete={onEventDelete}
          onAddView={onAddView}
          onRemoveView={onRemoveView}
          deepViewModuleId={deepViewModuleId}
          onOpenDeepView={onOpenDeepView}
          analyser={analyser}
        />

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
