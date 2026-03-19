// src/ui/surface/MacroKnobModule.tsx
// Macro Knob module renderer for the Surface view.
// A single knob with weighted multi-parameter mapping — what semantic controls
// become in the module system.
import { useCallback } from 'react';
import type { SurfaceModule, Track, SemanticControlDef } from '../../engine/types';
import { Knob } from '../Knob';
import { computeSemanticValue, computeSemanticRawUpdates } from '../SemanticControlsSection';

interface MacroKnobModuleProps {
  module: SurfaceModule;
  track: Track;
  onParamChange?: (controlId: string, value: number) => void;
  onProcessorParamChange?: (processorId: string, controlId: string, value: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

export function MacroKnobModule({
  module,
  track,
  onParamChange,
  onProcessorParamChange,
  onInteractionStart,
  onInteractionEnd,
}: MacroKnobModuleProps) {
  const semanticControl = module.config.semanticControl as SemanticControlDef | undefined;

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
      // Compute raw param updates from the knob value
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
