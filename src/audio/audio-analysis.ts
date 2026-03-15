// src/audio/audio-analysis.ts — Pure audio analysis functions for AI self-evaluation.
// Each function takes PCM samples + sample rate and returns structured results.
// No side effects, no external dependencies.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpectralResult {
  spectral_centroid: number;    // normalised 0.0-1.0 (brightness)
  spectral_rolloff: number;     // normalised 0.0-1.0 (high-freq energy)
  spectral_flatness: number;    // 0.0 (tonal) to 1.0 (noisy)
  spectral_bandwidth: number;   // normalised 0.0-1.0 (harmonic spread)
  fundamental_estimate: number; // Hz
  pitch_stability: number;      // 0.0-1.0
  signal_type: 'tonal' | 'transient' | 'noise' | 'mixed';
  confidence: number;           // 0.0-1.0
}

export interface DynamicsResult {
  lufs: number;           // integrated loudness (simplified LUFS)
  rms: number;            // dB
  peak: number;           // dB
  crest_factor: number;   // peak-to-RMS ratio in dB
  dynamic_range: number;  // dB
  confidence: number;     // 0.0-1.0
}

export interface RhythmResult {
  tempo_estimate: number;       // BPM (echoed from input when provided)
  onset_count: number;
  onset_times: number[];        // seconds
  rhythmic_density: number;     // 0.0-1.0
  swing_estimate: number;       // 0.0 = straight
  confidence: number;           // 0.0-1.0
}

// ---------------------------------------------------------------------------
// FFT utilities (radix-2 Cooley-Tukey, in-place)
// ---------------------------------------------------------------------------

/**
 * In-place radix-2 FFT. `re` and `im` must have length that is a power of 2.
 * After the call, `re[k]` and `im[k]` hold the real and imaginary parts of bin k.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Butterfly
  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2;
    const angleStep = -2 * Math.PI / size;
    const wRe = Math.cos(angleStep);
    const wIm = Math.sin(angleStep);

    for (let i = 0; i < n; i += size) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < halfSize; j++) {
        const a = i + j;
        const b = a + halfSize;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * Build a Hann window of the given length.
 */
export function hannWindow(length: number): Float64Array {
  const w = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (length - 1)));
  }
  return w;
}

/**
 * Compute magnitude spectrum from PCM samples using Hann-windowed FFT.
 * Returns magnitudes for bins 0..fftSize/2 (inclusive).
 */
export function computeMagnitudeSpectrum(
  samples: Float32Array,
  offset: number,
  fftSize: number,
): Float64Array {
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const window = hannWindow(fftSize);

  const available = Math.min(fftSize, samples.length - offset);
  for (let i = 0; i < available; i++) {
    re[i] = samples[offset + i] * window[i];
  }
  // Remaining bins are already 0 (zero-padded)

  fft(re, im);

  const numBins = fftSize / 2 + 1;
  const magnitudes = new Float64Array(numBins);
  for (let i = 0; i < numBins; i++) {
    magnitudes[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }
  return magnitudes;
}

// ---------------------------------------------------------------------------
// Helper: compute RMS of a Float32Array (or a slice)
// ---------------------------------------------------------------------------

function computeRms(samples: Float32Array, start = 0, end?: number): number {
  const stop = end ?? samples.length;
  let sum = 0;
  for (let i = start; i < stop; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / (stop - start));
}

function ampToDb(amp: number): number {
  return amp > 0 ? 20 * Math.log10(amp) : -Infinity;
}

// ---------------------------------------------------------------------------
// Spectral analysis
// ---------------------------------------------------------------------------

const DEFAULT_FFT_SIZE = 2048;

export function analyzeSpectral(
  samples: Float32Array,
  sampleRate: number,
  fftSize: number = DEFAULT_FFT_SIZE,
): SpectralResult {
  const rms = computeRms(samples);
  const nyquist = sampleRate / 2;

  // Low signal = low confidence
  if (rms < 1e-6) {
    return {
      spectral_centroid: 0,
      spectral_rolloff: 0,
      spectral_flatness: 0,
      spectral_bandwidth: 0,
      fundamental_estimate: 0,
      pitch_stability: 0,
      signal_type: 'noise',
      confidence: 0,
    };
  }

  // Average spectra across multiple frames for more stable results
  const hopSize = fftSize / 2;
  const numFrames = Math.max(1, Math.floor((samples.length - fftSize) / hopSize) + 1);
  const numBins = fftSize / 2 + 1;
  const avgMagnitudes = new Float64Array(numBins);
  const frameCentroids: number[] = [];

  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * hopSize;
    if (offset + fftSize > samples.length) break;

    const magnitudes = computeMagnitudeSpectrum(samples, offset, fftSize);

    // Accumulate for averaging
    for (let i = 0; i < numBins; i++) {
      avgMagnitudes[i] += magnitudes[i];
    }

    // Per-frame centroid for pitch stability measurement
    let frameTotalMag = 0;
    let frameWeightedSum = 0;
    for (let i = 1; i < numBins; i++) {
      const freq = (i * sampleRate) / fftSize;
      frameWeightedSum += freq * magnitudes[i];
      frameTotalMag += magnitudes[i];
    }
    if (frameTotalMag > 0) {
      frameCentroids.push(frameWeightedSum / frameTotalMag);
    }
  }

  const actualFrames = Math.min(numFrames, Math.floor((samples.length - fftSize) / hopSize) + 1);
  for (let i = 0; i < numBins; i++) {
    avgMagnitudes[i] /= actualFrames;
  }

  // --- Spectral centroid (weighted mean frequency, normalised to 0-1) ---
  let totalMag = 0;
  let weightedSum = 0;
  for (let i = 1; i < numBins; i++) {
    const freq = (i * sampleRate) / fftSize;
    weightedSum += freq * avgMagnitudes[i];
    totalMag += avgMagnitudes[i];
  }
  const centroidHz = totalMag > 0 ? weightedSum / totalMag : 0;
  const spectral_centroid = Math.min(1, centroidHz / nyquist);

  // --- Spectral rolloff (frequency below which 85% of energy is concentrated) ---
  let energySum = 0;
  for (let i = 1; i < numBins; i++) {
    energySum += avgMagnitudes[i] * avgMagnitudes[i];
  }
  const rolloffThreshold = 0.85 * energySum;
  let cumulativeEnergy = 0;
  let rolloffBin = numBins - 1;
  for (let i = 1; i < numBins; i++) {
    cumulativeEnergy += avgMagnitudes[i] * avgMagnitudes[i];
    if (cumulativeEnergy >= rolloffThreshold) {
      rolloffBin = i;
      break;
    }
  }
  const rolloffHz = (rolloffBin * sampleRate) / fftSize;
  const spectral_rolloff = Math.min(1, rolloffHz / nyquist);

  // --- Spectral flatness (geometric mean / arithmetic mean of power spectrum) ---
  let logSum = 0;
  let arithmeticSum = 0;
  let validBins = 0;
  for (let i = 1; i < numBins; i++) {
    const power = avgMagnitudes[i] * avgMagnitudes[i];
    if (power > 1e-20) {
      logSum += Math.log(power);
      validBins++;
    }
    arithmeticSum += power;
  }
  const arithmeticMean = arithmeticSum / (numBins - 1);
  let spectral_flatness = 0;
  if (validBins > 0 && arithmeticMean > 1e-20) {
    const geometricMean = Math.exp(logSum / validBins);
    spectral_flatness = Math.min(1, geometricMean / arithmeticMean);
  }

  // --- Spectral bandwidth (std dev of frequency distribution, normalised) ---
  let varianceSum = 0;
  for (let i = 1; i < numBins; i++) {
    const freq = (i * sampleRate) / fftSize;
    const diff = freq - centroidHz;
    varianceSum += avgMagnitudes[i] * diff * diff;
  }
  const bandwidthHz = totalMag > 0 ? Math.sqrt(varianceSum / totalMag) : 0;
  const spectral_bandwidth = Math.min(1, bandwidthHz / nyquist);

  // --- Fundamental estimate (peak bin in spectrum) ---
  let peakBin = 1;
  let peakMag = 0;
  for (let i = 1; i < numBins; i++) {
    if (avgMagnitudes[i] > peakMag) {
      peakMag = avgMagnitudes[i];
      peakBin = i;
    }
  }
  const fundamental_estimate = (peakBin * sampleRate) / fftSize;

  // --- Pitch stability (variance of per-frame centroids) ---
  let pitch_stability = 0;
  if (frameCentroids.length > 1) {
    const meanCentroid = frameCentroids.reduce((a, b) => a + b, 0) / frameCentroids.length;
    const centroidVariance = frameCentroids.reduce((a, c) => a + (c - meanCentroid) ** 2, 0) / frameCentroids.length;
    const centroidStdDev = Math.sqrt(centroidVariance);
    // Normalise: low std dev relative to mean = stable
    const relativeStdDev = meanCentroid > 0 ? centroidStdDev / meanCentroid : 1;
    pitch_stability = Math.max(0, Math.min(1, 1 - relativeStdDev * 5));
  }

  // --- Signal type classification ---
  let signal_type: SpectralResult['signal_type'];
  if (spectral_flatness > 0.5) {
    signal_type = 'noise';
  } else if (pitch_stability > 0.6 && spectral_flatness < 0.2) {
    signal_type = 'tonal';
  } else if (samples.length < sampleRate * 0.1) {
    // Very short signal is likely a transient
    signal_type = 'transient';
  } else {
    signal_type = 'mixed';
  }

  // --- Confidence ---
  // Based on signal level and render length
  const durationSeconds = samples.length / sampleRate;
  let confidence = 1.0;
  // Quiet signals reduce confidence
  if (rms < 0.001) confidence *= 0.3;
  else if (rms < 0.01) confidence *= 0.6;
  // Very short renders reduce confidence
  if (durationSeconds < 0.5) confidence *= 0.5;
  else if (durationSeconds < 1.0) confidence *= 0.7;
  confidence = Math.round(confidence * 100) / 100;

  return {
    spectral_centroid: Math.round(spectral_centroid * 1000) / 1000,
    spectral_rolloff: Math.round(spectral_rolloff * 1000) / 1000,
    spectral_flatness: Math.round(spectral_flatness * 1000) / 1000,
    spectral_bandwidth: Math.round(spectral_bandwidth * 1000) / 1000,
    fundamental_estimate: Math.round(fundamental_estimate * 10) / 10,
    pitch_stability: Math.round(pitch_stability * 100) / 100,
    signal_type,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Dynamics analysis
// ---------------------------------------------------------------------------

export function analyzeDynamics(
  samples: Float32Array,
  sampleRate: number,
): DynamicsResult {
  if (samples.length === 0) {
    return {
      lufs: -Infinity,
      rms: -Infinity,
      peak: -Infinity,
      crest_factor: 0,
      dynamic_range: 0,
      confidence: 0,
    };
  }

  // Peak level
  let peakAmp = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peakAmp) peakAmp = abs;
  }
  const peakDb = ampToDb(peakAmp);

  // RMS level
  const rmsAmp = computeRms(samples);
  const rmsDb = ampToDb(rmsAmp);

  // Crest factor (peak / RMS in dB)
  const crest_factor = rmsAmp > 0 ? peakDb - rmsDb : 0;

  // Dynamic range: compute RMS per short window, find range between
  // loudest and quietest non-silent windows
  const windowSamples = Math.floor(sampleRate * 0.4); // 400ms windows
  const numWindows = Math.max(1, Math.floor(samples.length / windowSamples));
  const windowRms: number[] = [];

  for (let i = 0; i < numWindows; i++) {
    const start = i * windowSamples;
    const end = Math.min(start + windowSamples, samples.length);
    const wRms = computeRms(samples, start, end);
    if (wRms > 1e-7) { // exclude near-silent windows
      windowRms.push(ampToDb(wRms));
    }
  }

  let dynamic_range = 0;
  if (windowRms.length >= 2) {
    const sorted = windowRms.sort((a, b) => a - b);
    dynamic_range = sorted[sorted.length - 1] - sorted[0];
  }

  // Simplified LUFS approximation (integrated loudness)
  // True LUFS requires K-weighting filter; we use a simplified approach
  // that applies a basic high-pass to approximate K-weighting, then
  // compute the mean square.
  const lufs = computeSimplifiedLufs(samples, sampleRate);

  // Confidence
  const durationSeconds = samples.length / sampleRate;
  let confidence = 1.0;
  if (rmsAmp < 1e-6) confidence = 0;
  else if (rmsAmp < 0.001) confidence *= 0.3;
  else if (rmsAmp < 0.01) confidence *= 0.6;
  if (durationSeconds < 0.5) confidence *= 0.5;
  else if (durationSeconds < 1.0) confidence *= 0.7;
  confidence = Math.round(confidence * 100) / 100;

  return {
    lufs: isFinite(lufs) ? Math.round(lufs * 10) / 10 : -Infinity,
    rms: isFinite(rmsDb) ? Math.round(rmsDb * 10) / 10 : -Infinity,
    peak: isFinite(peakDb) ? Math.round(peakDb * 10) / 10 : -Infinity,
    crest_factor: Math.round(crest_factor * 10) / 10,
    dynamic_range: Math.round(dynamic_range * 10) / 10,
    confidence,
  };
}

/**
 * Simplified LUFS using a basic shelf boost approximation of K-weighting.
 * This is not ITU-R BS.1770 compliant but gives a reasonable approximation
 * for relative comparisons.
 */
function computeSimplifiedLufs(samples: Float32Array, _sampleRate: number): number {
  // For a simplified version, we use RMS with a basic emphasis on
  // higher frequencies. A simple first-order high-shelf at ~1.5kHz
  // approximates the K-weighting pre-filter's effect on perceived loudness.
  // For now, we use plain RMS in dB as the approximation,
  // offset by the typical difference between LUFS and plain RMS for music.
  const rmsAmp = computeRms(samples);
  if (rmsAmp < 1e-10) return -Infinity;
  // LUFS is roughly RMS dB - 0.691 for mono signals without K-weighting.
  // This is a placeholder that's directionally correct for relative comparisons.
  return ampToDb(rmsAmp) - 0.691;
}

// ---------------------------------------------------------------------------
// Rhythm analysis
// ---------------------------------------------------------------------------

export function analyzeRhythm(
  samples: Float32Array,
  sampleRate: number,
  bpm?: number,
): RhythmResult {
  const durationSeconds = samples.length / sampleRate;
  const rms = computeRms(samples);

  if (rms < 1e-6 || durationSeconds < 0.1) {
    return {
      tempo_estimate: bpm ?? 0,
      onset_count: 0,
      onset_times: [],
      rhythmic_density: 0,
      swing_estimate: 0,
      confidence: 0,
    };
  }

  // --- Onset detection (energy-based) ---
  // Compute energy per frame using short windows
  const frameDurationMs = 10; // 10ms frames
  const frameSamples = Math.floor(sampleRate * frameDurationMs / 1000);
  const numFrames = Math.floor(samples.length / frameSamples);
  const energy = new Float64Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    let sum = 0;
    const start = i * frameSamples;
    const end = Math.min(start + frameSamples, samples.length);
    for (let j = start; j < end; j++) {
      sum += samples[j] * samples[j];
    }
    energy[i] = sum / (end - start);
  }

  // Compute spectral flux (energy difference, half-wave rectified)
  const flux = new Float64Array(numFrames);
  for (let i = 1; i < numFrames; i++) {
    const diff = energy[i] - energy[i - 1];
    flux[i] = diff > 0 ? diff : 0;
  }

  // Adaptive threshold: use mean + factor * std dev of ALL flux values
  // (including zeros). Using only positive values would set the threshold
  // too high when onsets are sparse (the median of the positive values
  // would be close to the onset magnitude itself).
  const allFlux = Array.from(flux);
  const fluxMean = allFlux.reduce((a, b) => a + b, 0) / allFlux.length;
  const fluxStdDev = Math.sqrt(allFlux.reduce((a, v) => a + (v - fluxMean) ** 2, 0) / allFlux.length);
  const threshold = fluxMean + 1.5 * fluxStdDev;

  // If threshold is essentially zero (perfectly silent signal), bail out
  if (threshold < 1e-15) {
    return {
      tempo_estimate: bpm ?? 0,
      onset_count: 0,
      onset_times: [],
      rhythmic_density: 0,
      swing_estimate: 0,
      confidence: 0,
    };
  }

  // Compute a minimum absolute flux threshold: the flux peak must represent
  // a significant energy increase relative to the average frame energy.
  // This prevents spurious onset detection in continuous/sustained tones.
  let meanEnergy = 0;
  for (let i = 0; i < numFrames; i++) meanEnergy += energy[i];
  meanEnergy /= numFrames;
  // Onset flux must be at least 5% of mean energy to count
  const absThreshold = meanEnergy * 0.05;

  // Peak picking with minimum inter-onset interval (50ms)
  const minInterOnsetFrames = Math.floor(50 / frameDurationMs);
  const onset_times: number[] = [];
  let lastOnsetFrame = -minInterOnsetFrames;

  const effectiveThreshold = Math.max(threshold, absThreshold);

  for (let i = 1; i < numFrames - 1; i++) {
    if (flux[i] > effectiveThreshold && flux[i] > flux[i - 1] && flux[i] >= flux[i + 1]) {
      if (i - lastOnsetFrame >= minInterOnsetFrames) {
        onset_times.push(Math.round((i * frameDurationMs / 1000) * 1000) / 1000);
        lastOnsetFrame = i;
      }
    }
  }

  const onset_count = onset_times.length;
  const tempo_estimate = bpm ?? estimateTempo(onset_times, durationSeconds);

  // --- Rhythmic density (onsets per beat) ---
  let rhythmic_density = 0;
  if (tempo_estimate > 0) {
    const beatsInDuration = (tempo_estimate / 60) * durationSeconds;
    if (beatsInDuration > 0) {
      rhythmic_density = Math.min(1, onset_count / (beatsInDuration * 4)); // normalise to 16th-note grid
    }
  }

  // --- Swing estimate ---
  const swing_estimate = estimateSwing(onset_times, tempo_estimate);

  // --- Confidence ---
  let confidence = 1.0;
  if (onset_count < 2) confidence *= 0.3;
  else if (onset_count < 4) confidence *= 0.6;
  if (durationSeconds < 0.5) confidence *= 0.5;
  else if (durationSeconds < 1.0) confidence *= 0.7;
  if (rms < 0.01) confidence *= 0.5;
  confidence = Math.round(confidence * 100) / 100;

  return {
    tempo_estimate: Math.round(tempo_estimate * 10) / 10,
    onset_count,
    onset_times,
    rhythmic_density: Math.round(rhythmic_density * 1000) / 1000,
    swing_estimate: Math.round(swing_estimate * 1000) / 1000,
    confidence,
  };
}

/**
 * Simple tempo estimation from onset times using inter-onset intervals.
 */
function estimateTempo(onsetTimes: number[], _durationSeconds: number): number {
  if (onsetTimes.length < 2) return 0;

  // Compute inter-onset intervals
  const iois: number[] = [];
  for (let i = 1; i < onsetTimes.length; i++) {
    iois.push(onsetTimes[i] - onsetTimes[i - 1]);
  }

  // Find the most common IOI (rounded to 10ms buckets)
  const buckets = new Map<number, number>();
  for (const ioi of iois) {
    const bucket = Math.round(ioi * 100) / 100; // 10ms resolution
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }

  let bestBucket = 0;
  let bestCount = 0;
  for (const [bucket, count] of buckets) {
    if (count > bestCount) {
      bestCount = count;
      bestBucket = bucket;
    }
  }

  if (bestBucket <= 0) return 0;

  // Convert IOI to BPM (assuming the IOI represents a beat subdivision)
  // Try common subdivisions and pick the one that gives a reasonable BPM
  const candidateBpms = [
    60 / bestBucket,           // if IOI = quarter note
    60 / (bestBucket * 2),     // if IOI = eighth note
    60 / (bestBucket * 4),     // if IOI = sixteenth note
    (60 / bestBucket) * 2,     // if IOI = half note
  ];

  // Pick the candidate closest to a typical musical tempo (60-200 BPM)
  let bestBpm = 120;
  let bestDist = Infinity;
  for (const bpm of candidateBpms) {
    if (bpm >= 40 && bpm <= 240) {
      const dist = Math.abs(bpm - 120); // prefer mid-range
      if (dist < bestDist) {
        bestDist = dist;
        bestBpm = bpm;
      }
    }
  }

  return bestBpm;
}

/**
 * Estimate swing from onset times and tempo.
 * Swing is the ratio of long-to-short eighth note durations.
 * Returns 0.0 for straight time, positive values for swing.
 */
function estimateSwing(onsetTimes: number[], bpm: number): number {
  if (bpm <= 0 || onsetTimes.length < 3) return 0;

  const beatDuration = 60 / bpm;
  const eighthDuration = beatDuration / 2;

  // Look at consecutive pairs of IOIs that might represent swung eighths
  const iois: number[] = [];
  for (let i = 1; i < onsetTimes.length; i++) {
    iois.push(onsetTimes[i] - onsetTimes[i - 1]);
  }

  // Filter IOIs that are roughly eighth-note length (within 50% tolerance)
  const eighthIois = iois.filter(ioi =>
    ioi > eighthDuration * 0.5 && ioi < eighthDuration * 1.5,
  );

  if (eighthIois.length < 2) return 0;

  // Check for alternating long-short pattern
  let longShortPairs = 0;
  let totalRatio = 0;

  for (let i = 0; i < eighthIois.length - 1; i += 2) {
    const first = eighthIois[i];
    const second = eighthIois[i + 1];
    if (first > second * 1.05) { // slight threshold to avoid noise
      totalRatio += (first / second) - 1;
      longShortPairs++;
    }
  }

  if (longShortPairs === 0) return 0;
  return Math.min(1, totalRatio / longShortPairs);
}
