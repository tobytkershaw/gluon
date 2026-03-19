// src/ui/surface/semantic-utils.ts
// Pure helper functions for semantic control value computation.
// Extracted from SemanticControlsSection.tsx during legacy cleanup (#1067).

import type { Track, SemanticControlDef, SemanticTransform } from '../../engine/types';

/** Resolve a raw param's current value given moduleId + controlId. */
function resolveRawValue(track: Track, moduleId: string, controlId: string): number {
  if (moduleId === 'source') {
    // Source params are stored in track.params via runtime param names.
    // After #392, control IDs match runtime names except frequency→note.
    const runtimeMap: Record<string, string> = {
      frequency: 'note',
    };
    const runtimeKey = runtimeMap[controlId] ?? controlId;
    return track.params[runtimeKey] ?? 0.5;
  }
  // Processor param
  const proc = (track.processors ?? []).find(p => p.id === moduleId);
  if (proc) return proc.params[controlId] ?? 0.5;
  return 0.5;
}

/** Compute the display value of a semantic control as weighted average of raw params. */
export function computeSemanticValue(track: Track, def: SemanticControlDef): number {
  if (def.weights.length === 0) return 0.5;
  let totalWeight = 0;
  let sum = 0;
  for (const w of def.weights) {
    const raw = resolveRawValue(track, w.moduleId, w.controlId);
    let effective = raw;
    if (w.transform === 'inverse') effective = 1 - raw;
    // For bipolar, map relative to center (0.5)
    if (w.transform === 'bipolar') effective = raw; // already 0-1, just average directly
    sum += effective * w.weight;
    totalWeight += w.weight;
  }
  return totalWeight > 0 ? Math.max(0, Math.min(1, sum / totalWeight)) : 0.5;
}

/** RFC formula: given knob value v (0-1), weight, and transform, compute raw param value.
 *  - linear:  clamp( 0.5 + (v - 0.5) * weight * 2 )
 *  - inverse: clamp( 0.5 - (v - 0.5) * weight * 2 )
 *  - bipolar: clamp( 0.5 + (v - 0.5) * weight * 2 )   (same formula, different semantic intent)
 */
function applyTransform(transform: SemanticTransform, v: number, weight: number): number {
  const offset = (v - 0.5) * weight * 2;
  let raw: number;
  switch (transform) {
    case 'linear':
      raw = 0.5 + offset;
      break;
    case 'inverse':
      raw = 0.5 - offset;
      break;
    case 'bipolar':
      raw = 0.5 + offset;
      break;
  }
  return Math.max(0, Math.min(1, raw));
}

/** Apply a semantic knob value to compute new raw param values.
 * Returns a list of { moduleId, controlId, value } updates. */
export function computeSemanticRawUpdates(
  track: Track,
  def: SemanticControlDef,
  knobValue: number,
): { moduleId: string; controlId: string; value: number }[] {
  const updates: { moduleId: string; controlId: string; value: number }[] = [];
  for (const w of def.weights) {
    const newValue = applyTransform(w.transform, knobValue, w.weight);
    updates.push({ moduleId: w.moduleId, controlId: w.controlId, value: newValue });
  }
  return updates;
}
