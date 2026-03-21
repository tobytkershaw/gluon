// src/ui/surface/MacroKnobModule.tsx
// Macro Knob module renderer for the Surface view.
// A single knob with weighted multi-parameter mapping — what semantic controls
// become in the module system.
import { useCallback, useMemo } from 'react';
import type { SemanticControlDef, BindingTarget, ResolvedBinding } from '../../engine/types';
import { resolveBinding, writeBinding } from '../../engine/binding-resolver';
import { Knob } from '../Knob';
import type { ModuleRendererProps } from './ModuleRendererProps';
import { getAccentColor } from './visual-utils';
import { ensureTypedTarget } from './binding-helpers';
import { dispatchMutations } from './binding-dispatch';

/**
 * MacroKnobModule — single knob that fans out to weighted raw params.
 * Interaction start/end is handled uniformly by the surface gesture handler,
 * which captures all source + processor state for single-gesture undo.
 */
export function MacroKnobModule({
  module,
  track,
  visualContext,
  roleColor,
  onParamChange,
  onProcessorParamChange,
  onInteractionStart,
  onInteractionEnd,
}: ModuleRendererProps) {
  const semanticControl = module.config.semanticControl as SemanticControlDef | undefined;
  // Use palette role color when available, fall back to legacy accent
  const arcColor = roleColor?.full ?? getAccentColor(visualContext);

  // Resolve the control binding through the binding contract.
  // ensureTypedTarget handles both old string bindings and already-typed BindingTargets.
  // For macro-knob with semanticControl config, migrateBinding produces a WeightedTarget.
  const controlBinding = module.bindings.find(b => b.role === 'control');

  const { target, resolved } = useMemo((): { target: BindingTarget | null; resolved: ResolvedBinding | null } => {
    if (!controlBinding) return { target: null, resolved: null };
    const t = ensureTypedTarget(controlBinding, module.type, module.config);
    return { target: t, resolved: resolveBinding(track, t) };
  }, [controlBinding, module.type, module.config, track]);

  const handleChange = useCallback(
    (knobValue: number) => {
      if (!target) return;
      const result = writeBinding(track, target, knobValue);
      if (result.status === 'ok') {
        dispatchMutations(result.mutations, { onParamChange, onProcessorParamChange });
      }
    },
    [track, target, onParamChange, onProcessorParamChange],
  );

  // No config and no binding — show fallback
  if (!semanticControl && !controlBinding) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-zinc-500">
        No config
      </div>
    );
  }

  const isDisconnected = resolved !== null && resolved.status !== 'ok';
  const displayValue = resolved?.status === 'ok' && 'value' in resolved
    ? resolved.value
    : 0.5;
  const displayName = semanticControl?.name ?? module.label;
  const displayDescription = semanticControl?.description;

  return (
    <div
      className={`h-full flex flex-col items-center justify-center p-2${isDisconnected ? ' opacity-40 pointer-events-none' : ''}`}
      title={isDisconnected && resolved && 'reason' in resolved
        ? `Disconnected: ${resolved.reason}`
        : undefined}
    >
      <Knob
        value={displayValue}
        label={displayName}
        accentColor={arcColor}
        onChange={handleChange}
        onPointerDown={onInteractionStart}
        onPointerUp={onInteractionEnd}
        size={48}
      />
      {displayDescription && (
        <span className="text-[10px] text-zinc-600 mt-0.5 text-center max-w-[120px] truncate">
          {displayDescription}
        </span>
      )}
    </div>
  );
}
