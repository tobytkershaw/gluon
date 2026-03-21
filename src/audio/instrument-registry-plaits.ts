// src/audio/instrument-registry-plaits.ts
// Plaits synth instrument definition — extracted from instrument-registry.ts
import type {
  ControlKind,
  SemanticRole,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Canonical-to-runtime mappings ---
// After the hardware-name rename (#392), most Plaits control IDs match their
// runtime param names directly (timbre→timbre, harmonics→harmonics, morph→morph).
// The only remaining mapping is frequency→note.
// Processors (Rings, Clouds) and modulators (Tides) use identity mappings.

export const controlIdToRuntimeParam: Record<string, string> = {
  frequency: 'note',
  'fm-amount': 'fm_amount',
  'timbre-mod-amount': 'timbre_mod_amount',
  'morph-mod-amount': 'morph_mod_amount',
  'lpg-colour': 'lpg_colour',
};

export const runtimeParamToControlId: Record<string, string> = {
  note: 'frequency',
  fm_amount: 'fm-amount',
  timbre_mod_amount: 'timbre-mod-amount',
  morph_mod_amount: 'morph-mod-amount',
  lpg_colour: 'lpg-colour',
};

// --- Control factory ---

function makePlaitsControl(
  id: string,
  name: string,
  semanticRole: SemanticRole,
  description: string,
  runtimeParam: string,
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
      adapterId: 'plaits',
      path: `params.${runtimeParam}`,
    },
    displayMapping,
  };
}

function defaultControls(overrides?: Record<string, number>): ControlSchema[] {
  const controls: ControlSchema[] = [
    // Row 1: Frequency, Harmonics (matching hardware 2x2 layout)
    makePlaitsControl(
      'frequency',
      'Frequency',
      'pitch',
      'Fundamental pitch of the sound. 0.0 is the lowest, 1.0 is the highest.',
      'note',
      0.5,
      'large',
      { type: 'log', min: 20, max: 16000, unit: 'Hz', decimals: 0 },
    ),
    makePlaitsControl(
      'harmonics',
      'Harmonics',
      'richness',
      'Frequency spread or balance between tonal constituents. Behavior varies by model — see model-specific descriptions.',
      'harmonics',
    ),
    // Row 2: Timbre, Morph (medium — smaller knobs on hardware)
    makePlaitsControl(
      'timbre',
      'Timbre',
      'brightness',
      'Spectral content of the sound. Low values are dark and warm, high values are bright and cutting.',
      'timbre',
      0.5,
      'medium',
    ),
    makePlaitsControl(
      'morph',
      'Morph',
      'texture',
      'Lateral timbral variation. Explores different tonal characters at the same brightness level.',
      'morph',
      0.5,
      'medium',
    ),
    // Row 3: Timbre Mod, FM Amount, Morph Mod (attenuverters, matching hardware order)
    makePlaitsControl(
      'timbre-mod-amount',
      'Timbre Mod',
      'brightness',
      'How much the internal envelope modulates the timbre parameter.',
      'timbre_mod_amount',
      0.0,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makePlaitsControl(
      'fm-amount',
      'FM Amount',
      'richness',
      'Frequency modulation depth. Controls how much the internal envelope modulates the pitch.',
      'fm_amount',
      0.0,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makePlaitsControl(
      'morph-mod-amount',
      'Morph Mod',
      'texture',
      'How much the internal envelope modulates the morph parameter.',
      'morph_mod_amount',
      0.0,
      'small',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makePlaitsControl(
      'decay',
      'Decay',
      'decay',
      'LPG decay time. Controls how long the internal low-pass gate stays open after a trigger. Disabled for physical and drum models (12–16) which use their own internal decay.',
      'decay',
      0.5,
      'small',
      { type: 'log', min: 1, max: 4000, unit: 'ms', decimals: 0 },
    ),
    makePlaitsControl(
      'lpg-colour',
      'LPG Colour',
      'brightness',
      'LPG response character. Low values add more filtering (VCFA), high values are more like a pure VCA. Disabled for physical and drum models (12–16).',
      'lpg_colour',
      0.5,
      'small',
    ),
    // Row 4: Portamento controls — track-level fields, not params entries
    {
      id: 'portamento-time',
      name: 'Portamento',
      kind: 'continuous' as ControlKind,
      semanticRole: 'pitch' as SemanticRole,
      description: 'Pitch glide time between notes. 0.0 = instant (no glide), 1.0 = 500ms glide.',
      readable: true,
      writable: true,
      range: { min: 0, max: 1, default: 0 },
      size: 'small' as const,
      binding: {
        adapterId: 'plaits',
        path: 'track.portamentoTime',
      },
      displayMapping: { type: 'linear', min: 0, max: 500, unit: 'ms', decimals: 0 },
    },
    {
      id: 'portamento-mode',
      name: 'Porta Mode',
      kind: 'enum' as ControlKind,
      semanticRole: 'pitch' as SemanticRole,
      description: 'Portamento mode: off (no glide), always (glide every note), legato (glide only when notes overlap).',
      readable: true,
      writable: true,
      enumValues: ['off', 'always', 'legato'],
      size: 'small' as const,
      binding: {
        adapterId: 'plaits',
        path: 'track.portamentoMode',
      },
    },
  ];
  if (overrides) {
    for (const c of controls) {
      if (c.range && c.id in overrides) {
        c.range = { ...c.range, default: overrides[c.id] };
      }
    }
  }
  return controls;
}

// --- Engine definitions ---

// Official Plaits model names and order per MI documentation.
// Pair structure: 8 pitched models, then 5 noise/string models, then 3 percussion.
// IDs are stable (used in persistence) — labels updated to match official docs.
// Per-engine default param overrides. Only engines that benefit from non-0.5
// defaults are listed. Values derived from official Mutable Instruments Plaits
// documentation and acoustic testing.
const ENGINE_DATA: [string, string, string, boolean, Record<string, number>?][] = [
  ['virtual-analog', 'Virtual Analog', 'Classic variable-waveshape VA oscillator', false],
  ['waveshaping', 'Waveshaper', 'Variable-slope triangle into waveshaper and wavefolder', false,
    { timbre: 0.3 }], // 0.5 is aggressive folding; 0.3 = subtle warmth
  ['fm', 'FM', '2-operator FM with feedback', false,
    { timbre: 0.3 }], // 0.5 = bright; 0.3 = warm FM
  ['grain-formant', 'Formant', 'Granular formant oscillator — vowels and filtered sine', false],
  ['harmonic', 'Harmonic', 'Additive synthesis — 24 harmonics', false],
  ['wavetable', 'Wavetable', 'Wavetable oscillator — 8x8 banks', false],
  ['chords', 'Chords', 'Chord engine — string machine style', false,
    { harmonics: 0.25, morph: 0.2 }], // minor triad, warm organ/string drawbar
  ['vowel-speech', 'Speech', 'Speech synthesis — SAM, LPC, and formant', false],
  ['swarm', 'Swarm', 'Granular cloud of 8 sawtooth oscillators', false],
  ['filtered-noise', 'Filtered Noise', 'Clocked noise through resonant filter', false],
  ['particle-dust', 'Particle Noise', 'Dust noise through all-pass and band-pass filters', false],
  ['inharmonic-string', 'Inharmonic String', 'Karplus-Strong extended model with inharmonicity', false],
  ['modal-resonator', 'Modal Resonator', 'Tuned modal resonator — bells, plates, struck objects', false],
  ['analog-bass-drum', 'Analog Bass Drum', 'Analog bass drum synthesis', true,
    { frequency: 0.25, harmonics: 0.12, timbre: 0.2, morph: 0.4 }], // deep punchy kick
  ['analog-snare', 'Analog Snare Drum', 'Analog snare drum synthesis', true,
    { frequency: 0.38, harmonics: 0.4, timbre: 0.35, morph: 0.3 }], // balanced snappy snare
  ['analog-hi-hat', 'Analog Hi-Hat', 'Analog hi-hat synthesis', true,
    { frequency: 0.65, harmonics: 0.4, morph: 0.15 }], // tight closed hat
];

const engines: EngineDef[] = ENGINE_DATA.map(([id, label, description, _perc, defaults]) => ({
  id,
  label,
  description,
  controls: defaultControls(defaults),
}));

const percussionSet = new Set(
  ENGINE_DATA.filter(([, , , perc]) => perc).map(([id]) => id),
);

export function isPercussion(engineId: string): boolean {
  return percussionSet.has(engineId);
}

export function isPercussionByIndex(index: number): boolean {
  return ENGINE_DATA[index]?.[3] ?? false;
}

// --- Instrument definition ---

export const plaitsInstrument: InstrumentDef = {
  type: 'synth',
  label: 'Mutable Instruments Plaits',
  adapterId: 'plaits',
  engines,
};

// --- Lookup helpers ---

const engineByIdMap = new Map<string, EngineDef>(
  engines.map(e => [e.id, e]),
);

export function getEngineById(engineId: string): EngineDef | undefined {
  return engineByIdMap.get(engineId);
}

export function getEngineByIndex(index: number): EngineDef | undefined {
  return engines[index];
}

export function getModelName(index: number): string {
  if (index < 0) return 'No Source';
  return engines[index]?.label ?? `Unknown ${index}`;
}

export function getEngineControlSchemas(engineId: string): ControlSchema[] {
  return engineByIdMap.get(engineId)?.controls ?? [];
}

export function getControlBinding(engineId: string, controlId: string): import('../engine/canonical-types').ControlBinding | undefined {
  const engine = engineByIdMap.get(engineId);
  if (!engine) return undefined;
  return engine.controls.find(c => c.id === controlId)?.binding;
}

export function getModelList(): { index: number; name: string; description: string }[] {
  return engines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
