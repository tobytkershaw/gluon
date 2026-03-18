// src/audio/instrument-registry.ts
// Re-export hub — imports per-module instrument definitions and builds shared registries.
// All existing consumers import from this file; no import paths need to change.

import type {
  ControlSchema,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Per-module re-exports ---

export {
  controlIdToRuntimeParam,
  runtimeParamToControlId,
  isPercussion,
  isPercussionByIndex,
  plaitsInstrument,
  getEngineById,
  getEngineByIndex,
  getModelName,
  getEngineControlSchemas,
  getControlBinding,
  getModelList,
} from './instrument-registry-plaits';

export {
  ringsInstrument,
  getRingsEngineById,
  getRingsEngineByIndex,
  getRingsModelList,
} from './instrument-registry-rings';

export {
  cloudsInstrument,
  getCloudsEngineById,
  getCloudsEngineByIndex,
  getCloudsModelList,
} from './instrument-registry-clouds';

export {
  tidesInstrument,
  getTidesEngineById,
  getTidesEngineByIndex,
  getTidesModelList,
} from './instrument-registry-tides';

export {
  ripplesInstrument,
  getRipplesEngineById,
  getRipplesEngineByIndex,
  getRipplesModelList,
} from './instrument-registry-ripples';

export {
  eqInstrument,
  getEqEngineById,
  getEqEngineByIndex,
  getEqModelList,
} from './instrument-registry-eq';

export {
  compressorInstrument,
  getCompressorEngineById,
  getCompressorEngineByIndex,
  getCompressorModelList,
} from './instrument-registry-compressor';

export {
  stereoInstrument,
  getStereoEngineById,
  getStereoEngineByIndex,
  getStereoModelList,
} from './instrument-registry-stereo';

export {
  chorusInstrument,
  getChorusEngineById,
  getChorusEngineByIndex,
  getChorusModelList,
} from './instrument-registry-chorus';

export {
  distortionInstrument,
  getDistortionEngineById,
  getDistortionEngineByIndex,
  getDistortionModelList,
} from './instrument-registry-distortion';

// --- Processor registry ---

import { ringsInstrument } from './instrument-registry-rings';
import { cloudsInstrument } from './instrument-registry-clouds';
import { ripplesInstrument } from './instrument-registry-ripples';
import { eqInstrument } from './instrument-registry-eq';
import { compressorInstrument } from './instrument-registry-compressor';
import { stereoInstrument } from './instrument-registry-stereo';
import { chorusInstrument } from './instrument-registry-chorus';
import { distortionInstrument } from './instrument-registry-distortion';
import { tidesInstrument } from './instrument-registry-tides';

const processorInstruments = new Map<string, InstrumentDef>([
  ['rings', ringsInstrument],
  ['clouds', cloudsInstrument],
  ['ripples', ripplesInstrument],
  ['eq', eqInstrument],
  ['compressor', compressorInstrument],
  ['stereo', stereoInstrument],
  ['chorus', chorusInstrument],
  ['distortion', distortionInstrument],
]);

/** Get the instrument definition for a processor type */
export function getProcessorInstrument(type: string): InstrumentDef | undefined {
  return processorInstruments.get(type);
}

/** Get valid control IDs for a processor type */
export function getProcessorControlIds(type: string): string[] {
  const inst = processorInstruments.get(type);
  if (!inst || inst.engines.length === 0) return [];
  return inst.engines[0].controls.map(c => c.id);
}

/** Look up a ControlSchema for a processor type by control ID */
export function getProcessorControlSchema(type: string, controlId: string): ControlSchema | undefined {
  const inst = processorInstruments.get(type);
  if (!inst || inst.engines.length === 0) return undefined;
  return inst.engines[0].controls.find(c => c.id === controlId);
}

/** Get all registered processor type names */
export function getRegisteredProcessorTypes(): string[] {
  return Array.from(processorInstruments.keys());
}

// --- Modulator registry ---

const modulatorInstruments = new Map<string, InstrumentDef>([
  ['tides', tidesInstrument],
]);

/** Get the instrument definition for a modulator type */
export function getModulatorInstrument(type: string): InstrumentDef | undefined {
  return modulatorInstruments.get(type);
}

/** Get valid control IDs for a modulator type */
export function getModulatorControlIds(type: string): string[] {
  const inst = modulatorInstruments.get(type);
  if (!inst || inst.engines.length === 0) return [];
  return inst.engines[0].controls.map(c => c.id);
}

/** Get all registered modulator type names */
export function getRegisteredModulatorTypes(): string[] {
  return Array.from(modulatorInstruments.keys());
}

/** Look up a modulator engine (model/mode) by name, returning its index */
export function getModulatorEngineByName(type: string, name: string): { index: number; engine: EngineDef } | undefined {
  const inst = modulatorInstruments.get(type);
  if (!inst) return undefined;
  const index = inst.engines.findIndex(e => e.id === name);
  if (index < 0) return undefined;
  return { index, engine: inst.engines[index] };
}

/** Get the engine name for a modulator type by index */
export function getModulatorEngineName(type: string, index: number): string | undefined {
  const inst = modulatorInstruments.get(type);
  return inst?.engines[index]?.id;
}

/** Look up a processor engine (model/mode) by name, returning its index */
export function getProcessorEngineByName(type: string, name: string): { index: number; engine: EngineDef } | undefined {
  const inst = processorInstruments.get(type);
  if (!inst) return undefined;
  const index = inst.engines.findIndex(e => e.id === name);
  if (index < 0) return undefined;
  return { index, engine: inst.engines[index] };
}

/** Get the engine name for a processor type by index */
export function getProcessorEngineName(type: string, index: number): string | undefined {
  const inst = processorInstruments.get(type);
  return inst?.engines[index]?.id;
}

/** Get default parameter values for a processor type at a given model index.
 *  Returns an empty object if the type or model is unrecognised. */
export function getProcessorDefaultParams(type: string, modelIndex: number): Record<string, number> {
  const inst = processorInstruments.get(type);
  const engine = inst?.engines[modelIndex];
  if (!engine) return {};
  const defaults: Record<string, number> = {};
  for (const c of engine.controls) {
    defaults[c.id] = c.range?.default ?? 0.5;
  }
  return defaults;
}

/** Get default parameter values for a modulator type at a given model index.
 *  Returns an empty object if the type or model is unrecognised. */
export function getModulatorDefaultParams(type: string, modelIndex: number): Record<string, number> {
  const inst = modulatorInstruments.get(type);
  const engine = inst?.engines[modelIndex];
  if (!engine) return {};
  const defaults: Record<string, number> = {};
  for (const c of engine.controls) {
    defaults[c.id] = c.range?.default ?? 0.5;
  }
  return defaults;
}
