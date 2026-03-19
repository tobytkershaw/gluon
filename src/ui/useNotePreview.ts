// src/ui/useNotePreview.ts
// Triggers a short audition note when hovering or selecting tracker cells.
import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import type { AudioEngine } from '../audio/audio-engine';
import type { Track } from '../engine/types';
import type { Transport } from '../engine/sequencer-types';
import { midiToNote } from '../audio/synth-interface';

/** Duration (seconds) of a preview note. Short enough to be non-intrusive. */
const PREVIEW_DURATION_SEC = 0.15;
/** Debounce: ignore rapid-fire previews within this window (ms). */
const DEBOUNCE_MS = 50;

/**
 * Hook that provides a `previewNote` callback for auditing a MIDI note
 * on the active track's synth engine. Returns a stable callback pair:
 * - `previewNote(pitch)` — trigger a short note
 * - `cancelPreview()` — release any sounding preview early
 */
export function useNotePreview(
  audioRef: RefObject<AudioEngine>,
  activeTrack: Track | null,
  transportStatus: Transport['status'] = 'stopped',
) {
  const lastPreviewTime = useRef(0);
  const lastPreviewPitch = useRef<number | null>(null);

  const previewNote = useCallback((pitch: number) => {
    const audio = audioRef.current;
    if (!audio?.isRunning || !activeTrack) return;

    // Suppress preview during playback to avoid corrupting playing voice state (#1007)
    if (transportStatus === 'playing') return;

    // Debounce: skip if the same pitch was just previewed
    const now = Date.now();
    if (pitch === lastPreviewPitch.current && now - lastPreviewTime.current < DEBOUNCE_MS) {
      return;
    }
    lastPreviewPitch.current = pitch;
    lastPreviewTime.current = now;

    const audioNow = audio.getCurrentTime();
    audio.scheduleNote({
      trackId: activeTrack.id,
      time: audioNow,
      gateOffTime: audioNow + PREVIEW_DURATION_SEC,
      accent: false,
      params: { ...activeTrack.params, note: midiToNote(pitch) },
    });
  }, [audioRef, activeTrack, transportStatus]);

  const cancelPreview = useCallback(() => {
    const audio = audioRef.current;
    if (!audio?.isRunning || !activeTrack) return;
    audio.releaseTrack(activeTrack.id);
    lastPreviewPitch.current = null;
  }, [audioRef, activeTrack]);

  return { previewNote, cancelPreview };
}
