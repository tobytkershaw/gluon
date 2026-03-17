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

/** Distinct colors for modulation arcs — visually separable on dark backgrounds */
const MODULATION_ARC_COLORS = [
  'rgb(167 139 250)', // violet-400
  'rgb(34 211 238)',   // cyan-400
  'rgb(251 146 60)',   // orange-400
  'rgb(52 211 153)',   // emerald-400
  'rgb(251 113 133)',  // rose-400
  'rgb(250 204 21)',   // yellow-400
];

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

  // Assign a stable color per modulator ID based on its index in the modulators array
  const modulatorColorMap = new Map<string, string>();
  for (let i = 0; i < modulators.length; i++) {
    modulatorColorMap.set(modulators[i].id, MODULATION_ARC_COLORS[i % MODULATION_ARC_COLORS.length]);
  }

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
    const modColor = modulatorColorMap.get(route.modulatorId) ?? MODULATION_ARC_COLORS[0];

    const existing = map.get(matchedParam) ?? [];
    existing.push({ routeId: route.id, modulatorLabel: modLabel, depth: route.depth, color: modColor });
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

      {/* Module grid: wrap left-to-right, centered horizontally */}
      <div className="flex flex-wrap gap-3 items-start justify-center">
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
          onModulationDepthChange={onModulationDepthChange}
          onModulationDepthCommit={onModulationDepthCommit}
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
              onModulationDepthChange={onModulationDepthChange}
              onModulationDepthCommit={onModulationDepthCommit}
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

        {/* Add module button — wider hint when chain is empty, compact when populated */}
        <button
          type="button"
          onClick={() => setBrowserOpen(true)}
          className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed transition-colors ${
            processors.length === 0 && modulators.length === 0
              ? 'border-zinc-700/40 text-zinc-600 hover:text-zinc-400 hover:border-zinc-600/50 bg-zinc-800/20'
              : 'border-zinc-700/50 text-zinc-500 hover:text-zinc-400 hover:border-zinc-600/50'
          }`}
          style={{ minWidth: processors.length === 0 && modulators.length === 0 ? 220 : 148, height: 572 }}
        >
          <span className="text-xl leading-none">+</span>
          <span className="text-[11px] font-mono uppercase tracking-wider">Add Module</span>
          {processors.length === 0 && modulators.length === 0 && (
            <span className="text-[10px] text-zinc-600 mt-1 max-w-[160px] text-center leading-tight">
              Add processors and modulators to build your signal chain
            </span>
          )}
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
