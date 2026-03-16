// src/ui/RackView.tsx
// Rack view: Eurorack-style vertical module panel grid for the active track.
// Modules fill left to right in a flex-wrap container, wrapping to the next row
// at the container edge. Each module is a vertical panel with large knobs for
// primary controls, small knobs for secondary, selectors/toggles for mode pickers.
import { useState, useRef, useEffect } from 'react';
import type { Track, ModulationTarget } from '../engine/types';
import { getModelName, getEngineByIndex, getProcessorInstrument, getModulatorInstrument } from '../audio/instrument-registry';
import { controlIdToRuntimeParam } from '../audio/instrument-registry';
import { ModulePanel } from './ModulePanel';
import { ChainStrip } from './ChainStrip';
import { getSourceControls, getProcessorControls, getModulatorControls } from './module-controls';
import { ModuleBrowser } from './ModuleBrowser';
import { DraggableNumber } from './DraggableNumber';

/** Valid source params that can be modulation targets (matches chain-validation.ts) */
const VALID_SOURCE_MOD_TARGETS = ['timbre', 'harmonics', 'morph'];

interface ModulationTargetOption {
  moduleId: string;  // 'source' or processorId
  moduleLabel: string;
  paramId: string;
  paramLabel: string;
  target: ModulationTarget;
}

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
  // Modulator editing
  onModulatorParamChange: (modulatorId: string, param: string, value: number) => void;
  onModulatorInteractionStart: (modulatorId: string) => void;
  onModulatorInteractionEnd: (modulatorId: string) => void;
  onModulatorModelChange: (modulatorId: string, model: number) => void;
  onRemoveModulator: (modulatorId: string) => void;
  // Modulation routing editing
  onModulationDepthChange: (routeId: string, depth: number) => void;
  onModulationDepthCommit: (routeId: string, depth: number) => void;
  onRemoveModulation: (routeId: string) => void;
  onConnectModulator: (modulatorId: string, target: ModulationTarget, depth: number) => void;
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

/** Build list of valid modulation targets for a given modulator on a track */
function buildTargetOptions(track: Track, modulatorId: string): ModulationTargetOption[] {
  const options: ModulationTargetOption[] = [];
  const existingRoutes = (track.modulations ?? []).filter(r => r.modulatorId === modulatorId);

  // Source targets (brightness, richness, texture -- not pitch)
  const sourceEngine = getEngineByIndex(track.model);
  if (sourceEngine) {
    for (const control of sourceEngine.controls) {
      if (!VALID_SOURCE_MOD_TARGETS.includes(control.id)) continue;
      // Skip if this modulator already routes to this source param
      const alreadyRouted = existingRoutes.some(
        r => r.target.kind === 'source' && r.target.param === control.id
      );
      if (alreadyRouted) continue;
      options.push({
        moduleId: 'source',
        moduleLabel: 'Plaits',
        paramId: control.id,
        paramLabel: control.name,
        target: { kind: 'source', param: control.id },
      });
    }
  }

  // Processor targets
  const processors = track.processors ?? [];
  for (const proc of processors) {
    const inst = getProcessorInstrument(proc.type);
    if (!inst) continue;
    const engine = inst.engines[proc.model] ?? inst.engines[0];
    if (!engine) continue;
    for (const control of engine.controls) {
      const alreadyRouted = existingRoutes.some(
        r => r.target.kind === 'processor' && r.target.processorId === proc.id && r.target.param === control.id
      );
      if (alreadyRouted) continue;
      options.push({
        moduleId: proc.id,
        moduleLabel: inst.label.replace('Mutable Instruments ', ''),
        paramId: control.id,
        paramLabel: control.name,
        target: { kind: 'processor', processorId: proc.id, param: control.id },
      });
    }
  }

  return options;
}

function TargetPicker({ options, onSelect, onClose }: {
  options: ModulationTargetOption[];
  onSelect: (option: ModulationTargetOption) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  // Group options by module
  const groups = new Map<string, { label: string; isSource: boolean; options: ModulationTargetOption[] }>();
  for (const opt of options) {
    if (!groups.has(opt.moduleId)) {
      groups.set(opt.moduleId, {
        label: opt.moduleLabel,
        isSource: opt.moduleId === 'source',
        options: [],
      });
    }
    groups.get(opt.moduleId)!.options.push(opt);
  }

  if (options.length === 0) {
    return (
      <div ref={ref} className="mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg p-2">
        <span className="text-[10px] text-zinc-500 italic">No available targets</span>
      </div>
    );
  }

  return (
    <div ref={ref} className="mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
      {Array.from(groups.entries()).map(([moduleId, group]) => (
        <div key={moduleId} className="p-1">
          <div className={`text-[9px] uppercase tracking-wider font-medium px-2 py-1 ${
            group.isSource ? 'text-amber-400/70' : 'text-sky-400/70'
          }`}>
            {group.label}
          </div>
          {group.options.map((opt) => (
            <button
              key={`${opt.moduleId}-${opt.paramId}`}
              onClick={() => onSelect(opt)}
              className="block w-full text-left px-2 py-1 rounded text-[10px] text-zinc-300 hover:bg-violet-400/10 hover:text-violet-200 transition-colors"
            >
              {opt.paramLabel}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function RackView({
  activeTrack,
  onParamChange, onInteractionStart, onInteractionEnd,
  onModelChange, onNoteChange, onHarmonicsChange,
  onProcessorParamChange, onProcessorInteractionStart, onProcessorInteractionEnd,
  onProcessorModelChange, onRemoveProcessor,
  onModulatorParamChange, onModulatorInteractionStart, onModulatorInteractionEnd,
  onModulatorModelChange, onRemoveModulator,
  onModulationDepthChange, onModulationDepthCommit, onRemoveModulation,
  onConnectModulator,
  onAddProcessor, onAddModulator,
}: RackViewProps) {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [routePickerModulatorId, setRoutePickerModulatorId] = useState<string | null>(null);

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
      {/* Chain strip (if processors or modulators exist) */}
      {(processors.length > 0 || modulators.length > 0) && (
        <div className="mb-0">
          <ChainStrip
            track={activeTrack}
          />
        </div>
      )}

      {/* Module grid: flex-wrap left-to-right */}
      <div className="flex flex-wrap gap-3 items-start">
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
          const isPickerOpen = routePickerModulatorId === mod.id;

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
              {/* Routing section inside modulator panel */}
              <div className="border-t border-zinc-800/40 pt-2">
                <button
                  type="button"
                  onClick={() => setRoutePickerModulatorId(isPickerOpen ? null : mod.id)}
                  className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-dashed border-violet-400/30 text-violet-400/60 hover:text-violet-400 hover:border-violet-400/50 transition-colors"
                >
                  + Route
                </button>
                {isPickerOpen && (
                  <TargetPicker
                    options={buildTargetOptions(activeTrack, mod.id)}
                    onSelect={(opt) => {
                      onConnectModulator(mod.id, opt.target, 0.2);
                      setRoutePickerModulatorId(null);
                    }}
                    onClose={() => setRoutePickerModulatorId(null)}
                  />
                )}
                {/* Routing chips */}
                {modRoutings.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {modRoutings.map(r => (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 rounded bg-violet-400/10 border border-violet-400/20 text-violet-300"
                      >
                        <span className="opacity-60">{'\u2192'}</span>
                        <span className="truncate max-w-[80px]">{formatRoutingTarget(r.target, activeTrack)}</span>
                        <DraggableNumber
                          value={r.depth}
                          min={-1}
                          max={1}
                          step={0.01}
                          decimals={2}
                          className="text-violet-200 hover:text-violet-100"
                          onChange={(depth) => onModulationDepthChange(r.id, depth)}
                          onCommit={(depth) => onModulationDepthCommit(r.id, depth)}
                        />
                        <button
                          type="button"
                          onClick={() => onRemoveModulation(r.id)}
                          className="ml-0.5 text-violet-400/40 hover:text-red-400 transition-colors leading-none"
                          title="Remove route"
                        >
                          {'\u00d7'}
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </ModulePanel>
          );
        })}

        {/* Add module button (fits in the grid flow) */}
        <button
          type="button"
          onClick={() => setBrowserOpen(true)}
          className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-700/50 text-zinc-500 hover:text-zinc-400 hover:border-zinc-600/50 transition-colors"
          style={{ width: 168, minHeight: 120 }}
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
