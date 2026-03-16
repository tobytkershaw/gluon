// src/ui/ExpandedTrack.tsx
// Layer 2: expanded track layout with module-grouped controls.
import type { Session, Track, Agency, SequencerViewKind, SemanticControlDef } from '../engine/types';
import { getModelName, getEngineByIndex, getProcessorInstrument, getModulatorInstrument } from '../audio/instrument-registry';
import { controlIdToRuntimeParam } from '../audio/instrument-registry';
import { getTrackLabel } from '../engine/track-labels';
import { ParameterSpace } from './ParameterSpace';
import { Visualiser } from './Visualiser';
import { PitchControl } from './PitchControl';
import { SequencerViewSlot } from './SequencerViewSlot';
import { ChainStrip } from './ChainStrip';
import { ModulePanel } from './ModulePanel';
import { RoutingChips } from './RoutingChip';
import { DeepView } from './DeepView';
import { SemanticControlsSection } from './SemanticControlsSection';
import { getSourceControls, getProcessorControls, getModulatorControls } from './module-controls';

interface ExpandedTrackProps {
  session: Session;
  activeTrack: Track;
  // Transport (position only — play/bpm/swing/record moved to global top bar)
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
  // Processor editing
  selectedProcessorId: string | null;
  onSelectProcessor: (processorId: string | null) => void;
  onProcessorParamChange: (processorId: string, param: string, value: number) => void;
  onProcessorInteractionStart: (processorId: string) => void;
  onProcessorInteractionEnd: (processorId: string) => void;
  onProcessorModelChange: (processorId: string, model: number) => void;
  onRemoveProcessor: (processorId: string) => void;
  onToggleProcessorEnabled?: (processorId: string) => void;
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

export function ExpandedTrack({
  activeTrack,
  playing, globalStep,
  onParamChange, onInteractionStart, onInteractionEnd,
  onModelChange, onAgencyChange, onNoteChange, onHarmonicsChange,
  selectedProcessorId, onSelectProcessor,
  onProcessorParamChange, onProcessorInteractionStart, onProcessorInteractionEnd,
  onProcessorModelChange, onRemoveProcessor, onToggleProcessorEnabled,
  selectedModulatorId, onSelectModulator,
  onModulatorParamChange, onModulatorInteractionStart, onModulatorInteractionEnd,
  onModulatorModelChange, onRemoveModulator,
  onSemanticChange, onSemanticInteractionStart, onSemanticInteractionEnd,
  onAddView, onRemoveView,
  stepPage, onStepToggle, onStepAccent, selectedStep, onStepSelect,
  onPatternLength, onPageChange, onClearPattern,
  deepViewModuleId, onOpenDeepView,
  analyser,
}: ExpandedTrackProps) {
  const currentStep = Math.floor(globalStep % activeTrack.pattern.length);
  const processors = activeTrack.processors ?? [];
  const modulators = activeTrack.modulators ?? [];
  const modulations = activeTrack.modulations ?? [];
  const sourceLabel = `Plaits (${getModelName(activeTrack.model)})`;

  // Build source engine list for mode selector
  const sourceEngines = Array.from({ length: 16 }, (_, i) => {
    const eng = getEngineByIndex(i);
    return eng ? { index: i, label: eng.label } : null;
  }).filter((e): e is { index: number; label: string } => e !== null);

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-3 p-4 overflow-y-auto">
      {/* Track header: label, engine, agency toggle */}
      <div
        className="flex items-center gap-3"
        onDoubleClick={() => onOpenDeepView('all')}
      >
        <span className="text-[11px] font-medium tracking-wider uppercase text-zinc-300">
          {getTrackLabel(activeTrack)}
        </span>
        <span className="text-[10px] text-zinc-500">
          {getModelName(activeTrack.model)}
        </span>
        <button
          onClick={() => onAgencyChange(activeTrack.agency === 'OFF' ? 'ON' : 'OFF')}
          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
            activeTrack.agency === 'ON'
              ? 'bg-teal-400/20 text-teal-400'
              : 'bg-zinc-800 text-zinc-500'
          }`}
        >
          {activeTrack.agency === 'ON' ? 'AI ON' : 'AI OFF'}
        </button>
      </div>

      {/* Chain strip (if processors or modulators exist) */}
      {(processors.length > 0 || modulators.length > 0) && (
        <ChainStrip
          track={activeTrack}
          selectedProcessorId={selectedProcessorId}
          selectedModulatorId={selectedModulatorId}
          onSelectProcessor={onSelectProcessor}
          onSelectModulator={onSelectModulator}
          onNodeClick={(moduleId) => onOpenDeepView(moduleId)}
        />
      )}

      {/* Deep view or control area */}
      {deepViewModuleId !== null ? (
        <DeepView
          track={activeTrack}
          focusedModuleId={deepViewModuleId === 'all' ? null : deepViewModuleId}
          onClose={() => onOpenDeepView(null)}
        />
      ) : (
        <>
          {/* Semantic controls (chain voices only) */}
          {processors.length > 0 && (
            <SemanticControlsSection
              track={activeTrack}
              onSemanticChange={onSemanticChange}
              onInteractionStart={onSemanticInteractionStart}
              onInteractionEnd={onSemanticInteractionEnd}
            />
          )}

          {/* Source controls */}
          <ModulePanel
            label={sourceLabel}
            accentColor="amber"
            controls={getSourceControls(activeTrack)}
            onParamChange={(controlId, value) => {
              const runtimeParam = controlIdToRuntimeParam[controlId] ?? controlId;
              if (runtimeParam === 'timbre') {
                onParamChange(value, activeTrack.params.morph);
              } else if (runtimeParam === 'morph') {
                onParamChange(activeTrack.params.timbre, value);
              } else if (runtimeParam === 'note') {
                onNoteChange(value);
              } else if (runtimeParam === 'harmonics') {
                onHarmonicsChange(value);
              }
            }}
            onInteractionStart={onInteractionStart}
            onInteractionEnd={onInteractionEnd}
            engines={sourceEngines}
            currentModel={activeTrack.model}
            onModelChange={onModelChange}
          />

          {/* Processor control sections */}
          {processors.map((proc) => {
            const inst = getProcessorInstrument(proc.type);
            if (!inst) return null;
            const engine = inst.engines[proc.model] ?? inst.engines[0];
            const procLabel = engine ? `${inst.label}: ${engine.label}` : inst.label;
            const procEngines = inst.engines.map((e, i) => ({ index: i, label: e.label }));

            return (
              <ModulePanel
                key={proc.id}
                label={procLabel}
                accentColor="sky"
                controls={getProcessorControls(proc)}
                onParamChange={(controlId, value) => onProcessorParamChange(proc.id, controlId, value)}
                onInteractionStart={() => onProcessorInteractionStart(proc.id)}
                onInteractionEnd={() => onProcessorInteractionEnd(proc.id)}
                isHighlighted={selectedProcessorId === proc.id}
                engines={procEngines}
                currentModel={proc.model}
                onModelChange={(model) => onProcessorModelChange(proc.id, model)}
                onRemove={() => onRemoveProcessor(proc.id)}
                enabled={proc.enabled}
                onToggleEnabled={onToggleProcessorEnabled ? () => onToggleProcessorEnabled(proc.id) : undefined}
              />
            );
          })}

          {/* Modulator control sections */}
          {modulators.map((mod) => {
            const inst = getModulatorInstrument(mod.type);
            if (!inst) return null;
            const engine = inst.engines[mod.model] ?? inst.engines[0];
            const modLabel = engine ? `${inst.label}: ${engine.label}` : inst.label;
            const modEngines = inst.engines.map((e, i) => ({ index: i, label: e.label }));
            const modRoutings = modulations.filter(r => r.modulatorId === mod.id);

            return (
              <ModulePanel
                key={mod.id}
                label={modLabel}
                accentColor="violet"
                controls={getModulatorControls(mod)}
                onParamChange={(controlId, value) => onModulatorParamChange(mod.id, controlId, value)}
                onInteractionStart={() => onModulatorInteractionStart(mod.id)}
                onInteractionEnd={() => onModulatorInteractionEnd(mod.id)}
                isHighlighted={selectedModulatorId === mod.id}
                engines={modEngines}
                currentModel={mod.model}
                onModelChange={(model) => onModulatorModelChange(mod.id, model)}
                onRemove={() => onRemoveModulator(mod.id)}
              >
                <RoutingChips
                  routings={modRoutings}
                  track={activeTrack}
                />
              </ModulePanel>
            );
          })}

          {/* XY pad */}
          <div className="relative flex-1 min-h-[200px]">
            <ParameterSpace
              timbre={activeTrack.params.timbre}
              morph={activeTrack.params.morph}
              onChange={onParamChange}
              onInteractionStart={onInteractionStart}
              onInteractionEnd={onInteractionEnd}
            />
          </div>
        </>
      )}

      {(activeTrack.views ?? []).map((viewConfig) => (
        <SequencerViewSlot
          key={viewConfig.id}
          config={viewConfig}
          onRemove={onRemoveView ?? (() => {})}
          pattern={activeTrack.pattern}
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
          note={activeTrack.params.note}
          harmonics={activeTrack.params.harmonics}
          onNoteChange={onNoteChange}
          onHarmonicsChange={onHarmonicsChange}
        />
      </div>
    </div>
  );
}
