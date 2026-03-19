// src/audio/module-descriptors.ts
// Descriptor registry for all audio modules — used by audio-engine for generic dispatch.
import type { ModuleDescriptor, ProcessorContract, ModulatorContract, CreationResult } from './module-contract';
import { AUDIO_DEGRADED_EVENT, type AudioDegradedDetail } from './runtime-events';

function dispatchDegradedEvent(moduleType: string, error: unknown): void {
  if (typeof window !== 'undefined') {
    const message = `${moduleType} init failed: ${error}`;
    window.dispatchEvent(new CustomEvent<AudioDegradedDetail>(AUDIO_DEGRADED_EVENT, {
      detail: { message, source: `${moduleType}-factory` },
    }));
  }
}

/** Creates a pass-through processor for degraded mode (no processing, just passes audio through). */
function createPassthroughProcessor(ctx: AudioContext): ProcessorContract {
  // Use a GainNode as a no-op pass-through
  const gain = ctx.createGain();
  gain.gain.value = 1;
  return {
    role: 'processor' as const,
    inputNode: gain,
    outputNode: gain,
    setPatch() {},
    setModel() {},
    sendCommand() {},
    silence() {},
    destroy() { gain.disconnect(); },
  };
}

/** Creates a silent modulator for degraded mode (outputs zeros). */
function createPassthroughModulator(ctx: AudioContext): ModulatorContract {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  return {
    role: 'modulator' as const,
    outputNode: gain,
    setPatch() {},
    setModel() {},
    silence() {},
    pause() {},
    resume() {},
    destroy() { gain.disconnect(); },
  };
}

async function createProcessor(
  moduleType: string,
  factory: () => Promise<ProcessorContract>,
  ctx: AudioContext,
): Promise<CreationResult<ProcessorContract>> {
  try {
    const engine = await factory();
    return { engine, degraded: false };
  } catch (e) {
    dispatchDegradedEvent(moduleType, e);
    return { engine: createPassthroughProcessor(ctx), degraded: true, degradedReason: String(e) };
  }
}

async function createModulator(
  moduleType: string,
  factory: () => Promise<ModulatorContract>,
  ctx: AudioContext,
): Promise<CreationResult<ModulatorContract>> {
  try {
    const engine = await factory();
    return { engine, degraded: false };
  } catch (e) {
    dispatchDegradedEvent(moduleType, e);
    return { engine: createPassthroughModulator(ctx), degraded: true, degradedReason: String(e) };
  }
}

export const moduleDescriptors = new Map<string, ModuleDescriptor>([
  ['rings', {
    type: 'rings', role: 'processor',
    commands: ['strum', 'damp', 'set-polyphony', 'set-internal-exciter', 'set-fine-tune', 'set-note'],
    create: async (ctx) => createProcessor('rings', async () => {
      const { RingsSynth } = await import('./rings-synth');
      return RingsSynth.create(ctx);
    }, ctx),
  }],
  ['clouds', {
    type: 'clouds', role: 'processor',
    commands: ['freeze'],
    create: async (ctx) => createProcessor('clouds', async () => {
      const { CloudsSynth } = await import('./clouds-synth');
      return CloudsSynth.create(ctx);
    }, ctx),
  }],
  ['ripples', {
    type: 'ripples', role: 'processor',
    commands: [],
    create: async (ctx) => createProcessor('ripples', async () => {
      const { RipplesSynth } = await import('./ripples-synth');
      return RipplesSynth.create(ctx);
    }, ctx),
  }],
  ['eq', {
    type: 'eq', role: 'processor',
    commands: [],
    create: async (ctx) => createProcessor('eq', async () => {
      const { EqSynth } = await import('./eq-synth');
      return EqSynth.create(ctx);
    }, ctx),
  }],
  ['compressor', {
    type: 'compressor', role: 'processor',
    commands: ['sidechain-enabled'],
    sidechain: { inputIndex: 1 },
    create: async (ctx) => createProcessor('compressor', async () => {
      const { CompressorSynth } = await import('./compressor-synth');
      return CompressorSynth.create(ctx);
    }, ctx),
  }],
  ['stereo', {
    type: 'stereo', role: 'processor',
    commands: [],
    create: async (ctx) => createProcessor('stereo', async () => {
      const { StereoSynth } = await import('./stereo-synth');
      return StereoSynth.create(ctx);
    }, ctx),
  }],
  ['chorus', {
    type: 'chorus', role: 'processor',
    commands: [],
    create: async (ctx) => createProcessor('chorus', async () => {
      const { ChorusSynth } = await import('./chorus-synth');
      return ChorusSynth.create(ctx);
    }, ctx),
  }],
  ['distortion', {
    type: 'distortion', role: 'processor',
    commands: [],
    create: async (ctx) => createProcessor('distortion', async () => {
      const { DistortionSynth } = await import('./distortion-synth');
      return DistortionSynth.create(ctx);
    }, ctx),
  }],
  ['warps', {
    type: 'warps', role: 'processor',
    commands: [],
    create: async (ctx) => createProcessor('warps', async () => {
      const { WarpsSynth } = await import('./warps-synth');
      return WarpsSynth.create(ctx);
    }, ctx),
  }],
  ['elements', {
    type: 'elements', role: 'processor',
    commands: ['gate', 'damp', 'set-note'],
    create: async (ctx) => createProcessor('elements', async () => {
      const { ElementsSynth } = await import('./elements-synth');
      return ElementsSynth.create(ctx);
    }, ctx),
  }],
  ['beads', {
    type: 'beads', role: 'processor',
    commands: [],
    create: async (ctx) => createProcessor('beads', async () => {
      const { BeadsSynth } = await import('./beads-synth');
      return BeadsSynth.create(ctx);
    }, ctx),
  }],
  ['frames', {
    type: 'frames', role: 'processor',
    commands: [],
    create: async (ctx) => createProcessor('frames', async () => {
      const { FramesSynth } = await import('./frames-synth');
      return FramesSynth.create(ctx);
    }, ctx),
  }],
  ['tides', {
    type: 'tides', role: 'modulator',
    commands: [],
    create: async (ctx) => createModulator('tides', async () => {
      const { TidesSynth } = await import('./tides-synth');
      return TidesSynth.create(ctx);
    }, ctx),
  }],
  ['marbles', {
    type: 'marbles', role: 'modulator',
    commands: [],
    create: async (ctx) => createModulator('marbles', async () => {
      const { MarblesSynth } = await import('./marbles-synth');
      return MarblesSynth.create(ctx);
    }, ctx),
  }],
]);
