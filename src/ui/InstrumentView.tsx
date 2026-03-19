// src/ui/InstrumentView.tsx
// Thin shell: ExpandedTrack (top bar moved to AppShell)
import type { Session, Track, SequencerViewKind, Agency, SemanticControlDef } from '../engine/types';
import { ExpandedTrack } from './ExpandedTrack';

interface Props {
  session: Session;
  activeTrack: Track;
  // Transport (position only)
  playing: boolean;
  globalStep: number;
  // Params
  onParamChange: (timbre: number, morph: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  onModelChange: (model: number) => void;
  onAgencyChange: (agency: Agency) => void;
  onNoteChange: (note: number) => void;
  onHarmonicsChange: (harmonics: number) => void;
  onExtendedSourceParamChange: (runtimeParam: string, value: number) => void;
  // Processor editing
  selectedProcessorId: string | null;
  onSelectProcessor: (processorId: string | null) => void;
  onProcessorParamChange: (processorId: string, param: string, value: number) => void;
  onProcessorInteractionStart: (processorId: string) => void;
  onProcessorInteractionEnd: (processorId: string) => void;
  onProcessorModelChange: (processorId: string, model: number) => void;
  onRemoveProcessor: (processorId: string) => void;
  // Modulator editing
  selectedModulatorId: string | null;
  onSelectModulator: (modulatorId: string | null) => void;
  onModulatorParamChange: (modulatorId: string, param: string, value: number) => void;
  onModulatorInteractionStart: (modulatorId: string) => void;
  onModulatorInteractionEnd: (modulatorId: string) => void;
  onModulatorModelChange: (modulatorId: string, model: number) => void;
  onRemoveModulator: (modulatorId: string) => void;
  // Semantic controls
  onSemanticChange: (controlDef: SemanticControlDef, knobValue: number) => void;
  onSemanticInteractionStart: (controlDef: SemanticControlDef) => void;
  onSemanticInteractionEnd: (controlDef: SemanticControlDef) => void;
  // Pattern
  stepPage: number;
  onStepToggle: (stepIndex: number) => void;
  onStepAccent: (stepIndex: number) => void;
  selectedStep: number | null;
  onStepSelect: (stepIndex: number | null) => void;
  onPatternLength: (length: number) => void;
  onPageChange: (page: number) => void;
  onClearPattern: () => void;
  // Views
  onAddView?: (kind: SequencerViewKind) => void;
  onRemoveView?: (viewId: string) => void;
  // Deep view
  deepViewModuleId: string | null;
  onOpenDeepView: (moduleId: string | null) => void;
  // Audio
  analyser: AnalyserNode | null;
}

export function InstrumentView({
  session, activeTrack,
  playing, globalStep,
  onParamChange, onInteractionStart, onInteractionEnd,
  onModelChange, onAgencyChange, onNoteChange, onHarmonicsChange,
  onExtendedSourceParamChange,
  selectedProcessorId, onSelectProcessor,
  onProcessorParamChange, onProcessorInteractionStart, onProcessorInteractionEnd,
  onProcessorModelChange, onRemoveProcessor,
  selectedModulatorId, onSelectModulator,
  onModulatorParamChange, onModulatorInteractionStart, onModulatorInteractionEnd,
  onModulatorModelChange, onRemoveModulator,
  onSemanticChange, onSemanticInteractionStart, onSemanticInteractionEnd,
  onAddView, onRemoveView,
  stepPage, onStepToggle, onStepAccent, selectedStep, onStepSelect,
  onPatternLength, onPageChange, onClearPattern,
  deepViewModuleId, onOpenDeepView,
  analyser,
}: Props) {
  return (
    <div className="flex flex-col h-full">
      {/* Main content */}
      <div className="flex-1 min-h-0 flex">
        <ExpandedTrack
          session={session}
          activeTrack={activeTrack}
          playing={playing}
          globalStep={globalStep}
          onParamChange={onParamChange}
          onInteractionStart={onInteractionStart}
          onInteractionEnd={onInteractionEnd}
          onModelChange={onModelChange}
          onAgencyChange={onAgencyChange}
          onNoteChange={onNoteChange}
          onHarmonicsChange={onHarmonicsChange}
          onExtendedSourceParamChange={onExtendedSourceParamChange}
          selectedProcessorId={selectedProcessorId}
          onSelectProcessor={onSelectProcessor}
          onProcessorParamChange={onProcessorParamChange}
          onProcessorInteractionStart={onProcessorInteractionStart}
          onProcessorInteractionEnd={onProcessorInteractionEnd}
          onProcessorModelChange={onProcessorModelChange}
          onRemoveProcessor={onRemoveProcessor}
          selectedModulatorId={selectedModulatorId}
          onSelectModulator={onSelectModulator}
          onModulatorParamChange={onModulatorParamChange}
          onModulatorInteractionStart={onModulatorInteractionStart}
          onModulatorInteractionEnd={onModulatorInteractionEnd}
          onModulatorModelChange={onModulatorModelChange}
          onRemoveModulator={onRemoveModulator}
          onSemanticChange={onSemanticChange}
          onSemanticInteractionStart={onSemanticInteractionStart}
          onSemanticInteractionEnd={onSemanticInteractionEnd}
          stepPage={stepPage}
          onStepToggle={onStepToggle}
          onStepAccent={onStepAccent}
          selectedStep={selectedStep}
          onStepSelect={onStepSelect}
          onPatternLength={onPatternLength}
          onPageChange={onPageChange}
          onClearPattern={onClearPattern}
          onAddView={onAddView}
          onRemoveView={onRemoveView}
          deepViewModuleId={deepViewModuleId}
          onOpenDeepView={onOpenDeepView}
          analyser={analyser}
        />
      </div>
    </div>
  );
}
