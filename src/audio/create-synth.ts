// src/audio/create-synth.ts
// Factory for the Plaits source synth (SynthEngine).
// Processor/modulator factories are now in module-descriptors.ts.
import type { SynthEngine } from './synth-interface';
import { PlaitsSynth } from './plaits-synth';
import { WebAudioSynth } from './web-audio-synth';
import { AUDIO_DEGRADED_EVENT, type AudioDegradedDetail } from './runtime-events';

const PREFERRED_SYNTH_BACKOFF_MS = 30_000;

interface BackoffState {
  until: number;
}

const preferredSynthBackoff = new WeakMap<AudioContext, BackoffState>();

export async function createPreferredSynth(ctx: AudioContext, output: AudioNode): Promise<SynthEngine> {
  const now = Date.now();
  const backoff = preferredSynthBackoff.get(ctx);
  if (backoff && now < backoff.until) {
    return new WebAudioSynth(ctx, output);
  }

  try {
    const synth = await PlaitsSynth.create(ctx, output);
    preferredSynthBackoff.delete(ctx);
    return synth;
  } catch (error) {
    const message = 'Plaits init failed, falling back to WebAudioSynth.';
    console.warn(message, error);
    preferredSynthBackoff.set(ctx, {
      until: now + PREFERRED_SYNTH_BACKOFF_MS,
    });
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
