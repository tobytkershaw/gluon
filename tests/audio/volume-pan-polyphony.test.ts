import { describe, expect, it, vi } from 'vitest';
import { createSession } from '../../src/engine/session';
import { buildRenderSpec } from '../../src/audio/render-spec';
import {
  applyStereoGain,
  applyStereoPan,
  downmixStereoToMono,
  mixStereoBuffers,
  monoToStereo,
} from '../../src/audio/render-mix';
import type { StereoBuffer } from '../../src/audio/render-mix';
import { analyzeDynamics } from '../../src/audio/audio-analysis';
import { VoicePool } from '../../src/audio/voice-pool';
import type { PoolVoice } from '../../src/audio/voice-pool';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SR = 48000;

/** Generate a sine wave at the given frequency. */
function sineWave(freq: number, sampleRate: number, duration: number, amplitude = 0.5): Float32Array {
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = amplitude * Math.sin(2 * Math.PI * freq * i / sampleRate);
  }
  return samples;
}

/** Compute RMS of a buffer. */
function rms(buf: Float32Array): number {
  if (buf.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    sum += buf[i] * buf[i];
  }
  return Math.sqrt(sum / buf.length);
}

/** Compute peak absolute value of a buffer. */
function peak(buf: Float32Array): number {
  let max = 0;
  for (let i = 0; i < buf.length; i++) {
    const abs = Math.abs(buf[i]);
    if (abs > max) max = abs;
  }
  return max;
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

function mockGainParam() {
  return {
    value: 0.3,
    setValueAtTime: vi.fn(),
    cancelAndHoldAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
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

// ---------------------------------------------------------------------------
// 1. RenderSpec: per-track volume/pan propagation
// ---------------------------------------------------------------------------

describe('buildRenderSpec — per-track volume/pan', () => {
  it('includes default volume (0.8) and pan (0.0) in track spec', () => {
    const session = createSession();
    const spec = buildRenderSpec(session, [session.tracks[0].id], 1);

    expect(spec.tracks).toHaveLength(1);
    expect(spec.tracks[0].volume).toBe(0.8);
    expect(spec.tracks[0].pan).toBe(0.0);
  });

  it('propagates custom volume and pan values', () => {
    const session = createSession();
    session.tracks[0] = { ...session.tracks[0], volume: 0.0, pan: -1.0 };
    session.tracks[1] = { ...session.tracks[1], volume: 1.0, pan: 1.0 };

    const spec = buildRenderSpec(session, [session.tracks[0].id, session.tracks[1].id], 1);

    expect(spec.tracks[0].volume).toBe(0.0);
    expect(spec.tracks[0].pan).toBe(-1.0);
    expect(spec.tracks[1].volume).toBe(1.0);
    expect(spec.tracks[1].pan).toBe(1.0);
  });

  it('propagates master volume and pan', () => {
    const session = createSession();
    session.master = { volume: 0.5, pan: 0.3 };

    const spec = buildRenderSpec(session, undefined, 1);

    expect(spec.master.volume).toBe(0.5);
    expect(spec.master.pan).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
// 2. Volume at 0.0 → silence
// ---------------------------------------------------------------------------

describe('volume at 0.0 → silence', () => {
  it('applyStereoGain with gain=0 zeroes all samples', () => {
    const signal = sineWave(440, SR, 0.5, 0.8);
    const stereo = monoToStereo(signal);
    const result = applyStereoGain(stereo, 0.0);

    expect(rms(result.left)).toBe(0);
    expect(rms(result.right)).toBe(0);
    expect(peak(result.left)).toBe(0);
    expect(peak(result.right)).toBe(0);
  });

  it('full mix path: volume=0 track produces silence after mono downmix', () => {
    const signal = sineWave(440, SR, 0.5, 0.8);
    // Simulate the render-worker mixing path
    let stereo = monoToStereo(signal);
    stereo = applyStereoGain(stereo, 0.0);
    stereo = applyStereoPan(stereo, 0.0);
    const mixed = mixStereoBuffers([stereo]);
    const mono = downmixStereoToMono(mixed);

    expect(rms(mono)).toBe(0);
    expect(peak(mono)).toBe(0);
  });

  it('analyzeDynamics confirms silence for volume=0 track', () => {
    const signal = sineWave(440, SR, 1.0, 0.8);
    let stereo = monoToStereo(signal);
    stereo = applyStereoGain(stereo, 0.0);
    const mono = downmixStereoToMono(stereo);
    const dynamics = analyzeDynamics(mono, SR);

    expect(dynamics.peak).toBe(-Infinity);
    expect(dynamics.rms).toBe(-Infinity);
  });
});

// ---------------------------------------------------------------------------
// 3. Volume at 1.0 → louder than default (0.8)
// ---------------------------------------------------------------------------

describe('volume at 1.0 → louder than default (0.8)', () => {
  it('RMS at volume=1.0 exceeds RMS at volume=0.8', () => {
    const signal = sineWave(440, SR, 0.5, 0.5);

    const atDefault = applyStereoGain(monoToStereo(signal), 0.8);
    const atFull = applyStereoGain(monoToStereo(signal), 1.0);

    const rmsDefault = rms(downmixStereoToMono(atDefault));
    const rmsFull = rms(downmixStereoToMono(atFull));

    expect(rmsFull).toBeGreaterThan(rmsDefault);
    // The ratio should be 1.0/0.8 = 1.25
    expect(rmsFull / rmsDefault).toBeCloseTo(1.25, 2);
  });

  it('analyzeDynamics confirms higher LUFS at volume=1.0 than 0.8', () => {
    const signal = sineWave(440, SR, 1.0, 0.5);

    const monoDefault = downmixStereoToMono(applyStereoGain(monoToStereo(signal), 0.8));
    const monoFull = downmixStereoToMono(applyStereoGain(monoToStereo(signal), 1.0));

    const dDefault = analyzeDynamics(monoDefault, SR);
    const dFull = analyzeDynamics(monoFull, SR);

    expect(dFull.lufs).toBeGreaterThan(dDefault.lufs);
    expect(dFull.peak).toBeGreaterThan(dDefault.peak);
  });
});

// ---------------------------------------------------------------------------
// 4. Pan full left → right channel is silence
// ---------------------------------------------------------------------------

describe('pan full left → right channel silence', () => {
  it('pan=-1 produces zero right channel and non-zero left channel', () => {
    const signal = sineWave(440, SR, 0.5, 0.8);
    const stereo = applyStereoPan(monoToStereo(signal), -1.0);

    // Right channel should be essentially zero
    expect(rms(stereo.right)).toBeCloseTo(0, 5);
    expect(peak(stereo.right)).toBeCloseTo(0, 5);

    // Left channel should have signal
    expect(rms(stereo.left)).toBeGreaterThan(0.1);
  });

  it('pan=+1 produces zero left channel and non-zero right channel', () => {
    const signal = sineWave(440, SR, 0.5, 0.8);
    const stereo = applyStereoPan(monoToStereo(signal), 1.0);

    expect(rms(stereo.left)).toBeCloseTo(0, 5);
    expect(peak(stereo.left)).toBeCloseTo(0, 5);
    expect(rms(stereo.right)).toBeGreaterThan(0.1);
  });

  it('pan=0 (center) distributes equally to both channels', () => {
    const signal = sineWave(440, SR, 0.5, 0.8);
    const stereo = applyStereoPan(monoToStereo(signal), 0.0);

    const leftRms = rms(stereo.left);
    const rightRms = rms(stereo.right);

    // Equal-power pan at center: cos(pi/4) = sin(pi/4) = sqrt(2)/2
    expect(leftRms).toBeCloseTo(rightRms, 5);
  });

  it('mono downmix of hard-left pan still has signal', () => {
    const signal = sineWave(440, SR, 0.5, 0.8);
    const stereo = applyStereoPan(monoToStereo(signal), -1.0);
    const mono = downmixStereoToMono(stereo);

    // downmixStereoToMono = (left + right) * 0.5
    // Hard left: left = signal * cos(0) = signal, right = signal * sin(0) = 0
    // So mono = signal * 0.5
    expect(rms(mono)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Offline render respects volume/pan (render-worker mixing path)
// ---------------------------------------------------------------------------

describe('render-worker mixing path: volume/pan applied per-track', () => {
  it('two tracks at different volumes produce proportional output levels', () => {
    const signalA = sineWave(440, SR, 0.5, 0.5);
    const signalB = sineWave(880, SR, 0.5, 0.5);

    // Simulate render-worker logic: per-track gain + pan, then mix + master
    const trackA = applyStereoPan(applyStereoGain(monoToStereo(signalA), 0.4), 0.0);
    const trackB = applyStereoPan(applyStereoGain(monoToStereo(signalB), 0.8), 0.0);
    const mixed = mixStereoBuffers([trackA, trackB]);
    const mastered = applyStereoPan(applyStereoGain(mixed, 0.8), 0.0);
    const mono = downmixStereoToMono(mastered);

    // The mix should have audible signal
    expect(rms(mono)).toBeGreaterThan(0);

    // Track B (volume 0.8) should contribute more than track A (volume 0.4)
    const monoA = downmixStereoToMono(applyStereoPan(applyStereoGain(monoToStereo(signalA), 0.4), 0.0));
    const monoB = downmixStereoToMono(applyStereoPan(applyStereoGain(monoToStereo(signalB), 0.8), 0.0));
    expect(rms(monoB)).toBeGreaterThan(rms(monoA));
    expect(rms(monoB) / rms(monoA)).toBeCloseTo(2.0, 1); // 0.8/0.4 = 2x
  });

  it('panned tracks mix into correct stereo field before downmix', () => {
    const signalL = sineWave(440, SR, 0.5, 0.5);
    const signalR = sineWave(880, SR, 0.5, 0.5);

    const trackL = applyStereoPan(applyStereoGain(monoToStereo(signalL), 0.8), -1.0);
    const trackR = applyStereoPan(applyStereoGain(monoToStereo(signalR), 0.8), 1.0);
    const mixed = mixStereoBuffers([trackL, trackR]);

    // Left channel should have signalL, right channel should have signalR
    expect(rms(mixed.left)).toBeGreaterThan(0.1);
    expect(rms(mixed.right)).toBeGreaterThan(0.1);

    // Cross-channel leakage should be negligible (hard-panned)
    // At pan=-1: left gets cos(0)=1, right gets sin(0)=0
    // At pan=+1: left gets cos(pi/2)=0, right gets sin(pi/2)=1
    // So mixed.left is mostly signalL, mixed.right is mostly signalR
    // We can verify by checking that the left channel RMS is close to
    // what signalL alone would produce
    const expectedLeftRms = rms(signalL) * 0.8; // gain * original RMS
    expect(rms(mixed.left)).toBeCloseTo(expectedLeftRms, 2);
  });

  it('master volume=0 silences everything regardless of track volume', () => {
    const signal = sineWave(440, SR, 0.5, 0.8);
    const track = applyStereoPan(applyStereoGain(monoToStereo(signal), 1.0), 0.0);
    const mixed = mixStereoBuffers([track]);
    const mastered = applyStereoGain(mixed, 0.0); // master volume = 0
    const mono = downmixStereoToMono(mastered);

    expect(rms(mono)).toBe(0);
    expect(peak(mono)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Polyphony: overlapping notes use separate voices
// ---------------------------------------------------------------------------

describe('polyphony — 4-voice pool live audio integration', () => {
  it('4 overlapping notes use 4 distinct voices with no stealing', () => {
    const voices = Array.from({ length: 4 }, () => makePoolVoice());
    const pool = new VoicePool(voices);

    const makeNote = (time: number, gateOff: number, noteVal: number) => ({
      trackId: 'v0',
      time,
      gateOffTime: gateOff,
      accent: false,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: noteVal },
    });

    // Schedule 4 simultaneous notes at different pitches
    const allocated = [
      pool.scheduleNote(makeNote(1.0, 2.0, 0.3), 1, 'e1'),
      pool.scheduleNote(makeNote(1.0, 2.0, 0.4), 1, 'e2'),
      pool.scheduleNote(makeNote(1.0, 2.0, 0.5), 1, 'e3'),
      pool.scheduleNote(makeNote(1.0, 2.0, 0.6), 1, 'e4'),
    ];

    // All four voices are distinct
    const uniqueVoices = new Set(allocated);
    expect(uniqueVoices.size).toBe(4);

    // Each voice received exactly one scheduleNote call
    for (const voice of voices) {
      expect(voice.synth.scheduleNote).toHaveBeenCalledTimes(1);
    }

    // Event tracking works for all 4
    expect(pool.getVoiceForEvent('e1')).toBe(voices[0]);
    expect(pool.getVoiceForEvent('e2')).toBe(voices[1]);
    expect(pool.getVoiceForEvent('e3')).toBe(voices[2]);
    expect(pool.getVoiceForEvent('e4')).toBe(voices[3]);
  });

  it('5th note steals the oldest voice (round-robin) when all 4 are active', () => {
    const voices = Array.from({ length: 4 }, () => makePoolVoice());
    const pool = new VoicePool(voices);

    const makeNote = (time: number, gateOff: number) => ({
      trackId: 'v0',
      time,
      gateOffTime: gateOff,
      accent: false,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    });

    // Fill all 4 voices with active notes
    pool.scheduleNote(makeNote(1.0, 5.0), 1);
    pool.scheduleNote(makeNote(1.1, 5.0), 1);
    pool.scheduleNote(makeNote(1.2, 5.0), 1);
    pool.scheduleNote(makeNote(1.3, 5.0), 1);

    // 5th note steals voice 0 (round-robin wraps)
    const stolen = pool.scheduleNote(makeNote(1.4, 5.0), 1);
    expect(stolen).toBe(voices[0]);
    expect(voices[0].synth.scheduleNote).toHaveBeenCalledTimes(2);
  });

  it('released voice is reused before stealing an active voice', () => {
    const voices = Array.from({ length: 4 }, () => makePoolVoice());
    const pool = new VoicePool(voices);

    const makeNote = (time: number, gateOff: number) => ({
      trackId: 'v0',
      time,
      gateOffTime: gateOff,
      accent: false,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.47 },
    });

    // Fill all 4 voices; voice 0 has an early gate-off
    pool.scheduleNote(makeNote(1.0, 1.5), 1);  // voice 0 — released by t=2.0
    pool.scheduleNote(makeNote(1.1, 5.0), 1);  // voice 1 — still active
    pool.scheduleNote(makeNote(1.2, 5.0), 1);  // voice 2 — still active
    pool.scheduleNote(makeNote(1.3, 5.0), 1);  // voice 3 — still active

    // At t=2.0, voice 0 is released; new note should reuse it
    const reused = pool.allocate(2.0);
    expect(reused).toBe(voices[0]);
  });
});

// ---------------------------------------------------------------------------
// 7. Gain clamping edge cases
// ---------------------------------------------------------------------------

describe('gain/pan edge cases', () => {
  it('applyStereoGain clamps gain to [0, 1]', () => {
    const signal = sineWave(440, SR, 0.1, 0.5);
    const stereo = monoToStereo(signal);

    // Gain > 1 should be clamped to 1
    const over = applyStereoGain(stereo, 1.5);
    const at1 = applyStereoGain(stereo, 1.0);
    expect(rms(over.left)).toBeCloseTo(rms(at1.left), 5);

    // Gain < 0 should be clamped to 0
    const under = applyStereoGain(stereo, -0.5);
    expect(rms(under.left)).toBe(0);
  });

  it('applyStereoPan clamps pan to [-1, 1]', () => {
    const signal = sineWave(440, SR, 0.1, 0.5);
    const stereo = monoToStereo(signal);

    // Pan beyond limits should be clamped
    const beyond = applyStereoPan(stereo, -2.0);
    const atNeg1 = applyStereoPan(stereo, -1.0);
    expect(rms(beyond.left)).toBeCloseTo(rms(atNeg1.left), 5);
    expect(rms(beyond.right)).toBeCloseTo(rms(atNeg1.right), 5);
  });
});
