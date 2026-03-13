// src/ui/ExpandedVoice.tsx
// Layer 2: expanded voice layout with module-grouped controls.
import type { Session, Voice, Agency, SequencerViewKind, ModulationTarget } from '../engine/types';
import { getModelName, getEngineByIndex, getProcessorInstrument, getModulatorInstrument } from '../audio/instrument-registry';
import { controlIdToRuntimeParam } from '../audio/instrument-registry';
import { TransportBar } from './TransportBar';
import { ParameterSpace } from './ParameterSpace';
import { Visualiser } from './Visualiser';
import { PitchControl } from './PitchControl';
import { SequencerViewSlot } from './SequencerViewSlot';
import { ChainStrip } from './ChainStrip';
import { ControlSection } from './ControlSection';
import { DeepView } from './DeepView';

interface ExpandedVoiceProps {
  session: Session;
  activeVoice: Voice;
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
  // Modulator editing
  selectedModulatorId: string | null;
  onSelectModulator: (modulatorId: string | null) => void;
  onModulatorParamChange: (modulatorId: string, param: string, value: number) => void;
  onModulatorInteractionStart: (modulatorId: string) => void;
  onModulatorInteractionEnd: (modulatorId: string) => void;
  onModulatorModelChange: (modulatorId: string, model: number) => void;
  onRemoveModulator: (modulatorId: string) => void;
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

/** Build source controls from instrument registry */
function getSourceControls(voice: Voice) {
  const engine = getEngineByIndex(voice.model);
  if (!engine) return [];
  return engine.controls.map(c => ({
    id: c.id,
    name: c.name,
    value: voice.params[controlIdToRuntimeParam[c.id] ?? c.id] ?? c.range.default,
  }));
}

/** Build processor controls from instrument registry */
function getProcessorControls(proc: { type: string; model: number; params: Record<string, number> }) {
  const inst = getProcessorInstrument(proc.type);
  if (!inst) return [];
  const engine = inst.engines[proc.model] ?? inst.engines[0];
  if (!engine) return [];
  return engine.controls.map(c => ({
    id: c.id,
    name: c.name,
    value: proc.params[c.id] ?? c.range.default,
  }));
}

/** Build modulator controls from instrument registry */
function getModulatorControls(mod: { type: string; model: number; params: Record<string, number> }) {
  const inst = getModulatorInstrument(mod.type);
  if (!inst) return [];
  const engine = inst.engines[mod.model] ?? inst.engines[0];
  if (!engine) return [];
  return engine.controls.map(c => ({
    id: c.id,
    name: c.name,
    value: mod.params[c.id] ?? c.range.default,
  }));
}

/** Human-readable label for a modulation target */
function formatRoutingTarget(target: ModulationTarget, voice: Voice): string {
  if (target.kind === 'source') {
    return `Source / ${target.param.charAt(0).toUpperCase() + target.param.slice(1)}`;
  }
  const proc = (voice.processors ?? []).find(p => p.id === target.processorId);
  const procLabel = proc ? getProcessorInstrument(proc.type)?.label ?? proc.type : target.processorId;
  return `${procLabel} / ${target.param.charAt(0).toUpperCase() + target.param.slice(1)}`;
}

export function ExpandedVoice({
  session, activeVoice,
  playing, bpm, swing, recording, globalStep,
  onTogglePlay, onBpmChange, onSwingChange, onToggleRecord,
  onParamChange, onInteractionStart, onInteractionEnd,
  onModelChange, onAgencyChange, onNoteChange, onHarmonicsChange,
  selectedProcessorId, onSelectProcessor,
  onProcessorParamChange, onProcessorInteractionStart, onProcessorInteractionEnd,
  onProcessorModelChange, onRemoveProcessor,
  selectedModulatorId, onSelectModulator,
  onModulatorParamChange, onModulatorInteractionStart, onModulatorInteractionEnd,
  onModulatorModelChange, onRemoveModulator,
  onAddView, onRemoveView,
  stepPage, onStepToggle, onStepAccent, selectedStep, onStepSelect,
  onPatternLength, onPageChange, onClearPattern,
  deepViewModuleId, onOpenDeepView,
  analyser,
}: ExpandedVoiceProps) {
  const currentStep = Math.floor(globalStep % activeVoice.pattern.length);
  const processors = activeVoice.processors ?? [];
  const modulators = activeVoice.modulators ?? [];
  const modulations = activeVoice.modulations ?? [];
  const sourceLabel = `Plaits (${getModelName(activeVoice.model)})`;
  const sourceEngine = getEngineByIndex(activeVoice.model);

  // Build source engine list for mode selector
  const sourceEngines = Array.from({ length: 16 }, (_, i) => {
    const eng = getEngineByIndex(i);
    return eng ? { index: i, label: eng.label } : null;
  }).filter((e): e is { index: number; label: string } => e !== null);

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-3 p-4 overflow-y-auto">
      {/* Voice header: label, engine, agency toggle */}
      <div
        className="flex items-center gap-3"
        onDoubleClick={() => onOpenDeepView('all')}
      >
        <span className="text-[11px] font-medium tracking-wider uppercase text-zinc-300">
          {activeVoice.id}
        </span>
        <span className="text-[10px] text-zinc-500">
          {getModelName(activeVoice.model)}
        </span>
        <button
          onClick={() => onAgencyChange(activeVoice.agency === 'OFF' ? 'ON' : 'OFF')}
          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
            activeVoice.agency === 'ON'
              ? 'bg-teal-400/20 text-teal-400'
              : 'bg-zinc-800 text-zinc-500'
          }`}
        >
          {activeVoice.agency === 'ON' ? 'AI ON' : 'AI OFF'}
        </button>
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

      {/* Chain strip (if processors or modulators exist) */}
      {(processors.length > 0 || modulators.length > 0) && (
        <ChainStrip
          voice={activeVoice}
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
          voice={activeVoice}
          focusedModuleId={deepViewModuleId === 'all' ? null : deepViewModuleId}
          onClose={() => onOpenDeepView(null)}
        />
      ) : (
        <>
          {/* Source controls */}
          <ControlSection
            label={sourceLabel}
            accentColor="amber"
            controls={getSourceControls(activeVoice)}
            onParamChange={(controlId, value) => {
              const runtimeParam = controlIdToRuntimeParam[controlId] ?? controlId;
              if (runtimeParam === 'timbre') {
                onParamChange(value, activeVoice.params.morph);
              } else if (runtimeParam === 'morph') {
                onParamChange(activeVoice.params.timbre, value);
              } else if (runtimeParam === 'note') {
                onNoteChange(value);
              } else if (runtimeParam === 'harmonics') {
                onHarmonicsChange(value);
              }
            }}
            onInteractionStart={onInteractionStart}
            onInteractionEnd={onInteractionEnd}
            engines={sourceEngines}
            currentModel={activeVoice.model}
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
              <ControlSection
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
              <div key={mod.id}>
                <ControlSection
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
                />
                {/* Routing chips */}
                {modRoutings.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5 px-1">
                    {modRoutings.map(r => (
                      <span
                        key={r.id}
                        className="text-[9px] px-2 py-0.5 rounded bg-violet-400/10 border border-violet-400/20 text-violet-300"
                      >
                        → {formatRoutingTarget(r.target, activeVoice)} ({r.depth > 0 ? '+' : ''}{r.depth.toFixed(2)})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* XY pad */}
          <div className="relative flex-1 min-h-[200px]">
            <ParameterSpace
              timbre={activeVoice.params.timbre}
              morph={activeVoice.params.morph}
              onChange={onParamChange}
              onInteractionStart={onInteractionStart}
              onInteractionEnd={onInteractionEnd}
            />
          </div>
        </>
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
  );
}
