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
      'Morphs between combination modes: crossfade → fold → ring mod → frequency shift (Gluon). Hardware Warps continues through XOR → comparator → vocoder, not yet implemented.',
    ),
    makeWarpsControl(
      'timbre',
      'Timbre',
      'texture',
      'Per-algorithm processing intensity. Crossfade: mix position. Fold: fold amount. Ring mod: gain/clipping. Frequency shift: feedback amount.',
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
// Gluon implements 4 of the 7: crossfade, fold, ring mod, and frequency shift
// (Gluon extension replacing XOR/comparator/vocoder). The algorithm knob (0-1)
// sweeps through the implemented algorithms continuously.
// "Ring Mod" covers both diode and digital ring mod regions.

const WARPS_ENGINE_DATA: [string, string, string][] = [
  ['crossfade', 'Crossfade', 'Constant-power crossfade between carrier and modulator'],
  ['fold', 'Fold', 'Sum carrier + modulator through a wavefolder — harmonic enrichment'],
  ['ring', 'Ring Mod', 'Ring modulation — diode and digital models, metallic textures'],
  ['frequency_shift', 'Frequency Shift (Gluon)', 'Frequency shifting via Hilbert transform — detuned, dissonant effects (Gluon extension; hardware Warps has XOR, comparator, and vocoder here instead)'],
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
