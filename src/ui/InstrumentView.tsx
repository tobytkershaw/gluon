// src/ui/InstrumentView.tsx
import type { Session, Voice, SequencerViewKind } from '../engine/types';
import type { MusicalEvent } from '../engine/canonical-types';
import type { EventSelector } from '../engine/event-primitives';
import type { ViewMode } from './view-types';
import { ViewToggle } from './ViewToggle';
import { VoiceSelector } from './VoiceSelector';
import { UndoButton } from './UndoButton';
import { TransportBar } from './TransportBar';
import { ParameterSpace } from './ParameterSpace';
import { ModelSelector } from './ModelSelector';
import { AgencyToggle } from './AgencyToggle';
import { Visualiser } from './Visualiser';
import { PitchControl } from './PitchControl';
import { ChatPanel } from './ChatPanel';
import { Tracker } from './Tracker';
import { SequencerViewSlot } from './SequencerViewSlot';
import { ChainStrip } from './ChainStrip';

interface Props {
  session: Session;
  activeVoice: Voice;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
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
  onAgencyChange: (agency: 'OFF' | 'ON') => void;
  onNoteChange: (note: number) => void;
  onHarmonicsChange: (harmonics: number) => void;
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
  // Audio
  analyser: AnalyserNode | null;
}

export function InstrumentView({
  session, activeVoice, view, onViewChange,
  playing, bpm, swing, recording, globalStep,
  onTogglePlay, onBpmChange, onSwingChange, onToggleRecord,
  onSelectVoice, onToggleMute, onToggleSolo,
  onParamChange, onInteractionStart, onInteractionEnd,
  onModelChange, onAgencyChange, onNoteChange, onHarmonicsChange,
  onEventUpdate, onEventDelete, onAddView, onRemoveView,
  stepPage, onStepToggle, onStepAccent, selectedStep, onStepSelect,
  onPatternLength, onPageChange, onClearPattern,
  onUndo, onSend, isThinking = false, isListening = false, analyser,
}: Props) {
  const currentStep = Math.floor(globalStep % activeVoice.pattern.length);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800/50">
        <ViewToggle view={view} onViewChange={onViewChange} />
        <VoiceSelector
          voices={session.voices}
          activeVoiceId={session.activeVoiceId}
          onSelectVoice={onSelectVoice}
          onToggleMute={onToggleMute}
          onToggleSolo={onToggleSolo}
          compact
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
        {/* Instrument controls */}
        <div className="flex-1 min-w-0 flex flex-col gap-3 p-4 overflow-y-auto">
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

          <div className="flex items-center gap-4">
            <ModelSelector model={activeVoice.model} onChange={onModelChange} />
            <AgencyToggle value={activeVoice.agency} onChange={onAgencyChange} />
          </div>

          <ChainStrip voice={activeVoice} />

          <div className="relative flex-1 min-h-[200px]">
            <ParameterSpace
              timbre={activeVoice.params.timbre}
              morph={activeVoice.params.morph}
              onChange={onParamChange}
              onInteractionStart={onInteractionStart}
              onInteractionEnd={onInteractionEnd}
            />
          </div>

          {activeVoice.regions.length > 0 && (
            <Tracker
              region={activeVoice.regions[0]}
              currentStep={currentStep}
              playing={playing}
              onUpdate={onEventUpdate}
              onDelete={onEventDelete}
            />
          )}

          {(activeVoice.views ?? []).map((viewConfig) => (
            <SequencerViewSlot
              key={viewConfig.id}
              config={viewConfig}
              onRemove={onRemoveView ?? (() => {})}
              pattern={activeVoice.pattern}
              currentStep={currentStep}
              playing={playing}
              stepPage={stepPage}
              selectedStep={selectedStep}
              onStepToggle={onStepToggle}
              onStepAccent={onStepAccent}
              onStepSelect={onStepSelect}
              onPatternLength={onPatternLength}
              onPageChange={onPageChange}
              onClearPattern={onClearPattern}
            />
          ))}

          {onAddView && (
            <div className="flex items-center gap-2">
              <button
                className="text-[9px] text-zinc-600 hover:text-zinc-400 uppercase tracking-widest transition-colors"
                onClick={() => onAddView('step-grid')}
              >
                + Step Grid
              </button>
            </div>
          )}

          <div className="flex gap-4">
            <div className="flex-1">
              <Visualiser analyser={analyser} />
            </div>
            <PitchControl
              note={activeVoice.params.note}
              harmonics={activeVoice.params.harmonics}
              onNoteChange={onNoteChange}
              onHarmonicsChange={onHarmonicsChange}
            />
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
