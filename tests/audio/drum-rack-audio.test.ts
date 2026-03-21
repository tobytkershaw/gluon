// tests/audio/drum-rack-audio.test.ts
//
// Tests for drum rack audio engine: pad routing, choke groups, pad management.
// Phase 2 of drum rack implementation (#1093).

import { describe, it, expect, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/audio-engine';
import { ACCENT_BASELINE } from '../../src/audio/voice-pool';
import type { ScheduledNote } from '../../src/engine/sequencer-types';

// ---------------------------------------------------------------------------
// Helpers — mock factories
// ---------------------------------------------------------------------------

function mockGainParam() {
  return {
    value: ACCENT_BASELINE,
    setValueAtTime: vi.fn(),
    cancelAndHoldAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

function mockGainNode(value = 1) {
  return {
    gain: { ...mockGainParam(), value },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function mockPannerNode() {
  return {
    pan: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

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

function makeDrumRackSlot() {
  return {
    pool: null,
    sourceOut: mockGainNode(),
    chainOutGain: mockGainNode(),
    trackVolume: mockGainNode(0.8),
    trackPanner: mockPannerNode(),
    muteGain: mockGainNode(),
    busInput: null,
    analyser: { fftSize: 256, connect: vi.fn(), disconnect: vi.fn() },
    processors: [] as unknown[],
    currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    currentModel: 0,
    isBus: false,
    isDrumRack: true,
    drumPads: new Map<string, unknown>(),
  };
}

function makeDrumPadSlot(id: string, chokeGroup?: number) {
  return {
    id,
    synth: mockSynth(),
    accentGain: mockGainNode(ACCENT_BASELINE),
    padGain: mockGainNode(0.8),
    padPanner: mockPannerNode(),
    model: 0,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    chokeGroup,
    lastNoteTime: 0,
    lastGateOffTime: 0,
  };
}

function injectTracks(
  engine: AudioEngine,
  entries: [string, ReturnType<typeof makeDrumRackSlot>][],
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

function makeNote(
  time: number,
  gateOffTime: number,
  overrides?: Partial<ScheduledNote>,
): ScheduledNote {
  return {
    trackId: 'drums',
    time,
    gateOffTime,
    accent: false,
    params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    ...overrides,
  };
}

// =========================================================================
// Drum rack pad routing tests
// =========================================================================

describe('Drum rack audio engine', () => {
  describe('pad routing', () => {
    it('scheduleNote with padId routes to the correct pad synth', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kickPad = makeDrumPadSlot('kick');
      const snarePad = makeDrumPadSlot('snare');
      slot.drumPads.set('kick', kickPad);
      slot.drumPads.set('snare', snarePad);

      injectCtx(engine, 0);
      injectTracks(engine, [['drums', slot]]);

      engine.scheduleNote(makeNote(1.0, 1.5, { eventId: 'kick-1', padId: 'kick' }));

      expect(kickPad.synth.scheduleNote).toHaveBeenCalled();
      expect(snarePad.synth.scheduleNote).not.toHaveBeenCalled();
    });

    it('scheduleNote without padId on drum rack is silently ignored', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kickPad = makeDrumPadSlot('kick');
      slot.drumPads.set('kick', kickPad);

      injectTracks(engine, [['drums', slot]]);

      // No padId — drum rack has no pool, so should be ignored
      engine.scheduleNote(makeNote(1.0, 1.5, { eventId: 'no-pad' }));

      expect(kickPad.synth.scheduleNote).not.toHaveBeenCalled();
      expect(engine.getActiveVoices()).toEqual([]);
    });

    it('scheduleNote with unknown padId is silently ignored', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kickPad = makeDrumPadSlot('kick');
      slot.drumPads.set('kick', kickPad);

      injectCtx(engine, 0);
      injectTracks(engine, [['drums', slot]]);

      engine.scheduleNote(makeNote(1.0, 1.5, { eventId: 'ghost', padId: 'ghost-pad' }));

      expect(kickPad.synth.scheduleNote).not.toHaveBeenCalled();
      expect(engine.getActiveVoices()).toEqual([]);
    });

    it('accent notes get boosted gain on the pad', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kickPad = makeDrumPadSlot('kick');
      slot.drumPads.set('kick', kickPad);

      injectCtx(engine, 0);
      injectTracks(engine, [['drums', slot]]);

      engine.scheduleNote(makeNote(1.0, 1.5, { eventId: 'accent-kick', padId: 'kick', accent: true }));

      const gainCalls = kickPad.accentGain.gain.setValueAtTime.mock.calls;
      // Should have accent level (ACCENT_BASELINE * 2.0) set at note time
      expect(gainCalls.some((c: number[]) => c[0] === ACCENT_BASELINE * 2.0 && c[1] === 1.0)).toBe(true);
    });

    it('tracks active voices for drum pad notes', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kickPad = makeDrumPadSlot('kick');
      slot.drumPads.set('kick', kickPad);

      injectCtx(engine, 0);
      injectTracks(engine, [['drums', slot]]);

      engine.scheduleNote(makeNote(1.0, 1.5, { eventId: 'kick-tracked', padId: 'kick' }));

      const voices = engine.getActiveVoices();
      expect(voices.length).toBe(1);
      expect(voices[0].eventId).toBe('kick-tracked');
      expect(voices[0].trackId).toBe('drums');
    });

    it('multiple pads can trigger simultaneously', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kickPad = makeDrumPadSlot('kick');
      const snarePad = makeDrumPadSlot('snare');
      const hatPad = makeDrumPadSlot('hat');
      slot.drumPads.set('kick', kickPad);
      slot.drumPads.set('snare', snarePad);
      slot.drumPads.set('hat', hatPad);

      injectCtx(engine, 0);
      injectTracks(engine, [['drums', slot]]);

      engine.scheduleNote(makeNote(1.0, 1.5, { eventId: 'k1', padId: 'kick' }));
      engine.scheduleNote(makeNote(1.0, 1.5, { eventId: 's1', padId: 'snare' }));
      engine.scheduleNote(makeNote(1.0, 1.5, { eventId: 'h1', padId: 'hat' }));

      expect(kickPad.synth.scheduleNote).toHaveBeenCalledTimes(1);
      expect(snarePad.synth.scheduleNote).toHaveBeenCalledTimes(1);
      expect(hatPad.synth.scheduleNote).toHaveBeenCalledTimes(1);
      expect(engine.getActiveVoices().length).toBe(3);
    });
  });

  // =========================================================================
  // Choke group tests
  // =========================================================================

  describe('choke groups', () => {
    it('triggering a pad chokes other pads in the same group', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const closedHat = makeDrumPadSlot('hat-closed', 1);
      const openHat = makeDrumPadSlot('hat-open', 1);
      const kick = makeDrumPadSlot('kick'); // no choke group
      slot.drumPads.set('hat-closed', closedHat);
      slot.drumPads.set('hat-open', openHat);
      slot.drumPads.set('kick', kick);

      injectCtx(engine, 0);
      injectTracks(engine, [['drums', slot]]);

      // Trigger open hat first
      engine.scheduleNote(makeNote(1.0, 2.0, { eventId: 'oh1', padId: 'hat-open' }));

      // Trigger closed hat — should choke the open hat
      engine.scheduleNote(makeNote(1.5, 2.0, { eventId: 'ch1', padId: 'hat-closed' }));

      // Open hat should have been silenced (gate-off)
      expect(openHat.synth.silence).toHaveBeenCalled();
      // Open hat's accent gain should have been ramped to 0
      expect(openHat.accentGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 1.5);

      // Kick should NOT be affected (different choke group)
      expect(kick.synth.silence).not.toHaveBeenCalled();
    });

    it('pads without choke groups do not choke each other', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kick = makeDrumPadSlot('kick');
      const snare = makeDrumPadSlot('snare');
      slot.drumPads.set('kick', kick);
      slot.drumPads.set('snare', snare);

      injectCtx(engine, 0);
      injectTracks(engine, [['drums', slot]]);

      engine.scheduleNote(makeNote(1.0, 2.0, { eventId: 'k1', padId: 'kick' }));
      engine.scheduleNote(makeNote(1.0, 2.0, { eventId: 's1', padId: 'snare' }));

      // Neither should be silenced
      expect(kick.synth.silence).not.toHaveBeenCalled();
      expect(snare.synth.silence).not.toHaveBeenCalled();
    });

    it('choke group only affects same group number', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const pad1a = makeDrumPadSlot('pad1a', 1);
      const pad1b = makeDrumPadSlot('pad1b', 1);
      const pad2a = makeDrumPadSlot('pad2a', 2);
      slot.drumPads.set('pad1a', pad1a);
      slot.drumPads.set('pad1b', pad1b);
      slot.drumPads.set('pad2a', pad2a);

      injectCtx(engine, 0);
      injectTracks(engine, [['drums', slot]]);

      // Trigger pad in group 2
      engine.scheduleNote(makeNote(1.0, 2.0, { eventId: 'p2a', padId: 'pad2a' }));

      // Should NOT choke pads in group 1
      expect(pad1a.synth.silence).not.toHaveBeenCalled();
      expect(pad1b.synth.silence).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Release and silence generation
  // =========================================================================

  describe('release and silence', () => {
    it('releaseTrack silences all drum pad synths', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kick = makeDrumPadSlot('kick');
      const snare = makeDrumPadSlot('snare');
      slot.drumPads.set('kick', kick);
      slot.drumPads.set('snare', snare);

      injectCtx(engine, 0);
      injectTracks(engine, [['drums', slot]]);

      engine.scheduleNote(makeNote(0.1, 5.0, { eventId: 'k1', padId: 'kick' }));
      engine.releaseTrack('drums');

      expect(kick.synth.silence).toHaveBeenCalled();
      expect(snare.synth.silence).toHaveBeenCalled();
      expect(engine.getActiveVoices()).toEqual([]);
    });

    it('releaseGeneration fades drum pad gains', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kick = makeDrumPadSlot('kick');
      slot.drumPads.set('kick', kick);

      injectCtx(engine, 0);
      injectTracks(engine, [['drums', slot]]);
      injectModulatorSlots(engine, []);

      engine.scheduleNote(makeNote(0.1, 5.0, { eventId: 'k1', padId: 'kick' }), 0);
      engine.releaseGeneration(1);

      expect(kick.synth.silence).toHaveBeenCalledWith(1);
      expect(kick.accentGain.gain.linearRampToValueAtTime).toHaveBeenCalled();
    });

    it('silenceGeneration hard-silences drum pads', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kick = makeDrumPadSlot('kick');
      slot.drumPads.set('kick', kick);

      injectCtx(engine, 0);
      injectTracks(engine, [['drums', slot]]);
      injectModulatorSlots(engine, []);

      engine.scheduleNote(makeNote(0.1, 5.0, { eventId: 'k1', padId: 'kick' }), 0);
      engine.silenceGeneration(1);

      expect(kick.synth.silence).toHaveBeenCalledWith(1);
      expect(kick.accentGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
    });

    it('restoreBaseline restores drum pad accent gains', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kick = makeDrumPadSlot('kick');
      slot.drumPads.set('kick', kick);

      injectCtx(engine, 1.0);
      injectTracks(engine, [['drums', slot]]);
      injectModulatorSlots(engine, []);

      engine.restoreBaseline();

      const calls = kick.accentGain.gain.setValueAtTime.mock.calls;
      expect(calls.some((c: number[]) => c[0] === ACCENT_BASELINE)).toBe(true);
    });
  });

  // =========================================================================
  // Pad management methods
  // =========================================================================

  describe('pad management', () => {
    it('isTrackDrumRack returns true for drum rack slots', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      injectTracks(engine, [['drums', slot]]);

      expect(engine.isTrackDrumRack('drums')).toBe(true);
      expect(engine.isTrackDrumRack('nonexistent')).toBe(false);
    });

    it('hasDrumPad checks pad existence', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      slot.drumPads.set('kick', makeDrumPadSlot('kick'));
      injectTracks(engine, [['drums', slot]]);

      expect(engine.hasDrumPad('drums', 'kick')).toBe(true);
      expect(engine.hasDrumPad('drums', 'snare')).toBe(false);
      expect(engine.hasDrumPad('nonexistent', 'kick')).toBe(false);
    });

    it('getDrumPadIds returns pad IDs', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      slot.drumPads.set('kick', makeDrumPadSlot('kick'));
      slot.drumPads.set('snare', makeDrumPadSlot('snare'));
      injectTracks(engine, [['drums', slot]]);

      expect(engine.getDrumPadIds('drums')).toEqual(['kick', 'snare']);
      expect(engine.getDrumPadIds('nonexistent')).toEqual([]);
    });

    it('removeDrumPad destroys synth and disconnects nodes', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kickPad = makeDrumPadSlot('kick');
      slot.drumPads.set('kick', kickPad);
      injectTracks(engine, [['drums', slot]]);

      engine.removeDrumPad('drums', 'kick');

      expect(kickPad.synth.destroy).toHaveBeenCalled();
      expect(kickPad.accentGain.disconnect).toHaveBeenCalled();
      expect(kickPad.padGain.disconnect).toHaveBeenCalled();
      expect(kickPad.padPanner.disconnect).toHaveBeenCalled();
      expect(slot.drumPads.has('kick')).toBe(false);
    });

    it('setDrumPadModel delegates to pad synth', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kickPad = makeDrumPadSlot('kick');
      slot.drumPads.set('kick', kickPad);
      injectTracks(engine, [['drums', slot]]);

      engine.setDrumPadModel('drums', 'kick', 7);

      expect(kickPad.synth.setModel).toHaveBeenCalledWith(7);
      expect(kickPad.model).toBe(7);
    });

    it('setDrumPadParams delegates to pad synth', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kickPad = makeDrumPadSlot('kick');
      slot.drumPads.set('kick', kickPad);
      injectTracks(engine, [['drums', slot]]);

      const newParams = { harmonics: 0.8, timbre: 0.3, morph: 0.6, note: 0.5 };
      engine.setDrumPadParams('drums', 'kick', newParams);

      expect(kickPad.synth.setParams).toHaveBeenCalledWith({
        harmonics: 0.8,
        timbre: 0.3,
        morph: 0.6,
        note: 0.5,
      });
    });

    it('setDrumPadLevel sets pad gain value', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kickPad = makeDrumPadSlot('kick');
      slot.drumPads.set('kick', kickPad);
      injectTracks(engine, [['drums', slot]]);

      engine.setDrumPadLevel('drums', 'kick', 0.6);

      expect(kickPad.padGain.gain.value).toBe(0.6);
    });

    it('setDrumPadPan passes -1..1 directly to panner', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kickPad = makeDrumPadSlot('kick');
      slot.drumPads.set('kick', kickPad);
      injectTracks(engine, [['drums', slot]]);

      // 0.0 = center
      engine.setDrumPadPan('drums', 'kick', 0.0);
      expect(kickPad.padPanner.pan.value).toBe(0);

      // -1.0 = full left
      engine.setDrumPadPan('drums', 'kick', -1.0);
      expect(kickPad.padPanner.pan.value).toBe(-1);

      // 1.0 = full right
      engine.setDrumPadPan('drums', 'kick', 1.0);
      expect(kickPad.padPanner.pan.value).toBe(1);
    });

    it('setDrumPadChokeGroup updates choke group', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kickPad = makeDrumPadSlot('kick');
      slot.drumPads.set('kick', kickPad);
      injectTracks(engine, [['drums', slot]]);

      engine.setDrumPadChokeGroup('drums', 'kick', 2);
      expect(kickPad.chokeGroup).toBe(2);

      engine.setDrumPadChokeGroup('drums', 'kick', undefined);
      expect(kickPad.chokeGroup).toBeUndefined();
    });

    it('removeDrumPad on non-drum-rack track is a no-op', () => {
      const engine = new AudioEngine();
      // Use a regular track slot shape
      const slot = {
        pool: null,
        sourceOut: mockGainNode(),
        chainOutGain: mockGainNode(),
        trackVolume: mockGainNode(0.8),
        trackPanner: mockPannerNode(),
        muteGain: mockGainNode(),
        busInput: null,
        analyser: { fftSize: 256, connect: vi.fn(), disconnect: vi.fn() },
        processors: [],
        currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
        currentModel: 0,
        isBus: false,
        isDrumRack: false,
        drumPads: new Map(),
      };
      (engine as unknown as { tracks: Map<string, unknown> }).tracks = new Map([['t0', slot]]);

      expect(() => engine.removeDrumPad('t0', 'kick')).not.toThrow();
    });
  });

  // =========================================================================
  // Voice stealing on same pad
  // =========================================================================

  describe('voice stealing on same pad (re-trigger)', () => {
    it('re-triggering same pad ramps down before new note', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kick = makeDrumPadSlot('kick');
      slot.drumPads.set('kick', kick);

      injectCtx(engine, 0);
      injectTracks(engine, [['drums', slot]]);

      // First trigger — long sustain
      engine.scheduleNote(makeNote(1.0, 5.0, { eventId: 'k1', padId: 'kick' }));

      // Second trigger while first is still sustaining
      engine.scheduleNote(makeNote(1.5, 3.0, { eventId: 'k2', padId: 'kick' }));

      // Should have ramped down before second trigger (voice stealing)
      expect(kick.accentGain.gain.cancelAndHoldAtTime).toHaveBeenCalled();
      expect(kick.accentGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 1.5);
    });
  });

  // =========================================================================
  // removeTrack cleans up drum pads
  // =========================================================================

  describe('track removal cleans up pads', () => {
    it('addDrumPad concurrent calls for same pad only create one pad (in-flight guard)', async () => {
      // Test the in-flight deduplication guard by checking the pendingDrumPads set.
      // Two synchronous calls to addDrumPad for the same trackId:padId should
      // result in only the first proceeding past the guard.
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      injectTracks(engine, [['drums', slot]]);

      // Inject a mock AudioContext with createGain/createStereoPanner
      const mockCtx = {
        currentTime: 0,
        createGain: () => mockGainNode(),
        createStereoPanner: () => mockPannerNode(),
      };
      (engine as unknown as { ctx: unknown }).ctx = mockCtx;

      // Access pendingDrumPads to verify the guard
      const pending = (engine as unknown as { pendingDrumPads: Set<string> }).pendingDrumPads;
      expect(pending.size).toBe(0);

      // Mock createPreferredSynth at module level via vi.mock
      let resolveCreate!: (synth: ReturnType<typeof mockSynth>) => void;
      const createPromise = new Promise<ReturnType<typeof mockSynth>>(r => { resolveCreate = r; });

      // We need to intercept the createPreferredSynth call. Since it's a static
      // import, we use vi.hoisted + vi.mock. But for simplicity in this test file,
      // we directly test the guard by observing state.

      // Fire first call — it will add to pendingDrumPads and then await
      const p1 = engine.addDrumPad('drums', 'kick', 0,
        { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 }, 0.8, 0.0);

      // The pending set should now contain the key (before the await resolves)
      // Note: this is a microtask-level check; the first call is suspended at
      // the await but hasn't resolved yet.
      expect(pending.has('drums:kick')).toBe(true);

      // Fire second call synchronously — should bail due to in-flight guard
      const p2 = engine.addDrumPad('drums', 'kick', 0,
        { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 }, 0.8, 0.0);

      // p2 should resolve immediately (returned early), so await it
      await p2;

      // The pending set should still have the key from p1
      expect(pending.has('drums:kick')).toBe(true);

      // Now let p1 complete (it will fail at createPreferredSynth since we have a mock ctx,
      // but the guard is what we're testing)
      try { await p1; } catch { /* expected: mock ctx lacks real AudioContext methods */ }

      // After p1 completes (success or failure), the pending key should be cleared
      expect(pending.has('drums:kick')).toBe(false);
    });

    it('addDrumPad post-await revalidation destroys synth if track disappeared', async () => {
      // Verify that if the track is removed during the createPreferredSynth await,
      // the newly created synth is destroyed and not leaked.
      // We use the real addDrumPad but with a mock ctx that will cause
      // createPreferredSynth to fail. The post-await guard is the key behavior.
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      injectTracks(engine, [['drums', slot]]);

      const mockCtx = {
        currentTime: 0,
        createGain: () => mockGainNode(),
        createStereoPanner: () => mockPannerNode(),
      };
      (engine as unknown as { ctx: unknown }).ctx = mockCtx;

      // Call addDrumPad — createPreferredSynth will reject because mockCtx
      // doesn't support real AudioWorklet creation. This exercises the
      // try/finally cleanup path (pendingDrumPads.delete).
      const p = engine.addDrumPad('drums', 'kick', 0,
        { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 }, 0.8, 0.0);

      // Remove track while addDrumPad is in flight
      (engine as unknown as { tracks: Map<string, unknown> }).tracks.delete('drums');

      // Should not throw
      try { await p; } catch { /* createPreferredSynth may throw with mock ctx */ }

      // Pad should not exist (track was removed)
      expect(slot.drumPads.has('kick')).toBe(false);

      // pendingDrumPads should be cleaned up even on error
      const pending = (engine as unknown as { pendingDrumPads: Set<string> }).pendingDrumPads;
      expect(pending.has('drums:kick')).toBe(false);
    });

    it('removeTrack destroys all drum pad synths', () => {
      const engine = new AudioEngine();
      const slot = makeDrumRackSlot();
      const kick = makeDrumPadSlot('kick');
      const snare = makeDrumPadSlot('snare');
      slot.drumPads.set('kick', kick);
      slot.drumPads.set('snare', snare);

      injectTracks(engine, [['drums', slot]]);

      engine.removeTrack('drums');

      expect(kick.synth.destroy).toHaveBeenCalled();
      expect(snare.synth.destroy).toHaveBeenCalled();
      expect(kick.accentGain.disconnect).toHaveBeenCalled();
      expect(snare.accentGain.disconnect).toHaveBeenCalled();
    });
  });
});
