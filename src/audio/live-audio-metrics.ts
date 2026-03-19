import type { Session } from '../engine/types';
import type { AudioEngine } from './audio-engine';

export interface AudioMetricFrame {
  rms: number;
  peak: number;
  centroid: number;
  crest: number;
  onsetDensity: number;
}

export interface AudioMetricsSnapshot {
  capturedAt: number;
  master: AudioMetricFrame;
  tracks: Record<string, AudioMetricFrame>;
}

interface OnsetTracker {
  lastEnergyDb: number;
  lastOnsetAt: number;
  onsets: number[];
}

const SILENCE_FLOOR_DB = -120;
const ONSET_WINDOW_MS = 4000;
const ONSET_MIN_GAP_MS = 120;
const ONSET_MIN_LEVEL_DB = -45;
const ONSET_JUMP_DB = 6;
const RECENT_STOP_MAX_AGE_MS = 2000;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function amplitudeToDb(value: number): number {
  if (!isFinite(value) || value <= 0.000001) return SILENCE_FLOOR_DB;
  return Math.max(SILENCE_FLOOR_DB, 20 * Math.log10(value));
}

function getTimeBuffer(cache: WeakMap<AnalyserNode, Float32Array>, analyser: AnalyserNode): Float32Array {
  const size = analyser.fftSize;
  const existing = cache.get(analyser);
  if (existing && existing.length === size) return existing;
  const buf = new Float32Array(size);
  cache.set(analyser, buf);
  return buf;
}

function getFreqBuffer(cache: WeakMap<AnalyserNode, Float32Array>, analyser: AnalyserNode): Float32Array {
  const size = analyser.frequencyBinCount;
  const existing = cache.get(analyser);
  if (existing && existing.length === size) return existing;
  const buf = new Float32Array(size);
  cache.set(analyser, buf);
  return buf;
}

export class LiveAudioMetricsStore {
  private readonly timeBuffers = new WeakMap<AnalyserNode, Float32Array>();
  private readonly freqBuffers = new WeakMap<AnalyserNode, Float32Array>();
  private readonly onsetTrackers = new Map<string, OnsetTracker>();
  private snapshot: AudioMetricsSnapshot | null = null;

  sample(session: Session, audio: AudioEngine, now = Date.now()): void {
    const ctx = audio.getAudioContext();
    const masterAnalyser = audio.getAnalyser();
    if (!ctx || !masterAnalyser) {
      this.snapshot = null;
      return;
    }

    const master = this.readMetricFrame('master', masterAnalyser, ctx.sampleRate, now);
    const tracks: Record<string, AudioMetricFrame> = {};

    for (const track of session.tracks) {
      const analyser = audio.getTrackAnalyser(track.id);
      if (!analyser) continue;
      tracks[track.id] = this.readMetricFrame(track.id, analyser, ctx.sampleRate, now);
    }

    for (const key of this.onsetTrackers.keys()) {
      if (key !== 'master' && !session.tracks.some(track => track.id === key)) {
        this.onsetTrackers.delete(key);
      }
    }

    this.snapshot = { capturedAt: now, master, tracks };
  }

  getSnapshot(isPlaying: boolean, now = Date.now()): AudioMetricsSnapshot | undefined {
    if (!this.snapshot) return undefined;
    if (isPlaying) return this.snapshot;
    if (now - this.snapshot.capturedAt <= RECENT_STOP_MAX_AGE_MS) return this.snapshot;
    return undefined;
  }

  clear(): void {
    this.snapshot = null;
    this.onsetTrackers.clear();
  }

  private readMetricFrame(key: string, analyser: AnalyserNode, sampleRate: number, now: number): AudioMetricFrame {
    const timeBuf = getTimeBuffer(this.timeBuffers, analyser);
    const freqBuf = getFreqBuffer(this.freqBuffers, analyser);

    analyser.getFloatTimeDomainData(timeBuf);
    analyser.getFloatFrequencyData(freqBuf);

    let peakAmp = 0;
    let sumSquares = 0;
    for (let i = 0; i < timeBuf.length; i++) {
      const sample = timeBuf[i];
      const abs = Math.abs(sample);
      if (abs > peakAmp) peakAmp = abs;
      sumSquares += sample * sample;
    }

    const rmsAmp = Math.sqrt(sumSquares / Math.max(1, timeBuf.length));
    const peakDb = amplitudeToDb(peakAmp);
    const rmsDb = amplitudeToDb(rmsAmp);
    const crestDb = peakDb - rmsDb;

    let weightedFreq = 0;
    let totalMag = 0;
    const nyquist = sampleRate / 2;
    for (let i = 0; i < freqBuf.length; i++) {
      const db = freqBuf[i];
      if (!isFinite(db)) continue;
      const mag = Math.pow(10, db / 20);
      if (!isFinite(mag) || mag <= 0) continue;
      const hz = (i / Math.max(1, freqBuf.length - 1)) * nyquist;
      weightedFreq += hz * mag;
      totalMag += mag;
    }
    const centroidHz = totalMag > 0 ? weightedFreq / totalMag : 0;

    const tracker = this.onsetTrackers.get(key) ?? { lastEnergyDb: SILENCE_FLOOR_DB, lastOnsetAt: -Infinity, onsets: [] };
    if (
      rmsDb >= ONSET_MIN_LEVEL_DB &&
      rmsDb - tracker.lastEnergyDb >= ONSET_JUMP_DB &&
      now - tracker.lastOnsetAt >= ONSET_MIN_GAP_MS
    ) {
      tracker.onsets.push(now);
      tracker.lastOnsetAt = now;
    }
    tracker.lastEnergyDb = rmsDb;
    tracker.onsets = tracker.onsets.filter(t => now - t <= ONSET_WINDOW_MS);
    this.onsetTrackers.set(key, tracker);

    return {
      rms: round1(rmsDb),
      peak: round1(peakDb),
      centroid: round1(centroidHz),
      crest: round1(crestDb),
      onsetDensity: round1(tracker.onsets.length / (ONSET_WINDOW_MS / 1000)),
    };
  }
}
