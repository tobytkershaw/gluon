import { describe, it, expect } from 'vitest';
import { shouldSkipTrackModelSync } from '../../src/ui/track-sync';

describe('shouldSkipTrackModelSync', () => {
  it('skips regular tracks with model -1 (no source module)', () => {
    expect(shouldSkipTrackModelSync({ model: -1, engine: 'plaits' })).toBe(true);
  });

  it('does not skip tracks with a valid model', () => {
    expect(shouldSkipTrackModelSync({ model: 3, engine: 'plaits' })).toBe(false);
  });

  it('does NOT skip drum-rack tracks even when model is -1 (#1129)', () => {
    // Drum-rack tracks use model: -1 at the track level because their
    // real sound sources live under track.drumRack.pads. The sync effect
    // must still reach the drum-rack pad reconciliation block.
    expect(shouldSkipTrackModelSync({ model: -1, engine: 'drum-rack' })).toBe(false);
  });
});
