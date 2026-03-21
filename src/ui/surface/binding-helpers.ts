// src/ui/surface/binding-helpers.ts
// Helpers for working with the binding contract in surface module renderers.

import type { BindingTarget, ModuleBinding } from '../../engine/types';
import { migrateBinding } from '../../engine/binding-resolver';

/**
 * Ensure a binding's target is a typed BindingTarget.
 * If the target is already a typed object (has a `kind` field), returns it directly.
 * Otherwise, calls migrateBinding() to convert the old string format.
 */
export function ensureTypedTarget(
  binding: ModuleBinding,
  moduleType: string,
  config: Record<string, unknown>,
): BindingTarget {
  if (typeof binding.target !== 'string') {
    return binding.target;
  }
  // Old string format — migrate to typed target
  const migrated = migrateBinding(
    { role: binding.role, trackId: binding.trackId, target: binding.target },
    moduleType,
    config,
  );
  return migrated.target;
}

/**
 * Extract a display label from a BindingTarget.
 * Returns a human-readable short label for the target.
 */
export function targetLabel(target: BindingTarget): string {
  switch (target.kind) {
    case 'source':
      return target.param;
    case 'processor':
      return target.param;
    case 'modulator':
      return target.param;
    case 'mix':
      return target.param;
    case 'drumPad':
      return target.param;
    case 'generator':
      return target.param;
    case 'paramShape':
      return target.param;
    case 'weighted':
      return 'macro';
    case 'region':
      return target.patternId;
    case 'chain':
      return 'chain';
    case 'kit':
      return 'kit';
  }
}
