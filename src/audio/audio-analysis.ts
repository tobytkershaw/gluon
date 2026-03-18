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

// ---------------------------------------------------------------------------
// Frequency masking (cross-track spectral conflict detection)
// ---------------------------------------------------------------------------

/** A frequency band definition used by masking analysis. */
interface FrequencyBand {
  label: string;
  range: string;   // human-readable (e.g. "60-200Hz")
  lo: number;       // Hz, inclusive
  hi: number;       // Hz, exclusive
}

const MASKING_BANDS: FrequencyBand[] = [
  { label: 'sub',      range: '20-60Hz',     lo: 20,   hi: 60 },
  { label: 'low',      range: '60-200Hz',    lo: 60,   hi: 200 },
  { label: 'low-mid',  range: '200-500Hz',   lo: 200,  hi: 500 },
  { label: 'mid',      range: '500Hz-2kHz',  lo: 500,  hi: 2000 },
  { label: 'high-mid', range: '2-6kHz',      lo: 2000, hi: 6000 },
  { label: 'high',     range: '6-20kHz',     lo: 6000, hi: 20000 },
];

export interface MaskingConflict {
  band: string;          // human-readable range (e.g. "60-200Hz")
  bandLabel: string;     // short label (e.g. "low")
  tracks: string[];      // track IDs with significant energy in this band
  severity: 'low' | 'medium' | 'high';
  overlapRatio: number;  // 0.0-1.0 — how much the weaker track's energy
                         // overlaps the dominant track's energy in this band
  suggestion: string;
}

export interface MaskingResult {
  conflicts: MaskingConflict[];
  trackProfiles: Record<string, Record<string, number>>; // trackId → bandLabel → energy (dB)
  confidence: number;
}

export interface TrackAudio {
  trackId: string;
  pcm: Float32Array;
  sampleRate: number;
}

/**
 * Compute average energy (in dB) per frequency band for a set of PCM samples.
 * Returns a map from band label to energy in dB.
 */
export function computeBandEnergies(
  samples: Float32Array,
  sampleRate: number,
  fftSize: number = DEFAULT_FFT_SIZE,
): Record<string, number> {
  const rms = computeRms(samples);
  if (rms < 1e-6) {
    // Silent — return -Infinity for all bands
    const result: Record<string, number> = {};
    for (const band of MASKING_BANDS) {
      result[band.label] = -Infinity;
    }
    return result;
  }

  // Average spectra across frames
  const hopSize = fftSize / 2;
  const numBins = fftSize / 2 + 1;
  const avgMagnitudes = new Float64Array(numBins);
  let frameCount = 0;

  for (let offset = 0; offset + fftSize <= samples.length; offset += hopSize) {
    const magnitudes = computeMagnitudeSpectrum(samples, offset, fftSize);
    for (let i = 0; i < numBins; i++) {
      avgMagnitudes[i] += magnitudes[i];
    }
    frameCount++;
  }

  if (frameCount === 0) {
    // Too short for even one frame — do a zero-padded single frame
    const magnitudes = computeMagnitudeSpectrum(samples, 0, fftSize);
    for (let i = 0; i < numBins; i++) {
      avgMagnitudes[i] = magnitudes[i];
    }
    frameCount = 1;
  }

  for (let i = 0; i < numBins; i++) {
    avgMagnitudes[i] /= frameCount;
  }

  // Accumulate energy per band
  const bandEnergies: Record<string, number> = {};
  const binFreqStep = sampleRate / fftSize;

  for (const band of MASKING_BANDS) {
    const loBin = Math.max(1, Math.ceil(band.lo / binFreqStep));
    const hiBin = Math.min(numBins - 1, Math.floor(band.hi / binFreqStep));

    let energy = 0;
    for (let i = loBin; i <= hiBin; i++) {
      energy += avgMagnitudes[i] * avgMagnitudes[i];
    }
    // Normalise by number of bins to make bands comparable
    const binCount = Math.max(1, hiBin - loBin + 1);
    const meanPower = energy / binCount;
    bandEnergies[band.label] = meanPower > 1e-20 ? 10 * Math.log10(meanPower) : -Infinity;
  }

  return bandEnergies;
}

/**
 * Analyze frequency masking across multiple tracks.
 *
 * For each frequency band, identifies which tracks have significant energy and
 * flags bands where multiple tracks compete. Returns structured conflict reports
 * with severity and remediation suggestions.
 */
export function analyzeMasking(tracks: TrackAudio[]): MaskingResult {
  if (tracks.length < 2) {
    return { conflicts: [], trackProfiles: {}, confidence: 0 };
  }

  // Compute band energies for each track
  const profiles: Record<string, Record<string, number>> = {};
  const allSilent = new Set<string>();

  for (const track of tracks) {
    const energies = computeBandEnergies(track.pcm, track.sampleRate);
    profiles[track.trackId] = energies;

    // Check if this track is essentially silent
    const maxEnergy = Math.max(...Object.values(energies).filter(e => isFinite(e)));
    if (!isFinite(maxEnergy) || maxEnergy < -80) {
      allSilent.add(track.trackId);
    }
  }

  const activeTracks = tracks.filter(t => !allSilent.has(t.trackId));
  if (activeTracks.length < 2) {
    return { conflicts: [], trackProfiles: profiles, confidence: 0.3 };
  }

  // For each band, find tracks with significant energy and detect conflicts
  const conflicts: MaskingConflict[] = [];

  // Threshold: a track has "significant" energy in a band if it is within
  // 20dB of that track's own peak band. This is relative to each track's
  // own level, so a quiet pad can still conflict with a loud bass.
  const SIGNIFICANCE_OFFSET_DB = 20;
  // Two tracks conflict if both have significant energy and the overlap
  // (ratio of secondary to primary energy) exceeds a threshold.
  const OVERLAP_THRESHOLD_DB = 6; // within 6dB = high overlap

  for (const band of MASKING_BANDS) {
    // Gather tracks with significant energy in this band
    const trackEnergies: { trackId: string; energy: number }[] = [];

    for (const track of activeTracks) {
      const energy = profiles[track.trackId][band.label];
      if (!isFinite(energy)) continue;

      // Find this track's peak band energy
      const peakEnergy = Math.max(
        ...Object.values(profiles[track.trackId]).filter(e => isFinite(e)),
      );
      if (!isFinite(peakEnergy)) continue;

      // Significant if within SIGNIFICANCE_OFFSET_DB of own peak
      if (energy >= peakEnergy - SIGNIFICANCE_OFFSET_DB) {
        trackEnergies.push({ trackId: track.trackId, energy });
      }
    }

    if (trackEnergies.length < 2) continue;

    // Sort by energy descending
    trackEnergies.sort((a, b) => b.energy - a.energy);
    const dominant = trackEnergies[0];
    const secondary = trackEnergies[1];

    const gap = dominant.energy - secondary.energy;
    // overlapRatio: 1.0 when equal energy, 0.0 when gap >= 20dB
    const overlapRatio = Math.max(0, Math.min(1, 1 - gap / 20));

    if (overlapRatio < 0.1) continue; // negligible overlap

    const severity: MaskingConflict['severity'] =
      gap < OVERLAP_THRESHOLD_DB ? 'high' :
      gap < OVERLAP_THRESHOLD_DB * 2 ? 'medium' : 'low';

    const conflictingTracks = trackEnergies
      .filter(te => dominant.energy - te.energy < 20)
      .map(te => te.trackId);

    const suggestion = generateMaskingSuggestion(band, conflictingTracks, severity);

    conflicts.push({
      band: band.range,
      bandLabel: band.label,
      tracks: conflictingTracks,
      severity,
      overlapRatio: Math.round(overlapRatio * 100) / 100,
      suggestion,
    });
  }

  // Sort conflicts by severity (high first)
  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  conflicts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Confidence based on number of active tracks and render quality
  let confidence = 1.0;
  if (activeTracks.length === 2) confidence *= 0.9;
  // Reduce confidence if renders are very short
  for (const track of activeTracks) {
    const durationS = track.pcm.length / track.sampleRate;
    if (durationS < 0.5) { confidence *= 0.5; break; }
    if (durationS < 1.0) { confidence *= 0.7; break; }
  }
  confidence = Math.round(confidence * 100) / 100;

  return { conflicts, trackProfiles: profiles, confidence };
}

/** Generate a human-readable suggestion for a masking conflict. */
function generateMaskingSuggestion(
  band: FrequencyBand,
  trackIds: string[],
  severity: MaskingConflict['severity'],
): string {
  const trackNames = trackIds.join(' and ');

  if (band.label === 'sub' || band.label === 'low') {
    if (severity === 'high') {
      return `${trackNames} are competing in the ${band.range} range. Consider high-passing one track, using sidechain ducking, or separating them with EQ cuts.`;
    }
    return `Moderate overlap between ${trackNames} in the ${band.range} range. A gentle EQ cut on the less important track may help clarity.`;
  }

  if (band.label === 'mid' || band.label === 'low-mid') {
    if (severity === 'high') {
      return `${trackNames} are masking each other in the ${band.range} range. Try carving complementary EQ notches or adjusting timbres to occupy different spectral regions.`;
    }
    return `Some spectral overlap between ${trackNames} in the ${band.range} range. Consider subtle timbre adjustment on one track.`;
  }

  // high-mid and high
  if (severity === 'high') {
    return `${trackNames} are both bright in the ${band.range} range. Consider rolling off highs on one track or using different timbral textures.`;
  }
  return `Minor overlap between ${trackNames} in the ${band.range} range. Usually acceptable unless the mix sounds harsh.`;
}

// ---------------------------------------------------------------------------
// Diff analysis (before/after snapshot comparison)
// ---------------------------------------------------------------------------

/** Delta for a single numeric metric. */
export interface MetricDelta {
  before: number;
  after: number;
  delta: number;
  /** Human-readable summary of what changed. */
  description: string;
}

export interface DiffResult {
  spectral: {
    centroid: MetricDelta;
    rolloff: MetricDelta;
    flatness: MetricDelta;
    bandwidth: MetricDelta;
    fundamental: MetricDelta;
    pitch_stability: MetricDelta;
    signal_type_before: SpectralResult['signal_type'];
    signal_type_after: SpectralResult['signal_type'];
  };
  dynamics: {
    lufs: MetricDelta;
    rms: MetricDelta;
    peak: MetricDelta;
    crest_factor: MetricDelta;
    dynamic_range: MetricDelta;
  };
  rhythm: {
    onset_count: MetricDelta;
    rhythmic_density: MetricDelta;
    swing_estimate: MetricDelta;
  };
  /** Plain-language summary of the most notable changes. */
  summary: string;
  confidence: number;
}

function metricDelta(before: number, after: number, description: string): MetricDelta {
  return {
    before: round3(before),
    after: round3(after),
    delta: round3(after - before),
    description,
  };
}

function round3(n: number): number {
  return isFinite(n) ? Math.round(n * 1000) / 1000 : n;
}

/**
 * Compare two rendered audio snapshots and produce structured deltas.
 * Runs spectral, dynamics, and rhythm analysis on both and computes
 * the difference for every metric.
 */
export function analyzeDiff(
  beforePcm: Float32Array,
  afterPcm: Float32Array,
  sampleRate: number,
  bpm?: number,
): DiffResult {
  const specBefore = analyzeSpectral(beforePcm, sampleRate);
  const specAfter = analyzeSpectral(afterPcm, sampleRate);
  const dynBefore = analyzeDynamics(beforePcm, sampleRate);
  const dynAfter = analyzeDynamics(afterPcm, sampleRate);
  const rhythmBefore = analyzeRhythm(beforePcm, sampleRate, bpm);
  const rhythmAfter = analyzeRhythm(afterPcm, sampleRate, bpm);

  const nyquist = sampleRate / 2;

  // --- Spectral deltas ---
  const centroidHzBefore = specBefore.spectral_centroid * nyquist;
  const centroidHzAfter = specAfter.spectral_centroid * nyquist;
  const centroidDelta = centroidHzAfter - centroidHzBefore;

  const rolloffHzBefore = specBefore.spectral_rolloff * nyquist;
  const rolloffHzAfter = specAfter.spectral_rolloff * nyquist;

  const spectral = {
    centroid: metricDelta(
      centroidHzBefore, centroidHzAfter,
      describeDelta(centroidDelta, 'Hz', 'brighter', 'darker', 50),
    ),
    rolloff: metricDelta(
      rolloffHzBefore, rolloffHzAfter,
      describeDelta(rolloffHzAfter - rolloffHzBefore, 'Hz', 'more high-frequency energy', 'less high-frequency energy', 100),
    ),
    flatness: metricDelta(
      specBefore.spectral_flatness, specAfter.spectral_flatness,
      describeDelta(specAfter.spectral_flatness - specBefore.spectral_flatness, '', 'noisier', 'more tonal', 0.05),
    ),
    bandwidth: metricDelta(
      specBefore.spectral_bandwidth * nyquist, specAfter.spectral_bandwidth * nyquist,
      describeDelta((specAfter.spectral_bandwidth - specBefore.spectral_bandwidth) * nyquist, 'Hz', 'wider harmonic spread', 'narrower harmonic spread', 50),
    ),
    fundamental: metricDelta(
      specBefore.fundamental_estimate, specAfter.fundamental_estimate,
      describeDelta(specAfter.fundamental_estimate - specBefore.fundamental_estimate, 'Hz', 'higher pitch', 'lower pitch', 5),
    ),
    pitch_stability: metricDelta(
      specBefore.pitch_stability, specAfter.pitch_stability,
      describeDelta(specAfter.pitch_stability - specBefore.pitch_stability, '', 'more stable pitch', 'less stable pitch', 0.05),
    ),
    signal_type_before: specBefore.signal_type,
    signal_type_after: specAfter.signal_type,
  };

  // --- Dynamics deltas ---
  const dynamics = {
    lufs: metricDelta(
      dynBefore.lufs, dynAfter.lufs,
      describeDelta(dynAfter.lufs - dynBefore.lufs, 'dB', 'louder', 'quieter', 1),
    ),
    rms: metricDelta(
      dynBefore.rms, dynAfter.rms,
      describeDelta(dynAfter.rms - dynBefore.rms, 'dB', 'louder RMS', 'quieter RMS', 1),
    ),
    peak: metricDelta(
      dynBefore.peak, dynAfter.peak,
      describeDelta(dynAfter.peak - dynBefore.peak, 'dB', 'higher peak', 'lower peak', 1),
    ),
    crest_factor: metricDelta(
      dynBefore.crest_factor, dynAfter.crest_factor,
      describeDelta(dynAfter.crest_factor - dynBefore.crest_factor, 'dB', 'more transient/punchy', 'more compressed/flat', 0.5),
    ),
    dynamic_range: metricDelta(
      dynBefore.dynamic_range, dynAfter.dynamic_range,
      describeDelta(dynAfter.dynamic_range - dynBefore.dynamic_range, 'dB', 'wider dynamic range', 'narrower dynamic range', 0.5),
    ),
  };

  // --- Rhythm deltas ---
  const rhythm = {
    onset_count: metricDelta(
      rhythmBefore.onset_count, rhythmAfter.onset_count,
      describeDelta(rhythmAfter.onset_count - rhythmBefore.onset_count, 'onsets', 'more events', 'fewer events', 1),
    ),
    rhythmic_density: metricDelta(
      rhythmBefore.rhythmic_density, rhythmAfter.rhythmic_density,
      describeDelta(rhythmAfter.rhythmic_density - rhythmBefore.rhythmic_density, '', 'denser rhythm', 'sparser rhythm', 0.02),
    ),
    swing_estimate: metricDelta(
      rhythmBefore.swing_estimate, rhythmAfter.swing_estimate,
      describeDelta(rhythmAfter.swing_estimate - rhythmBefore.swing_estimate, '', 'more swing', 'less swing', 0.02),
    ),
  };

  // --- Summary ---
  const notable: string[] = [];
  if (spectral.centroid.description) notable.push(spectral.centroid.description);
  if (dynamics.lufs.description) notable.push(dynamics.lufs.description);
  if (rhythm.onset_count.description) notable.push(rhythm.onset_count.description);
  if (spectral.flatness.description) notable.push(spectral.flatness.description);
  if (dynamics.crest_factor.description) notable.push(dynamics.crest_factor.description);
  if (specBefore.signal_type !== specAfter.signal_type) {
    notable.push(`Signal type changed from ${specBefore.signal_type} to ${specAfter.signal_type}`);
  }
  const summary = notable.length > 0
    ? notable.join('. ') + '.'
    : 'No significant differences detected.';

  // Confidence: average of individual analysis confidences
  const confidences = [
    specBefore.confidence, specAfter.confidence,
    dynBefore.confidence, dynAfter.confidence,
    rhythmBefore.confidence, rhythmAfter.confidence,
  ];
  const confidence = Math.round(
    (confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100,
  ) / 100;

  return { spectral, dynamics, rhythm, summary, confidence };
}

/**
 * Produce a human-readable description of a metric delta.
 * Returns empty string if the change is below the threshold.
 */
function describeDelta(
  delta: number,
  unit: string,
  upWord: string,
  downWord: string,
  threshold: number,
): string {
  if (!isFinite(delta)) return '';
  const absDelta = Math.abs(delta);
  if (absDelta < threshold) return '';
  const direction = delta > 0 ? upWord : downWord;
  const rounded = Math.round(absDelta * 10) / 10;
  return unit ? `${direction} (${rounded > 0 ? '+' : ''}${delta > 0 ? rounded : -rounded} ${unit})` : direction;
}
