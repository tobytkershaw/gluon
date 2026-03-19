import { useCallback } from 'react';
import type { SurfaceModule, Track } from '../../engine/types';
import { Knob } from '../Knob';
import type { ModuleRendererProps } from './ModuleRendererProps';

/** Parse a binding target into moduleId + controlId.
 *  Simple names like 'timbre' → { moduleId: 'source', controlId: 'timbre' }
 *  Compound names like 'proc-rings:brightness' → { moduleId: 'proc-rings', controlId: 'brightness' }
 */
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
 * Simplest Surface module type: a row of knobs with optional pinned indicator.
 */
export function KnobGroupModule({
  module,
  track,
  onParamChange,
  onProcessorParamChange,
  onInteractionStart,
  onInteractionEnd,
  onProcessorInteractionStart,
  onProcessorInteractionEnd,
}: ModuleRendererProps) {
  const controlBindings = module.bindings.filter(b => b.role === 'control');
  const isPinned = module.config.pinned === true;

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

  const handlePointerDown = useCallback(
    (target: string) => {
      const { moduleId } = parseTarget(target);
      if (moduleId === 'source') {
        onInteractionStart?.();
      } else {
        onProcessorInteractionStart?.(moduleId);
      }
    },
    [onInteractionStart, onProcessorInteractionStart],
  );

  const handlePointerUp = useCallback(
    (target: string) => {
      const { moduleId } = parseTarget(target);
      if (moduleId === 'source') {
        onInteractionEnd?.();
      } else {
        onProcessorInteractionEnd?.(moduleId);
      }
    },
    [onInteractionEnd, onProcessorInteractionEnd],
  );

  return (
    <div className="h-full flex flex-col p-2">
      {/* Module header */}
      <div className="flex items-center gap-1 mb-2">
        <span className="text-xs text-zinc-400 font-medium truncate">
          {module.label}
        </span>
        {isPinned && (
          <span className="text-[10px] text-amber-500/60" title="Pinned control">
            {'\u{1F4CC}'}
          </span>
        )}
      </div>

      {/* Knobs row */}
      <div className="flex-1 flex items-center justify-center gap-3 flex-wrap">
        {controlBindings.map(binding => {
          const value = resolveValue(track, binding.target);
          const { controlId } = parseTarget(binding.target);
          return (
            <Knob
              key={binding.target}
              value={value}
              label={controlId}
              accentColor="zinc"
              onChange={v => handleChange(binding.target, v)}
              onPointerDown={() => handlePointerDown(binding.target)}
              onPointerUp={() => handlePointerUp(binding.target)}
              size={36}
            />
          );
        })}
      </div>
    </div>
  );
}
