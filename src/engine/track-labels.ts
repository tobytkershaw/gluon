// src/engine/track-labels.ts
import type { Track, Session } from './types';
import { getTrackKind, MASTER_BUS_ID } from './types';
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
 * Priority: 1) user-assigned name, 2) for buses: "Bus" or "Master", 3) abbreviated engine label, 4) track id fallback.
 */
export function getTrackLabel(track: Track): string {
  if (track.name) return track.name;
  if (getTrackKind(track) === 'bus') {
    return track.id === MASTER_BUS_ID ? 'Master' : 'Bus';
  }
  const modelName = getModelName(track.model);
  return ENGINE_ABBREV[modelName] ?? modelName;
}

/**
 * Returns a 1-indexed ordinal label for a track as the AI sees it.
 *
 * Audio tracks are numbered sequentially (Track 1, Track 2, ...).
 * Bus tracks get "Master Bus" or "Bus N" labels.
 *
 * Format: "Track N (user-name)" or "Track N (Engine)" for unnamed tracks.
 * Bus format: "Master Bus" or "Bus N".
 */
export function getTrackOrdinalLabel(track: Track, audioTracks: Track[]): string {
  if (getTrackKind(track) === 'bus') {
    return track.id === MASTER_BUS_ID ? 'Master Bus' : `Bus`;
  }
  const ordinal = audioTracks.indexOf(track) + 1;
  const suffix = track.name ? track.name : getTrackLabel(track);
  return `Track ${ordinal} (${suffix})`;
}

/**
 * Resolve a trackId string that may be:
 * - An internal ID ("v0", "master-bus")
 * - An ordinal reference ("Track 1", "track 2", "1", "2")
 *
 * Returns the internal track ID, or null if unresolvable.
 */
export function resolveTrackId(ref: string, session: Session): string | null {
  // Direct match on internal ID
  if (session.tracks.some(t => t.id === ref)) return ref;

  // Try ordinal resolution: "Track 1", "track 1", or bare "1"
  const ordinalMatch = ref.match(/^(?:track\s+)?(\d+)$/i);
  if (ordinalMatch) {
    const ordinal = parseInt(ordinalMatch[1], 10);
    const audioTracks = session.tracks.filter(t => getTrackKind(t) !== 'bus');
    if (ordinal >= 1 && ordinal <= audioTracks.length) {
      return audioTracks[ordinal - 1].id;
    }
  }

  // Try "Master Bus" or "master-bus"
  if (/^master[\s-]?bus$/i.test(ref)) {
    const master = session.tracks.find(t => t.id === MASTER_BUS_ID);
    if (master) return master.id;
  }

  return null;
}
