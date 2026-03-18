// tests/ai/infer-bars.test.ts — Tests for listen/render bar inference from pattern duration.

import { describe, it, expect } from 'vitest';
import { inferBarsFromPatterns } from '../../src/ai/api';
import { createSession } from '../../src/engine/session';
import type { Session } from '../../src/engine/types';
import { getActivePattern } from '../../src/engine/types';

function sessionWithPatternDuration(duration: number, trackId = 'v0'): Session {
  const session = createSession();
  const track = session.tracks.find(t => t.id === trackId)!;
  track.patterns[0] = { ...getActivePattern(track), duration };
  return session;
}

function sessionWithMultipleTracks(durations: number[]): Session {
  const session = createSession();
  // Start with the default track (v0) and add more as needed
  for (let i = 0; i < durations.length; i++) {
    if (i >= session.tracks.length) break;
    const track = session.tracks[i];
    if (track.patterns.length > 0) {
      track.patterns[0] = { ...getActivePattern(track), duration: durations[i] };
    }
  }
  return session;
}

describe('inferBarsFromPatterns', () => {
  it('returns 2 when no tracks exist', () => {
    const session = createSession();
    session.tracks = [];
    expect(inferBarsFromPatterns(session)).toBe(2);
  });

  it('returns 2 when trackIds are provided but none match', () => {
    const session = createSession();
    expect(inferBarsFromPatterns(session, ['nonexistent'])).toBe(2);
  });

  it('infers 1 bar from default 16-step pattern', () => {
    const session = sessionWithPatternDuration(16);
    expect(inferBarsFromPatterns(session, ['v0'])).toBe(1);
  });

  it('infers 4 bars from a 64-step pattern', () => {
    const session = sessionWithPatternDuration(64);
    expect(inferBarsFromPatterns(session, ['v0'])).toBe(4);
  });

  it('infers 2 bars from a 32-step pattern', () => {
    const session = sessionWithPatternDuration(32);
    expect(inferBarsFromPatterns(session, ['v0'])).toBe(2);
  });

  it('floors partial bars (e.g. 48 steps = 3 bars)', () => {
    const session = sessionWithPatternDuration(48);
    expect(inferBarsFromPatterns(session, ['v0'])).toBe(3);
  });

  it('uses maximum across all tracks when no trackIds specified', () => {
    // Default session has v0 (audio) and master (bus)
    const session = sessionWithPatternDuration(64);
    // v0 has 64-step pattern (4 bars), master has default 16-step (1 bar)
    expect(inferBarsFromPatterns(session)).toBe(4);
  });

  it('uses maximum across specified tracks', () => {
    const session = createSession();
    // v0 = 32 steps (2 bars)
    const track0 = session.tracks.find(t => t.id === 'v0')!;
    track0.patterns[0] = { ...getActivePattern(track0), duration: 32 };

    // Add another audio track manually for this test
    const track1 = { ...track0, id: 'v1', patterns: [{ ...getActivePattern(track0), id: 'v1-pattern-0', duration: 64 }] };
    session.tracks.push(track1);

    // Only v0 and v1 — should pick the max (64 steps = 4 bars)
    expect(inferBarsFromPatterns(session, ['v0', 'v1'])).toBe(4);
    // Only v0 — should be 2 bars
    expect(inferBarsFromPatterns(session, ['v0'])).toBe(2);
  });

  it('returns 2 when tracks have no patterns', () => {
    const session = createSession();
    session.tracks[0].patterns = [];
    // Remove the master bus patterns too
    for (const t of session.tracks) t.patterns = [];
    expect(inferBarsFromPatterns(session)).toBe(2);
  });

  it('minimum is 1 bar even for very short patterns', () => {
    const session = sessionWithPatternDuration(4);
    expect(inferBarsFromPatterns(session, ['v0'])).toBe(1);
  });
});
