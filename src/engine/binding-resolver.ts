// src/engine/binding-resolver.ts
// Binding contract core: resolve and write typed binding targets against track state.

import type {
  Track,
  BindingTarget,
  BindingRole,
  ScalarTarget,
  WeightedMapping,
  ResolvedBinding,
  ResolvedScalar,
  ResolvedWeighted,
  BindingWriteResult,
  ParamMutation,
  SourceTarget,
  ProcessorTarget,
  ModulatorTarget,
  MixTarget,
  DrumPadTarget,
  SemanticControlDef,
} from './types';
import { controlIdToRuntimeParam } from '../audio/instrument-registry-plaits';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a scalar target to its current value and native range. */
function resolveScalar(track: Track, target: ScalarTarget): ResolvedScalar | { status: 'stale'; reason: string } | { status: 'unsupported'; reason: string } {
  switch (target.kind) {
    case 'source': {
      const runtimeKey = controlIdToRuntimeParam[target.param] ?? target.param;
      if (!(runtimeKey in track.params)) {
        return { status: 'stale', reason: `Source param '${target.param}' not found on track` };
      }
      return { status: 'ok', kind: 'scalar', value: track.params[runtimeKey], range: { min: 0, max: 1 } };
    }
    case 'processor': {
      const proc = (track.processors ?? []).find(p => p.id === target.processorId);
      if (!proc) return { status: 'stale', reason: `Processor '${target.processorId}' not found on track` };
      if (!(target.param in proc.params)) {
        return { status: 'stale', reason: `Param '${target.param}' not found on processor '${target.processorId}'` };
      }
      return { status: 'ok', kind: 'scalar', value: proc.params[target.param], range: { min: 0, max: 1 } };
    }
    case 'modulator': {
      const mod = (track.modulators ?? []).find(m => m.id === target.modulatorId);
      if (!mod) return { status: 'stale', reason: `Modulator '${target.modulatorId}' not found on track` };
      if (!(target.param in mod.params)) {
        return { status: 'stale', reason: `Param '${target.param}' not found on modulator '${target.modulatorId}'` };
      }
      return { status: 'ok', kind: 'scalar', value: mod.params[target.param], range: { min: 0, max: 1 } };
    }
    case 'mix': {
      if (target.param === 'volume') {
        return { status: 'ok', kind: 'scalar', value: track.volume, range: { min: 0, max: 1 } };
      }
      // pan: -1 to 1
      return { status: 'ok', kind: 'scalar', value: track.pan, range: { min: -1, max: 1 } };
    }
    case 'drumPad': {
      if (!track.drumRack) return { status: 'stale', reason: 'Track has no drum rack' };
      const pad = track.drumRack.pads.find(p => p.id === target.padId);
      if (!pad) return { status: 'stale', reason: `Drum pad '${target.padId}' not found` };
      if (target.param === 'level') {
        return { status: 'ok', kind: 'scalar', value: pad.level, range: { min: 0, max: 1 } };
      }
      if (target.param === 'pan') {
        return { status: 'ok', kind: 'scalar', value: pad.pan, range: { min: -1, max: 1 } };
      }
      // source param
      if (!(target.param in pad.source.params)) {
        return { status: 'stale', reason: `Param '${target.param}' not found on drum pad '${target.padId}'` };
      }
      return { status: 'ok', kind: 'scalar', value: pad.source.params[target.param], range: { min: 0, max: 1 } };
    }
    case 'generator':
      return { status: 'unsupported', reason: `Generator targets are not yet implemented` };
    case 'paramShape':
      return { status: 'unsupported', reason: `ParamShape targets are not yet implemented` };
  }
}

/** Normalize a value from its native range to 0-1. */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

/** Denormalize a 0-1 value to its native range. */
function denormalize(normalized: number, min: number, max: number): number {
  return min + normalized * (max - min);
}

/** Clamp a value between min and max. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Apply transform to convert knob value (0-1) to raw param value (0-1).
 *  Matches the formula in semantic-utils.ts applyTransform. */
function applyTransform(transform: 'linear' | 'inverse' | 'bipolar' | undefined, v: number, weight: number): number {
  const t = transform ?? 'linear';
  const offset = (v - 0.5) * weight * 2;
  let raw: number;
  switch (t) {
    case 'linear':
      raw = 0.5 + offset;
      break;
    case 'inverse':
      raw = 0.5 - offset;
      break;
    case 'bipolar':
      // Same formula as linear — bipolar is a semantic annotation (parameter spans
      // a bidirectional range like pan) not a different math transform. The difference
      // matters for display (centered indicator) not computation. Matches semantic-utils.ts.
      raw = 0.5 + offset;
      break;
  }
  return clamp(raw, 0, 1);
}

/** Compute weighted average: resolve each scalar, normalize to 0-1,
 *  apply transform (for reading), compute weighted sum. */
function resolveWeighted(track: Track, mappings: WeightedMapping[]): ResolvedWeighted | { status: 'stale'; reason: string } | { status: 'unsupported'; reason: string } {
  const componentValues: ResolvedWeighted['componentValues'] = [];
  let totalWeight = 0;
  let sum = 0;

  for (const mapping of mappings) {
    const resolved = resolveScalar(track, mapping.target);
    if (resolved.status !== 'ok') {
      // Propagate the actual status — stale vs unsupported have different UX treatments
      return { status: resolved.status, reason: (resolved as { reason: string }).reason };
    }
    const r = resolved as ResolvedScalar;
    const normalized = normalize(r.value, r.range.min, r.range.max);

    // Apply transform for reading (inverse flips the value)
    let effective = normalized;
    const t = mapping.transform ?? 'linear';
    if (t === 'inverse') effective = 1 - normalized;

    sum += effective * mapping.weight;
    totalWeight += mapping.weight;

    componentValues.push({ target: mapping.target, value: r.value, range: r.range });
  }

  const value = totalWeight > 0 ? clamp(sum / totalWeight, 0, 1) : 0.5;
  return { status: 'ok', kind: 'weighted', value, componentValues };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a binding target against a track's current state.
 * Returns the current value(s) or a stale/unsupported status.
 */
export function resolveBinding(track: Track, target: BindingTarget): ResolvedBinding {
  switch (target.kind) {
    case 'source':
    case 'processor':
    case 'modulator':
    case 'mix':
    case 'drumPad':
    case 'generator':
    case 'paramShape':
      return resolveScalar(track, target);

    case 'weighted':
      return resolveWeighted(track, target.mappings);

    case 'region': {
      const pattern = track.patterns.find(p => p.id === target.patternId);
      if (!pattern) return { status: 'stale', reason: `Pattern '${target.patternId}' not found on track` };
      return { status: 'ok', kind: 'region', patternId: target.patternId, events: pattern.events };
    }

    case 'chain':
      return { status: 'ok', kind: 'chain', processors: track.processors ?? [] };

    case 'kit': {
      if (!track.drumRack) return { status: 'stale', reason: 'Track has no drum rack' };
      return { status: 'ok', kind: 'kit', pads: track.drumRack.pads };
    }
  }
}

/** Build a ParamMutation for a scalar target. */
function scalarMutation(target: ScalarTarget, value: number): ParamMutation {
  switch (target.kind) {
    case 'source':
      return { kind: 'sourceParam', param: target.param, value };
    case 'processor':
      return { kind: 'processorParam', processorId: (target as ProcessorTarget).processorId, param: target.param, value };
    case 'modulator':
      return { kind: 'modulatorParam', modulatorId: (target as ModulatorTarget).modulatorId, param: target.param, value };
    case 'mix':
      return { kind: 'mixParam', param: (target as MixTarget).param, value };
    case 'drumPad':
      return { kind: 'drumPadParam', padId: (target as DrumPadTarget).padId, param: target.param, value };
    case 'generator':
    case 'paramShape':
      // Should never reach here — caller should guard
      throw new Error(`Cannot create mutation for unsupported target kind: ${target.kind}`);
  }
}

/**
 * Write a normalized 0-1 value to a binding target.
 * Returns the mutations needed to apply the write, or stale/unsupported.
 */
export function writeBinding(track: Track, target: BindingTarget, value: number): BindingWriteResult {
  switch (target.kind) {
    case 'source':
    case 'processor':
    case 'modulator':
    case 'mix':
    case 'drumPad': {
      // Resolve to check existence
      const resolved = resolveScalar(track, target);
      if (resolved.status === 'stale') return resolved;
      if (resolved.status === 'unsupported') return resolved;
      const r = resolved as ResolvedScalar;
      // Denormalize from 0-1 to native range
      const native = clamp(denormalize(value, r.range.min, r.range.max), r.range.min, r.range.max);
      return { status: 'ok', trackId: track.id, mutations: [scalarMutation(target, native)] };
    }

    case 'generator':
    case 'paramShape':
      return { status: 'unsupported', reason: `${target.kind} targets are not writable` };

    case 'weighted': {
      const mutations: ParamMutation[] = [];
      for (const mapping of target.mappings) {
        // Resolve to check existence and get range
        const resolved = resolveScalar(track, mapping.target);
        if (resolved.status === 'stale') return resolved as { status: 'stale'; reason: string };
        if (resolved.status === 'unsupported') return resolved as { status: 'unsupported'; reason: string };
        const r = resolved as ResolvedScalar;

        // Apply transform: knob value (0-1) → raw param (0-1 intermediate)
        const intermediate = applyTransform(mapping.transform, value, mapping.weight);
        // Denormalize to native range
        const native = clamp(denormalize(intermediate, r.range.min, r.range.max), r.range.min, r.range.max);
        mutations.push(scalarMutation(mapping.target, native));
      }
      return { status: 'ok', trackId: track.id, mutations };
    }

    case 'region':
      return { status: 'unsupported', reason: 'Region targets are not writable via writeBinding' };
    case 'chain':
      return { status: 'unsupported', reason: 'Chain targets are not writable via writeBinding' };
    case 'kit':
      return { status: 'unsupported', reason: 'Kit targets are not writable via writeBinding' };
  }
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/** Known source param names (control IDs that map to track.params). */
const KNOWN_SOURCE_PARAMS = new Set([
  'frequency', 'harmonics', 'timbre', 'morph', 'note',
  'fm-amount', 'timbre-mod-amount', 'morph-mod-amount', 'lpg-colour',
]);

/**
 * Migrate an old string-format binding to the new typed BindingTarget system.
 * Handles:
 *  - Processor targets (contains ':')
 *  - Source targets (known param names)
 *  - Region/chain/kit (based on role)
 *  - Weighted targets (macro-knob with semanticControl config)
 */
export function migrateBinding(
  old: { role: string; trackId: string; target: string },
  moduleType: string,
  config: Record<string, unknown>,
): { role: BindingRole; trackId: string; target: BindingTarget } {
  const role = old.role as BindingRole;

  // Macro-knob with semantic control config → weighted target
  if (moduleType === 'macro-knob' && config.semanticControl) {
    const sc = config.semanticControl as SemanticControlDef;
    const mappings: WeightedMapping[] = (sc.weights ?? []).map(w => {
      // Determine the scalar target from moduleId + controlId
      let scalarTarget: ScalarTarget;
      if (w.moduleId === 'source') {
        scalarTarget = { kind: 'source', param: w.controlId };
      } else {
        // Treat as processor
        scalarTarget = { kind: 'processor', processorId: w.moduleId, param: w.controlId };
      }
      return {
        target: scalarTarget,
        weight: w.weight,
        transform: w.transform,
      };
    });
    return { role, trackId: old.trackId, target: { kind: 'weighted', mappings } };
  }

  // Role-based compound targets
  if (role === 'region') {
    return { role, trackId: old.trackId, target: { kind: 'region', patternId: old.target } };
  }
  if (role === 'chain') {
    return { role, trackId: old.trackId, target: { kind: 'chain' } };
  }
  if (role === 'kit') {
    return { role, trackId: old.trackId, target: { kind: 'kit' } };
  }

  // Colon-separated target: "processorId:param"
  // Note: old surfaces never had modulator bindings (no renderer supported them),
  // so all colon-targets are processor targets. If modulator bindings are added
  // to old surfaces in future, this migration must be updated to distinguish them.
  if (old.target.includes(':')) {
    const [processorId, param] = old.target.split(':', 2);
    return { role, trackId: old.trackId, target: { kind: 'processor', processorId, param } };
  }

  // Dot-separated target: "padId.param" — drum pad parameter binding.
  // The AI uses this format for drum rack per-pad params (e.g. "kick.timbre", "snare.level").
  // Must be checked before source params because "kick.frequency" is not a source param name.
  if (old.target.includes('.')) {
    const [padId, param] = old.target.split('.', 2);
    return { role, trackId: old.trackId, target: { kind: 'drumPad', padId, param } };
  }

  // Source target: known param names
  if (KNOWN_SOURCE_PARAMS.has(old.target)) {
    return { role, trackId: old.trackId, target: { kind: 'source', param: old.target } };
  }

  // Fallback: treat as source param (covers runtime param names like 'timbre', 'morph')
  return { role, trackId: old.trackId, target: { kind: 'source', param: old.target } };
}
