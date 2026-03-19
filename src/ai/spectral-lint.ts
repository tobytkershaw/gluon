// src/ai/spectral-lint.ts — Advisory spectral overlap warnings.
//
// "Lint, don't gate": when 3+ audio tracks are active and spectral slots
// have not been assigned, tool results include an informational warning
// suggesting the AI consider spectral slotting. The AI is free to ignore it.

import type { Session } from '../engine/types';
import { getTrackKind } from '../engine/types';
import type { SpectralSlotManager } from '../engine/spectral-slots';

/** Threshold: only warn when active audio tracks reach this count. */
export const SPECTRAL_LINT_TRACK_THRESHOLD = 3;

/**
 * Check whether the current session warrants a spectral overlap advisory.
 *
 * Returns a warning string if:
 * 1. There are >= SPECTRAL_LINT_TRACK_THRESHOLD active (non-muted) audio tracks
 * 2. Not all of those tracks have spectral slot assignments
 *
 * Returns null if no warning is needed.
 */
export function checkSpectralOverlapAdvisory(
  session: Session,
  spectralSlots: SpectralSlotManager,
): string | null {
  // Count active (non-muted) audio tracks
  const activeAudioTracks = session.tracks.filter(
    t => getTrackKind(t) === 'audio' && !t.muted,
  );

  if (activeAudioTracks.length < SPECTRAL_LINT_TRACK_THRESHOLD) {
    return null;
  }

  // Check which active tracks lack spectral slot assignments
  const unslottedTracks = activeAudioTracks.filter(
    t => !spectralSlots.get(t.id),
  );

  if (unslottedTracks.length === 0) {
    // All active tracks have slots assigned — no warning needed
    return null;
  }

  const unslottedNames = unslottedTracks
    .map(t => t.name ?? t.id)
    .join(', ');

  const totalActive = activeAudioTracks.length;

  return (
    `Advisory: ${totalActive} active audio tracks and ${unslottedTracks.length} ` +
    `lack spectral slot assignments (${unslottedNames}). ` +
    `Consider using assign_spectral_slot to allocate frequency bands — ` +
    `this helps prevent masking between tracks sharing the same frequency range.`
  );
}

/**
 * If an advisory is warranted, attach it to the response object
 * under the `spectralAdvisory` key. Mutates the response in place
 * for convenience, and also returns the advisory string (or null).
 */
export function appendSpectralAdvisory(
  response: Record<string, unknown>,
  session: Session,
  spectralSlots: SpectralSlotManager,
): string | null {
  const advisory = checkSpectralOverlapAdvisory(session, spectralSlots);
  if (advisory) {
    response.spectralAdvisory = advisory;
  }
  return advisory;
}
