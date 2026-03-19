/* eslint-disable react-refresh/only-export-components -- pure helper fn co-located with component */
// src/ui/SemanticControlsSection.tsx
// Container rendering semantic knobs for a track's surface semantic controls.
import { useState, useCallback } from 'react';
import type { Track, SemanticControlDef, SemanticTransform } from '../engine/types';
import { getModelName, getProcessorInstrument } from '../audio/instrument-registry';
import { SemanticKnob } from './SemanticKnob';
import { SemanticInspector } from './SemanticInspector';

interface SemanticControlsSectionProps {
  track: Track;
  /** Called with each raw param update during drag. */
  onSemanticChange: (controlDef: SemanticControlDef, knobValue: number) => void;
  onInteractionStart: (controlDef: SemanticControlDef) => void;
  onInteractionEnd: (controlDef: SemanticControlDef) => void;
}

/** Resolve a raw param's current value given moduleId + controlId. */
export function resolveRawValue(track: Track, moduleId: string, controlId: string): number {
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

/** Resolve moduleId to a human-readable label for the inspector. */
function resolveModuleLabel(track: Track, moduleId: string): string {
  if (moduleId === 'source') {
    return track.model < 0 ? 'No Source' : `Plaits (${getModelName(track.model)})`;
  }
  const proc = (track.processors ?? []).find(p => p.id === moduleId);
  if (proc) {
    const inst = getProcessorInstrument(proc.type);
    return inst?.label ?? proc.type;
  }
  return moduleId;
}

export function SemanticControlsSection({
  track, onSemanticChange, onInteractionStart, onInteractionEnd,
}: SemanticControlsSectionProps) {
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  // Extract semantic controls from macro-knob modules
  const semanticControls = track.surface.modules
    .filter(m => m.type === 'macro-knob')
    .map(m => m.config.semanticControl as SemanticControlDef)
    .filter(Boolean);

  const handleClick = useCallback((defId: string) => {
    setInspectedId(prev => prev === defId ? null : defId);
  }, []);

  if (semanticControls.length === 0) return null;

  return (
    <div className="bg-zinc-900/50 border border-emerald-400/20 rounded-lg p-3 space-y-3">
      {/* Header */}
      <span className="text-[11px] font-medium text-emerald-300">Semantic Controls</span>

      {/* Knob row */}
      <div className="flex flex-wrap gap-3">
        {semanticControls.map((def) => (
          <div key={def.id} className="relative">
            <SemanticKnob
              name={def.name}
              value={computeSemanticValue(track, def)}
              onChange={(v) => onSemanticChange(def, v)}
              onPointerDown={() => onInteractionStart(def)}
              onPointerUp={() => onInteractionEnd(def)}
              onClick={() => handleClick(def.id)}
            />
            {inspectedId === def.id && (
              <SemanticInspector
                control={def}
                resolveModuleLabel={(moduleId) => resolveModuleLabel(track, moduleId)}
                onClose={() => setInspectedId(null)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Helpers exported for App.tsx to compute raw param updates ---

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

/** RFC formula: given knob value v (0-1), weight, and transform, compute raw param value.
 *  - linear:  baseValue + (v - 0.5) * weight * 2  — but since we don't have a separate baseValue,
 *    we use: clamp(0.5 + (v - 0.5) * weight * 2) which yields the range [0.5 - weight, 0.5 + weight].
 *    Actually for simplicity: the knob IS the macro control. Each raw param = transform(v, weight).
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
