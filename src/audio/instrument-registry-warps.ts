// src/audio/instrument-registry-warps.ts
// Warps processor instrument definition — Mutable Instruments Warps signal combiner
import type {
  SemanticRole,
  ControlKind,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Warps control factory ---

function makeWarpsControl(
  id: string,
  name: string,
  semanticRole: SemanticRole,
  description: string,
  defaultVal = 0.5,
  size: 'large' | 'medium' | 'small' = 'large',
  displayMapping?: DisplayMapping,
): ControlSchema {
  return {
    id,
    name,
    kind: 'continuous' as ControlKind,
    semanticRole,
    description,
    readable: true,
    writable: true,
    range: { min: 0, max: 1, default: defaultVal },
    size,
    binding: {
      adapterId: 'warps',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function warpsControls(): ControlSchema[] {
  return [
    makeWarpsControl(
      'algorithm',
      'Algorithm',
      'richness',
      'Morphs between combination modes: crossfade → fold → ring mod → frequency shift. Sweep through the full range to explore.',
    ),
    makeWarpsControl(
      'timbre',
      'Timbre',
      'texture',
      'Internal waveshaping and modulation depth. Controls how aggressively the signal is processed within the current algorithm.',
    ),
    makeWarpsControl(
      'level',
      'Level',
      'level',
      'Modulator input level / internal oscillator amplitude. Controls the intensity of the modulation source.',
      0.5,
    ),
  ];
}

// --- Warps engine definitions ---

const WARPS_ENGINE_DATA: [string, string, string][] = [
  ['crossfade', 'Crossfade', 'Crossfade/pan between signals'],
  ['fold', 'Fold', 'Wavefolding — harmonic enrichment'],
  ['ring', 'Ring Mod', 'Ring modulation — metallic, inharmonic textures'],
  ['frequency_shift', 'Frequency Shift', 'Frequency shifting — Hilbert transform, detuned effects'],
];

const warpsEngines: EngineDef[] = WARPS_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: warpsControls(),
}));

// --- Warps instrument definition ---

export const warpsInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Mutable Instruments Warps',
  adapterId: 'warps',
  engines: warpsEngines,
};

const warpsEngineByIdMap = new Map<string, EngineDef>(
  warpsEngines.map(e => [e.id, e]),
);

export function getWarpsEngineById(engineId: string): EngineDef | undefined {
  return warpsEngineByIdMap.get(engineId);
}

export function getWarpsEngineByIndex(index: number): EngineDef | undefined {
  return warpsEngines[index];
}

export function getWarpsModelList(): { index: number; name: string; description: string }[] {
  return warpsEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
