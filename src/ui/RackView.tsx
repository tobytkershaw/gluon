// src/ui/RackView.tsx
// Rack view: Guitar Rig-style vertical stack of module panels for the active track.
import { useState } from 'react';
import type { Session, Track, ModulationTarget } from '../engine/types';
import { getModelName, getEngineByIndex, getProcessorInstrument, getModulatorInstrument } from '../audio/instrument-registry';
import { controlIdToRuntimeParam } from '../audio/instrument-registry';
import { ControlSection } from './ControlSection';
import { getSourceControls, getProcessorControls, getModulatorControls } from './module-controls';
import { ModuleBrowser } from './ModuleBrowser';

interface RackViewProps {
  session: Session;
  activeTrack: Track;
  // Source param editing
  onParamChange: (timbre: number, morph: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  onModelChange: (model: number) => void;
  onNoteChange: (note: number) => void;
  onHarmonicsChange: (harmonics: number) => void;
  // Processor editing
  onProcessorParamChange: (processorId: string, param: string, value: number) => void;
  onProcessorInteractionStart: (processorId: string) => void;
  onProcessorInteractionEnd: (processorId: string) => void;
  onProcessorModelChange: (processorId: string, model: number) => void;
  onRemoveProcessor: (processorId: string) => void;
  // Modulator editing
  onModulatorParamChange: (modulatorId: string, param: string, value: number) => void;
  onModulatorInteractionStart: (modulatorId: string) => void;
  onModulatorInteractionEnd: (modulatorId: string) => void;
  onModulatorModelChange: (modulatorId: string, model: number) => void;
  onRemoveModulator: (modulatorId: string) => void;
  // Module browser
  onAddProcessor: (type: string) => void;
  onAddModulator: (type: string) => void;
}

/** Human-readable label for a modulation target */
function formatRoutingTarget(target: ModulationTarget, track: Track): string {
  if (target.kind === 'source') {
    return `Source / ${target.param.charAt(0).toUpperCase() + target.param.slice(1)}`;
  }
  const proc = (track.processors ?? []).find(p => p.id === target.processorId);
  const procLabel = proc ? getProcessorInstrument(proc.type)?.label ?? proc.type : target.processorId;
  return `${procLabel} / ${target.param.charAt(0).toUpperCase() + target.param.slice(1)}`;
}

export function RackView({
  activeTrack,
  onParamChange, onInteractionStart, onInteractionEnd,
  onModelChange, onNoteChange, onHarmonicsChange,
  onProcessorParamChange, onProcessorInteractionStart, onProcessorInteractionEnd,
  onProcessorModelChange, onRemoveProcessor,
  onModulatorParamChange, onModulatorInteractionStart, onModulatorInteractionEnd,
  onModulatorModelChange, onRemoveModulator,
  onAddProcessor, onAddModulator,
}: RackViewProps) {
  const [browserOpen, setBrowserOpen] = useState(false);

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
      {/* Source module */}
      <ControlSection
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

      {/* Processor modules */}
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
            engines={procEngines}
            currentModel={proc.model}
            onModelChange={(model) => onProcessorModelChange(proc.id, model)}
            onRemove={() => onRemoveProcessor(proc.id)}
          />
        );
      })}

      {/* Modulator modules */}
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
                    {'\u2192'} {formatRoutingTarget(r.target, activeTrack)} ({r.depth > 0 ? '+' : ''}{r.depth.toFixed(2)})
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Add module button */}
      <button
        type="button"
        onClick={() => setBrowserOpen(true)}
        className="flex items-center justify-center gap-1.5 py-2 rounded border border-dashed border-zinc-700/50 text-zinc-500 hover:text-zinc-400 hover:border-zinc-600/50 transition-colors text-[10px] font-mono uppercase tracking-wider"
      >
        <span className="text-sm leading-none">+</span>
        Add Module
      </button>

      {/* Module browser slide-out */}
      {browserOpen && (
        <ModuleBrowser
          activeTrack={activeTrack}
          onAddProcessor={onAddProcessor}
          onAddModulator={onAddModulator}
          onClose={() => setBrowserOpen(false)}
        />
      )}
    </div>
  );
}
