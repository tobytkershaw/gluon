import type { SynthEngine } from './synth-interface';
import { PlaitsSynth } from './plaits-synth';
import { WebAudioSynth } from './web-audio-synth';

export async function createPreferredSynth(ctx: AudioContext, output: AudioNode): Promise<SynthEngine> {
  try {
    return await PlaitsSynth.create(ctx, output);
  } catch (error) {
    console.warn('Plaits init failed, falling back to WebAudioSynth.', error);
    return new WebAudioSynth(ctx, output);
  }
}
