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
 * Mutations for modulatorParam, mixParam, and drumPadParam are not yet supported —
 * App.tsx doesn't have handler callbacks for these target kinds. These mutations
 * are logged as warnings so they're visible during development.
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
      case 'mixParam':
      case 'drumPadParam':
        if (import.meta.env.DEV) {
          console.warn(`[binding-dispatch] unsupported mutation kind "${m.kind}" — no handler callback exists yet`);
        }
        break;
    }
  }
}
