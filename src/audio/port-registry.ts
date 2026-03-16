// src/audio/port-registry.ts
// Hardware I/O port definitions per MI module type.
// Each module declares named input/output jacks with signal type.
// Used by PatchView to render named ports and validate connections.

/** Signal type flowing through a port */
export type PortSignalType = 'audio' | 'cv' | 'gate';

/** A single input or output jack on a module */
export interface PortDef {
  /** Machine-readable identifier (e.g. 'out', 'aux', 'v-oct') */
  id: string;
  /** Hardware name as printed on the module panel */
  name: string;
  /** Signal type */
  signal: PortSignalType;
}

/** Complete I/O declaration for a module type */
export interface ModulePortDef {
  inputs: PortDef[];
  outputs: PortDef[];
}

// ---------------------------------------------------------------------------
// Port definitions — derived from MI hardware panel labels
// ---------------------------------------------------------------------------

const plaitsPortDef: ModulePortDef = {
  inputs: [
    { id: 'v-oct',        name: 'V/OCT',         signal: 'cv' },
    { id: 'trigger',      name: 'TRIGGER',        signal: 'gate' },
    { id: 'level',        name: 'LEVEL',          signal: 'cv' },
    { id: 'model-cv',     name: 'MODEL CV',       signal: 'cv' },
    { id: 'timbre-cv',    name: 'TIMBRE CV',      signal: 'cv' },
    { id: 'fm-cv',        name: 'FM CV',          signal: 'cv' },
    { id: 'morph-cv',     name: 'MORPH CV',       signal: 'cv' },
    { id: 'harmonics-cv', name: 'HARMONICS CV',   signal: 'cv' },
  ],
  outputs: [
    { id: 'out', name: 'OUT', signal: 'audio' },
    { id: 'aux', name: 'AUX', signal: 'audio' },
  ],
};

const ringsPortDef: ModulePortDef = {
  inputs: [
    { id: 'v-oct',         name: 'V/OCT',          signal: 'cv' },
    { id: 'strum',         name: 'STRUM',           signal: 'gate' },
    { id: 'audio-in',      name: 'IN',              signal: 'audio' },
    { id: 'frequency-cv',  name: 'FREQ CV',         signal: 'cv' },
    { id: 'structure-cv',  name: 'STRUCT CV',       signal: 'cv' },
    { id: 'brightness-cv', name: 'BRIGHT CV',       signal: 'cv' },
    { id: 'damping-cv',    name: 'DAMP CV',         signal: 'cv' },
    { id: 'position-cv',   name: 'POS CV',          signal: 'cv' },
  ],
  outputs: [
    { id: 'odd',  name: 'ODD',  signal: 'audio' },
    { id: 'even', name: 'EVEN', signal: 'audio' },
  ],
};

// Clouds (Mutable Instruments, 2014 hardware revision).
// All CV inputs listed below match the hardware panel jacks.
// Software backing status:
//   - audio-in, position-cv, size-cv, density-cv, texture-cv: bridged in WASM
//   - pitch-cv, blend-cv: hardware-only (no WASM bridge yet)
//   - freeze, trigger: gate inputs, hardware-only (no WASM bridge yet)
const cloudsPortDef: ModulePortDef = {
  inputs: [
    { id: 'audio-in',    name: 'IN L/R',       signal: 'audio' },  // stereo audio input
    { id: 'position-cv', name: 'POS CV',       signal: 'cv' },     // grain position CV
    { id: 'size-cv',     name: 'SIZE CV',      signal: 'cv' },     // grain size CV
    { id: 'density-cv',  name: 'DENS CV',      signal: 'cv' },     // grain density CV
    { id: 'texture-cv',  name: 'TEXT CV',      signal: 'cv' },     // grain texture CV
    { id: 'pitch-cv',    name: 'PITCH CV',     signal: 'cv' },     // pitch shift CV (no WASM bridge)
    { id: 'blend-cv',    name: 'BLEND CV',     signal: 'cv' },     // dry/wet blend CV (no WASM bridge)
    { id: 'freeze',      name: 'FREEZE',       signal: 'gate' },   // buffer freeze gate (no WASM bridge)
    { id: 'trigger',     name: 'TRIGGER',      signal: 'gate' },   // grain trigger gate (no WASM bridge)
  ],
  outputs: [
    { id: 'audio-out', name: 'OUT L/R', signal: 'audio' },  // stereo audio output
  ],
};

const tidesPortDef: ModulePortDef = {
  inputs: [
    { id: 'v-oct',        name: 'V/OCT',        signal: 'cv' },
    { id: 'fm-cv',        name: 'FM CV',         signal: 'cv' },
    { id: 'slope-cv',     name: 'SLOPE CV',      signal: 'cv' },
    { id: 'smooth-cv',    name: 'SMOOTH CV',     signal: 'cv' },
    { id: 'shape-cv',     name: 'SHAPE CV',      signal: 'cv' },
    { id: 'trig-gate',    name: 'TRIG',          signal: 'gate' },
    { id: 'clock',        name: 'CLOCK',         signal: 'gate' },
  ],
  outputs: [
    { id: 'out-1', name: 'OUT 1', signal: 'cv' },
    { id: 'out-2', name: 'OUT 2', signal: 'cv' },
    { id: 'out-3', name: 'OUT 3', signal: 'cv' },
    { id: 'out-4', name: 'OUT 4', signal: 'cv' },
  ],
};

// ---------------------------------------------------------------------------
// Registry — maps module adapter ID to its port definition
// ---------------------------------------------------------------------------

const portRegistry = new Map<string, ModulePortDef>([
  ['plaits', plaitsPortDef],
  ['rings',  ringsPortDef],
  ['clouds', cloudsPortDef],
  ['tides',  tidesPortDef],
]);

/** Get the I/O port definition for a module type (adapter ID). */
export function getModulePortDef(adapterId: string): ModulePortDef | undefined {
  return portRegistry.get(adapterId);
}

/** Get output port definitions for a module type. */
export function getModuleOutputs(adapterId: string): PortDef[] {
  return portRegistry.get(adapterId)?.outputs ?? [];
}

/** Get input port definitions for a module type. */
export function getModuleInputs(adapterId: string): PortDef[] {
  return portRegistry.get(adapterId)?.inputs ?? [];
}

/**
 * Curated list of source (Plaits) parameters that can be modulation targets.
 *
 * This is THE single source of truth — all other modules (chain-validation,
 * RackView, PatchView) import from here instead of maintaining their own copies.
 *
 * Each entry corresponds to a CV input on the Plaits hardware panel (e.g.
 * 'timbre' ← TIMBRE CV, 'harmonics' ← HARMONICS CV, 'morph' ← MORPH CV).
 * Frequency/note modulation is intentionally excluded (needs different depth
 * semantics — see Phase 4B).
 */
export function getSourceModTargets(): string[] {
  return ['timbre', 'harmonics', 'morph'];
}

/** Get all registered adapter IDs that have port definitions */
export function getRegisteredPortAdapterIds(): string[] {
  return Array.from(portRegistry.keys());
}
