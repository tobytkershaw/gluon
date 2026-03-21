// src/ui/surface/binding-dispatch.ts
// Utility to dispatch ParamMutation[] through the existing renderer callbacks.

import type { BindingTarget, ParamMutation } from '../../engine/types';

/** Target kinds whose writes can be dispatched through existing App.tsx callbacks. */
const DISPATCHABLE_KINDS = new Set<string>(['source', 'processor', 'drumPad']);

/** Whether a binding target's writes can be dispatched through the current callback set.
 *  Renderers should treat targets where this returns false as read-only. */
export function canDispatch(target: BindingTarget): boolean {
  if (target.kind === 'weighted') {
    return target.mappings.every(m => DISPATCHABLE_KINDS.has(m.target.kind));
  }
  return DISPATCHABLE_KINDS.has(target.kind);
}

/** Subset of ModuleRendererProps callbacks needed for mutation dispatch. */
export interface MutationCallbacks {
  onParamChange?: (controlId: string, value: number) => void;
  onProcessorParamChange?: (processorId: string, controlId: string, value: number) => void;
  onDrumPadParamChange?: (padId: string, param: string, value: number) => void;
}

/**
 * Dispatch an array of ParamMutations through the appropriate renderer callbacks.
 * Only sourceParam and processorParam mutations are supported — App.tsx doesn't
 * have handler callbacks for other target kinds yet.
 */
export function dispatchMutations(
  mutations: ParamMutation[],
  callbacks: MutationCallbacks,
): void {
  for (const m of mutations) {
    switch (m.kind) {
      case 'sourceParam':
        callbacks.onParamChange?.(m.param, m.value);
        break;
      case 'processorParam':
        callbacks.onProcessorParamChange?.(m.processorId, m.param, m.value);
        break;
      case 'drumPadParam':
        callbacks.onDrumPadParamChange?.(m.padId, m.param, m.value);
        break;
      case 'modulatorParam':
      case 'mixParam':
        break;
    }
  }
}
