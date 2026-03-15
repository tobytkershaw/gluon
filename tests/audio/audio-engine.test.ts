import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/audio-engine';
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

describe('AudioEngine', () => {
  it('delegates scheduled notes to the synth and schedules accent gain separately', () => {
    const engine = new AudioEngine();
    const setValueAtTime = vi.fn();
    const synth = {
      scheduleNote: vi.fn(),
      setModel: vi.fn(),
      setParams: vi.fn(),
      destroy: vi.fn(),
    };

    (engine as { tracks: Map<string, unknown> }).tracks = new Map([
      ['v0', {
        synth,
        sourceOut: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
        chainOutGain: mockGainNode(),
        muteGain: { gain: { value: 1 } },
        accentGain: { gain: { setValueAtTime } },
        processors: [],
        currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
        currentModel: 0,
      }],
    ]);

    const note: ScheduledNote = {
      trackId: 'v0',
      time: 1.25,
      gateOffTime: 1.5,
      accent: true,
      params: { harmonics: 0.4, timbre: 0.6, morph: 0.7, note: 0.5 },
    };

    engine.scheduleNote(note);

    expect(synth.scheduleNote).toHaveBeenCalledWith(note, 0);
    expect(setValueAtTime).toHaveBeenNthCalledWith(1, 0.6, 1.25);
    expect(setValueAtTime).toHaveBeenNthCalledWith(2, 0.3, 1.5);
    expect(engine.getActiveVoices()).toEqual([{
      eventId: 'manual:v0:1.25:1.5',
      generation: 0,
      trackId: 'v0',
      noteTime: 1.25,
      gateOffTime: 1.5,
      state: 'scheduled',
    }]);
  });

  it('rebuildChain wires sourceOut -> chainOutGain when no processors', () => {
    const engine = new AudioEngine();
    const sourceOutConnect = vi.fn();
    const sourceOutDisconnect = vi.fn();
    const chainOutGain = mockGainNode();

    const slot = {
      synth: { scheduleNote: vi.fn(), setModel: vi.fn(), setParams: vi.fn(), destroy: vi.fn() },
      sourceOut: { gain: { value: 1 }, connect: sourceOutConnect, disconnect: sourceOutDisconnect },
      chainOutGain,
      muteGain: { gain: { value: 1 } },
      accentGain: { gain: { setValueAtTime: vi.fn() } },
      processors: [],
      currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
      currentModel: 0,
    };

    (engine as { tracks: Map<string, unknown> }).tracks = new Map([['v0', slot]]);

    // Access private method for testing
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
      synth: { scheduleNote: vi.fn(), setModel: vi.fn(), setParams: vi.fn(), destroy: vi.fn() },
      sourceOut: { gain: { value: 1 }, connect: sourceOutConnect, disconnect: sourceOutDisconnect },
      chainOutGain,
      muteGain: { gain: { value: 1 } },
      accentGain: { gain: { setValueAtTime: vi.fn() } },
      processors: [{ id: 'rings-0', type: 'rings' as const, engine: { inputNode: procNode, destroy: vi.fn(), setPatch: vi.fn(), setModel: vi.fn(), setNote: vi.fn(), setPolyphony: vi.fn(), setInternalExciter: vi.fn(), strum: vi.fn() } }],
      currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
      currentModel: 0,
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
      synth: { scheduleNote: vi.fn(), setModel: vi.fn(), setParams: vi.fn(), destroy: vi.fn() },
      sourceOut: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
      chainOutGain: mockGainNode(),
      muteGain: { gain: { value: 1 } },
      accentGain: { gain: { setValueAtTime: vi.fn() } },
      processors: [{ id: 'rings-0', type: 'rings' as const, engine: { inputNode: procNode, destroy: vi.fn(), setPatch, setModel: vi.fn(), setNote: vi.fn(), setPolyphony: vi.fn(), setInternalExciter: vi.fn(), strum: vi.fn() } }],
      currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
      currentModel: 0,
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
      synth: { scheduleNote: vi.fn(), setModel: vi.fn(), setParams: vi.fn(), destroy: vi.fn() },
      sourceOut: { gain: { value: 1 }, connect: sourceOutConnect, disconnect: sourceOutDisconnect },
      chainOutGain,
      muteGain: { gain: { value: 1 } },
      accentGain: { gain: { setValueAtTime: vi.fn() } },
      processors: [{ id: 'rings-0', type: 'rings' as const, engine: { inputNode: procNode, destroy, setPatch: vi.fn(), setModel: vi.fn(), setNote: vi.fn(), setPolyphony: vi.fn(), setInternalExciter: vi.fn(), strum: vi.fn() } }],
      currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
      currentModel: 0,
    };

    (engine as { tracks: Map<string, unknown> }).tracks = new Map([['v0', slot]]);
    engine.removeProcessor('v0', 'rings-0');

    expect(destroy).toHaveBeenCalled();
    expect(slot.processors).toHaveLength(0);
    // After removal, sourceOut connects directly to chainOutGain
    expect(sourceOutConnect).toHaveBeenCalledWith(chainOutGain);
  });

  it('advances generation when silenceAll is called without an explicit generation', () => {
    const engine = new AudioEngine();
    const synth = {
      scheduleNote: vi.fn(),
      setModel: vi.fn(),
      setParams: vi.fn(),
      destroy: vi.fn(),
      silence: vi.fn(),
    };
    const procSilence = vi.fn();
    const modSilence = vi.fn();
    const modPause = vi.fn();
    const accentGain = {
      gain: {
        cancelAndHoldAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
      },
    };

    (engine as unknown as { ctx: { currentTime: number } }).ctx = { currentTime: 0 };
    (engine as { tracks: Map<string, unknown> }).tracks = new Map([
      ['v0', {
        synth,
        sourceOut: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
        chainOutGain: mockGainNode(),
        muteGain: { gain: { value: 1 } },
        accentGain,
        processors: [{ id: 'rings-0', type: 'rings', engine: { silence: procSilence, damp: vi.fn() } }],
        currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
        currentModel: 0,
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
    engine.silenceAll();

    expect(engine.getGeneration()).toBe(1);
    expect(synth.silence).toHaveBeenCalledWith(1);
    expect(procSilence).toHaveBeenCalledWith(1);
    expect(modSilence).toHaveBeenCalledWith(1);
    expect(modPause).toHaveBeenCalled();
  });

  it('releases active voices through a target generation', () => {
    const engine = new AudioEngine();
    const synth = {
      scheduleNote: vi.fn(),
      setModel: vi.fn(),
      setParams: vi.fn(),
      destroy: vi.fn(),
      silence: vi.fn(),
    };
    const accentGain = {
      gain: {
        setValueAtTime: vi.fn(),
        cancelAndHoldAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
    };

    (engine as unknown as { ctx: { currentTime: number } }).ctx = { currentTime: 0 };
    (engine as { tracks: Map<string, unknown> }).tracks = new Map([
      ['v0', {
        synth,
        sourceOut: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
        chainOutGain: mockGainNode(),
        muteGain: { gain: { value: 1 } },
        accentGain,
        processors: [],
        currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
        currentModel: 0,
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

    expect(synth.silence).toHaveBeenCalledWith(2);
    expect(engine.getActiveVoices()).toEqual([]);
  });

  it('retains recent voices long enough to clean up processor tails', () => {
    const engine = new AudioEngine();
    const synth = {
      scheduleNote: vi.fn(),
      setModel: vi.fn(),
      setParams: vi.fn(),
      destroy: vi.fn(),
      silence: vi.fn(),
    };
    const procSilence = vi.fn();

    (engine as unknown as { ctx: { currentTime: number } }).ctx = { currentTime: 1.0 };
    (engine as { tracks: Map<string, unknown> }).tracks = new Map([
      ['v0', {
        synth,
        sourceOut: { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() },
        chainOutGain: mockGainNode(),
        muteGain: { gain: { value: 1 } },
        accentGain: { gain: { setValueAtTime: vi.fn(), cancelAndHoldAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } },
        processors: [{ id: 'rings-0', type: 'rings', engine: { silence: procSilence, damp: vi.fn() } }],
        currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
        currentModel: 0,
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
