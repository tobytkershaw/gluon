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
import type { ChorusEngine } from './chorus-synth';
import { ChorusSynth } from './chorus-synth';
import type { DistortionEngine } from './distortion-synth';
import { DistortionSynth } from './distortion-synth';
import type { WarpsEngine } from './warps-synth';
import { WarpsSynth } from './warps-synth';
import type { ElementsEngine } from './elements-synth';
import { ElementsSynth } from './elements-synth';
import type { BeadsEngine } from './beads-synth';
import { BeadsSynth } from './beads-synth';
import { AUDIO_DEGRADED_EVENT, type AudioDegradedDetail } from './runtime-events';

export async function createPreferredSynth(ctx: AudioContext, output: AudioNode): Promise<SynthEngine> {
  try {
    return await PlaitsSynth.create(ctx, output);
  } catch (error) {
    const message = 'Plaits init failed, falling back to WebAudioSynth.';
    console.warn(message, error);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<AudioDegradedDetail>(AUDIO_DEGRADED_EVENT, {
        detail: {
          message,
          source: 'synth-fallback',
        },
      }));
    }
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

export async function createChorusProcessor(ctx: AudioContext): Promise<ChorusEngine> {
  return ChorusSynth.create(ctx);
}

export async function createDistortionProcessor(ctx: AudioContext): Promise<DistortionEngine> {
  return DistortionSynth.create(ctx);
}

export async function createWarpsProcessor(ctx: AudioContext): Promise<WarpsEngine> {
  return WarpsSynth.create(ctx);
}

export async function createElementsProcessor(ctx: AudioContext): Promise<ElementsEngine> {
  return ElementsSynth.create(ctx);
}

export async function createBeadsProcessor(ctx: AudioContext): Promise<BeadsEngine> {
  return BeadsSynth.create(ctx);
}
