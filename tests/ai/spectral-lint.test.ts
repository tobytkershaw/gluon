// tests/ai/spectral-lint.test.ts — Tests for proactive spectral overlap
// advisory warnings (#878).

import { describe, it, expect } from 'vitest';
import { checkSpectralOverlapAdvisory, appendSpectralAdvisory, SPECTRAL_LINT_TRACK_THRESHOLD } from '../../src/ai/spectral-lint';
import { SpectralSlotManager } from '../../src/engine/spectral-slots';
import { createSession } from '../../src/engine/session';
import { addTrack } from '../../src/engine/session';
import type { Session } from '../../src/engine/types';

/** Helper: build a session with N unmuted audio tracks. */
function sessionWithNTracks(n: number): Session {
  let session = createSession(); // starts with 1 track
  for (let i = 1; i < n; i++) {
    const result = addTrack(session, 'audio');
    if (result) session = result;
  }
  return session;
}

describe('checkSpectralOverlapAdvisory', () => {
  it('returns null when there are fewer than 3 active audio tracks', () => {
    const session = sessionWithNTracks(2);
    const slots = new SpectralSlotManager();
    expect(checkSpectralOverlapAdvisory(session, slots)).toBeNull();
  });

  it('returns null for a single track', () => {
    const session = createSession();
    const slots = new SpectralSlotManager();
    expect(checkSpectralOverlapAdvisory(session, slots)).toBeNull();
  });

  it('returns an advisory when 3 tracks exist and none are slotted', () => {
    const session = sessionWithNTracks(3);
    const slots = new SpectralSlotManager();
    const result = checkSpectralOverlapAdvisory(session, slots);
    expect(result).not.toBeNull();
    expect(result).toContain('Advisory');
    expect(result).toContain('3 active audio tracks');
    expect(result).toContain('3 lack spectral slot assignments');
  });

  it('returns an advisory when 4 tracks exist and 2 are unslotted', () => {
    const session = sessionWithNTracks(4);
    const slots = new SpectralSlotManager();
    // Assign slots to the first two tracks
    slots.assign(session.tracks[0].id, ['sub', 'low'], 9);
    slots.assign(session.tracks[1].id, ['mid', 'high_mid'], 6);
    const result = checkSpectralOverlapAdvisory(session, slots);
    expect(result).not.toBeNull();
    expect(result).toContain('4 active audio tracks');
    expect(result).toContain('2 lack spectral slot assignments');
  });

  it('returns null when all tracks have slots assigned', () => {
    const session = sessionWithNTracks(3);
    const slots = new SpectralSlotManager();
    for (const t of session.tracks) {
      slots.assign(t.id, ['mid'], 5);
    }
    expect(checkSpectralOverlapAdvisory(session, slots)).toBeNull();
  });

  it('excludes muted tracks from the count', () => {
    const session = sessionWithNTracks(4);
    // Mute two tracks — only 2 active remain (below threshold)
    session.tracks[0].muted = true;
    session.tracks[1].muted = true;
    const slots = new SpectralSlotManager();
    expect(checkSpectralOverlapAdvisory(session, slots)).toBeNull();
  });

  it('excludes bus tracks from the count', () => {
    let session = sessionWithNTracks(2);
    // Add a bus track — total is 3 tracks but only 2 audio
    const withBus = addTrack(session, 'bus');
    if (withBus) session = withBus;
    const slots = new SpectralSlotManager();
    expect(checkSpectralOverlapAdvisory(session, slots)).toBeNull();
  });

  it('includes track names in the advisory', () => {
    const session = sessionWithNTracks(3);
    session.tracks[0].name = 'Kick';
    session.tracks[1].name = 'Bass';
    session.tracks[2].name = 'Lead';
    const slots = new SpectralSlotManager();
    const result = checkSpectralOverlapAdvisory(session, slots);
    expect(result).toContain('Kick');
    expect(result).toContain('Bass');
    expect(result).toContain('Lead');
  });

  it('only lists unslotted tracks in the advisory', () => {
    const session = sessionWithNTracks(3);
    session.tracks[0].name = 'Kick';
    session.tracks[1].name = 'Bass';
    session.tracks[2].name = 'Lead';
    const slots = new SpectralSlotManager();
    slots.assign(session.tracks[0].id, ['sub'], 9);
    const result = checkSpectralOverlapAdvisory(session, slots);
    expect(result).not.toBeNull();
    expect(result).not.toContain('Kick');
    expect(result).toContain('Bass');
    expect(result).toContain('Lead');
  });
});

describe('appendSpectralAdvisory', () => {
  it('mutates response with spectralAdvisory key when advisory triggers', () => {
    const session = sessionWithNTracks(3);
    const slots = new SpectralSlotManager();
    const response: Record<string, unknown> = { queued: true };
    const advisory = appendSpectralAdvisory(response, session, slots);
    expect(advisory).not.toBeNull();
    expect(response.spectralAdvisory).toBe(advisory);
  });

  it('does not add key when no advisory needed', () => {
    const session = sessionWithNTracks(2);
    const slots = new SpectralSlotManager();
    const response: Record<string, unknown> = { queued: true };
    const advisory = appendSpectralAdvisory(response, session, slots);
    expect(advisory).toBeNull();
    expect(response).not.toHaveProperty('spectralAdvisory');
  });
});

describe('SPECTRAL_LINT_TRACK_THRESHOLD', () => {
  it('is 3', () => {
    expect(SPECTRAL_LINT_TRACK_THRESHOLD).toBe(3);
  });
});
