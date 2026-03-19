// src/ui/useAudioLoad.ts
// Hook that estimates audio thread load by comparing AudioContext.currentTime
// advancement against wall-clock time. Returns a 0.0–1.0 load fraction.
import { useState, useEffect, useRef } from 'react';

/** How often to sample (ms). Lower = more responsive but more overhead. */
const SAMPLE_INTERVAL_MS = 200;

/** Smoothing factor for exponential moving average (0–1, higher = more smoothing). */
const SMOOTHING = 0.7;

/**
 * Estimate audio thread load by measuring how far AudioContext.currentTime
 * lags behind wall-clock time over each sample interval.
 *
 * When the audio thread is keeping up, currentTime advances at ~1x real time.
 * Under load, it falls behind — the ratio of actual advancement to expected
 * advancement gives us the load estimate: load = 1 - (actual / expected).
 *
 * Returns a smoothed 0.0–1.0 value (0 = idle, 1 = fully overloaded).
 */
export function useAudioLoad(audioContext: AudioContext | null): number {
  const [load, setLoad] = useState(0);
  const prevRef = useRef<{ wallTime: number; audioTime: number } | null>(null);
  const smoothedRef = useRef(0);

  useEffect(() => {
    if (!audioContext) {
      prevRef.current = null;
      smoothedRef.current = 0;
      setLoad(0); // eslint-disable-line react-hooks/set-state-in-effect -- syncing external audio state
      return;
    }

    // Reset baseline
    prevRef.current = {
      wallTime: performance.now(),
      audioTime: audioContext.currentTime,
    };

    const id = setInterval(() => {
      if (audioContext.state !== 'running') return;

      const now = performance.now();
      const currentAudioTime = audioContext.currentTime;
      const prev = prevRef.current;
      if (!prev) {
        prevRef.current = { wallTime: now, audioTime: currentAudioTime };
        return;
      }

      const wallDelta = (now - prev.wallTime) / 1000; // seconds
      const audioDelta = currentAudioTime - prev.audioTime;

      prevRef.current = { wallTime: now, audioTime: currentAudioTime };

      // Avoid division by zero or nonsensical readings on first sample
      if (wallDelta < 0.01) return;

      // ratio: how much audio time advanced relative to wall time
      // 1.0 = perfect, <1.0 = falling behind
      const ratio = Math.min(audioDelta / wallDelta, 1);
      const instantLoad = 1 - ratio;

      // Exponential moving average for smooth display
      smoothedRef.current = SMOOTHING * smoothedRef.current + (1 - SMOOTHING) * instantLoad;
      setLoad(Math.max(0, Math.min(1, smoothedRef.current)));
    }, SAMPLE_INTERVAL_MS);

    return () => clearInterval(id);
  }, [audioContext]);

  return load;
}
