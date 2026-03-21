// src/ui/surface/binding-dispatch.ts
// Utility to dispatch ParamMutation[] through the existing renderer callbacks.

import type { ParamMutation } from '../../engine/types';

/** Subset of ModuleRendererProps callbacks needed for mutation dispatch. */
export interface MutationCallbacks {
  onParamChange?: (controlId: string, value: number) => void;
  onProcessorParamChange?: (processorId: string, controlId: string, value: number) => void;
}

/**
 * Dispatch an array of ParamMutations through the appropriate renderer callbacks.
 * Mutations that don't have a matching callback (e.g. modulatorParam, mixParam, drumPadParam)
 * are silently dropped — those callbacks don't exist on the current renderer props.
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
      case 'modulatorParam':
        // No renderer callback for modulator params yet — drop silently
        break;
      case 'mixParam':
        // No renderer callback for mix params yet — drop silently
        break;
      case 'drumPadParam':
        // No renderer callback for drum pad params yet — drop silently
        break;
    }
  }
}
