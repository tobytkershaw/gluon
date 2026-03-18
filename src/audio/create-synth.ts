import type { SynthEngine } from './synth-interface';
import { PlaitsSynth } from './plaits-synth';
import { WebAudioSynth } from './web-audio-synth';
import type { RingsEngine } from './rings-synth';
import { RingsSynth } from './rings-synth';
import type { CloudsEngine } from './clouds-synth';
import { CloudsSynth } from './clouds-synth';
import type { RipplesEngine } from './ripples-synth';
import { RipplesSynth } from './ripples-synth';
import type { EqEngine } from './eq-synth';
import { EqSynth } from './eq-synth';
import type { TidesEngine } from './tides-synth';
import { TidesSynth } from './tides-synth';
import type { CompressorEngine } from './compressor-synth';
import { CompressorSynth } from './compressor-synth';
import type { StereoEngine } from './stereo-synth';
import { StereoSynth } from './stereo-synth';

export async function createPreferredSynth(ctx: AudioContext, output: AudioNode): Promise<SynthEngine> {
  try {
    return await PlaitsSynth.create(ctx, output);
  } catch (error) {
    console.warn('Plaits init failed, falling back to WebAudioSynth.', error);
    return new WebAudioSynth(ctx, output);
  }
}

export async function createRingsProcessor(ctx: AudioContext): Promise<RingsEngine> {
  return RingsSynth.create(ctx);
}

export async function createCloudsProcessor(ctx: AudioContext): Promise<CloudsEngine> {
  return CloudsSynth.create(ctx);
}

export async function createRipplesProcessor(ctx: AudioContext): Promise<RipplesEngine> {
  return RipplesSynth.create(ctx);
}

export async function createEqProcessor(ctx: AudioContext): Promise<EqEngine> {
  return EqSynth.create(ctx);
}

export async function createTidesModulator(ctx: AudioContext): Promise<TidesEngine> {
  return TidesSynth.create(ctx);
}

export async function createCompressorProcessor(ctx: AudioContext): Promise<CompressorEngine> {
  return CompressorSynth.create(ctx);
}

export async function createStereoProcessor(ctx: AudioContext): Promise<StereoEngine> {
  return StereoSynth.create(ctx);
}
