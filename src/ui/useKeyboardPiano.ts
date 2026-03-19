// src/ui/useKeyboardPiano.ts
// Maps computer keyboard to piano keys for real-time note audition (Ableton-style).
// When recording is active, captured notes are written to the active track's region.
import { useEffect, useRef, useState, useCallback } from 'react';
import type { RefObject, MutableRefObject } from 'react';
import type { AudioEngine } from '../audio/audio-engine';
import type { Session } from '../engine/types';
import { getActiveTrack, getActivePattern } from '../engine/types';
import { midiToNote } from '../audio/synth-interface';
import { isEditable } from './useShortcuts';
import type { NoteEvent } from '../engine/canonical-types';
import { keyToMidi } from './keyboard-piano-map';

/** Sustain placeholder: gate-off scheduled far in the future, released on key-up. */
const SUSTAIN_SECONDS = 30;
/** Default velocity as a normalized 0-1 value (mezzo-forte). */
const DEFAULT_VELOCITY = 0.7;
/** Minimum note duration in steps to avoid zero-length events. */
const MIN_NOTE_DURATION = 0.25;

/** Pending note being held during recording. */
interface PendingNote {
  midi: number;
  startStep: number;
}

/**
 * Hook that maps keyboard keys to piano notes for real-time audition.
 * When `recordArmed` is true and the transport is playing, notes are also
 * captured as NoteEvents and written to the active track's region via
 * `onRecordEvents`.
 *
 * - Bottom row (Z-M) + middle row sharps (S,D,G,H,J): lower octave
 * - Top row (Q-U) + number row sharps (2,3,5,6,7): upper octave
 * - `-` / `=` keys shift octave down / up
 * - Only active when no text input is focused
 * - Works across all views
 */
export function useKeyboardPiano(
  audioRef: RefObject<AudioEngine>,
  session: Session,
  recordArmed: boolean,
  globalStepRef: MutableRefObject<number>,
  onRecordEvents: (trackId: string, events: NoteEvent[]) => void,
) {
  const [octaveOffset, setOctaveOffset] = useState(0);
  const heldKeys = useRef(new Set<string>());
  /** Pending notes being recorded, keyed by lowercase keyboard key. */
  const pendingNotes = useRef(new Map<string, PendingNote>());
  // Refs to avoid stale closures in event handlers
  const octaveRef = useRef(octaveOffset);
  const sessionRef = useRef(session);
  const recordArmedRef = useRef(recordArmed);
  const onRecordEventsRef = useRef(onRecordEvents);
  useEffect(() => {
    octaveRef.current = octaveOffset;
    sessionRef.current = session;
    recordArmedRef.current = recordArmed;
    onRecordEventsRef.current = onRecordEvents;
  });

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Skip if typing in an input, or if modifier keys are held (avoid conflicts with shortcuts)
    if (isEditable()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // Octave shift
    if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      setOctaveOffset(o => Math.max(o - 1, -4));
      return;
    }
    if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      setOctaveOffset(o => Math.min(o + 1, 4));
      return;
    }

    // Ignore key repeat
    if (e.repeat) return;

    const midi = keyToMidi(e.key, octaveRef.current);
    if (midi === undefined) return;

    e.preventDefault();

    const audio = audioRef.current;
    if (!audio?.isRunning) return;

    const currentSession = sessionRef.current;
    const track = getActiveTrack(currentSession);
    if (!track) return;

    const lower = e.key.toLowerCase();

    // Track this key as held
    heldKeys.current.add(lower);

    // Start recording a pending note if recording is active
    if (recordArmedRef.current && currentSession.transport.status === 'playing') {
      pendingNotes.current.set(lower, {
        midi,
        startStep: globalStepRef.current,
      });
    }

    const now = audio.getCurrentTime();
    // Ensure accent gain is at baseline before triggering
    audio.scheduleNote({
      trackId: track.id,
      time: now,
      gateOffTime: now + SUSTAIN_SECONDS,
      accent: false,
      params: { ...track.params, note: midiToNote(midi) },
    });
  }, [audioRef, globalStepRef]);

  const finalizeNote = useCallback((lower: string) => {
    const pending = pendingNotes.current.get(lower);
    if (!pending) return;
    pendingNotes.current.delete(lower);

    const currentSession = sessionRef.current;
    const track = getActiveTrack(currentSession);
    if (!track) return;

    if (track.patterns.length === 0) return;
    const region = getActivePattern(track);
    if (region.duration <= 0) return;

    const currentStep = globalStepRef.current;
    let rawDuration = currentStep - pending.startStep;
    // If playhead wrapped past loop boundary, compute duration across the wrap
    if (rawDuration < 0) rawDuration += region.duration;
    const duration = Math.max(rawDuration, MIN_NOTE_DURATION);

    // Compute region-local position (wrap within loop)
    const at = ((pending.startStep % region.duration) + region.duration) % region.duration;

    const noteEvent: NoteEvent = {
      kind: 'note',
      at,
      pitch: pending.midi,
      velocity: DEFAULT_VELOCITY,
      duration,
    };

    onRecordEventsRef.current(track.id, [noteEvent]);
  }, [globalStepRef]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    const lower = e.key.toLowerCase();
    if (!heldKeys.current.has(lower)) return;

    heldKeys.current.delete(lower);

    // Finalize any pending recorded note for this key
    finalizeNote(lower);

    const audio = audioRef.current;
    if (!audio?.isRunning) return;

    const currentSession = sessionRef.current;
    const track = getActiveTrack(currentSession);
    if (!track) return;

    // Only release if no other note keys are still held (monophonic: last-note-off silences)
    if (heldKeys.current.size === 0) {
      audio.releaseTrack(track.id);
    }
  }, [audioRef, finalizeNote]);

  // When recording stops (disarm or transport stop), finalize any held notes
  const isRecordingActive = recordArmed && session.transport.status === 'playing';
  const wasRecordingRef = useRef(false);

  useEffect(() => {
    if (wasRecordingRef.current && !isRecordingActive) {
      // Recording just stopped — finalize all pending notes
      for (const key of pendingNotes.current.keys()) {
        finalizeNote(key);
      }
      pendingNotes.current.clear();
    }
    wasRecordingRef.current = isRecordingActive;
  }, [isRecordingActive, finalizeNote]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  return { octaveOffset };
}
