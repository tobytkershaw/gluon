import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/audio-engine';
import { VoicePool } from '../../src/audio/voice-pool';
import type { PoolVoice } from '../../src/audio/voice-pool';
import type { ScheduledNote } from '../../src/engine/sequencer-types';

function mockGainNode() {
  return {
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function mockSynth() {
  return {
    scheduleNote: vi.fn(),
    setModel: vi.fn(),
    setParams: vi.fn(),
    silence: vi.fn(),
    destroy: vi.fn(),
  };
}

function mockAccentGain() {
  return {
    gain: {
      value: 0.3,
      setValueAtTime: vi.fn(),
      cancelAndHoldAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function makePoolVoice(): PoolVoice {
  return {
    synth: mockSynth() as unknown as PoolVoice['synth'],
    accentGain: mockAccentGain() as unknown as GainNode,
    lastNoteTime: 0,
    lastGateOffTime: 0,
  };
}

function makePool(voiceCount = 2): VoicePool {
  const voices = Array.from({ length: voiceCount }, () => makePoolVoice());
  return new VoicePool(voices);
}

function makeTrackSlot(pool?: VoicePool) {
  return {
    pool: pool ?? makePool(),
    sourceOut: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
    chainOutGain: mockGainNode(),
    muteGain: { gain: { value: 1 } },
    processors: [] as unknown[],
    currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    currentModel: 0,
  };
}

describe('AudioEngine', () => {
  it('delegates scheduled notes to the voice pool and tracks active voices', () => {
    const engine = new AudioEngine();
    const pool = makePool();
    const slot = makeTrackSlot(pool);

    (engine as { tracks: Map<string, unknown> }).tracks = new Map([['v0', slot]]);

    const note: ScheduledNote = {
      trackId: 'v0',
      time: 1.25,
      gateOffTime: 1.5,
      accent: true,
      params: { harmonics: 0.4, timbre: 0.6, morph: 0.7, note: 0.5 },
    };

    engine.scheduleNote(note);

    // Voice pool's first voice should have received the note
    expect(pool.voices[0].synth.scheduleNote).toHaveBeenCalledWith(note, 0);
    expect(engine.getActiveVoices()).toEqual([{
      eventId: 'manual:v0:1.25:1.5',
      generation: 0,
      trackId: 'v0',
      noteTime: 1.25,
      gateOffTime: 1.5,
      state: 'scheduled',
    }]);
  });

  it('overlapping notes use different synth instances via voice pool', () => {
    const engine = new AudioEngine();
    const pool = makePool();
    const slot = makeTrackSlot(pool);

    (engine as { tracks: Map<string, unknown> }).tracks = new Map([['v0', slot]]);

    // Note A: gate-off at 1.5 (still decaying when B starts)
    const noteA: ScheduledNote = {
      eventId: 'evt-a',
      trackId: 'v0',
      time: 1.0,
      gateOffTime: 1.5,
      accent: true,
      params: { harmonics: 0.4, timbre: 0.6, morph: 0.7, note: 0.5 },
    };

    // Note B: starts at 1.2 (overlaps with A)
    const noteB: ScheduledNote = {
      eventId: 'evt-b',
      trackId: 'v0',
      time: 1.2,
      gateOffTime: 1.7,
      accent: false,
      params: { harmonics: 0.8, timbre: 0.3, morph: 0.1, note: 0.6 },
    };

    engine.scheduleNote(noteA);
    engine.scheduleNote(noteB);

    // Different synth instances received each note
    expect(pool.voices[0].synth.scheduleNote).toHaveBeenCalledWith(noteA, 0);
    expect(pool.voices[1].synth.scheduleNote).toHaveBeenCalledWith(noteB, 0);

    // Accent automation was applied to different gain nodes
    const v0Gain = pool.voices[0].accentGain.gain as unknown as { setValueAtTime: ReturnType<typeof vi.fn> };
    const v1Gain = pool.voices[1].accentGain.gain as unknown as { setValueAtTime: ReturnType<typeof vi.fn> };
    expect(v0Gain.setValueAtTime).toHaveBeenCalledWith(0.6, 1.0); // accent boost on voice 0
    expect(v1Gain.setValueAtTime).toHaveBeenCalledWith(0.3, 1.2); // no accent on voice 1
  });

  it('rebuildChain wires sourceOut -> chainOutGain when no processors', () => {
    const engine = new AudioEngine();
    const sourceOutConnect = vi.fn();
    const sourceOutDisconnect = vi.fn();
    const chainOutGain = mockGainNode();

    const slot = {
      ...makeTrackSlot(),
      sourceOut: { gain: { value: 1 }, connect: sourceOutConnect, disconnect: sourceOutDisconnect },
      chainOutGain,
    };

    (engine as { tracks: Map<string, unknown> }).tracks = new Map([['v0', slot]]);
    (engine as unknown as { rebuildChain: (s: unknown) => void }).rebuildChain(slot);

    expect(sourceOutDisconnect).toHaveBeenCalled();
    expect(sourceOutConnect).toHaveBeenCalledWith(chainOutGain);
  });

  it('rebuildChain inserts processor between sourceOut and chainOutGain', () => {
    const engine = new AudioEngine();
    const sourceOutConnect = vi.fn();
    const sourceOutDisconnect = vi.fn();
    const procConnect = vi.fn();
    const procDisconnect = vi.fn();
    const chainOutGain = mockGainNode();
    const procNode = { connect: procConnect, disconnect: procDisconnect };

    const slot = {
      ...makeTrackSlot(),
      sourceOut: { gain: { value: 1 }, connect: sourceOutConnect, disconnect: sourceOutDisconnect },
      chainOutGain,
      processors: [{ id: 'rings-0', type: 'rings' as const, engine: { role: 'processor', inputNode: procNode, outputNode: procNode, destroy: vi.fn(), setPatch: vi.fn(), setModel: vi.fn(), sendCommand: vi.fn(), silence: vi.fn() } }],
    };

    (engine as { tracks: Map<string, unknown> }).tracks = new Map([['v0', slot]]);
    (engine as unknown as { rebuildChain: (s: unknown) => void }).rebuildChain(slot);

    expect(sourceOutConnect).toHaveBeenCalledWith(procNode);
    expect(procConnect).toHaveBeenCalledWith(chainOutGain);
  });

  it('setProcessorPatch delegates to processor engine', () => {
    const engine = new AudioEngine();
    const setPatch = vi.fn();
    const procNode = { connect: vi.fn(), disconnect: vi.fn() };

    const slot = {
      ...makeTrackSlot(),
      processors: [{ id: 'rings-0', type: 'rings' as const, engine: { role: 'processor', inputNode: procNode, outputNode: procNode, destroy: vi.fn(), setPatch, setModel: vi.fn(), sendCommand: vi.fn(), silence: vi.fn() } }],
    };

    (engine as { tracks: Map<string, unknown> }).tracks = new Map([['v0', slot]]);
    const params = { structure: 0.3, brightness: 0.6, damping: 0.5, position: 0.8 };
    engine.setProcessorPatch('v0', 'rings-0', params);

    expect(setPatch).toHaveBeenCalledWith(params);
  });

  it('removeProcessor destroys and removes the processor', () => {
    const engine = new AudioEngine();
    const destroy = vi.fn();
    const procNode = { connect: vi.fn(), disconnect: vi.fn() };
    const sourceOutConnect = vi.fn();
    const sourceOutDisconnect = vi.fn();
    const chainOutGain = mockGainNode();

    const slot = {
      ...makeTrackSlot(),
      sourceOut: { gain: { value: 1 }, connect: sourceOutConnect, disconnect: sourceOutDisconnect },
      chainOutGain,
      processors: [{ id: 'rings-0', type: 'rings' as const, engine: { role: 'processor', inputNode: procNode, outputNode: procNode, destroy, setPatch: vi.fn(), setModel: vi.fn(), sendCommand: vi.fn(), silence: vi.fn() } }],
    };

    (engine as { tracks: Map<string, unknown> }).tracks = new Map([['v0', slot]]);
    engine.removeProcessor('v0', 'rings-0');

    expect(destroy).toHaveBeenCalled();
    expect(slot.processors).toHaveLength(0);
    expect(sourceOutConnect).toHaveBeenCalledWith(chainOutGain);
  });

  it('silenceGeneration silences pool voices for active tracks', () => {
    const engine = new AudioEngine();
    const pool = makePool();
    const procSilence = vi.fn();
    const modSilence = vi.fn();
    const modPause = vi.fn();

    (engine as unknown as { ctx: { currentTime: number } }).ctx = { currentTime: 0 };
    (engine as { tracks: Map<string, unknown> }).tracks = new Map([
      ['v0', {
        ...makeTrackSlot(pool),
        processors: [{ id: 'rings-0', type: 'rings', engine: { silence: procSilence, sendCommand: vi.fn() } }],
      }],
    ]);
    (engine as { modulatorSlots: Map<string, unknown[]> }).modulatorSlots = new Map([
      ['v0', [{ engine: { silence: modSilence, pause: modPause } }]],
    ]);

    expect(engine.getGeneration()).toBe(0);
    engine.scheduleNote({
      eventId: 'evt-0',
      generation: 0,
      trackId: 'v0',
      time: 0.1,
      gateOffTime: 0.6,
      accent: false,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    });

    engine.silenceGeneration(1);

    expect(engine.getGeneration()).toBe(1);
    // Both voices in the pool should have been silenced
    expect(pool.voices[0].synth.silence).toHaveBeenCalledWith(1);
    expect(pool.voices[1].synth.silence).toHaveBeenCalledWith(1);
    expect(procSilence).toHaveBeenCalledWith(1);
    expect(modSilence).toHaveBeenCalledWith(1);
    expect(modPause).toHaveBeenCalled();
  });

  it('releases active voices through a target generation', () => {
    const engine = new AudioEngine();
    const pool = makePool();

    (engine as unknown as { ctx: { currentTime: number } }).ctx = { currentTime: 0 };
    (engine as { tracks: Map<string, unknown> }).tracks = new Map([
      ['v0', {
        ...makeTrackSlot(pool),
        processors: [],
      }],
    ]);
    (engine as { modulatorSlots: Map<string, unknown[]> }).modulatorSlots = new Map();

    engine.scheduleNote({
      eventId: 'evt-1',
      generation: 1,
      trackId: 'v0',
      time: 0.1,
      gateOffTime: 0.6,
      accent: false,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    }, 1);

    engine.releaseGeneration(2);

    // Both pool voices should have been released
    expect(pool.voices[0].synth.silence).toHaveBeenCalledWith(2);
    expect(pool.voices[1].synth.silence).toHaveBeenCalledWith(2);
    expect(engine.getActiveVoices()).toEqual([]);
  });

  it('passes eventId to voice pool for event-voice tracking', () => {
    const engine = new AudioEngine();
    const pool = makePool();
    const slot = makeTrackSlot(pool);

    (engine as { tracks: Map<string, unknown> }).tracks = new Map([['v0', slot]]);

    const note: ScheduledNote = {
      eventId: 'evt-tracked',
      trackId: 'v0',
      time: 1.0,
      gateOffTime: 1.5,
      accent: false,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    };

    engine.scheduleNote(note);

    // VoicePool should have the event-voice mapping
    expect(pool.getVoiceForEvent('evt-tracked')).toBe(pool.voices[0]);
  });

  it('4 simultaneous notes on one track use 4 different voices', () => {
    const engine = new AudioEngine();
    const pool = makePool(4);
    const slot = makeTrackSlot(pool);

    (engine as { tracks: Map<string, unknown> }).tracks = new Map([['v0', slot]]);

    const makeNote = (id: string, time: number, gateOff: number): ScheduledNote => ({
      eventId: id,
      trackId: 'v0',
      time,
      gateOffTime: gateOff,
      accent: false,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    });

    engine.scheduleNote(makeNote('evt-1', 1.0, 2.0));
    engine.scheduleNote(makeNote('evt-2', 1.1, 2.1));
    engine.scheduleNote(makeNote('evt-3', 1.2, 2.2));
    engine.scheduleNote(makeNote('evt-4', 1.3, 2.3));

    // Each event should have its own voice
    const assignedVoices = new Set([
      pool.getVoiceForEvent('evt-1'),
      pool.getVoiceForEvent('evt-2'),
      pool.getVoiceForEvent('evt-3'),
      pool.getVoiceForEvent('evt-4'),
    ]);
    expect(assignedVoices.size).toBe(4);

    // Each voice synth received exactly one note
    for (const voice of pool.voices) {
      expect(voice.synth.scheduleNote).toHaveBeenCalledTimes(1);
    }
  });

  it('retains recent voices long enough to clean up processor tails', () => {
    const engine = new AudioEngine();
    const pool = makePool();
    const procSilence = vi.fn();

    (engine as unknown as { ctx: { currentTime: number } }).ctx = { currentTime: 1.0 };
    (engine as { tracks: Map<string, unknown> }).tracks = new Map([
      ['v0', {
        ...makeTrackSlot(pool),
        processors: [{ id: 'rings-0', type: 'rings', engine: { silence: procSilence, sendCommand: vi.fn() } }],
      }],
    ]);
    (engine as { modulatorSlots: Map<string, unknown[]> }).modulatorSlots = new Map();

    engine.scheduleNote({
      eventId: 'evt-tail',
      generation: 1,
      trackId: 'v0',
      time: 0.1,
      gateOffTime: 0.2,
      accent: false,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    }, 1);

    // Current time is well past gateOffTime, but still inside the tail grace window.
    engine.releaseGeneration(2);

    expect(procSilence).toHaveBeenCalledWith(2);
  });
});
