// src/audio/instrument-registry-eq.ts
// EQ processor instrument definition — extracted from instrument-registry.ts
import type {
  SemanticRole,
  ControlKind,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- EQ control factory ---

function makeEqControl(
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
      adapterId: 'eq',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function eqControls(): ControlSchema[] {
  return [
    makeEqControl(
      'low-freq',
      'Low Freq',
      'brightness',
      'Low shelf frequency. 0.0 = 20Hz, 1.0 = 500Hz. Controls where the low shelf takes effect.',
      0.25,
      'medium',
      { type: 'log', min: 20, max: 500, unit: 'Hz', decimals: 0 },
    ),
    makeEqControl(
      'low-gain',
      'Low Gain',
      'level',
      'Low shelf gain. 0.0 = -18dB, 0.5 = unity (0dB), 1.0 = +18dB. Cut low end to reduce mud, boost for warmth.',
      0.5,
      'large',
      { type: 'linear', min: -18, max: 18, unit: 'dB', decimals: 1 },
    ),
    makeEqControl(
      'mid1-freq',
      'Mid 1 Freq',
      'brightness',
      'Mid band 1 center frequency. 0.0 = 100Hz, 1.0 = 8kHz. Target specific frequency ranges.',
      0.4,
      'medium',
      { type: 'log', min: 100, max: 8000, unit: 'Hz', decimals: 0 },
    ),
    makeEqControl(
      'mid1-gain',
      'Mid 1 Gain',
      'level',
      'Mid band 1 gain. 0.0 = -18dB, 0.5 = unity, 1.0 = +18dB. Cut to remove problem frequencies, boost for presence.',
      0.5,
      'large',
      { type: 'linear', min: -18, max: 18, unit: 'dB', decimals: 1 },
    ),
    makeEqControl(
      'mid1-q',
      'Mid 1 Q',
      'resonance',
      'Mid band 1 bandwidth. 0.0 = wide (0.1), 1.0 = narrow (18). Narrow Q for surgical cuts, wide for gentle shaping.',
      0.3,
      'small',
      { type: 'log', min: 0.1, max: 18, unit: '', decimals: 1 },
    ),
    makeEqControl(
      'mid2-freq',
      'Mid 2 Freq',
      'brightness',
      'Mid band 2 center frequency. 0.0 = 100Hz, 1.0 = 8kHz. Second mid band for independent frequency targeting.',
      0.6,
      'medium',
      { type: 'log', min: 100, max: 8000, unit: 'Hz', decimals: 0 },
    ),
    makeEqControl(
      'mid2-gain',
      'Mid 2 Gain',
      'level',
      'Mid band 2 gain. 0.0 = -18dB, 0.5 = unity, 1.0 = +18dB.',
      0.5,
      'large',
      { type: 'linear', min: -18, max: 18, unit: 'dB', decimals: 1 },
    ),
    makeEqControl(
      'mid2-q',
      'Mid 2 Q',
      'resonance',
      'Mid band 2 bandwidth. 0.0 = wide (0.1), 1.0 = narrow (18).',
      0.3,
      'small',
      { type: 'log', min: 0.1, max: 18, unit: '', decimals: 1 },
    ),
    makeEqControl(
      'high-freq',
      'High Freq',
      'brightness',
      'High shelf frequency. 0.0 = 1kHz, 1.0 = 20kHz. Controls where the high shelf takes effect.',
      0.75,
      'medium',
      { type: 'log', min: 1000, max: 20000, unit: 'Hz', decimals: 0 },
    ),
    makeEqControl(
      'high-gain',
      'High Gain',
      'level',
      'High shelf gain. 0.0 = -18dB, 0.5 = unity, 1.0 = +18dB. Cut harshness or boost air/presence.',
      0.5,
      'large',
      { type: 'linear', min: -18, max: 18, unit: 'dB', decimals: 1 },
    ),
  ];
}

// --- EQ engine definitions ---

const EQ_ENGINE_DATA: [string, string, string][] = [
  ['4band', '4-Band Parametric', 'Low shelf + 2 peaking mids + high shelf — covers most mixing needs'],
  ['8band', '8-Band Parametric', 'Low shelf + 6 peaking mids + high shelf — surgical precision for complex corrections'],
];

const eqEngines: EngineDef[] = EQ_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: eqControls(),
}));

// --- EQ instrument definition ---

export const eqInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Parametric EQ',
  adapterId: 'eq',
  engines: eqEngines,
};

const eqEngineByIdMap = new Map<string, EngineDef>(
  eqEngines.map(e => [e.id, e]),
);

export function getEqEngineById(engineId: string): EngineDef | undefined {
  return eqEngineByIdMap.get(engineId);
}

export function getEqEngineByIndex(index: number): EngineDef | undefined {
  return eqEngines[index];
}

export function getEqModelList(): { index: number; name: string; description: string }[] {
  return eqEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
