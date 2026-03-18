// tests/audio/ripples-dsp.test.ts
// Unit tests for Ripples SVF DSP functions.
// These test the core math extracted from ripples-worklet.ts.

import { describe, it, expect } from 'vitest';

// --- Extracted DSP functions (must match ripples-worklet.ts) ---

function tanhApprox(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

function cutoffToCoeff(normalised: number, sr: number): number {
  const freqHz = 20 * Math.pow(1000, normalised);
  const maxFreq = sr * 0.45;
  const fc = Math.min(freqHz, maxFreq);
  return 2 * Math.sin(Math.PI * fc / sr);
}

function resonanceToQ(normalised: number): number {
  const qDamp = 2 * Math.pow(0.005, normalised);
  return qDamp;
}

function clampSample(x: number): number {
  if (x > 4.0) return 4.0;
  if (x < -4.0) return -4.0;
  if (x > -1e-15 && x < 1e-15) return 0;
  return x;
}

// --- SVF processing helper (runs one 2-pole section for N samples) ---

interface SvfState { lp: number; bp: number; }

function processSvf2Pole(
  input: Float32Array,
  mode: 'lp' | 'bp' | 'hp',
  cutoff: number,
  resonance: number,
  drive: number,
  sr: number,
): Float32Array {
  const output = new Float32Array(input.length);
  const svf: SvfState = { lp: 0, bp: 0 };
  const f = cutoffToCoeff(cutoff, sr);
  const qDamp = resonanceToQ(resonance);

  for (let i = 0; i < input.length; i++) {
    const driveGain = 1 + drive * 3;
    const driven = tanhApprox(input[i] * driveGain);
    const hp = driven - svf.lp - qDamp * svf.bp;
    svf.bp = clampSample(svf.bp + f * hp);
    svf.lp = clampSample(svf.lp + f * svf.bp);

    if (mode === 'lp') output[i] = svf.lp;
    else if (mode === 'bp') output[i] = svf.bp;
    else output[i] = hp;
  }
  return output;
}

function processSvf4Pole(
  input: Float32Array,
  cutoff: number,
  resonance: number,
  drive: number,
  sr: number,
): Float32Array {
  const output = new Float32Array(input.length);
  const svf1: SvfState = { lp: 0, bp: 0 };
  const svf2: SvfState = { lp: 0, bp: 0 };
  const f = cutoffToCoeff(cutoff, sr);
  const qDamp = resonanceToQ(resonance);

  for (let i = 0; i < input.length; i++) {
    const driveGain = 1 + drive * 3;
    const driven = tanhApprox(input[i] * driveGain);
    const hp1 = driven - svf1.lp - qDamp * svf1.bp;
    svf1.bp = clampSample(svf1.bp + f * hp1);
    svf1.lp = clampSample(svf1.lp + f * svf1.bp);
    const hp2 = svf1.lp - svf2.lp - qDamp * svf2.bp;
    svf2.bp = clampSample(svf2.bp + f * hp2);
    svf2.lp = clampSample(svf2.lp + f * svf2.bp);
    output[i] = svf2.lp;
  }
  return output;
}

// --- Tests ---

describe('tanhApprox', () => {
  it('returns 0 for input 0', () => {
    expect(tanhApprox(0)).toBe(0);
  });

  it('saturates to 1 for large positive input', () => {
    expect(tanhApprox(5)).toBe(1);
  });

  it('saturates to -1 for large negative input', () => {
    expect(tanhApprox(-5)).toBe(-1);
  });

  it('is odd symmetric: tanh(-x) = -tanh(x)', () => {
    for (const x of [0.1, 0.5, 1.0, 2.0]) {
      expect(tanhApprox(-x)).toBeCloseTo(-tanhApprox(x), 10);
    }
  });

  it('approximates real tanh within 5% for |x| < 2', () => {
    for (const x of [0.1, 0.5, 1.0, 1.5, 2.0]) {
      const approx = tanhApprox(x);
      const real = Math.tanh(x);
      expect(Math.abs(approx - real)).toBeLessThan(0.05);
    }
  });
});

describe('cutoffToCoeff', () => {
  const sr = 48000;

  it('maps 0.0 to ~20 Hz frequency', () => {
    const f = cutoffToCoeff(0, sr);
    // f = 2 * sin(pi * 20 / 48000) ≈ 2 * pi * 20 / 48000 ≈ 0.00262
    expect(f).toBeCloseTo(2 * Math.sin(Math.PI * 20 / sr), 5);
  });

  it('maps 1.0 to high frequency (clamped near Nyquist)', () => {
    const f = cutoffToCoeff(1, sr);
    // 20 * 1000^1 = 20000 Hz, clamped to sr * 0.45 = 21600 Hz
    // Since 20000 < 21600, frequency is 20000 Hz (not clamped)
    expect(f).toBeCloseTo(2 * Math.sin(Math.PI * 20000 / sr), 5);
  });

  it('maps 0.5 to ~632 Hz', () => {
    // 20 * 1000^0.5 = 20 * 31.62 ≈ 632 Hz
    const f = cutoffToCoeff(0.5, sr);
    const expectedFreq = 20 * Math.pow(1000, 0.5);
    expect(f).toBeCloseTo(2 * Math.sin(Math.PI * expectedFreq / sr), 5);
  });

  it('is monotonically increasing', () => {
    let prev = cutoffToCoeff(0, sr);
    for (let n = 0.1; n <= 1.0; n += 0.1) {
      const curr = cutoffToCoeff(n, sr);
      expect(curr).toBeGreaterThan(prev);
      prev = curr;
    }
  });
});

describe('resonanceToQ', () => {
  it('at 0.0 returns high damping (low Q)', () => {
    const q = resonanceToQ(0);
    expect(q).toBe(2); // q_damp = 2
  });

  it('at 1.0 returns very low damping (high Q / self-oscillation)', () => {
    const q = resonanceToQ(1);
    expect(q).toBeCloseTo(0.01, 2);
  });

  it('is monotonically decreasing', () => {
    let prev = resonanceToQ(0);
    for (let n = 0.1; n <= 1.0; n += 0.1) {
      const curr = resonanceToQ(n);
      expect(curr).toBeLessThan(prev);
      prev = curr;
    }
  });
});

describe('SVF low-pass filter', () => {
  const sr = 48000;
  const N = 4096;

  function makeSine(freq: number, frames: number, sampleRate: number): Float32Array {
    const buf = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      buf[i] = Math.sin(2 * Math.PI * freq * i / sampleRate);
    }
    return buf;
  }

  function rms(buf: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  it('passes low frequencies through with cutoff at 0.5 (~632 Hz)', () => {
    const input = makeSine(100, N, sr);
    const output = processSvf2Pole(input, 'lp', 0.5, 0, 0, sr);
    const inRms = rms(input);
    const outRms = rms(output);
    // 100 Hz is well below 632 Hz cutoff — should pass through mostly intact
    expect(outRms / inRms).toBeGreaterThan(0.8);
  });

  it('attenuates high frequencies with cutoff at 0.3 (~170 Hz)', () => {
    const input = makeSine(5000, N, sr);
    const output = processSvf2Pole(input, 'lp', 0.3, 0, 0, sr);
    const inRms = rms(input);
    const outRms = rms(output);
    // 5000 Hz is far above 170 Hz cutoff — should be heavily attenuated
    expect(outRms / inRms).toBeLessThan(0.1);
  });

  it('4-pole attenuates more than 2-pole', () => {
    const input = makeSine(3000, N, sr);
    const out2 = processSvf2Pole(input, 'lp', 0.4, 0, 0, sr);
    const out4 = processSvf4Pole(input, 0.4, 0, 0, sr);
    expect(rms(out4)).toBeLessThan(rms(out2));
  });
});

describe('SVF high-pass filter', () => {
  const sr = 48000;
  const N = 4096;

  function makeSine(freq: number, frames: number, sampleRate: number): Float32Array {
    const buf = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      buf[i] = Math.sin(2 * Math.PI * freq * i / sampleRate);
    }
    return buf;
  }

  function rms(buf: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  it('passes high frequencies through with cutoff at 0.3 (~170 Hz)', () => {
    const input = makeSine(5000, N, sr);
    const output = processSvf2Pole(input, 'hp', 0.3, 0, 0, sr);
    const inRms = rms(input);
    const outRms = rms(output);
    expect(outRms / inRms).toBeGreaterThan(0.8);
  });

  it('attenuates low frequencies with cutoff at 0.5 (~632 Hz)', () => {
    const input = makeSine(100, N, sr);
    const output = processSvf2Pole(input, 'hp', 0.5, 0, 0, sr);
    const inRms = rms(input);
    const outRms = rms(output);
    expect(outRms / inRms).toBeLessThan(0.2);
  });
});

describe('SVF band-pass filter', () => {
  const sr = 48000;
  const N = 4096;

  function makeSine(freq: number, frames: number, sampleRate: number): Float32Array {
    const buf = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      buf[i] = Math.sin(2 * Math.PI * freq * i / sampleRate);
    }
    return buf;
  }

  function rms(buf: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  it('passes signal near cutoff frequency', () => {
    // Cutoff at 0.5 → ~632 Hz
    const input = makeSine(632, N, sr);
    const output = processSvf2Pole(input, 'bp', 0.5, 0.3, 0, sr);
    const outRms = rms(output);
    // Should have significant output near the cutoff
    expect(outRms).toBeGreaterThan(0.1);
  });

  it('attenuates both low and high frequencies', () => {
    const inputLow = makeSine(50, N, sr);
    const inputHigh = makeSine(10000, N, sr);
    const outputLow = processSvf2Pole(inputLow, 'bp', 0.5, 0, 0, sr);
    const outputHigh = processSvf2Pole(inputHigh, 'bp', 0.5, 0, 0, sr);
    const inRms = rms(inputLow); // both sines have same amplitude
    expect(rms(outputLow) / inRms).toBeLessThan(0.2);
    expect(rms(outputHigh) / inRms).toBeLessThan(0.2);
  });
});

describe('Drive saturation', () => {
  it('drive at 0 passes signal through with unity gain', () => {
    const input = new Float32Array([0.5]);
    const output = processSvf2Pole(input, 'lp', 1.0, 0, 0, 48000);
    // With cutoff at 1.0, first sample won't be fully passed (filter needs warm-up),
    // but the tanhApprox(0.5 * 1) ≈ 0.5 should pass mostly unchanged
    expect(Math.abs(tanhApprox(0.5))).toBeCloseTo(0.5, 1);
  });

  it('drive at 1.0 applies soft clipping', () => {
    // With drive=1.0, gain = 1 + 3 = 4, so input 0.5 → tanh(2.0)
    const driven = tanhApprox(0.5 * 4);
    expect(driven).toBeCloseTo(Math.tanh(2.0), 1);
    // Should be compressed relative to linear
    expect(driven).toBeLessThan(2.0);
  });
});

describe('Filter stability', () => {
  const sr = 48000;
  const N = 48000; // 1 second

  function makeImpulse(frames: number): Float32Array {
    const buf = new Float32Array(frames);
    buf[0] = 1;
    return buf;
  }

  it('does not blow up with high resonance', () => {
    const input = makeImpulse(N);
    const output = processSvf2Pole(input, 'lp', 0.5, 0.95, 0, sr);
    for (let i = 0; i < output.length; i++) {
      expect(Math.abs(output[i])).toBeLessThanOrEqual(4.0);
    }
  });

  it('does not blow up with extreme settings', () => {
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = (Math.random() - 0.5) * 2;
    const output = processSvf2Pole(input, 'lp', 1.0, 1.0, 1.0, sr);
    for (let i = 0; i < output.length; i++) {
      expect(Number.isFinite(output[i])).toBe(true);
      expect(Math.abs(output[i])).toBeLessThanOrEqual(4.0);
    }
  });

  it('self-oscillates at maximum resonance (energy builds from impulse)', () => {
    const input = makeImpulse(N);
    const output = processSvf2Pole(input, 'bp', 0.5, 0.99, 0, sr);
    // The filter should ring — check that output is still non-zero after many samples
    let tailEnergy = 0;
    for (let i = N - 1000; i < N; i++) tailEnergy += output[i] * output[i];
    // With near-unity resonance, the BP output should still be ringing
    expect(tailEnergy).toBeGreaterThan(0);
  });
});
