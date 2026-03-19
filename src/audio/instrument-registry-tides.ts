// src/audio/instrument-registry-tides.ts
// Tides modulator instrument definition — extracted from instrument-registry.ts
import type {
  ControlKind,
  SemanticRole,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Tides control factory ---

function makeTidesControl(
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
      adapterId: 'tides',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function tidesControls(): ControlSchema[] {
  return [
    makeTidesControl(
      'frequency',
      'Frequency',
      'pitch',
      'Rate of the modulation cycle. Low values are slow sweeps, high values are fast oscillation.',
      0.3,
      'large',
      { type: 'log', min: 0.05, max: 100, unit: 'Hz', decimals: 1 },
    ),
    makeTidesControl(
      'shape',
      'Shape',
      'texture',
      'Waveform character. Blends between different waveshapes (sine, triangle, saw, square-like).',
    ),
    makeTidesControl(
      'slope',
      'Slope',
      'texture',
      'Attack/decay symmetry. Low values have fast attack/slow decay, high values have slow attack/fast decay.',
    ),
    makeTidesControl(
      'smoothness',
      'Smoothness',
      'brightness',
      'Waveshape transformation. Low values apply wavefolding (adds kinks and harmonics), center is neutral, high values smooth/round the waveform.',
      0.5,
    ),
    // --- Extended parameters (via _tides_set_extended) ---
    // Hardware label: SHIFT/LEVEL — function varies by output mode
    makeTidesControl(
      'shift',
      'Shift/Level',
      'texture',
      'Output polarization, shifting, and phase spread. Function depends on the active output mode.',
      0.0,
      'small',
    ),
    {
      id: 'output-mode',
      name: 'Output Mode',
      kind: 'discrete' as ControlKind,
      semanticRole: 'body',
      description: 'Output routing mode. 0: different waveshapes per output (SHIFT = attenuverter). 1: signal crossfaded between outputs (SHIFT = destination). 2: phase-shifted copies per output (SHIFT = phase offset). 3: frequency-ratio-shifted outputs for polyrhythms/chords (SHIFT = ratio).',
      readable: true,
      writable: true,
      range: { min: 0, max: 3, default: 1 },
      size: 'small',
      binding: {
        adapterId: 'tides',
        path: 'params.output-mode',
      },
    } as ControlSchema,
    {
      id: 'range',
      name: 'Range',
      kind: 'discrete' as ControlKind,
      semanticRole: 'pitch',
      description: 'Frequency range. 0: slow (control rate, ~0.125 Hz center, for LFO/envelope use). 1: audio rate (~130 Hz center, for audible oscillation).',
      readable: true,
      writable: true,
      range: { min: 0, max: 1, default: 0 },
      size: 'small',
      binding: {
        adapterId: 'tides',
        path: 'params.range',
      },
    } as ControlSchema,
  ];
}

// --- Tides engine definitions ---

// Official Tides 2018 ramp modes (selected via button C on hardware):
// 1. AD (one-shot unipolar attack-decay envelope)
// 2. Looping (cyclic bipolar oscillations)
// 3. AR (one-shot unipolar attack-release envelope)
const TIDES_ENGINE_DATA: [string, string, string][] = [
  ['ad', 'AD Envelope', 'One-shot unipolar attack-decay envelope triggered by events'],
  ['looping', 'Looping', 'Free-running cyclic bipolar oscillations — LFO mode'],
  ['ar', 'AR Envelope', 'One-shot unipolar attack-release envelope with gate hold'],
];

const tidesEngines: EngineDef[] = TIDES_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: tidesControls(),
}));

// --- Tides instrument definition ---

export const tidesInstrument: InstrumentDef = {
  type: 'modulator',
  label: 'Mutable Instruments Tides',
  adapterId: 'tides',
  engines: tidesEngines,
};

const tidesEngineByIdMap = new Map<string, EngineDef>(
  tidesEngines.map(e => [e.id, e]),
);

export function getTidesEngineById(engineId: string): EngineDef | undefined {
  return tidesEngineByIdMap.get(engineId);
}

export function getTidesEngineByIndex(index: number): EngineDef | undefined {
  return tidesEngines[index];
}

export function getTidesModelList(): { index: number; name: string; description: string }[] {
  return tidesEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
