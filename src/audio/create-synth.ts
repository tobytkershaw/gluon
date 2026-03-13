import type { SynthEngine } from './synth-interface';
import { PlaitsSynth } from './plaits-synth';
import { WebAudioSynth } from './web-audio-synth';
import type { RingsEngine } from './rings-synth';
import { RingsSynth } from './rings-synth';
import type { CloudsEngine } from './clouds-synth';
import { CloudsSynth } from './clouds-synth';
import type { TidesEngine } from './tides-synth';
import { TidesSynth } from './tides-synth';

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

export async function createTidesModulator(ctx: AudioContext): Promise<TidesEngine> {
  return TidesSynth.create(ctx);
}
