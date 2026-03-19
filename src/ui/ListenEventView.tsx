import { useState, useRef, useCallback, useEffect } from 'react';
import type { ListenEvent } from '../engine/types';

interface Props {
  events: ListenEvent[];
}

/**
 * Inline listen event display — shows rendered audio the AI evaluated
 * with play/pause controls so the human can hear exactly what the AI heard.
 */
export function ListenEventView({ events }: Props) {
  if (events.length === 0) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {events.map((event, i) => (
        <ListenCard key={i} event={event} />
      ))}
    </div>
  );
}

function ListenCard({ event }: { event: ListenEvent }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);

  // Clean up audio element, animation frame, and blob URL on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (event.audioUrl) {
        URL.revokeObjectURL(event.audioUrl);
      }
    };
  }, [event.audioUrl]);

  const updateProgress = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      setProgress(audio.duration > 0 ? audio.currentTime / audio.duration : 0);
      rafRef.current = requestAnimationFrame(updateProgress);
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (!event.audioUrl) return;

    if (playing && audioRef.current) {
      audioRef.current.pause();
      cancelAnimationFrame(rafRef.current);
      setPlaying(false);
      return;
    }

    // Create or reuse audio element
    if (!audioRef.current) {
      audioRef.current = new Audio(event.audioUrl);
      audioRef.current.addEventListener('ended', () => {
        setPlaying(false);
        setProgress(0);
        cancelAnimationFrame(rafRef.current);
      });
    }

    audioRef.current.currentTime = 0;
    audioRef.current.play().then(() => {
      setPlaying(true);
      rafRef.current = requestAnimationFrame(updateProgress);
    }).catch(() => {
      // Autoplay blocked — ignore
    });
  }, [event.audioUrl, playing, updateProgress]);

  const formatDuration = (seconds?: number): string => {
    if (!seconds) return '';
    const s = Math.round(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  // Truncate evaluation to first sentence or 120 chars
  const evalSummary = event.evaluation
    ? truncateEvaluation(event.evaluation)
    : null;

  return (
    <div
      className="flex items-center gap-2.5 rounded-md bg-zinc-800/30 border border-zinc-800/50 px-2.5 py-2"
      style={{ animation: 'fade-up 0.15s ease-out' }}
    >
      {/* Play/pause button */}
      <button
        onClick={togglePlay}
        disabled={!event.audioUrl}
        className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-teal-500/20 hover:bg-teal-500/30 transition-colors disabled:opacity-30"
        title={playing ? 'Pause' : 'Play what the AI heard'}
      >
        {playing ? (
          <svg viewBox="0 0 16 16" className="w-3 h-3 text-teal-400" fill="currentColor">
            <rect x="4" y="3" width="3" height="10" rx="0.5" />
            <rect x="9" y="3" width="3" height="10" rx="0.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" className="w-3 h-3 text-teal-400" fill="currentColor">
            <path d="M5 3.5v9l7-4.5z" />
          </svg>
        )}
      </button>

      {/* Progress bar and info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {/* Duration bar */}
          <div className="flex-1 h-1 rounded-full bg-zinc-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-teal-500/70 transition-[width] duration-75"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          {event.duration != null && (
            <span className="text-[10px] font-mono text-zinc-600 flex-shrink-0">
              {formatDuration(event.duration)}
            </span>
          )}
        </div>

        {/* Scope and label */}
        <div className="flex items-baseline gap-1.5 mt-1">
          {event.isDiff && (
            <span className="text-[10px] font-mono text-amber-500/70 uppercase tracking-wider">diff</span>
          )}
          {event.scope && (
            <span className="text-[10px] font-mono text-zinc-500 truncate">
              {event.scope}
            </span>
          )}
          {event.label && (
            <span className="text-[10px] font-mono text-zinc-600">
              {event.label}
            </span>
          )}
        </div>

        {/* Evaluation summary */}
        {evalSummary && (
          <div className="text-[11px] font-mono text-zinc-400 mt-1 leading-snug line-clamp-2">
            {evalSummary}
          </div>
        )}
      </div>
    </div>
  );
}

/** Truncate evaluation text to first sentence or 120 chars. */
function truncateEvaluation(text: string): string {
  // Take first sentence
  const sentenceEnd = text.search(/[.!?]\s/);
  if (sentenceEnd > 0 && sentenceEnd < 120) {
    return text.slice(0, sentenceEnd + 1);
  }
  if (text.length <= 120) return text;
  return text.slice(0, 117) + '...';
}
