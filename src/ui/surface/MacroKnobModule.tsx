// src/ui/surface/MacroKnobModule.tsx
// Macro Knob module renderer for the Surface view.
// A single knob with weighted multi-parameter mapping — what semantic controls
// become in the module system.
import { useCallback, useMemo } from 'react';
import type { SemanticControlDef } from '../../engine/types';
import { Knob } from '../Knob';
import { computeSemanticValue, computeSemanticRawUpdates } from '../SemanticControlsSection';
import type { ModuleRendererProps } from './ModuleRendererProps';

export function MacroKnobModule({
  module,
  track,
  onParamChange,
  onProcessorParamChange,
  onInteractionStart,
  onInteractionEnd,
  onProcessorInteractionStart,
  onProcessorInteractionEnd,
}: ModuleRendererProps) {
  const semanticControl = module.config.semanticControl as SemanticControlDef | undefined;

  // Unique processor IDs referenced by this macro knob's weights
  const processorIds = useMemo(() => {
    if (!semanticControl) return [];
    return [...new Set(
      semanticControl.weights
        .filter(w => w.moduleId !== 'source')
        .map(w => w.moduleId),
    )];
  }, [semanticControl]);

  if (!semanticControl) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-zinc-500">
        No config
      </div>
    );
  }

  // Compute current display value from weighted raw params
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

  const handlePointerDown = useCallback(() => {
    // Start interaction for source params
    if (semanticControl?.weights.some(w => w.moduleId === 'source')) {
      onInteractionStart?.();
    }
    // Start interaction for each affected processor
    for (const procId of processorIds) {
      onProcessorInteractionStart?.(procId);
    }
  }, [semanticControl, processorIds, onInteractionStart, onProcessorInteractionStart]);

  const handlePointerUp = useCallback(() => {
    if (semanticControl?.weights.some(w => w.moduleId === 'source')) {
      onInteractionEnd?.();
    }
    for (const procId of processorIds) {
      onProcessorInteractionEnd?.(procId);
    }
  }, [semanticControl, processorIds, onInteractionEnd, onProcessorInteractionEnd]);

  return (
    <div className="h-full flex flex-col items-center justify-center p-2">
      <Knob
        value={displayValue}
        label={semanticControl.name}
        accentColor="amber"
        onChange={handleChange}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
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
