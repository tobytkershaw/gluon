// src/ui/module-controls.ts
// Shared helpers to build control definitions from the instrument registry.
import type { Track } from '../engine/types';
import type { ControlKind, DisplayMapping } from '../engine/canonical-types';
import { getEngineByIndex, getProcessorInstrument, getModulatorInstrument, controlIdToRuntimeParam } from '../audio/instrument-registry';

export interface ControlDef {
  id: string;
  name: string;
  value: number;
  /** 'large' for primary knobs, 'medium' for tone/character, 'small' for attenuverters. Defaults to 'large'. */
  size: 'large' | 'medium' | 'small';
  /** Control kind: continuous, discrete, or boolean. Defaults to 'continuous'. */
  kind: ControlKind;
  /** For discrete controls: the valid range */
  range?: { min: number; max: number; default: number };
  /** Optional display mapping for showing human-readable values with units */
  displayMapping?: DisplayMapping;
}

/** Build source controls from instrument registry */
export function getSourceControls(track: Track): ControlDef[] {
  const engine = getEngineByIndex(track.model);
  if (!engine) return [];
  return engine.controls.map(c => ({
    id: c.id,
    name: c.name,
    value: track.params[controlIdToRuntimeParam[c.id] ?? c.id] ?? c.range?.default ?? 0.5,
    size: c.size ?? 'large',
    kind: c.kind,
    range: c.range,
    displayMapping: c.displayMapping,
  }));
}

/** Build processor controls from instrument registry */
export function getProcessorControls(proc: { type: string; model: number; params: Record<string, number> }): ControlDef[] {
  const inst = getProcessorInstrument(proc.type);
  if (!inst) return [];
  const engine = inst.engines[proc.model] ?? inst.engines[0];
  if (!engine) return [];
  return engine.controls.map(c => ({
    id: c.id,
    name: c.name,
    value: proc.params[c.id] ?? c.range?.default ?? 0.5,
    size: c.size ?? 'large',
    kind: c.kind,
    range: c.range,
    displayMapping: c.displayMapping,
  }));
}

/** Build modulator controls from instrument registry */
export function getModulatorControls(mod: { type: string; model: number; params: Record<string, number> }): ControlDef[] {
  const inst = getModulatorInstrument(mod.type);
  if (!inst) return [];
  const engine = inst.engines[mod.model] ?? inst.engines[0];
  if (!engine) return [];
  return engine.controls.map(c => ({
    id: c.id,
    name: c.name,
    value: mod.params[c.id] ?? c.range?.default ?? 0.5,
    size: c.size ?? 'large',
    kind: c.kind,
    range: c.range,
    displayMapping: c.displayMapping,
  }));
}
