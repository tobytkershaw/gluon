// src/engine/chain-validation.ts
// Shared chain validation layer for Phase 4A.
// Enforces structural chain correctness only — agency, arbitration,
// tool arg validation, and value clamping stay in their respective layers.

import type { Track, ModulationTarget } from './types';
import {
  getRegisteredProcessorTypes, getProcessorControlIds, getProcessorEngineByName,
  getRegisteredModulatorTypes, getModulatorControlIds, getModulatorEngineByName,
} from '../audio/instrument-registry';

const MAX_PROCESSORS = 2;
const MAX_MODULATORS = 2;

/** Source params that can be modulation targets (pitch excluded — needs different depth semantics) */
const VALID_SOURCE_MOD_TARGETS = new Set(['brightness', 'richness', 'texture']);

export interface ChainValidationResult {
  valid: boolean;
  errors: string[];
}

function ok(): ChainValidationResult {
  return { valid: true, errors: [] };
}

function fail(...errors: string[]): ChainValidationResult {
  return { valid: false, errors };
}

/** Validate current chain state is structurally sound */
export function validateChain(track: Track): ChainValidationResult {
  const processors = track.processors ?? [];
  const errors: string[] = [];
  const registeredTypes = getRegisteredProcessorTypes();

  if (processors.length > MAX_PROCESSORS) {
    errors.push(`Track ${track.id} has ${processors.length} processors (max ${MAX_PROCESSORS})`);
  }

  const ids = new Set<string>();
  for (const p of processors) {
    if (!registeredTypes.includes(p.type)) {
      errors.push(`Unknown processor type: ${p.type}`);
    }
    if (ids.has(p.id)) {
      errors.push(`Duplicate processor ID: ${p.id}`);
    }
    ids.add(p.id);
  }

  return errors.length > 0 ? { valid: false, errors } : ok();
}

/** Validate a proposed chain topology change (add/remove processor) */
export function validateChainMutation(
  track: Track,
  mutation: { kind: 'add'; type: string } | { kind: 'remove'; processorId: string },
): ChainValidationResult {
  const processors = track.processors ?? [];

  if (mutation.kind === 'add') {
    const registeredTypes = getRegisteredProcessorTypes();
    if (!registeredTypes.includes(mutation.type)) {
      return fail(`Unknown processor type: ${mutation.type}. Available: ${registeredTypes.join(', ')}`);
    }
    if (processors.length >= MAX_PROCESSORS) {
      return fail(`Cannot add processor: track ${track.id} already has ${processors.length} processors (max ${MAX_PROCESSORS})`);
    }
    return ok();
  }

  // kind === 'remove'
  if (!processors.some(p => p.id === mutation.processorId)) {
    return fail(`Processor not found: ${mutation.processorId}`);
  }
  return ok();
}

/** Validate that a processor target (for move/set_model) is structurally valid */
export function validateProcessorTarget(
  track: Track,
  processorId: string,
  options?: { param?: string; model?: string },
): ChainValidationResult {
  const processors = track.processors ?? [];
  const proc = processors.find(p => p.id === processorId);
  if (!proc) {
    return fail(`Processor not found: ${processorId} on track ${track.id}`);
  }

  const errors: string[] = [];

  if (options?.param !== undefined) {
    const validControls = getProcessorControlIds(proc.type);
    if (!validControls.includes(options.param)) {
      errors.push(`Unknown ${proc.type} control: ${options.param}. Valid controls: ${validControls.join(', ')}`);
    }
  }

  if (options?.model !== undefined) {
    const result = getProcessorEngineByName(proc.type, options.model);
    if (!result) {
      errors.push(`Unknown ${proc.type} model: ${options.model}`);
    }
  }

  return errors.length > 0 ? { valid: false, errors } : ok();
}

// --- Modulator validation ---

/** Validate a proposed modulator topology change (add/remove modulator) */
export function validateModulatorMutation(
  track: Track,
  mutation: { kind: 'add'; type: string } | { kind: 'remove'; modulatorId: string },
): ChainValidationResult {
  const modulators = track.modulators ?? [];

  if (mutation.kind === 'add') {
    const registeredTypes = getRegisteredModulatorTypes();
    if (!registeredTypes.includes(mutation.type)) {
      return fail(`Unknown modulator type: ${mutation.type}. Available: ${registeredTypes.join(', ')}`);
    }
    if (modulators.length >= MAX_MODULATORS) {
      return fail(`Cannot add modulator: track ${track.id} already has ${modulators.length} modulators (max ${MAX_MODULATORS})`);
    }
    return ok();
  }

  // kind === 'remove'
  if (!modulators.some(m => m.id === mutation.modulatorId)) {
    return fail(`Modulator not found: ${mutation.modulatorId}`);
  }
  return ok();
}

/**
 * Validate a modulation routing.
 * Route identity: (modulatorId, target.kind, target.param, target.processorId for processor targets).
 */
export function validateModulationTarget(
  track: Track,
  routing: { modulatorId: string; target: ModulationTarget; depth: number },
): ChainValidationResult {
  const modulators = track.modulators ?? [];
  const errors: string[] = [];

  // Modulator must exist on track
  if (!modulators.some(m => m.id === routing.modulatorId)) {
    errors.push(`Modulator not found: ${routing.modulatorId} on track ${track.id}`);
  }

  // Validate depth range
  if (routing.depth < -1 || routing.depth > 1) {
    errors.push(`Depth must be between -1.0 and 1.0, got ${routing.depth}`);
  }

  // Validate target
  const target = routing.target;
  if (target.kind === 'source') {
    if (!VALID_SOURCE_MOD_TARGETS.has(target.param)) {
      errors.push(`Cannot modulate source param "${target.param}". Valid targets: ${Array.from(VALID_SOURCE_MOD_TARGETS).join(', ')}. Pitch modulation is excluded in Phase 4B.`);
    }
  } else if (target.kind === 'processor') {
    const processors = track.processors ?? [];
    const proc = processors.find(p => p.id === target.processorId);
    if (!proc) {
      errors.push(`Processor not found: ${target.processorId} on track ${track.id}`);
    } else {
      const validControls = getProcessorControlIds(proc.type);
      if (!validControls.includes(target.param)) {
        errors.push(`Unknown ${proc.type} control: ${target.param}. Valid controls: ${validControls.join(', ')}`);
      }
    }
  } else {
    errors.push(`Unknown target kind: ${(target as { kind: string }).kind}`);
  }

  return errors.length > 0 ? { valid: false, errors } : ok();
}

/** Validate that a modulator target (for move/set_model with modulatorId) is structurally valid */
export function validateModulatorTarget(
  track: Track,
  modulatorId: string,
  options?: { param?: string; model?: string },
): ChainValidationResult {
  const modulators = track.modulators ?? [];
  const mod = modulators.find(m => m.id === modulatorId);
  if (!mod) {
    return fail(`Modulator not found: ${modulatorId} on track ${track.id}`);
  }

  const errors: string[] = [];

  if (options?.param !== undefined) {
    const validControls = getModulatorControlIds(mod.type);
    if (!validControls.includes(options.param)) {
      errors.push(`Unknown ${mod.type} control: ${options.param}. Valid controls: ${validControls.join(', ')}`);
    }
  }

  if (options?.model !== undefined) {
    const result = getModulatorEngineByName(mod.type, options.model);
    if (!result) {
      errors.push(`Unknown ${mod.type} model: ${options.model}`);
    }
  }

  return errors.length > 0 ? { valid: false, errors } : ok();
}
