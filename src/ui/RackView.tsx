// src/ui/RackView.tsx
// Rack view: Eurorack-style vertical module panel grid for the active track.
// Modules flow left to right in a horizontal-scroll container (no wrapping),
// preserving clear signal-flow direction: Source → Processors → Output.
// Each module is a vertical panel with large knobs for primary controls,
// small knobs for secondary, selectors/toggles for mode pickers.
import { useState, useMemo } from 'react';
import type { Track } from '../engine/types';
import { MAX_DRUM_PADS } from '../engine/types';
import { getModelName, getEngineByIndex, getProcessorInstrument, getModulatorInstrument, controlIdToRuntimeParam } from '../audio/instrument-registry';
import { ModulePanel } from './ModulePanel';
import { ChainStrip } from './ChainStrip';
import { RoutingChips } from './RoutingChip';
import { getSourceControls, getProcessorControls, getModulatorControls, getDrumPadControls } from './module-controls';
import { ModuleBrowser } from './ModuleBrowser';
import type { KnobModulationInfo } from './Knob';
import { routeSourceModuleParam } from './source-param-routing';

interface RackViewProps {
  activeTrack: Track;
  // Source param editing
  onParamChange: (timbre: number, morph: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  onModelChange: (model: number) => void;
  onNoteChange: (note: number) => void;
  onHarmonicsChange: (harmonics: number) => void;
  onExtendedSourceParamChange: (runtimeParam: string, value: number) => void;
  onPortamentoChange?: (field: 'portamentoTime' | 'portamentoMode', value: number | string) => void;
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
  // Processor replace
  onReplaceProcessor?: (processorId: string, newModuleType: string) => void;
  // Ramp request (Shift+Click on knobs)
  onRampRequest?: (controlId: string, targetValue: number, durationMs: number, processorId?: string) => void;
  // Pin-to-Surface
  onPinControl?: (moduleId: string, controlId: string) => void;
  pinnedControlIds?: (moduleId: string) => Set<string>;
  // Drum pad editing
  onDrumPadParamChange?: (padId: string, param: string, value: number) => void;
  onDrumPadModelChange?: (padId: string, model: number) => void;
  onAddDrumPad?: () => void;
  onRemoveDrumPad?: (padId: string) => void;
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
  onExtendedSourceParamChange,
  onPortamentoChange,
  onProcessorParamChange, onProcessorInteractionStart, onProcessorInteractionEnd,
  onProcessorModelChange, onRemoveProcessor, onToggleProcessorEnabled,
  onModulatorParamChange, onModulatorInteractionStart, onModulatorInteractionEnd,
  onModulatorModelChange, onRemoveModulator,
  onModulationDepthChange, onModulationDepthCommit, onRemoveModulation,
  onAddProcessor, onAddModulator,
  onReplaceProcessor,
  onRampRequest,
  onPinControl,
  pinnedControlIds,
  onDrumPadParamChange,
  onDrumPadModelChange,
  onAddDrumPad,
  onRemoveDrumPad,
  onNavigateToPatch,
}: RackViewProps) {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [replacingProcessorId, setReplacingProcessorId] = useState<string | null>(null);

  const processors = activeTrack.processors ?? [];
  const modulators = activeTrack.modulators ?? [];
  const modulations = activeTrack.modulations ?? [];
  const sourceLabel = activeTrack.model < 0 ? 'No Source' : `Plaits (${getModelName(activeTrack.model)})`;

  // Detect drum rack
  const isDrumRack = activeTrack.engine === 'drum-rack' && activeTrack.drumRack != null;
  const drumPads = isDrumRack ? activeTrack.drumRack!.pads : [];

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
    <div className="flex-1 min-w-0 flex flex-col" style={{ background: 'var(--bg-deep, #0f0e0c)' }}>
      {/* Chain strip — always visible */}
      <ChainStrip
        track={activeTrack}
      />

      {/* Module area */}
      <div className="flex-1 overflow-y-auto relative" style={{ alignContent: 'flex-start' }}>
        {/* Add module tab (right edge) */}
        <button
          type="button"
          onClick={() => setBrowserOpen(true)}
          className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer hover:bg-zinc-800 transition-colors z-10"
          style={{
            width: 24,
            height: 96,
            background: 'var(--bg-surface, #1c1917)',
            border: '1px solid rgba(61,57,53,0.6)',
            borderRight: 'none',
            borderRadius: '6px 0 0 6px',
            color: 'var(--text-faint, #57534e)',
            fontSize: 14,
            writingMode: 'vertical-rl',
            letterSpacing: '0.06em',
          }}
          title="Add module"
        >
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)', textTransform: 'uppercase' }}>+ Module</span>
        </button>

        {isDrumRack ? (
          /* Drum rack layout: labeled row per pad, then shared processors/modulators */
          <div className="flex flex-col gap-2 p-6">
            {/* Drum pad section header */}
            <div className="font-mono text-[10px] uppercase tracking-wider pb-1"
              style={{ color: 'var(--text-faint, #57534e)', letterSpacing: '0.08em', borderBottom: '1px solid rgba(61,57,53,0.3)' }}
            >
              Drum Pads
            </div>

            {/* One row per pad */}
            {drumPads.map((pad, padIndex) => {
              const padLabel = `${pad.name} (${getModelName(pad.source.model)})`;
              return (
                <div
                  key={pad.id}
                  className="flex items-start gap-4 py-2 px-2 rounded"
                  style={{
                    background: padIndex % 2 === 1 ? 'rgba(255,255,255,0.02)' : undefined,
                    borderBottom: padIndex < drumPads.length - 1 ? '1px solid rgba(63,63,70,0.3)' : undefined,
                  }}
                >
                  <ModulePanel
                    label={padLabel}
                    accentColor="amber"
                    controls={getDrumPadControls(pad)}
                    onParamChange={(controlId, value) => {
                      if (!onDrumPadParamChange) return;
                      if (controlId === 'level') {
                        onDrumPadParamChange(pad.id, 'level', value);
                      } else if (controlId === 'pan') {
                        // Convert 0..1 knob range back to -1..1 model range
                        onDrumPadParamChange(pad.id, 'pan', value * 2 - 1);
                      } else {
                        // Map control ID to runtime param name (e.g. 'frequency' -> 'note')
                        const runtimeParam = controlIdToRuntimeParam[controlId] ?? controlId;
                        onDrumPadParamChange(pad.id, runtimeParam, value);
                      }
                    }}
                    onInteractionStart={onInteractionStart}
                    onInteractionEnd={onInteractionEnd}
                    engines={sourceEngines}
                    currentModel={pad.source.model}
                    onModelChange={onDrumPadModelChange ? (model) => onDrumPadModelChange(pad.id, model) : undefined}
                    onRemove={onRemoveDrumPad ? () => onRemoveDrumPad(pad.id) : undefined}
                    onPinControl={onPinControl ? (controlId) => onPinControl(`pad:${pad.id}`, controlId) : undefined}
                    pinnedControlIds={pinnedControlIds?.(`pad:${pad.id}`)}
                  />
                </div>
              );
            })}

            {/* Add pad button */}
            {onAddDrumPad && drumPads.length < MAX_DRUM_PADS && (
              <button
                type="button"
                onClick={onAddDrumPad}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-amber-700/40 text-amber-600 hover:text-amber-400 hover:border-amber-600/50 transition-colors self-start"
              >
                <span className="text-sm leading-none">+</span>
                <span className="text-[11px] font-mono uppercase tracking-wider">Add Pad</span>
              </button>
            )}

            {/* Processors and modulators section — shared across all pads */}
            {(processors.length > 0 || modulators.length > 0) && (
              <>
                <div className="font-mono text-[10px] uppercase tracking-wider pb-1 mt-4"
                  style={{ color: 'var(--text-faint, #57534e)', letterSpacing: '0.08em', borderBottom: '1px solid rgba(61,57,53,0.3)' }}
                >
                  Signal Chain
                </div>
                <div className="flex flex-wrap gap-4 items-start">
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
                        onReplace={onReplaceProcessor ? () => { setReplacingProcessorId(proc.id); setBrowserOpen(true); } : undefined}
                        enabled={proc.enabled}
                        onToggleEnabled={onToggleProcessorEnabled ? () => onToggleProcessorEnabled(proc.id) : undefined}
                        modulationMap={processorModMaps.get(proc.id)}
                        onModulationClick={onNavigateToPatch}
                        onModulationDepthChange={onModulationDepthChange}
                        onModulationDepthCommit={onModulationDepthCommit}
                        onRampRequest={onRampRequest ? (controlId, target, dur) => onRampRequest(controlId, target, dur, proc.id) : undefined}
                        onPinControl={onPinControl ? (controlId) => onPinControl(proc.id, controlId) : undefined}
                        pinnedControlIds={pinnedControlIds?.(proc.id)}
                      />
                    );
                  })}
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
                </div>
              </>
            )}

            {/* Add module button */}
            <button
              type="button"
              onClick={() => setBrowserOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-zinc-700/50 text-zinc-500 hover:text-zinc-400 hover:border-zinc-600/50 transition-colors self-start mt-2"
            >
              <span className="text-sm leading-none">+</span>
              <span className="text-[11px] font-mono uppercase tracking-wider">Add Module</span>
            </button>
          </div>
        ) : (
          /* Standard layout: source → processors → modulators in flex-wrap */
          <div className="flex flex-wrap gap-4 p-6 items-start" style={{ alignContent: 'flex-start' }}>
            {/* Source module panel */}
            <ModulePanel
              label={sourceLabel}
              accentColor="amber"
              controls={getSourceControls(activeTrack)}
              onParamChange={(controlId, value) => routeSourceModuleParam(controlId, value, activeTrack, {
                onParamChange,
                onNoteChange,
                onHarmonicsChange,
                onExtendedSourceParamChange,
                onPortamentoChange,
              })}
              onInteractionStart={onInteractionStart}
              onInteractionEnd={onInteractionEnd}
              engines={sourceEngines}
              currentModel={activeTrack.model}
              onModelChange={onModelChange}
              modulationMap={sourceModMap}
              onModulationClick={onNavigateToPatch}
              onModulationDepthChange={onModulationDepthChange}
              onModulationDepthCommit={onModulationDepthCommit}
              onRampRequest={onRampRequest}
              onPinControl={onPinControl ? (controlId) => onPinControl('source', controlId) : undefined}
              pinnedControlIds={pinnedControlIds?.('source')}
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
                  onReplace={onReplaceProcessor ? () => { setReplacingProcessorId(proc.id); setBrowserOpen(true); } : undefined}
                  enabled={proc.enabled}
                  onToggleEnabled={onToggleProcessorEnabled ? () => onToggleProcessorEnabled(proc.id) : undefined}
                  modulationMap={processorModMaps.get(proc.id)}
                  onModulationClick={onNavigateToPatch}
                  onModulationDepthChange={onModulationDepthChange}
                  onModulationDepthCommit={onModulationDepthCommit}
                  onRampRequest={onRampRequest ? (controlId, target, dur) => onRampRequest(controlId, target, dur, proc.id) : undefined}
                  onPinControl={onPinControl ? (controlId) => onPinControl(proc.id, controlId) : undefined}
                  pinnedControlIds={pinnedControlIds?.(proc.id)}
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
        )}
      </div>

      {/* Module browser slide-out */}
      {browserOpen && (
        <ModuleBrowser
          activeTrack={activeTrack}
          onAddProcessor={onAddProcessor}
          onAddModulator={onAddModulator}
          onClose={() => { setBrowserOpen(false); setReplacingProcessorId(null); }}
          replaceProcessorId={replacingProcessorId ?? undefined}
          replaceProcessorType={replacingProcessorId ? (processors.find(p => p.id === replacingProcessorId)?.type) : undefined}
          onReplaceProcessor={onReplaceProcessor && replacingProcessorId ? (newType: string) => {
            onReplaceProcessor(replacingProcessorId, newType);
            setBrowserOpen(false);
            setReplacingProcessorId(null);
          } : undefined}
        />
      )}
    </div>
  );
}
