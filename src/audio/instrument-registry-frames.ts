// src/audio/instrument-registry-frames.ts
// Frames processor instrument definition — quadruple VCA keyframer/mixer
// Based on Mutable Instruments Frames: stores keyframe snapshots of 4-channel
// gains and interpolates between them as the FRAME knob sweeps through.
import type {
  SemanticRole,
  ControlKind,
  ControlSchema,
  DisplayMapping,
  EngineDef,
  InstrumentDef,
} from '../engine/canonical-types';

// --- Frames control factory ---

function makeFramesControl(
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
      adapterId: 'frames',
      path: `params.${id}`,
    },
    displayMapping,
  };
}

function framesControls(): ControlSchema[] {
  return [
    makeFramesControl(
      'frame',
      'Frame',
      'body',
      'Position in the animation sequence. Sweeps through stored keyframes — gains for all 4 channels are interpolated between the two nearest keyframes. 0% = start, 100% = end.',
      0.0,
      'large',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeFramesControl(
      'channel_1',
      'Channel 1',
      'level',
      'Gain for VCA channel 1 at the current keyframe position. When between keyframes, this value is interpolated automatically.',
      0.0,
      'medium',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeFramesControl(
      'channel_2',
      'Channel 2',
      'level',
      'Gain for VCA channel 2 at the current keyframe position. When between keyframes, this value is interpolated automatically.',
      0.0,
      'medium',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeFramesControl(
      'channel_3',
      'Channel 3',
      'level',
      'Gain for VCA channel 3 at the current keyframe position. When between keyframes, this value is interpolated automatically.',
      0.0,
      'medium',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeFramesControl(
      'channel_4',
      'Channel 4',
      'level',
      'Gain for VCA channel 4 at the current keyframe position. When between keyframes, this value is interpolated automatically.',
      0.0,
      'medium',
      { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 },
    ),
    makeFramesControl(
      'modulation',
      'Modulation',
      'mod_depth',
      'Attenuverter for frame position modulation. 0.0 = full reverse, 0.5 = no modulation, 1.0 = full forward. Offsets the frame knob position — use with an LFO or envelope to animate the keyframe sequence.',
      0.5,
      'small',
      { type: 'linear', min: -100, max: 100, unit: '%', decimals: 0 },
    ),
  ];
}

// --- Frames engine definitions ---

const FRAMES_ENGINE_DATA: [string, string, string][] = [
  ['keyframe', 'Keyframe', 'Interpolate between stored keyframe snapshots — the frame knob smoothly morphs channel gains using configurable easing curves'],
  ['sequencer', 'Sequencer', 'Step through keyframes sequentially without interpolation — the frame knob controls step rate, each step snaps to the next keyframe'],
];

const framesEngines: EngineDef[] = FRAMES_ENGINE_DATA.map(([id, label, description]) => ({
  id,
  label,
  description,
  controls: framesControls(),
}));

// --- Frames instrument definition ---

export const framesInstrument: InstrumentDef = {
  type: 'effect',
  label: 'Frames',
  adapterId: 'frames',
  engines: framesEngines,
};

const framesEngineByIdMap = new Map<string, EngineDef>(
  framesEngines.map(e => [e.id, e]),
);

export function getFramesEngineById(engineId: string): EngineDef | undefined {
  return framesEngineByIdMap.get(engineId);
}

export function getFramesEngineByIndex(index: number): EngineDef | undefined {
  return framesEngines[index];
}

export function getFramesModelList(): { index: number; name: string; description: string }[] {
  return framesEngines.map((e, i) => ({ index: i, name: e.label, description: e.description }));
}
