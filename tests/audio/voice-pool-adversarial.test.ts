// tests/audio/voice-pool-adversarial.test.ts
//
// Adversarial tests for voice pool and audio engine state management.
// Issue #865: stress-test allocation, stealing, generation, and cleanup invariants.

import { describe, it, expect, vi } from 'vitest';
import { VoicePool, ACCENT_BASELINE, STEAL_RAMP_TIME } from '../../src/audio/voice-pool';
import type { PoolVoice } from '../../src/audio/voice-pool';
import { AudioEngine } from '../../src/audio/audio-engine';
import type { ScheduledNote } from '../../src/engine/sequencer-types';

// ---------------------------------------------------------------------------
// Helpers — mock factories (same shape as existing audio tests)
// ---------------------------------------------------------------------------

function mockSynth() {
  return {
    scheduleNote: vi.fn(),
    setModel: vi.fn(),
    setParams: vi.fn(),
    setExtended: vi.fn(),
    silence: vi.fn(),
    destroy: vi.fn(),
    workletNode: undefined,
  };
}

function mockGainParam() {
  return {
    value: ACCENT_BASELINE,
    setValueAtTime: vi.fn(),
    cancelAndHoldAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

function mockAccentGain() {
  return {
    gain: mockGainParam(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function makePoolVoice(overrides?: Partial<PoolVoice>): PoolVoice {
  return {
    synth: mockSynth() as unknown as PoolVoice['synth'],
    accentGain: mockAccentGain() as unknown as GainNode,
    lastNoteTime: 0,
    lastGateOffTime: 0,
    ...overrides,
  };
}

function makeNote(
  time: number,
  gateOffTime: number,
  overrides?: Partial<ScheduledNote>,
): ScheduledNote {
  return {
    trackId: 't0',
    time,
    gateOffTime,
    accent: false,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    ...overrides,
  };
}

function makePool(count: number): VoicePool {
  return new VoicePool(Array.from({ length: count }, () => makePoolVoice()));
}

// AudioEngine helpers (same pattern as audio-engine.test.ts)

function mockGainNode() {
  return {
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      cancelAndHoldAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function makeTrackSlot(pool?: VoicePool) {
  return {
    pool: pool ?? makePool(4),
    sourceOut: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
    chainOutGain: mockGainNode(),
    trackVolume: { gain: { value: 0.8 }, connect: vi.fn(), disconnect: vi.fn() },
    trackPanner: { pan: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() },
    muteGain: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
    busInput: null,
    analyser: { fftSize: 256, connect: vi.fn(), disconnect: vi.fn() },
    processors: [] as unknown[],
    currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    currentModel: 0,
    isBus: false,
    isDrumRack: false,
    drumPads: new Map(),
  };
}

function makeBusSlot() {
  return {
    pool: null,
    sourceOut: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
    chainOutGain: mockGainNode(),
    trackVolume: { gain: { value: 0.8 }, connect: vi.fn(), disconnect: vi.fn() },
    trackPanner: { pan: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() },
    muteGain: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
    busInput: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
    analyser: { fftSize: 256, connect: vi.fn(), disconnect: vi.fn() },
    processors: [] as unknown[],
    currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    currentModel: 0,
    isBus: true,
    isDrumRack: false,
    drumPads: new Map(),
  };
}

function injectTracks(
  engine: AudioEngine,
  entries: [string, ReturnType<typeof makeTrackSlot> | ReturnType<typeof makeBusSlot>][],
) {
  const tracks = engine as unknown as { tracks: Map<string, unknown> };
  tracks.tracks = new Map(entries);
}

function injectCtx(engine: AudioEngine, currentTime: number) {
  (engine as unknown as { ctx: { currentTime: number } }).ctx = { currentTime };
}

function injectModulatorSlots(engine: AudioEngine, entries: [string, unknown[]][]) {
  (engine as { modulatorSlots: Map<string, unknown[]> }).modulatorSlots = new Map(entries);
}

// =========================================================================
// VoicePool adversarial tests
// =========================================================================

describe('VoicePool adversarial', () => {
  // -----------------------------------------------------------------------
  // More simultaneous notes than available voices — voice stealing
  // -----------------------------------------------------------------------

  describe('polyphony explosion — more notes than voices', () => {
    it('pool never exceeds capacity regardless of note count', () => {
      const pool = makePool(4);
      const allocated: PoolVoice[] = [];

      // Schedule 20 simultaneous active notes on a 4-voice pool
      for (let i = 0; i < 20; i++) {
        const v = pool.scheduleNote(makeNote(1.0 + i * 0.01, 10.0), 1, `evt-${i}`);
        allocated.push(v);
      }

      // INVARIANT: every returned voice is one of the 4 pool voices
      const unique = new Set(allocated);
      expect(unique.size).toBeLessThanOrEqual(4);
      for (const v of allocated) {
        expect(pool.voices).toContain(v);
      }
    });

    it('all voices stolen simultaneously — round-robin continues cycling', () => {
      const pool = makePool(2);

      // Fill both voices
      pool.scheduleNote(makeNote(1.0, 5.0), 1, 'a');
      pool.scheduleNote(makeNote(1.1, 5.0), 1, 'b');

      // Steal both in one burst — should round-robin through 0, 1
      const stolen1 = pool.scheduleNote(makeNote(1.2, 5.0), 1, 'c');
      const stolen2 = pool.scheduleNote(makeNote(1.3, 5.0), 1, 'd');

      expect(stolen1).toBe(pool.voices[0]);
      expect(stolen2).toBe(pool.voices[1]);

      // Steal ramps applied to both
      const g0 = pool.voices[0].accentGain.gain as unknown as { cancelAndHoldAtTime: ReturnType<typeof vi.fn> };
      const g1 = pool.voices[1].accentGain.gain as unknown as { cancelAndHoldAtTime: ReturnType<typeof vi.fn> };
      expect(g0.cancelAndHoldAtTime).toHaveBeenCalled();
      expect(g1.cancelAndHoldAtTime).toHaveBeenCalled();
    });

    it('8-voice pool with 32 simultaneous notes — no voice index out of bounds', () => {
      const pool = makePool(8);
      for (let i = 0; i < 32; i++) {
        const v = pool.allocate(1.0);
        expect(pool.voices.indexOf(v)).toBeGreaterThanOrEqual(0);
        expect(pool.voices.indexOf(v)).toBeLessThan(8);
        // Simulate active note
        v.lastGateOffTime = 10.0;
      }
    });
  });

  // -----------------------------------------------------------------------
  // Rapid note-on/note-off faster than release — no zombie voices
  // -----------------------------------------------------------------------

  describe('rapid note-on/note-off — no zombie voices', () => {
    it('notes with gate duration shorter than STEAL_RAMP_TIME', () => {
      const pool = makePool(2);

      // Extremely short notes — gateOff barely after time
      for (let i = 0; i < 10; i++) {
        const t = 1.0 + i * 0.001;
        pool.scheduleNote(makeNote(t, t + 0.0005), 1, `rapid-${i}`);
      }

      // All voices still belong to the pool
      expect(pool.voices.length).toBe(2);
      // Each voice should have been used multiple times
      const totalCalls =
        (pool.voices[0].synth.scheduleNote as ReturnType<typeof vi.fn>).mock.calls.length +
        (pool.voices[1].synth.scheduleNote as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(totalCalls).toBe(10);
    });

    it('zero-duration notes (gateOffTime === time) do not corrupt state', () => {
      const pool = makePool(4);

      for (let i = 0; i < 8; i++) {
        const t = 1.0 + i * 0.05;
        pool.scheduleNote(makeNote(t, t), 1, `zero-${i}`);
      }

      // INVARIANT: pool size unchanged
      expect(pool.voices.length).toBe(4);

      // All event mappings still accessible (last 4 overwrite first 4 via round-robin)
      for (let i = 4; i < 8; i++) {
        expect(pool.getVoiceForEvent(`zero-${i}`)).toBeDefined();
      }
    });

    it('event map entries are overwritten when voice is re-allocated', () => {
      const pool = makePool(1);

      pool.scheduleNote(makeNote(1.0, 1.5), 1, 'first');
      expect(pool.getVoiceForEvent('first')).toBe(pool.voices[0]);

      // Second note steals the same voice — 'first' mapping should remain
      // (the map uses eventId as key, not voice)
      pool.scheduleNote(makeNote(1.1, 1.6), 1, 'second');
      expect(pool.getVoiceForEvent('second')).toBe(pool.voices[0]);
      // 'first' still in the map (it's a different key)
      expect(pool.getVoiceForEvent('first')).toBe(pool.voices[0]);
    });
  });

  // -----------------------------------------------------------------------
  // Model change during playback
  // -----------------------------------------------------------------------

  describe('model change during playback', () => {
    it('setModel broadcasts to all voices including those with active notes', () => {
      const pool = makePool(4);

      // Schedule active notes on all 4 voices
      for (let i = 0; i < 4; i++) {
        pool.scheduleNote(makeNote(1.0 + i * 0.1, 5.0), 1, `active-${i}`);
      }

      // Change model mid-playback
      pool.setModel(7);

      for (const voice of pool.voices) {
        expect(voice.synth.setModel).toHaveBeenCalledWith(7);
      }
    });

    it('setParams during active notes does not clear event map', () => {
      const pool = makePool(2);
      pool.scheduleNote(makeNote(1.0, 5.0), 1, 'evt-1');

      pool.setParams({ harmonics: 0.8, timbre: 0.2, morph: 0.6, note: 0.3 });

      // Event mapping still intact
      expect(pool.getVoiceForEvent('evt-1')).toBe(pool.voices[0]);
    });
  });

  // -----------------------------------------------------------------------
  // Gate-off for a voice already stolen
  // -----------------------------------------------------------------------

  describe('gate-off for already-stolen voice', () => {
    it('releaseEvent on a stolen voice ID is a no-op (returns undefined)', () => {
      const pool = makePool(1);

      pool.scheduleNote(makeNote(1.0, 5.0), 1, 'original');
      pool.scheduleNote(makeNote(1.1, 5.0), 1, 'stealer');

      // Both map to the same voice, but releaseEvent only removes the key
      pool.releaseEvent('original');
      expect(pool.getVoiceForEvent('original')).toBeUndefined();
      // 'stealer' still mapped
      expect(pool.getVoiceForEvent('stealer')).toBe(pool.voices[0]);
    });

    it('releaseEvent on non-existent ID does not throw', () => {
      const pool = makePool(2);
      expect(() => pool.releaseEvent('does-not-exist')).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Generation mechanism — clearEventMap
  // -----------------------------------------------------------------------

  describe('generation mechanism prevents stale events', () => {
    it('clearEventMap wipes all entries regardless of voice count', () => {
      const pool = makePool(4);

      for (let i = 0; i < 4; i++) {
        pool.scheduleNote(makeNote(1.0 + i * 0.1, 5.0), 1, `gen-${i}`);
      }

      pool.clearEventMap();

      for (let i = 0; i < 4; i++) {
        expect(pool.getVoiceForEvent(`gen-${i}`)).toBeUndefined();
      }
    });

    it('new notes after clearEventMap work normally', () => {
      const pool = makePool(2);

      pool.scheduleNote(makeNote(1.0, 5.0), 1, 'old');
      pool.clearEventMap();
      pool.scheduleNote(makeNote(2.0, 6.0), 2, 'new');

      expect(pool.getVoiceForEvent('old')).toBeUndefined();
      expect(pool.getVoiceForEvent('new')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Every allocated voice is eventually released or stolen
  // -----------------------------------------------------------------------

  describe('no leaked voices', () => {
    it('releaseAll clears event map even with maxed-out voice count', () => {
      const pool = makePool(8);

      for (let i = 0; i < 16; i++) {
        pool.scheduleNote(makeNote(1.0 + i * 0.01, 10.0), 1, `leak-${i}`);
      }

      pool.releaseAll(2, 0, 0.05);

      // Every event should be cleared
      for (let i = 0; i < 16; i++) {
        expect(pool.getVoiceForEvent(`leak-${i}`)).toBeUndefined();
      }
    });

    it('silenceAll clears event map even with maxed-out voice count', () => {
      const pool = makePool(8);

      for (let i = 0; i < 16; i++) {
        pool.scheduleNote(makeNote(1.0 + i * 0.01, 10.0), 1, `leak-${i}`);
      }

      pool.silenceAll(2, 0);

      for (let i = 0; i < 16; i++) {
        expect(pool.getVoiceForEvent(`leak-${i}`)).toBeUndefined();
      }
    });

    it('destroy cleans up all voices even after heavy allocation', () => {
      const pool = makePool(4);

      for (let i = 0; i < 20; i++) {
        pool.scheduleNote(makeNote(1.0 + i * 0.01, 10.0), 1, `destroy-${i}`);
      }

      pool.destroy();

      for (const voice of pool.voices) {
        expect(voice.synth.destroy).toHaveBeenCalledTimes(1);
        expect(voice.accentGain.disconnect).toHaveBeenCalledTimes(1);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Maximum polyphony with maximum voices — stress test
  // -----------------------------------------------------------------------

  describe('stress: large pool with many notes', () => {
    it('100 notes on 16-voice pool — no crash, voices stay within pool', () => {
      const pool = makePool(16);

      for (let i = 0; i < 100; i++) {
        const v = pool.scheduleNote(makeNote(i * 0.01, i * 0.01 + 0.5), 1, `stress-${i}`);
        expect(pool.voices).toContain(v);
      }

      // Total scheduleNote calls across all voices should be 100
      const totalCalls = pool.voices.reduce(
        (sum, v) => sum + (v.synth.scheduleNote as ReturnType<typeof vi.fn>).mock.calls.length,
        0,
      );
      expect(totalCalls).toBe(100);
    });
  });
});

// =========================================================================
// AudioEngine adversarial tests
// =========================================================================

describe('AudioEngine adversarial', () => {
  // -----------------------------------------------------------------------
  // Voice allocation with mixed audio/bus tracks
  // -----------------------------------------------------------------------

  describe('mixed audio/bus tracks', () => {
    it('scheduleNote on a bus track is silently ignored (no voice pool)', () => {
      const engine = new AudioEngine();
      injectTracks(engine, [
        ['audio-1', makeTrackSlot()],
        ['bus-1', makeBusSlot()],
      ]);

      // Should not throw — bus tracks have pool === null
      engine.scheduleNote(makeNote(1.0, 1.5, { trackId: 'bus-1' }));
      expect(engine.getActiveVoices()).toEqual([]);
    });

    it('scheduleNote on audio track works alongside bus tracks', () => {
      const engine = new AudioEngine();
      const pool = makePool(4);
      injectTracks(engine, [
        ['audio-1', makeTrackSlot(pool)],
        ['bus-1', makeBusSlot()],
      ]);

      engine.scheduleNote(makeNote(1.0, 1.5, { trackId: 'audio-1', eventId: 'evt-1' }));
      const voices = engine.getActiveVoices();
      expect(voices.length).toBe(1);
      expect(voices[0].trackId).toBe('audio-1');
    });
  });

  // -----------------------------------------------------------------------
  // Generation mismatch — old generation events after new generation
  // -----------------------------------------------------------------------

  describe('generation mismatch', () => {
    it('silenceGeneration advances generation and marks voices silenced', () => {
      const engine = new AudioEngine();
      const pool = makePool(4);
      injectCtx(engine, 0);
      injectTracks(engine, [['t0', { ...makeTrackSlot(pool), processors: [] }]]);
      injectModulatorSlots(engine, []);

      engine.scheduleNote(makeNote(0.1, 5.0, { eventId: 'old-gen', trackId: 't0' }), 0);
      expect(engine.getGeneration()).toBe(0);

      engine.silenceGeneration(1);
      expect(engine.getGeneration()).toBe(1);

      // Old-generation voices should be gone (pruned because state is 'silenced')
      expect(engine.getActiveVoices()).toEqual([]);
    });

    it('notes scheduled after generation advance use new generation', () => {
      const engine = new AudioEngine();
      const pool = makePool(4);
      injectCtx(engine, 0);
      injectTracks(engine, [['t0', { ...makeTrackSlot(pool), processors: [] }]]);
      injectModulatorSlots(engine, []);

      engine.silenceGeneration(3);

      engine.scheduleNote(makeNote(1.0, 2.0, { eventId: 'new-gen', trackId: 't0' }));
      const voices = engine.getActiveVoices();
      expect(voices.length).toBe(1);
      expect(voices[0].generation).toBe(3);
    });

    it('advanceGeneration increments monotonically', () => {
      const engine = new AudioEngine();
      expect(engine.getGeneration()).toBe(0);
      expect(engine.advanceGeneration()).toBe(1);
      expect(engine.advanceGeneration()).toBe(2);
      expect(engine.advanceGeneration()).toBe(3);
    });

    it('releaseGeneration marks matching voices as released (pruned on next query)', () => {
      const engine = new AudioEngine();
      const pool = makePool(4);
      injectCtx(engine, 0);
      injectTracks(engine, [['t0', { ...makeTrackSlot(pool), processors: [] }]]);
      injectModulatorSlots(engine, []);

      engine.scheduleNote(makeNote(0.1, 5.0, { eventId: 'rel-1', trackId: 't0' }), 1);
      engine.releaseGeneration(2);

      // Released voices are pruned
      expect(engine.getActiveVoices()).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // No dangling voice references after track deletion
  // -----------------------------------------------------------------------

  describe('track deletion cleans up voices', () => {
    it('removeTrack clears active voices for that track', () => {
      const engine = new AudioEngine();
      const pool = makePool(4);
      injectCtx(engine, 0);
      injectTracks(engine, [['t0', makeTrackSlot(pool)]]);

      engine.scheduleNote(makeNote(0.1, 5.0, { eventId: 'doomed', trackId: 't0' }));
      expect(engine.getActiveVoices().length).toBe(1);

      engine.removeTrack('t0');

      // INVARIANT: no dangling voice references
      expect(engine.getActiveVoices()).toEqual([]);
      expect(engine.hasTrack('t0')).toBe(false);
    });

    it('removeTrack on non-existent track does not throw', () => {
      const engine = new AudioEngine();
      injectTracks(engine, []);
      expect(() => engine.removeTrack('ghost')).not.toThrow();
    });

    it('scheduleNote after removeTrack is silently ignored', () => {
      const engine = new AudioEngine();
      const pool = makePool(4);
      injectTracks(engine, [['t0', makeTrackSlot(pool)]]);
      engine.removeTrack('t0');

      engine.scheduleNote(makeNote(1.0, 2.0, { eventId: 'post-delete', trackId: 't0' }));
      expect(engine.getActiveVoices()).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Processor state consistency during hot-swap
  // -----------------------------------------------------------------------

  describe('processor hot-swap during active notes', () => {
    it('removeProcessor during active notes does not crash', () => {
      const engine = new AudioEngine();
      const pool = makePool(4);
      const procNode = { connect: vi.fn(), disconnect: vi.fn() };
      const procSlot = {
        id: 'rings-0',
        type: 'rings' as const,
        engine: {
          role: 'processor',
          inputNode: procNode,
          outputNode: procNode,
          destroy: vi.fn(),
          setPatch: vi.fn(),
          setModel: vi.fn(),
          sendCommand: vi.fn(),
          silence: vi.fn(),
        },
        enabled: true,
      };

      const slot = {
        ...makeTrackSlot(pool),
        processors: [procSlot],
      };
      injectTracks(engine, [['t0', slot]]);

      // Schedule notes on the track
      engine.scheduleNote(makeNote(0.1, 5.0, { eventId: 'during-swap', trackId: 't0' }));

      // Remove the processor while notes are active
      engine.removeProcessor('t0', 'rings-0');

      expect(procSlot.engine.destroy).toHaveBeenCalled();
      expect(slot.processors).toHaveLength(0);

      // Notes should still be active (processor removal doesn't kill voices)
      expect(engine.getActiveVoices().length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Processor bypass toggle during active signal
  // -----------------------------------------------------------------------

  describe('processor bypass toggle', () => {
    it('setProcessorEnabled toggles enabled state without destroying', () => {
      const engine = new AudioEngine();
      const pool = makePool(4);
      const procNode = { connect: vi.fn(), disconnect: vi.fn() };
      const procSlot = {
        id: 'rings-0',
        type: 'rings' as const,
        engine: {
          role: 'processor',
          inputNode: procNode,
          outputNode: procNode,
          destroy: vi.fn(),
          setPatch: vi.fn(),
          setModel: vi.fn(),
          sendCommand: vi.fn(),
          silence: vi.fn(),
        },
        enabled: true,
      };

      const slot = {
        ...makeTrackSlot(pool),
        processors: [procSlot],
      };
      injectTracks(engine, [['t0', slot]]);

      engine.scheduleNote(makeNote(0.1, 5.0, { eventId: 'bypass-test', trackId: 't0' }));

      // Bypass the processor (enabled=false)
      engine.setProcessorEnabled('t0', 'rings-0', false);
      expect(procSlot.enabled).toBe(false);

      // Processor should NOT be destroyed
      expect(procSlot.engine.destroy).not.toHaveBeenCalled();

      // Un-bypass (enabled=true)
      engine.setProcessorEnabled('t0', 'rings-0', true);
      expect(procSlot.enabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple tracks with independent voice pools
  // -----------------------------------------------------------------------

  describe('multi-track isolation', () => {
    it('voice pools are independent across tracks', () => {
      const engine = new AudioEngine();
      const poolA = makePool(2);
      const poolB = makePool(2);
      injectTracks(engine, [
        ['trackA', makeTrackSlot(poolA)],
        ['trackB', makeTrackSlot(poolB)],
      ]);

      engine.scheduleNote(makeNote(1.0, 5.0, { eventId: 'A-1', trackId: 'trackA' }));
      engine.scheduleNote(makeNote(1.0, 5.0, { eventId: 'B-1', trackId: 'trackB' }));

      // Each track's pool independently allocated
      expect(poolA.getVoiceForEvent('A-1')).toBe(poolA.voices[0]);
      expect(poolB.getVoiceForEvent('B-1')).toBe(poolB.voices[0]);

      // Deleting trackA does not affect trackB
      engine.removeTrack('trackA');
      expect(engine.getActiveVoices().length).toBe(1);
      expect(engine.getActiveVoices()[0].trackId).toBe('trackB');
    });

    it('silenceGeneration affects all tracks', () => {
      const engine = new AudioEngine();
      const poolA = makePool(2);
      const poolB = makePool(2);
      injectCtx(engine, 0);
      injectTracks(engine, [
        ['trackA', { ...makeTrackSlot(poolA), processors: [] }],
        ['trackB', { ...makeTrackSlot(poolB), processors: [] }],
      ]);
      injectModulatorSlots(engine, []);

      engine.scheduleNote(makeNote(0.1, 5.0, { eventId: 'A-1', trackId: 'trackA' }), 0);
      engine.scheduleNote(makeNote(0.1, 5.0, { eventId: 'B-1', trackId: 'trackB' }), 0);

      engine.silenceGeneration(1);

      // Both pools silenced
      expect(poolA.voices[0].synth.silence).toHaveBeenCalledWith(1);
      expect(poolB.voices[0].synth.silence).toHaveBeenCalledWith(1);
      expect(engine.getActiveVoices()).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Pruning: voices are pruned after tail grace period
  // -----------------------------------------------------------------------

  describe('voice pruning', () => {
    it('voices past gateOff + tail grace are pruned from active list', () => {
      const engine = new AudioEngine();
      const pool = makePool(4);

      // Set currentTime well past gateOff + grace (2s)
      injectCtx(engine, 10.0);
      injectTracks(engine, [['t0', makeTrackSlot(pool)]]);

      engine.scheduleNote(makeNote(0.1, 0.5, { eventId: 'old-note', trackId: 't0' }));

      // getActiveVoices triggers pruning — note gateOff 0.5 + 2.0 grace = 2.5 < 10.0
      expect(engine.getActiveVoices()).toEqual([]);
    });

    it('voices within tail grace remain active', () => {
      const engine = new AudioEngine();
      const pool = makePool(4);

      // currentTime just after gateOff but within grace
      injectCtx(engine, 1.5);
      injectTracks(engine, [['t0', makeTrackSlot(pool)]]);

      engine.scheduleNote(makeNote(0.1, 0.5, { eventId: 'recent-note', trackId: 't0' }));

      // gateOff 0.5 + 2.0 grace = 2.5 > 1.5 — should still be active
      const voices = engine.getActiveVoices();
      expect(voices.length).toBe(1);
      expect(voices[0].eventId).toBe('recent-note');
    });
  });

  // -----------------------------------------------------------------------
  // releaseTrack — keyboard note-off
  // -----------------------------------------------------------------------

  describe('releaseTrack (keyboard note-off)', () => {
    it('releaseTrack marks all active voices for that track as released', () => {
      const engine = new AudioEngine();
      const pool = makePool(4);
      injectCtx(engine, 1.0);
      injectTracks(engine, [['t0', makeTrackSlot(pool)]]);

      engine.scheduleNote(makeNote(0.1, 5.0, { eventId: 'kb-1', trackId: 't0' }));
      engine.scheduleNote(makeNote(0.2, 5.0, { eventId: 'kb-2', trackId: 't0' }));

      engine.releaseTrack('t0');

      // Released voices are pruned on next getActiveVoices call
      expect(engine.getActiveVoices()).toEqual([]);
    });

    it('releaseTrack on bus track does not throw', () => {
      const engine = new AudioEngine();
      injectTracks(engine, [['bus-1', makeBusSlot()]]);
      expect(() => engine.releaseTrack('bus-1')).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // scheduleNote to non-existent track
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('scheduleNote to non-existent track is silently ignored', () => {
      const engine = new AudioEngine();
      injectTracks(engine, []);

      engine.scheduleNote(makeNote(1.0, 2.0, { trackId: 'ghost' }));
      expect(engine.getActiveVoices()).toEqual([]);
    });

    it('duplicate eventIds overwrite in active voice map', () => {
      const engine = new AudioEngine();
      const pool = makePool(4);
      injectTracks(engine, [['t0', makeTrackSlot(pool)]]);

      engine.scheduleNote(makeNote(1.0, 5.0, { eventId: 'dup', trackId: 't0' }));
      engine.scheduleNote(makeNote(2.0, 6.0, { eventId: 'dup', trackId: 't0' }));

      // Only one entry for 'dup' in active voices
      const voices = engine.getActiveVoices();
      const dups = voices.filter(v => v.eventId === 'dup');
      expect(dups.length).toBe(1);
      expect(dups[0].noteTime).toBe(2.0);
    });

    it('restoreBaseline after silenceAll resets all accent gains', () => {
      const engine = new AudioEngine();
      const pool = makePool(4);
      injectCtx(engine, 1.0);
      injectTracks(engine, [['t0', { ...makeTrackSlot(pool), processors: [] }]]);
      injectModulatorSlots(engine, []);

      engine.scheduleNote(makeNote(0.1, 5.0, { eventId: 'restore-test', trackId: 't0' }), 0);
      engine.silenceGeneration(1);
      engine.restoreBaseline();

      for (const voice of pool.voices) {
        const gain = voice.accentGain.gain as unknown as { setValueAtTime: ReturnType<typeof vi.fn> };
        // Last call should be restoreBaseline setting ACCENT_BASELINE
        const calls = gain.setValueAtTime.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0]).toBe(ACCENT_BASELINE);
      }
    });
  });
});
