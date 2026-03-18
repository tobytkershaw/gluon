// src/audio/instrument-registry-beads.ts
// Beads processor instrument definition — Mutable Instruments Beads (Clouds successor)
import type {
  ControlKind,
  SemanticRole,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Beads control factory ---

function makeBeadsControl(
  id: string,
  name: string,
  semanticRole: SemanticRole,
  description: string,
  kind: ControlKind = 'continuous',
  defaultVal = 0.5,
  size: 'large' | 'medium' | 'small' = 'large',
  displayMapping?: DisplayMapping,
): ControlSchema {
  return {
    id,
    name,
    kind,
    semanticRole,
    description,
    readable: true,
    writable: true,
    range: { min: 0, max: 1, default: defaultVal },
    size,
    binding: {
      adapterId: 'beads',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function beadsControls(): ControlSchema[] {
  return [
    // Large knobs (hardware top row): Time, Density, Texture
    makeBeadsControl(
      'time',
      'Time',
      'decay',
      'Grain size in granular mode, delay time in delay mode, decay time in reverb mode.',
    ),
    makeBeadsControl(
      'density',
      'Density',
      'density',
      'Grain density and overlap. Low values produce sparse grains, high values create thick clouds. In delay mode controls feedback amount.',
    ),
    makeBeadsControl(
      'texture',
      'Texture',
      'texture',
      'Grain envelope shape and tone color. Controls the window function in granular mode and filtering in delay/reverb modes.',
    ),
    // Large knobs continued: Position, Pitch
    makeBeadsControl(
      'position',
      'Position',
      'texture',
      'Where in the recording buffer to read. Scrubs through captured audio.',
    ),
    makeBeadsControl(
      'pitch',
      'Pitch',
      'pitch',
      'Pitch shift amount. 0.5 is no shift, lower values pitch down, higher values pitch up.',
    ),
    // Mix control
    makeBeadsControl(
      'dry-wet',
      'Dry/Wet',
      'body',
      'Blend between dry input and processed wet signal.',
      'continuous',
      0.5,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
  ];
}

// --- Beads engine definitions ---

const BEADS_ENGINE_DATA: [string, string, string][] = [
  ['granular', 'Granular', 'Granular processing — real-time grain cloud, improved Clouds algorithm'],
  ['delay', 'Delay', 'Delay line — feedback, filtering, and pitch shifting'],
  ['reverb', 'Reverb', 'Algorithmic reverb — lush decay evolved from Clouds\' reverb mode'],
];

const beadsEngines: EngineDef[] = BEADS_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: beadsControls(),
}));

// --- Beads instrument definition ---

export const beadsInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Mutable Instruments Beads',
  adapterId: 'beads',
  engines: beadsEngines,
};

const beadsEngineByIdMap = new Map<string, EngineDef>(
  beadsEngines.map(e => [e.id, e]),
);

export function getBeadsEngineById(engineId: string): EngineDef | undefined {
  return beadsEngineByIdMap.get(engineId);
}

export function getBeadsEngineByIndex(index: number): EngineDef | undefined {
  return beadsEngines[index];
}

export function getBeadsModelList(): { index: number; name: string; description: string }[] {
  return beadsEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
