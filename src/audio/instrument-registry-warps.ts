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
      'Sweeps through the full Warps algorithm range: crossfade → wavefolder → diode ring mod → digital ring mod → XOR → comparator → vocoder.',
    ),
    makeWarpsControl(
      'timbre',
      'Timbre',
      'texture',
      'Secondary character control whose effect depends on the current algorithm: folding symmetry, ring-mod tone, logic threshold, or vocoder emphasis.',
    ),
    // On hardware this knob controls external carrier amplitude or internal oscillator
    // frequency (when internal osc is enabled). In Gluon it controls modulator amplitude.
    makeWarpsControl(
      'level',
      'Modulator Level',
      'level',
      'Modulator amplitude. Controls the intensity of the modulation source signal.',
      0.5,
    ),
  ];
}

// --- Warps engine definitions ---
// Official MI Warps has 7 algorithms selected by a continuous knob:
// 1. Crossfade, 2. Fold (cross-folding), 3. Diode Ring Mod,
// 4. Digital Ring Mod, 5. XOR, 6. Comparator, 7. Vocoder.
// In Gluon the algorithm knob (0-1) sweeps through all 7 continuously,
// so these engine presets are named entry points into the range.
// "Ring Mod" covers both diode and digital ring mod regions.

const WARPS_ENGINE_DATA: [string, string, string][] = [
  ['crossfade', 'Crossfade', 'Constant-power crossfade between carrier and modulator'],
  ['fold', 'Fold', 'Cross-folding — wavefolding for harmonic enrichment'],
  ['ring', 'Ring Mod', 'Ring modulation — diode and digital models, metallic textures'],
  ['vocoder', 'Vocoder', 'Comparator-to-vocoder end of the algorithm sweep — logic-like combination through robotic spectral transfer'],
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
