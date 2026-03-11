import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/audio-engine';
import type { ScheduledNote } from '../../src/engine/sequencer-types';

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

    (engine as { voices: Map<string, unknown> }).voices = new Map([
      ['v0', {
        synth,
        muteGain: { gain: { value: 1 } },
        accentGain: { gain: { setValueAtTime } },
        currentParams: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
        currentModel: 0,
      }],
    ]);

    const note: ScheduledNote = {
      voiceId: 'v0',
      time: 1.25,
      gateOffTime: 1.5,
      accent: true,
      params: { harmonics: 0.4, timbre: 0.6, morph: 0.7, note: 0.5 },
    };

    engine.scheduleNote(note);

    expect(synth.scheduleNote).toHaveBeenCalledWith(note);
    expect(setValueAtTime).toHaveBeenNthCalledWith(1, 0.6, 1.25);
    expect(setValueAtTime).toHaveBeenNthCalledWith(2, 0.3, 1.5);
  });
});
