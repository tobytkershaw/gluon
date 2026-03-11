// src/ui/InstrumentView.tsx
import type { Session, Voice, ChatMessage } from '../engine/types';
import type { ViewMode } from './view-types';
import { ViewToggle } from './ViewToggle';
import { VoiceSelector } from './VoiceSelector';
import { UndoButton } from './UndoButton';
import { TransportBar } from './TransportBar';
import { ParameterSpace } from './ParameterSpace';
import { ModelSelector } from './ModelSelector';
import { AgencyToggle } from './AgencyToggle';
import { StepGrid } from './StepGrid';
import { PatternControls } from './PatternControls';
import { Visualiser } from './Visualiser';
import { PitchControl } from './PitchControl';
import { ChatComposer } from './ChatComposer';

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
  onStepHold: (stepIndex: number) => void;
  onStepRelease: () => void;
  onPatternLength: (length: number) => void;
  onPageChange: (page: number) => void;
  onClearPattern: () => void;
  // Undo + Chat
  onUndo: () => void;
  onSend: (message: string) => void;
  // Audio
  analyser: AnalyserNode | null;
}

function lastAiPreview(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'ai') continue;
    if (msg.text) return msg.text;
    if (msg.actions?.length) {
      return msg.actions.map(a => `${a.voiceLabel}: ${a.description}`).join(', ');
    }
  }
  return null;
}

export function InstrumentView({
  session, activeVoice, view, onViewChange,
  playing, bpm, swing, recording, globalStep,
  onTogglePlay, onBpmChange, onSwingChange, onToggleRecord,
  onSelectVoice, onToggleMute, onToggleSolo,
  onParamChange, onInteractionStart, onInteractionEnd,
  onModelChange, onAgencyChange, onNoteChange, onHarmonicsChange,
  stepPage, onStepToggle, onStepAccent, onStepHold, onStepRelease,
  onPatternLength, onPageChange, onClearPattern,
  onUndo, onSend, analyser,
}: Props) {
  const currentStep = Math.floor(globalStep % activeVoice.pattern.length);
  const totalPages = Math.ceil(activeVoice.pattern.length / 16);
  const lastMsg = lastAiPreview(session.messages);

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
        <UndoButton onClick={onUndo} disabled={session.undoStack.length === 0} />
      </div>

      {/* Instrument area */}
      <div className="flex-1 min-h-0 flex flex-col gap-3 p-4 overflow-y-auto">
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

        <div className="relative flex-1 min-h-[200px]">
          <ParameterSpace
            timbre={activeVoice.params.timbre}
            morph={activeVoice.params.morph}
            onChange={onParamChange}
            onInteractionStart={onInteractionStart}
            onInteractionEnd={onInteractionEnd}
          />
        </div>

        <div className="flex items-center gap-3">
          <StepGrid
            pattern={activeVoice.pattern}
            currentStep={currentStep}
            playing={playing}
            page={stepPage}
            onToggleGate={onStepToggle}
            onToggleAccent={onStepAccent}
            onStepHold={onStepHold}
            onStepRelease={onStepRelease}
          />
          <PatternControls
            patternLength={activeVoice.pattern.length}
            totalPages={totalPages}
            currentPage={stepPage}
            onLengthChange={onPatternLength}
            onPageChange={onPageChange}
            onClear={onClearPattern}
          />
        </div>

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

      {/* Bottom strip: last AI message + composer */}
      <div className="border-t border-zinc-800/50 px-4 py-1.5 flex items-center gap-3">
        {lastMsg && (
          <div
            className="text-[10px] font-mono text-teal-400/60 truncate max-w-xs cursor-pointer hover:text-teal-400"
            onClick={() => onViewChange('chat')}
            title="Switch to chat"
          >
            {lastMsg}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <ChatComposer onSend={onSend} placeholder="Ask the AI..." />
        </div>
      </div>
    </div>
  );
}
