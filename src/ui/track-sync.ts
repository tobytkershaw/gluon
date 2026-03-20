import type { Track } from '../engine/types';

/**
 * Determines whether the track-level model/param sync should be skipped.
 * Tracks with model === -1 have no source module, so there's nothing to sync
 * at the track level — UNLESS the track is a drum-rack, where the real sound
 * sources live under track.drumRack.pads.
 *
 * Returns true when the track should skip the model/param block AND the
 * drum-rack reconciliation block (i.e. nothing to sync at all).
 */
export function shouldSkipTrackModelSync(track: Pick<Track, 'model' | 'engine'>): boolean {
  if (track.model === -1 && track.engine !== 'drum-rack') {
    return true;
  }
  return false;
}
