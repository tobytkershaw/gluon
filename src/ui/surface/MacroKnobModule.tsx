// src/ui/surface/MacroKnobModule.tsx
// Macro Knob module renderer for the Surface view.
// A single knob with weighted multi-parameter mapping — what semantic controls
// become in the module system.
import { useCallback } from 'react';
import type { SemanticControlDef } from '../../engine/types';
import { Knob } from '../Knob';
import { computeSemanticValue, computeSemanticRawUpdates } from '../SemanticControlsSection';
import type { ModuleRendererProps } from './ModuleRendererProps';

/**
 * MacroKnobModule — single knob that fans out to weighted raw params.
 * Interaction start/end is handled uniformly by the surface gesture handler,
 * which captures all source + processor state for single-gesture undo.
 */
export function MacroKnobModule({
  module,
  track,
  onParamChange,
  onProcessorParamChange,
  onInteractionStart,
  onInteractionEnd,
}: ModuleRendererProps) {
  const semanticControl = module.config.semanticControl as SemanticControlDef | undefined;

  if (!semanticControl) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-zinc-500">
        No config
      </div>
    );
  }

  const displayValue = computeSemanticValue(track, semanticControl);

  const handleChange = useCallback(
    (knobValue: number) => {
      const updates = computeSemanticRawUpdates(track, semanticControl, knobValue);
      for (const update of updates) {
        if (update.moduleId === 'source') {
          onParamChange?.(update.controlId, update.value);
        } else {
          onProcessorParamChange?.(update.moduleId, update.controlId, update.value);
        }
      }
    },
    [track, semanticControl, onParamChange, onProcessorParamChange],
  );

  return (
    <div className="h-full flex flex-col items-center justify-center p-2">
      <Knob
        value={displayValue}
        label={semanticControl.name}
        accentColor="amber"
        onChange={handleChange}
        onPointerDown={onInteractionStart}
        onPointerUp={onInteractionEnd}
        size={48}
      />
      {semanticControl.description && (
        <span className="text-[10px] text-zinc-600 mt-0.5 text-center max-w-[120px] truncate">
          {semanticControl.description}
        </span>
      )}
    </div>
  );
}
