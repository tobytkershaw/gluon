// src/engine/track-labels.ts
import type { Track } from './types';
import { getModelName } from '../audio/instrument-registry';

/** Abbreviated engine labels for compact display (~176px TrackRow width). */
const ENGINE_ABBREV: Record<string, string> = {
  'Virtual Analog': 'VA',
  'Waveshaping': 'Waveshp',
  'FM': 'FM',
  'Grain/Formant': 'Grain',
  'Harmonic': 'Harmonic',
  'Wavetable': 'Wavetbl',
  'Chords': 'Chords',
  'Vowel/Speech': 'Vowel',
  'Swarm': 'Swarm',
  'Filtered Noise': 'Noise',
  'Particle/Dust': 'Dust',
  'Inharmonic String': 'InhStr',
  'Modal Resonator': 'Modal',
  'Analog Bass Drum': 'Kick',
  'Analog Snare': 'Snare',
  'Analog Hi-Hat': 'HiHat',
};

/**
 * Returns the display label for a track.
 * Priority: 1) user-assigned name, 2) abbreviated engine label, 3) track id fallback.
 */
export function getTrackLabel(track: Track): string {
  if (track.name) return track.name;
  const modelName = getModelName(track.model);
  return ENGINE_ABBREV[modelName] ?? modelName;
}
