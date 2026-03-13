// src/engine/chain-validation.ts
// Shared chain validation layer for Phase 4A.
// Enforces structural chain correctness only — agency, arbitration,
// tool arg validation, and value clamping stay in their respective layers.

import type { Voice } from './types';
import { getRegisteredProcessorTypes, getProcessorControlIds, getProcessorEngineByName } from '../audio/instrument-registry';

const MAX_PROCESSORS = 2;

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
export function validateChain(voice: Voice): ChainValidationResult {
  const processors = voice.processors ?? [];
  const errors: string[] = [];
  const registeredTypes = getRegisteredProcessorTypes();

  if (processors.length > MAX_PROCESSORS) {
    errors.push(`Voice ${voice.id} has ${processors.length} processors (max ${MAX_PROCESSORS})`);
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
  voice: Voice,
  mutation: { kind: 'add'; type: string } | { kind: 'remove'; processorId: string },
): ChainValidationResult {
  const processors = voice.processors ?? [];

  if (mutation.kind === 'add') {
    const registeredTypes = getRegisteredProcessorTypes();
    if (!registeredTypes.includes(mutation.type)) {
      return fail(`Unknown processor type: ${mutation.type}. Available: ${registeredTypes.join(', ')}`);
    }
    if (processors.length >= MAX_PROCESSORS) {
      return fail(`Cannot add processor: voice ${voice.id} already has ${processors.length} processors (max ${MAX_PROCESSORS})`);
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
  voice: Voice,
  processorId: string,
  options?: { param?: string; model?: string },
): ChainValidationResult {
  const processors = voice.processors ?? [];
  const proc = processors.find(p => p.id === processorId);
  if (!proc) {
    return fail(`Processor not found: ${processorId} on voice ${voice.id}`);
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
