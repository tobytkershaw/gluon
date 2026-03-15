import { describe, expect, it } from 'vitest';
import {
  analyzeSpectral,
  analyzeDynamics,
  analyzeRhythm,
  fft,
  hannWindow,
  computeMagnitudeSpectrum,
} from '../../src/audio/audio-analysis';

// ---------------------------------------------------------------------------
// Test signal generators
// ---------------------------------------------------------------------------

/** Generate a sine wave at the given frequency. */
function sineWave(freq: number, sampleRate: number, duration: number, amplitude = 0.5): Float32Array {
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = amplitude * Math.sin(2 * Math.PI * freq * i / sampleRate);
  }
  return samples;
}

/** Generate white noise. */
function whiteNoise(sampleRate: number, duration: number, amplitude = 0.5): Float32Array {
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);
  // Use a simple deterministic PRNG for reproducibility
  let seed = 12345;
  for (let i = 0; i < numSamples; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    samples[i] = amplitude * ((seed / 0x7fffffff) * 2 - 1);
  }
  return samples;
}

/** Generate silence. */
function silence(sampleRate: number, duration: number): Float32Array {
  return new Float32Array(Math.floor(sampleRate * duration));
}

/** Generate a click train (impulses at regular intervals with a short burst). */
function clickTrain(intervalMs: number, sampleRate: number, duration: number, amplitude = 0.8): Float32Array {
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);
  const intervalSamples = Math.floor(sampleRate * intervalMs / 1000);
  // Each click is a short burst (~5ms) of noise-like energy — long enough
  // to register clearly in 10ms analysis frames.
  const burstLen = Math.floor(sampleRate * 0.005);
  for (let i = 0; i < numSamples; i += intervalSamples) {
    for (let j = 0; j < Math.min(burstLen, numSamples - i); j++) {
      // Damped sine burst at ~1kHz for broadband energy
      samples[i + j] = amplitude * Math.sin(2 * Math.PI * 1000 * j / sampleRate) * Math.exp(-j / (burstLen * 0.3));
    }
  }
  return samples;
}

const SR = 48000;

// ---------------------------------------------------------------------------
// FFT utilities
// ---------------------------------------------------------------------------

describe('fft', () => {
  it('produces correct magnitudes for a known cosine input', () => {
    const N = 256;
    const re = new Float64Array(N);
    const im = new Float64Array(N);

    // cos(2*pi*k*n/N) for k=10 should produce a peak at bin 10
    const k = 10;
    for (let n = 0; n < N; n++) {
      re[n] = Math.cos(2 * Math.PI * k * n / N);
    }

    fft(re, im);

    // The energy should concentrate at bins k and N-k
    const mag10 = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    const magOther = Math.sqrt(re[k + 5] * re[k + 5] + im[k + 5] * im[k + 5]);

    expect(mag10).toBeGreaterThan(N / 4); // should be ~N/2
    expect(magOther).toBeLessThan(1);     // other bins should be near zero
  });

  it('handles a single-sample input without crashing', () => {
    const re = new Float64Array([1]);
    const im = new Float64Array([0]);
    fft(re, im);
    expect(re[0]).toBe(1);
  });
});

describe('hannWindow', () => {
  it('produces a symmetric window with zero endpoints', () => {
    const w = hannWindow(256);
    expect(w.length).toBe(256);
    expect(w[0]).toBeCloseTo(0, 10);
    expect(w[255]).toBeCloseTo(0, 10);
    expect(w[128]).toBeCloseTo(1, 1); // peak near center
  });
});

describe('computeMagnitudeSpectrum', () => {
  it('detects dominant frequency of a sine wave', () => {
    const freq = 440;
    const samples = sineWave(freq, SR, 0.1);
    const fftSize = 2048;
    const mags = computeMagnitudeSpectrum(samples, 0, fftSize);

    // Find peak bin
    let peakBin = 0;
    let peakVal = 0;
    for (let i = 1; i < mags.length; i++) {
      if (mags[i] > peakVal) {
        peakVal = mags[i];
        peakBin = i;
      }
    }

    const peakFreq = (peakBin * SR) / fftSize;
    // Should be within one bin of 440 Hz (bin resolution ~23.4 Hz)
    expect(Math.abs(peakFreq - freq)).toBeLessThan(SR / fftSize + 1);
  });
});

// ---------------------------------------------------------------------------
// Spectral analysis
// ---------------------------------------------------------------------------

describe('analyzeSpectral', () => {
  it('detects a low-frequency sine as tonal with low centroid', () => {
    const samples = sineWave(100, SR, 1.0);
    const result = analyzeSpectral(samples, SR);

    expect(result.signal_type).toBe('tonal');
    expect(result.spectral_centroid).toBeLessThan(0.1); // low frequency = low centroid
    expect(result.fundamental_estimate).toBeGreaterThan(50);
    expect(result.fundamental_estimate).toBeLessThan(200);
    expect(result.pitch_stability).toBeGreaterThan(0.5);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('detects a high-frequency sine as brighter than a low one', () => {
    const low = analyzeSpectral(sineWave(200, SR, 1.0), SR);
    const high = analyzeSpectral(sineWave(4000, SR, 1.0), SR);

    expect(high.spectral_centroid).toBeGreaterThan(low.spectral_centroid);
  });

  it('detects white noise as having high flatness', () => {
    const samples = whiteNoise(SR, 1.0);
    const result = analyzeSpectral(samples, SR);

    expect(result.spectral_flatness).toBeGreaterThan(0.1);
    expect(result.signal_type).not.toBe('tonal');
  });

  it('returns low confidence for near-silent signals', () => {
    const samples = sineWave(440, SR, 1.0, 0.0001);
    const result = analyzeSpectral(samples, SR);

    expect(result.confidence).toBeLessThan(0.5);
  });

  it('returns zero confidence for silence', () => {
    const samples = silence(SR, 1.0);
    const result = analyzeSpectral(samples, SR);

    expect(result.confidence).toBe(0);
    expect(result.signal_type).toBe('noise');
  });

  it('returns values in expected ranges', () => {
    const samples = sineWave(440, SR, 1.0);
    const result = analyzeSpectral(samples, SR);

    expect(result.spectral_centroid).toBeGreaterThanOrEqual(0);
    expect(result.spectral_centroid).toBeLessThanOrEqual(1);
    expect(result.spectral_rolloff).toBeGreaterThanOrEqual(0);
    expect(result.spectral_rolloff).toBeLessThanOrEqual(1);
    expect(result.spectral_flatness).toBeGreaterThanOrEqual(0);
    expect(result.spectral_flatness).toBeLessThanOrEqual(1);
    expect(result.spectral_bandwidth).toBeGreaterThanOrEqual(0);
    expect(result.spectral_bandwidth).toBeLessThanOrEqual(1);
    expect(result.pitch_stability).toBeGreaterThanOrEqual(0);
    expect(result.pitch_stability).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Dynamics analysis
// ---------------------------------------------------------------------------

describe('analyzeDynamics', () => {
  it('measures peak and RMS correctly for a known sine', () => {
    const amplitude = 0.5;
    const samples = sineWave(440, SR, 1.0, amplitude);
    const result = analyzeDynamics(samples, SR);

    // Peak should be close to amplitude in dB: 20*log10(0.5) ≈ -6.02
    expect(result.peak).toBeCloseTo(-6.02, 0);

    // RMS of a sine is amplitude/sqrt(2): 20*log10(0.5/sqrt(2)) ≈ -9.03
    expect(result.rms).toBeCloseTo(-9.03, 0);

    // Crest factor for a sine is ~3.01 dB
    expect(result.crest_factor).toBeCloseTo(3.01, 0);

    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('reports louder signal as having higher LUFS than quiet one', () => {
    const loud = analyzeDynamics(sineWave(440, SR, 1.0, 0.8), SR);
    const quiet = analyzeDynamics(sineWave(440, SR, 1.0, 0.1), SR);

    expect(loud.lufs).toBeGreaterThan(quiet.lufs);
  });

  it('returns -Infinity for silence', () => {
    const samples = silence(SR, 1.0);
    const result = analyzeDynamics(samples, SR);

    expect(result.peak).toBe(-Infinity);
    expect(result.rms).toBe(-Infinity);
    expect(result.confidence).toBe(0);
  });

  it('returns zero confidence for empty samples', () => {
    const samples = new Float32Array(0);
    const result = analyzeDynamics(samples, SR);

    expect(result.confidence).toBe(0);
  });

  it('detects dynamic range between loud and quiet sections', () => {
    // Create a signal with loud and quiet sections
    const loud = sineWave(440, SR, 0.5, 0.8);
    const quiet = sineWave(440, SR, 0.5, 0.05);
    const combined = new Float32Array(loud.length + quiet.length);
    combined.set(loud, 0);
    combined.set(quiet, loud.length);

    const result = analyzeDynamics(combined, SR);
    expect(result.dynamic_range).toBeGreaterThan(5); // Should detect significant range
  });
});

// ---------------------------------------------------------------------------
// Rhythm analysis
// ---------------------------------------------------------------------------

describe('analyzeRhythm', () => {
  it('detects onsets in a click train', () => {
    // 120 BPM = 500ms per beat, click every 500ms
    const samples = clickTrain(500, SR, 2.0);
    const result = analyzeRhythm(samples, SR, 120);

    expect(result.onset_count).toBeGreaterThanOrEqual(2);
    expect(result.onset_times.length).toBe(result.onset_count);
    expect(result.tempo_estimate).toBe(120); // echoed from input
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('reports higher density for busier patterns', () => {
    const sparse = clickTrain(500, SR, 2.0);   // quarter notes at 120 BPM
    const dense = clickTrain(125, SR, 2.0);     // sixteenth notes at 120 BPM

    const sparseResult = analyzeRhythm(sparse, SR, 120);
    const denseResult = analyzeRhythm(dense, SR, 120);

    expect(denseResult.rhythmic_density).toBeGreaterThan(sparseResult.rhythmic_density);
  });

  it('returns zero onsets for silence', () => {
    const samples = silence(SR, 1.0);
    const result = analyzeRhythm(samples, SR, 120);

    expect(result.onset_count).toBe(0);
    expect(result.onset_times).toEqual([]);
    expect(result.rhythmic_density).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it('detects fewer onsets in a continuous tone than in a click train', () => {
    // A continuous sine has no true rhythmic onsets, though the detector
    // may pick up energy fluctuations. It should detect far fewer onsets
    // than a genuine rhythmic signal.
    const continuous = analyzeRhythm(sineWave(440, SR, 2.0, 0.5), SR, 120);
    const clicks = analyzeRhythm(clickTrain(250, SR, 2.0), SR, 120);

    // The click train should have more detected onsets than the continuous tone
    expect(clicks.onset_count).toBeGreaterThan(continuous.onset_count);
  });

  it('returns all values in expected ranges', () => {
    const samples = clickTrain(250, SR, 2.0);
    const result = analyzeRhythm(samples, SR, 120);

    expect(result.rhythmic_density).toBeGreaterThanOrEqual(0);
    expect(result.rhythmic_density).toBeLessThanOrEqual(1);
    expect(result.swing_estimate).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.onset_times.every(t => t >= 0)).toBe(true);
  });

  it('echoes provided BPM as tempo_estimate', () => {
    const samples = clickTrain(500, SR, 2.0);
    const result = analyzeRhythm(samples, SR, 140);
    expect(result.tempo_estimate).toBe(140);
  });
});
