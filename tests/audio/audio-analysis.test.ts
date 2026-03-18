import { describe, expect, it } from 'vitest';
import {
  analyzeSpectral,
  analyzeDynamics,
  analyzeRhythm,
  analyzeMasking,
  analyzeDiff,
  computeBandEnergies,
  fft,
  hannWindow,
  computeMagnitudeSpectrum,
} from '../../src/audio/audio-analysis';
import type { TrackAudio } from '../../src/audio/audio-analysis';

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

// ---------------------------------------------------------------------------
// Band energies
// ---------------------------------------------------------------------------

describe('computeBandEnergies', () => {
  it('puts a 100Hz sine energy in the low band', () => {
    const samples = sineWave(100, SR, 1.0);
    const energies = computeBandEnergies(samples, SR);

    // The "low" band (60-200Hz) should have the most energy
    expect(energies['low']).toBeGreaterThan(energies['mid']);
    expect(energies['low']).toBeGreaterThan(energies['high']);
  });

  it('puts a 1kHz sine energy in the mid band', () => {
    const samples = sineWave(1000, SR, 1.0);
    const energies = computeBandEnergies(samples, SR);

    expect(energies['mid']).toBeGreaterThan(energies['sub']);
    expect(energies['mid']).toBeGreaterThan(energies['low']);
  });

  it('returns -Infinity for all bands on silence', () => {
    const samples = silence(SR, 1.0);
    const energies = computeBandEnergies(samples, SR);

    for (const band of ['sub', 'low', 'low-mid', 'mid', 'high-mid', 'high']) {
      expect(energies[band]).toBe(-Infinity);
    }
  });
});

// ---------------------------------------------------------------------------
// Masking analysis (cross-track frequency conflict detection)
// ---------------------------------------------------------------------------

describe('analyzeMasking', () => {
  it('returns empty conflicts with fewer than 2 tracks', () => {
    const single: TrackAudio[] = [
      { trackId: 'kick', pcm: sineWave(50, SR, 1.0), sampleRate: SR },
    ];
    const result = analyzeMasking(single);
    expect(result.conflicts).toEqual([]);
    expect(result.confidence).toBe(0);
  });

  it('detects conflict between two tracks in the same frequency range', () => {
    // Both tracks have energy at ~80Hz (sub/low range)
    const kick: TrackAudio = { trackId: 'kick', pcm: sineWave(80, SR, 1.0), sampleRate: SR };
    const bass: TrackAudio = { trackId: 'bass', pcm: sineWave(80, SR, 1.0), sampleRate: SR };

    const result = analyzeMasking([kick, bass]);

    expect(result.conflicts.length).toBeGreaterThan(0);
    // Should find a conflict in sub or low band
    const lowConflicts = result.conflicts.filter(c =>
      c.bandLabel === 'sub' || c.bandLabel === 'low',
    );
    expect(lowConflicts.length).toBeGreaterThan(0);

    // Both tracks should appear in the conflict
    const conflict = lowConflicts[0];
    expect(conflict.tracks).toContain('kick');
    expect(conflict.tracks).toContain('bass');
    expect(conflict.severity).toBe('high');
    expect(conflict.overlapRatio).toBeGreaterThan(0.5);
  });

  it('finds no conflict between spectrally separated tracks', () => {
    // Kick at 50Hz, hi-hat simulated at 8kHz — very different ranges
    const kick: TrackAudio = { trackId: 'kick', pcm: sineWave(50, SR, 1.0), sampleRate: SR };
    const hihat: TrackAudio = { trackId: 'hihat', pcm: sineWave(8000, SR, 1.0), sampleRate: SR };

    const result = analyzeMasking([kick, hihat]);

    // Should have no high-severity conflicts
    const highConflicts = result.conflicts.filter(c => c.severity === 'high');
    expect(highConflicts.length).toBe(0);
  });

  it('returns track profiles with band energies for every track', () => {
    const kick: TrackAudio = { trackId: 'kick', pcm: sineWave(80, SR, 1.0), sampleRate: SR };
    const bass: TrackAudio = { trackId: 'bass', pcm: sineWave(100, SR, 1.0), sampleRate: SR };

    const result = analyzeMasking([kick, bass]);

    expect(result.trackProfiles).toHaveProperty('kick');
    expect(result.trackProfiles).toHaveProperty('bass');
    expect(result.trackProfiles['kick']).toHaveProperty('sub');
    expect(result.trackProfiles['kick']).toHaveProperty('low');
    expect(result.trackProfiles['kick']).toHaveProperty('mid');
  });

  it('handles silent tracks gracefully', () => {
    const kick: TrackAudio = { trackId: 'kick', pcm: sineWave(80, SR, 1.0), sampleRate: SR };
    const silent: TrackAudio = { trackId: 'silent', pcm: silence(SR, 1.0), sampleRate: SR };

    const result = analyzeMasking([kick, silent]);

    // Should not crash and should find no conflicts (only one active track)
    expect(result.conflicts).toEqual([]);
  });

  it('generates suggestions for conflicts', () => {
    const kick: TrackAudio = { trackId: 'kick', pcm: sineWave(80, SR, 1.0), sampleRate: SR };
    const bass: TrackAudio = { trackId: 'bass', pcm: sineWave(80, SR, 1.0), sampleRate: SR };

    const result = analyzeMasking([kick, bass]);
    const conflicts = result.conflicts.filter(c => c.tracks.length >= 2);

    expect(conflicts.length).toBeGreaterThan(0);
    for (const c of conflicts) {
      expect(c.suggestion).toBeTruthy();
      expect(typeof c.suggestion).toBe('string');
      expect(c.suggestion.length).toBeGreaterThan(10);
    }
  });

  it('sorts conflicts by severity (high first)', () => {
    // Create tracks that overlap in multiple bands with different severities
    const kick: TrackAudio = { trackId: 'kick', pcm: sineWave(80, SR, 1.0, 0.8), sampleRate: SR };
    const bass: TrackAudio = { trackId: 'bass', pcm: sineWave(80, SR, 1.0, 0.8), sampleRate: SR };

    const result = analyzeMasking([kick, bass]);

    if (result.conflicts.length >= 2) {
      const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      for (let i = 1; i < result.conflicts.length; i++) {
        expect(severityOrder[result.conflicts[i].severity])
          .toBeGreaterThanOrEqual(severityOrder[result.conflicts[i - 1].severity]);
      }
    }
  });

  it('handles three tracks competing in the same range', () => {
    const kick: TrackAudio = { trackId: 'kick', pcm: sineWave(80, SR, 1.0), sampleRate: SR };
    const bass: TrackAudio = { trackId: 'bass', pcm: sineWave(85, SR, 1.0), sampleRate: SR };
    const sub: TrackAudio = { trackId: 'sub', pcm: sineWave(75, SR, 1.0), sampleRate: SR };

    const result = analyzeMasking([kick, bass, sub]);

    expect(result.conflicts.length).toBeGreaterThan(0);
    // At least one conflict should reference all three tracks
    const multiTrackConflicts = result.conflicts.filter(c => c.tracks.length >= 3);
    // Or at least two tracks
    const anyConflicts = result.conflicts.filter(c => c.tracks.length >= 2);
    expect(anyConflicts.length).toBeGreaterThan(0);
  });

  it('returns confidence > 0 for valid multi-track input', () => {
    const kick: TrackAudio = { trackId: 'kick', pcm: sineWave(80, SR, 1.0), sampleRate: SR };
    const bass: TrackAudio = { trackId: 'bass', pcm: sineWave(100, SR, 1.0), sampleRate: SR };

    const result = analyzeMasking([kick, bass]);
    expect(result.confidence).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Diff analysis
// ---------------------------------------------------------------------------

describe('analyzeDiff', () => {
  it('returns all expected top-level keys', () => {
    const before = sineWave(440, SR, 1.0);
    const after = sineWave(880, SR, 1.0);
    const result = analyzeDiff(before, after, SR);
    expect(result).toHaveProperty('spectral');
    expect(result).toHaveProperty('dynamics');
    expect(result).toHaveProperty('rhythm');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('confidence');
  });

  it('detects pitch increase when frequency doubles', () => {
    const before = sineWave(220, SR, 1.0);
    const after = sineWave(440, SR, 1.0);
    const result = analyzeDiff(before, after, SR);
    // Fundamental should increase
    expect(result.spectral.fundamental.delta).toBeGreaterThan(0);
    expect(result.spectral.fundamental.after).toBeGreaterThan(result.spectral.fundamental.before);
  });

  it('detects loudness increase when amplitude increases', () => {
    const before = sineWave(440, SR, 1.0, 0.1);
    const after = sineWave(440, SR, 1.0, 0.8);
    const result = analyzeDiff(before, after, SR);
    // LUFS should increase (louder)
    expect(result.dynamics.lufs.delta).toBeGreaterThan(0);
    expect(result.dynamics.rms.delta).toBeGreaterThan(0);
  });

  it('detects brightness increase when switching to higher frequency', () => {
    const before = sineWave(200, SR, 1.0);
    const after = sineWave(4000, SR, 1.0);
    const result = analyzeDiff(before, after, SR);
    // Spectral centroid should increase significantly
    expect(result.spectral.centroid.delta).toBeGreaterThan(0);
  });

  it('returns no significant differences for identical signals', () => {
    const signal = sineWave(440, SR, 1.0);
    const result = analyzeDiff(signal, signal, SR);
    // Deltas should all be zero or near-zero
    expect(result.spectral.centroid.delta).toBeCloseTo(0, 1);
    expect(result.dynamics.lufs.delta).toBeCloseTo(0, 1);
    expect(result.summary).toBe('No significant differences detected.');
  });

  it('includes summary with notable changes', () => {
    const before = sineWave(200, SR, 1.0, 0.1);
    const after = sineWave(4000, SR, 1.0, 0.8);
    const result = analyzeDiff(before, after, SR);
    expect(result.summary).not.toBe('No significant differences detected.');
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('passes through bpm to rhythm analysis', () => {
    const before = sineWave(440, SR, 2.0);
    const after = sineWave(440, SR, 2.0);
    const result = analyzeDiff(before, after, SR, 120);
    // Should not throw and should return valid result
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('handles silent before signal gracefully', () => {
    const before = new Float32Array(SR); // 1s of silence
    const after = sineWave(440, SR, 1.0);
    const result = analyzeDiff(before, after, SR);
    expect(result).toHaveProperty('summary');
    // Confidence should be lower due to silent signal
    expect(result.confidence).toBeLessThan(1);
  });

  it('metric deltas have correct structure', () => {
    const before = sineWave(440, SR, 1.0);
    const after = sineWave(880, SR, 1.0);
    const result = analyzeDiff(before, after, SR);
    const delta = result.spectral.centroid;
    expect(delta).toHaveProperty('before');
    expect(delta).toHaveProperty('after');
    expect(delta).toHaveProperty('delta');
    expect(delta).toHaveProperty('description');
    expect(typeof delta.before).toBe('number');
    expect(typeof delta.after).toBe('number');
    expect(typeof delta.delta).toBe('number');
    expect(typeof delta.description).toBe('string');
  });
});
