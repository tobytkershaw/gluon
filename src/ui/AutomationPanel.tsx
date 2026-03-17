// src/ui/AutomationPanel.tsx
// Collapsible automation panel that sits below the tracker.
// Provides a parameter selector dropdown and an AutomationLane for drawing breakpoints.

import { useState, useCallback, useMemo } from 'react';
import type { Pattern, MusicalEvent, ParameterEvent, ControlSchema } from '../engine/canonical-types';
import type { Track, ProcessorConfig } from '../engine/types';
import type { EventSelector } from '../engine/event-primitives';
import { getEngineByIndex, getProcessorInstrument } from '../audio/instrument-registry';
import { AutomationLane } from './AutomationLane';

interface Props {
  track: Track;
  region: Pattern;
  currentStep: number;
  playing: boolean;
  onEventAdd: (step: number, event: MusicalEvent) => void;
  onEventUpdate: (selector: EventSelector, updates: Partial<MusicalEvent>) => void;
  onEventDelete: (selector: EventSelector) => void;
}

/** Build a flat list of available controls for a track (source + processors). */
function getAvailableControls(track: Track): { id: string; label: string; group: string }[] {
  const controls: { id: string; label: string; group: string }[] = [];

  // Source engine controls
  const engine = getEngineByIndex(track.model);
  if (engine) {
    for (const ctrl of engine.controls) {
      if (ctrl.kind === 'continuous' && ctrl.writable) {
        controls.push({ id: ctrl.id, label: ctrl.name, group: 'Source' });
      }
    }
  }

  // Processor controls
  if (track.processors) {
    for (const proc of track.processors) {
      const instrument = getProcessorInstrument(proc.type);
      if (!instrument) continue;
      for (const eng of instrument.engines) {
        for (const ctrl of eng.controls) {
          if (ctrl.kind === 'continuous' && ctrl.writable) {
            controls.push({
              id: `${proc.id}:${ctrl.id}`,
              label: ctrl.name,
              group: proc.type.charAt(0).toUpperCase() + proc.type.slice(1),
            });
          }
        }
      }
    }
  }

  return controls;
}

export function AutomationPanel({
  track,
  region,
  currentStep,
  playing,
  onEventAdd,
  onEventUpdate,
  onEventDelete,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);

  const availableControls = useMemo(() => getAvailableControls(track), [track]);

  // Auto-select first control if none selected
  const effectiveControlId = selectedControlId
    ?? (availableControls.length > 0 ? availableControls[0].id : null);

  const selectedLabel = useMemo(() => {
    if (!effectiveControlId) return 'None';
    const ctrl = availableControls.find(c => c.id === effectiveControlId);
    return ctrl ? ctrl.label : effectiveControlId;
  }, [effectiveControlId, availableControls]);

  // Count parameter events for each control (for the dropdown badge)
  const eventCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of region.events) {
      if (e.kind !== 'parameter') continue;
      const pe = e as ParameterEvent;
      const count = counts.get(pe.controlId) ?? 0;
      counts.set(pe.controlId, count + 1);
    }
    return counts;
  }, [region.events]);

  // --- Callbacks for AutomationLane ---

  const handleAddBreakpoint = useCallback((at: number, value: number, interpolation: 'step' | 'linear' | 'curve') => {
    if (!effectiveControlId) return;
    const event: ParameterEvent = {
      kind: 'parameter',
      at,
      controlId: effectiveControlId,
      value,
      interpolation,
    };
    onEventAdd(at, event);
  }, [effectiveControlId, onEventAdd]);

  const handleRemoveBreakpoint = useCallback((at: number) => {
    if (!effectiveControlId) return;
    onEventDelete({ at, kind: 'parameter', controlId: effectiveControlId });
  }, [effectiveControlId, onEventDelete]);

  const handleMoveBreakpoint = useCallback((fromAt: number, toAt: number, toValue: number) => {
    if (!effectiveControlId) return;
    onEventUpdate(
      { at: fromAt, kind: 'parameter', controlId: effectiveControlId },
      { at: toAt, value: toValue } as Partial<MusicalEvent>,
    );
  }, [effectiveControlId, onEventUpdate]);

  const handleUpdateInterpolation = useCallback((at: number, interpolation: 'step' | 'linear' | 'curve', tension?: number) => {
    if (!effectiveControlId) return;
    const updates: Partial<ParameterEvent> = { interpolation };
    if (tension !== undefined) updates.tension = tension;
    onEventUpdate(
      { at, kind: 'parameter', controlId: effectiveControlId },
      updates as Partial<MusicalEvent>,
    );
  }, [effectiveControlId, onEventUpdate]);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full px-3 py-1 text-[10px] font-medium tracking-wider uppercase text-zinc-500 hover:text-zinc-300 border-t border-zinc-800/50 transition-colors text-left flex items-center gap-2"
      >
        <svg className="text-zinc-500" width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M3 1l5 4-5 4V1z" /></svg>
        Automation
        {eventCounts.size > 0 && (
          <span className="text-[9px] text-amber-500/70 ml-1">
            {eventCounts.size} param{eventCounts.size !== 1 ? 's' : ''}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="border-t border-zinc-800/50">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1">
        <button
          onClick={() => setExpanded(false)}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Collapse automation panel"
        >
          <svg className="text-zinc-400" width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M1 3l4 5 4-5H1z" /></svg>
        </button>
        <span className="text-[10px] font-medium tracking-wider uppercase text-zinc-400">
          Automation
        </span>

        {/* Parameter selector */}
        <select
          className="text-[10px] bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-300 outline-none focus:border-amber-500/50 max-w-[140px]"
          value={effectiveControlId ?? ''}
          onChange={(e) => setSelectedControlId(e.target.value || null)}
        >
          {availableControls.length === 0 && (
            <option value="">No parameters</option>
          )}
          {/* Group by group name */}
          {(() => {
            const groups = new Map<string, typeof availableControls>();
            for (const ctrl of availableControls) {
              const group = groups.get(ctrl.group) ?? [];
              group.push(ctrl);
              groups.set(ctrl.group, group);
            }
            return Array.from(groups.entries()).map(([group, ctrls]) => (
              <optgroup key={group} label={group}>
                {ctrls.map(ctrl => {
                  const count = eventCounts.get(ctrl.id);
                  return (
                    <option key={ctrl.id} value={ctrl.id}>
                      {ctrl.label}{count ? ` (${count})` : ''}
                    </option>
                  );
                })}
              </optgroup>
            ));
          })()}
        </select>

        {/* Legend */}
        <div className="ml-auto flex items-center gap-3 text-[9px] text-zinc-600">
          <span>click: add</span>
          <span>alt+click: remove</span>
          <span>dbl-click: cycle mode</span>
          <span>drag: move</span>
        </div>
      </div>

      {/* Lane */}
      {effectiveControlId && (
        <div className="px-1">
          <AutomationLane
            events={region.events}
            controlId={effectiveControlId}
            duration={region.duration}
            label={selectedLabel}
            currentStep={currentStep}
            playing={playing}
            onAddBreakpoint={handleAddBreakpoint}
            onRemoveBreakpoint={handleRemoveBreakpoint}
            onMoveBreakpoint={handleMoveBreakpoint}
            onUpdateInterpolation={handleUpdateInterpolation}
            height={120}
          />
        </div>
      )}
    </div>
  );
}
