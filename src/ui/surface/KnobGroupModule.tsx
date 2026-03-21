import { useCallback, useMemo } from 'react';
import type { BindingTarget, ResolvedBinding } from '../../engine/types';
import { resolveBinding, writeBinding } from '../../engine/binding-resolver';
import { Knob } from '../Knob';
import type { ModuleRendererProps } from './ModuleRendererProps';
import { getAccentColor } from './visual-utils';
import { ensureTypedTarget, targetLabel } from './binding-helpers';
import { canDispatch, dispatchMutations } from './binding-dispatch';
// Palette-aware: roleColor.full for knob arcs, roleColor.muted for labels

/** Resolved control binding with typed target and current resolution. */
interface ResolvedControl {
  key: string;
  label: string;
  target: BindingTarget;
  resolved: ResolvedBinding;
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
  roleColor,
  onParamChange,
  onProcessorParamChange,
  onDrumPadParamChange,
  onInteractionStart,
  onInteractionEnd,
}: ModuleRendererProps) {
  const controlBindings = module.bindings.filter(b => b.role === 'control');
  const isPinned = module.config.pinned === true;
  // Use palette role color when available, fall back to legacy accent
  const arcColor = roleColor?.full ?? getAccentColor(visualContext);
  const labelColor = roleColor?.muted ?? arcColor;

  // Resolve all control bindings through the binding contract
  const resolvedControls: ResolvedControl[] = useMemo(() => {
    return controlBindings.map(binding => {
      const target = ensureTypedTarget(binding, module.type, module.config);
      const resolved = resolveBinding(track, target);
      return {
        key: typeof binding.target === 'string' ? binding.target : JSON.stringify(binding.target),
        label: targetLabel(target),
        target,
        resolved,
      };
    });
  }, [controlBindings, module.type, module.config, track]);

  const handleChange = useCallback(
    (target: BindingTarget, value: number) => {
      const result = writeBinding(track, target, value);
      if (result.status === 'ok') {
        dispatchMutations(result.mutations, { onParamChange, onProcessorParamChange, onDrumPadParamChange });
      }
    },
    [track, onParamChange, onProcessorParamChange],
  );

  return (
    <div className="h-full flex flex-col p-2">
      <div className="flex items-center gap-1 mb-2">
        <span className="text-xs font-medium truncate" style={{ color: labelColor }}>
          {module.label}
        </span>
        {isPinned && (
          <span className="text-[10px] text-amber-500/60" title="Pinned control">
            {'\u{1F4CC}'}
          </span>
        )}
      </div>
      <div className="flex-1 flex items-center justify-center gap-3 flex-wrap">
        {resolvedControls.map(ctrl => {
          const isDisconnected = ctrl.resolved.status !== 'ok';
          const isReadOnly = !isDisconnected && !canDispatch(ctrl.target);
          const value = ctrl.resolved.status === 'ok' && 'value' in ctrl.resolved
            ? ctrl.resolved.value
            : 0.5;

          return (
            <div
              key={ctrl.key}
              className={isDisconnected || isReadOnly ? 'opacity-40 pointer-events-none' : ''}
              title={isDisconnected
                ? `Disconnected: ${'reason' in ctrl.resolved ? ctrl.resolved.reason : 'unknown'}`
                : isReadOnly
                  ? `Read-only: ${ctrl.target.kind} writes not yet supported`
                  : undefined}
            >
              <Knob
                value={value}
                label={ctrl.label}
                accentColor={arcColor}
                onChange={v => handleChange(ctrl.target, v)}
                onPointerDown={onInteractionStart}
                onPointerUp={onInteractionEnd}
                size={36}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
