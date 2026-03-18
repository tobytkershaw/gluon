import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/audio-engine';

/**
 * Tests for mute/solo audio behavior (#943).
 *
 * The solo bug: clicking S highlights the button (state updates) but audio
 * doesn't change. These tests verify that muteTrack actually silences tracks
 * via the muteGain node.
 */

function makeTrackSlot(muted = false) {
  return {
    pool: null,
    sourceOut: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
    chainOutGain: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
    muteGain: { gain: { value: muted ? 0 : 1 }, connect: vi.fn(), disconnect: vi.fn() },
    processors: [],
    currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    currentModel: 0,
  };
}

describe('muteTrack', () => {
  it('uses setValueAtTime for reliable gain changes during playback', () => {
    const engine = new AudioEngine();
    const setValueAtTime = vi.fn();
    const slot = {
      ...makeTrackSlot(),
      muteGain: {
        gain: { value: 1, setValueAtTime },
        connect: vi.fn(),
        disconnect: vi.fn(),
      },
    };
    // Provide a mock AudioContext with currentTime
    (engine as unknown as { ctx: { currentTime: number } }).ctx = { currentTime: 0.5 };
    (engine as { tracks: Map<string, unknown> }).tracks = new Map([['v0', slot]]);

    engine.muteTrack('v0', true);

    // Should use setValueAtTime for reliable scheduling, not direct value assignment
    expect(setValueAtTime).toHaveBeenCalledWith(0, 0.5);
  });

  it('sets muteGain to 0 when muting a track', () => {
    const engine = new AudioEngine();
    const slot = makeTrackSlot();
    (engine as { tracks: Map<string, unknown> }).tracks = new Map([['v0', slot]]);

    engine.muteTrack('v0', true);

    expect(slot.muteGain.gain.value).toBe(0);
  });

  it('sets muteGain to 1 when unmuting a track', () => {
    const engine = new AudioEngine();
    const slot = makeTrackSlot(true);
    (engine as { tracks: Map<string, unknown> }).tracks = new Map([['v0', slot]]);

    engine.muteTrack('v0', false);

    expect(slot.muteGain.gain.value).toBe(1);
  });

  it('is a no-op for unknown track IDs', () => {
    const engine = new AudioEngine();
    // Should not throw
    engine.muteTrack('nonexistent', true);
  });
});

describe('solo via muteTrack (simulating App.tsx sync logic)', () => {
  /**
   * Simulates the useEffect in App.tsx that syncs solo state to audio:
   *   const anySoloed = tracks.some(v => v.solo);
   *   for (const track of tracks) {
   *     const audible = anySoloed ? track.solo : !track.muted;
   *     audio.muteTrack(track.id, !audible);
   *   }
   */
  function syncMuteSolo(
    engine: AudioEngine,
    tracks: Array<{ id: string; solo: boolean; muted: boolean }>,
  ) {
    const anySoloed = tracks.some(v => v.solo);
    for (const track of tracks) {
      const audible = anySoloed ? track.solo : !track.muted;
      engine.muteTrack(track.id, !audible);
    }
  }

  it('soloing one track mutes all others', () => {
    const engine = new AudioEngine();
    const slotA = makeTrackSlot();
    const slotB = makeTrackSlot();
    const slotC = makeTrackSlot();
    (engine as { tracks: Map<string, unknown> }).tracks = new Map([
      ['kick', slotA],
      ['bass', slotB],
      ['lead', slotC],
    ]);

    // Solo the kick
    syncMuteSolo(engine, [
      { id: 'kick', solo: true, muted: false },
      { id: 'bass', solo: false, muted: false },
      { id: 'lead', solo: false, muted: false },
    ]);

    expect(slotA.muteGain.gain.value).toBe(1); // kick audible (soloed)
    expect(slotB.muteGain.gain.value).toBe(0); // bass muted
    expect(slotC.muteGain.gain.value).toBe(0); // lead muted
  });

  it('unsoloing restores all tracks to audible', () => {
    const engine = new AudioEngine();
    const slotA = makeTrackSlot();
    const slotB = makeTrackSlot();
    (engine as { tracks: Map<string, unknown> }).tracks = new Map([
      ['kick', slotA],
      ['bass', slotB],
    ]);

    // Solo kick
    syncMuteSolo(engine, [
      { id: 'kick', solo: true, muted: false },
      { id: 'bass', solo: false, muted: false },
    ]);
    expect(slotB.muteGain.gain.value).toBe(0);

    // Unsolo kick
    syncMuteSolo(engine, [
      { id: 'kick', solo: false, muted: false },
      { id: 'bass', solo: false, muted: false },
    ]);
    expect(slotA.muteGain.gain.value).toBe(1);
    expect(slotB.muteGain.gain.value).toBe(1);
  });

  it('solo respects existing mute state when unsolo', () => {
    const engine = new AudioEngine();
    const slotA = makeTrackSlot();
    const slotB = makeTrackSlot();
    (engine as { tracks: Map<string, unknown> }).tracks = new Map([
      ['kick', slotA],
      ['bass', slotB],
    ]);

    // Bass is muted, no solo — bass should be silent
    syncMuteSolo(engine, [
      { id: 'kick', solo: false, muted: false },
      { id: 'bass', solo: false, muted: true },
    ]);
    expect(slotA.muteGain.gain.value).toBe(1);
    expect(slotB.muteGain.gain.value).toBe(0);
  });

  it('multiple tracks can be soloed simultaneously', () => {
    const engine = new AudioEngine();
    const slotA = makeTrackSlot();
    const slotB = makeTrackSlot();
    const slotC = makeTrackSlot();
    (engine as { tracks: Map<string, unknown> }).tracks = new Map([
      ['kick', slotA],
      ['bass', slotB],
      ['lead', slotC],
    ]);

    // Solo kick and bass
    syncMuteSolo(engine, [
      { id: 'kick', solo: true, muted: false },
      { id: 'bass', solo: true, muted: false },
      { id: 'lead', solo: false, muted: false },
    ]);

    expect(slotA.muteGain.gain.value).toBe(1); // kick audible
    expect(slotB.muteGain.gain.value).toBe(1); // bass audible
    expect(slotC.muteGain.gain.value).toBe(0); // lead muted
  });
});
