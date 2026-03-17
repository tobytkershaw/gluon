// src/ui/RackView.tsx
// Rack view: Eurorack-style vertical module panel grid for the active track.
// Modules flow left to right in a horizontal-scroll container (no wrapping),
// preserving clear signal-flow direction: Source → Processors → Output.
// Each module is a vertical panel with large knobs for primary controls,
// small knobs for secondary, selectors/toggles for mode pickers.
import { useState, useMemo } from 'react';
import type { Track } from '../engine/types';
import { getModelName, getEngineByIndex, getProcessorInstrument, getModulatorInstrument } from '../audio/instrument-registry';
import { controlIdToRuntimeParam } from '../audio/instrument-registry';
import { ModulePanel } from './ModulePanel';
import { ChainStrip } from './ChainStrip';
import { RoutingChips } from './RoutingChip';
import { getSourceControls, getProcessorControls, getModulatorControls } from './module-controls';
import { ModuleBrowser } from './ModuleBrowser';
import type { KnobModulationInfo } from './Knob';

interface RackViewProps {
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
  onToggleProcessorEnabled?: (processorId: string) => void;
  // Modulator editing
  onModulatorParamChange: (modulatorId: string, param: string, value: number) => void;
  onModulatorInteractionStart: (modulatorId: string) => void;
  onModulatorInteractionEnd: (modulatorId: string) => void;
  onModulatorModelChange: (modulatorId: string, model: number) => void;
  onRemoveModulator: (modulatorId: string) => void;
  // Modulation routing editing (depth + removal only; creation is in Patch view)
  onModulationDepthChange: (routeId: string, depth: number) => void;
  onModulationDepthCommit: (routeId: string, depth: number) => void;
  onRemoveModulation: (routeId: string) => void;
  // Module browser
  onAddProcessor: (type: string) => void;
  onAddModulator: (type: string) => void;
  // Navigation
  onNavigateToPatch?: () => void;
}

/**
 * Build a map of controlId -> KnobModulationInfo[] for a given moduleId.
 * Used to show modulation indicators on Rack knobs.
 */
function buildModulationMap(
  track: Track,
  moduleId: string,
): Map<string, KnobModulationInfo[]> {
  const map = new Map<string, KnobModulationInfo[]>();
  const modulations = track.modulations ?? [];
  const modulators = track.modulators ?? [];

  for (const route of modulations) {
    let matchedParam: string | undefined;
    if (moduleId === 'source' && route.target.kind === 'source') {
      matchedParam = route.target.param;
    } else if (moduleId !== 'source' && route.target.kind === 'processor' && route.target.processorId === moduleId) {
      matchedParam = route.target.param;
    }
    if (!matchedParam) continue;

    const mod = modulators.find(m => m.id === route.modulatorId);
    const modInst = mod ? getModulatorInstrument(mod.type) : undefined;
    const modLabel = modInst?.label?.replace('Mutable Instruments ', '') ?? route.modulatorId.slice(0, 8);

    const existing = map.get(matchedParam) ?? [];
    existing.push({ modulatorLabel: modLabel, depth: route.depth });
    map.set(matchedParam, existing);
  }
  return map;
}

export function RackView({
  activeTrack,
  onParamChange, onInteractionStart, onInteractionEnd,
  onModelChange, onNoteChange, onHarmonicsChange,
  onProcessorParamChange, onProcessorInteractionStart, onProcessorInteractionEnd,
  onProcessorModelChange, onRemoveProcessor, onToggleProcessorEnabled,
  onModulatorParamChange, onModulatorInteractionStart, onModulatorInteractionEnd,
  onModulatorModelChange, onRemoveModulator,
  onModulationDepthChange, onModulationDepthCommit, onRemoveModulation,
  onAddProcessor, onAddModulator,
  onNavigateToPatch,
}: RackViewProps) {
  const [browserOpen, setBrowserOpen] = useState(false);

  const processors = activeTrack.processors ?? [];
  const modulators = activeTrack.modulators ?? [];
  const modulations = activeTrack.modulations ?? [];
  const sourceLabel = activeTrack.model < 0 ? 'No Source' : `Plaits (${getModelName(activeTrack.model)})`;

  // Build source engine list for mode selector
  const sourceEngines = Array.from({ length: 16 }, (_, i) => {
    const eng = getEngineByIndex(i);
    return eng ? { index: i, label: eng.label } : null;
  }).filter((e): e is { index: number; label: string } => e !== null);

  // Pre-compute modulation maps for all modules
  const sourceModMap = useMemo(
    () => buildModulationMap(activeTrack, 'source'),
    [activeTrack],
  );
  const processorModMaps = useMemo(
    () => new Map(processors.map(p => [p.id, buildModulationMap(activeTrack, p.id)])),
    [activeTrack, processors],
  );

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-3 p-4 overflow-y-auto">
      {/* Chain strip (if processors or modulators exist) */}
      {(processors.length > 0 || modulators.length > 0) && (
        <div className="mb-0">
          <ChainStrip
            track={activeTrack}
          />
        </div>
      )}

      {/* Module grid: horizontal scroll, no wrap — preserves signal flow direction */}
      <div className="flex flex-nowrap gap-3 items-start overflow-x-auto pb-2">
        {/* Source module panel */}
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
          modulationMap={sourceModMap}
          onModulationClick={onNavigateToPatch}
        />

        {/* Processor module panels */}
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
              engines={procEngines}
              currentModel={proc.model}
              onModelChange={(model) => onProcessorModelChange(proc.id, model)}
              onRemove={() => onRemoveProcessor(proc.id)}
              enabled={proc.enabled}
              onToggleEnabled={onToggleProcessorEnabled ? () => onToggleProcessorEnabled(proc.id) : undefined}
              modulationMap={processorModMaps.get(proc.id)}
              onModulationClick={onNavigateToPatch}
            />
          );
        })}

        {/* Modulator module panels */}
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
              engines={modEngines}
              currentModel={mod.model}
              onModelChange={(model) => onModulatorModelChange(mod.id, model)}
              onRemove={() => onRemoveModulator(mod.id)}
            >
              <RoutingChips
                routings={modRoutings}
                track={activeTrack}
                interactive
                onDepthChange={onModulationDepthChange}
                onDepthCommit={onModulationDepthCommit}
                onRemove={onRemoveModulation}
                onNavigateToPatch={onNavigateToPatch}
              />
            </ModulePanel>
          );
        })}

        {/* Add module button (fits in the grid flow, matches uniform module height) */}
        <button
          type="button"
          onClick={() => setBrowserOpen(true)}
          className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-700/50 text-zinc-500 hover:text-zinc-400 hover:border-zinc-600/50 transition-colors shrink-0"
          style={{ width: 168, height: 572 }}
        >
          <span className="text-xl leading-none">+</span>
          <span className="text-[9px] font-mono uppercase tracking-wider">Add Module</span>
        </button>
      </div>

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
