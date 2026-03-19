import { useCallback } from 'react';
import type { Track } from '../../engine/types';
import { Knob } from '../Knob';
import type { ModuleRendererProps } from './ModuleRendererProps';
import { getAccentColor } from './visual-utils';

/** Parse a binding target into moduleId + controlId. */
function parseTarget(target: string): { moduleId: string; controlId: string } {
  const colonIdx = target.indexOf(':');
  if (colonIdx >= 0) {
    return { moduleId: target.slice(0, colonIdx), controlId: target.slice(colonIdx + 1) };
  }
  return { moduleId: 'source', controlId: target };
}

/** Resolve current value for a binding target from track state. */
function resolveValue(track: Track, target: string): number {
  const { moduleId, controlId } = parseTarget(target);
  if (moduleId === 'source') {
    return track.params[controlId] ?? 0.5;
  }
  const proc = (track.processors ?? []).find(p => p.id === moduleId);
  return proc?.params[controlId] ?? 0.5;
}

/**
 * KnobGroupModule — renders N labelled rotary knobs bound to control IDs.
 * Interaction start/end is handled uniformly by the surface gesture handler,
 * which captures all source + processor state for single-gesture undo.
 */
export function KnobGroupModule({
  module,
  track,
  visualContext,
  onParamChange,
  onProcessorParamChange,
  onInteractionStart,
  onInteractionEnd,
}: ModuleRendererProps) {
  const controlBindings = module.bindings.filter(b => b.role === 'control');
  const isPinned = module.config.pinned === true;
  const accentColor = getAccentColor(visualContext);

  const handleChange = useCallback(
    (target: string, value: number) => {
      const { moduleId, controlId } = parseTarget(target);
      if (moduleId === 'source') {
        onParamChange?.(controlId, value);
      } else {
        onProcessorParamChange?.(moduleId, controlId, value);
      }
    },
    [onParamChange, onProcessorParamChange],
  );

  return (
    <div className="h-full flex flex-col p-2">
      <div className="flex items-center gap-1 mb-2">
        <span className="text-xs font-medium truncate" style={{ color: accentColor }}>
          {module.label}
        </span>
        {isPinned && (
          <span className="text-[10px] text-amber-500/60" title="Pinned control">
            {'\u{1F4CC}'}
          </span>
        )}
      </div>
      <div className="flex-1 flex items-center justify-center gap-3 flex-wrap">
        {controlBindings.map(binding => {
          const value = resolveValue(track, binding.target);
          const { controlId } = parseTarget(binding.target);
          return (
            <Knob
              key={binding.target}
              value={value}
              label={controlId}
              accentColor={accentColor}
              onChange={v => handleChange(binding.target, v)}
              onPointerDown={onInteractionStart}
              onPointerUp={onInteractionEnd}
              size={36}
            />
          );
        })}
      </div>
    </div>
  );
}
