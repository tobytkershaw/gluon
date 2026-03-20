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
    <div className="mt-2 space-y-2">
      {events.map((event, i) => (
        <ListenCard key={i} event={event} />
      ))}
    </div>
  );
}

/** Deterministic pseudo-waveform heights from a seed string. */
function generateWaveformBars(seed: string, count: number): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    // Simple PRNG from hash
    hash = ((hash * 1103515245 + 12345) & 0x7fffffff);
    // Range 0.15 to 1.0 — biased toward middle for natural waveform look
    const raw = (hash % 1000) / 1000;
    bars.push(0.15 + raw * 0.85);
  }
  return bars;
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
      // eslint-disable-next-line react-hooks/immutability -- self-referencing rAF loop is intentional
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
    if (seconds == null) return '';
    return `${seconds.toFixed(1)}s`;
  };

  // Truncate evaluation to first sentence or 120 chars
  const evalSummary = event.evaluation
    ? truncateEvaluation(event.evaluation)
    : null;

  // Generate deterministic waveform bars based on scope + duration
  const waveformSeed = `${event.scope ?? 'mix'}-${event.duration ?? 0}`;
  const barCount = 48;
  const waveformBars = generateWaveformBars(waveformSeed, barCount);

  return (
    <div>
      {/* Card */}
      <div
        className="flex items-center gap-3 rounded-lg bg-zinc-900/60 border border-zinc-800/60 border-l-[3px] border-l-violet-400 px-3 py-2.5"
        style={{ animation: 'fade-up 0.15s ease-out' }}
      >
        {/* Play/pause button — violet circle */}
        <button
          onClick={togglePlay}
          disabled={!event.audioUrl}
          className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-violet-500/15 border border-violet-500/30 hover:bg-violet-500/25 transition-colors disabled:opacity-30"
          title={playing ? 'Pause' : 'Play what the AI heard'}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" className="w-3 h-3 text-violet-400" fill="currentColor">
              <rect x="4" y="3" width="3" height="10" rx="0.5" />
              <rect x="9" y="3" width="3" height="10" rx="0.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" className="w-2.5 h-3 text-violet-400 ml-0.5" fill="currentColor">
              <polygon points="0,0 12,8 0,16" />
            </svg>
          )}
        </button>

        {/* Waveform visualization */}
        <div className="flex-1 min-w-0 h-6 flex items-center gap-px">
          {waveformBars.map((height, i) => {
            const played = i / barCount < progress;
            return (
              <div
                key={i}
                className={`flex-1 rounded-sm transition-colors duration-75 ${
                  played ? 'bg-violet-400/70' : 'bg-zinc-700'
                }`}
                style={{ height: `${height * 100}%` }}
              />
            );
          })}
        </div>

        {/* Duration + scope metadata */}
        <div className="flex-shrink-0 flex flex-col items-end gap-0.5">
          {event.isDiff && (
            <span className="text-[9px] font-mono text-amber-500/70 uppercase tracking-wider">diff</span>
          )}
          {event.duration != null && (
            <span className="text-xs font-mono text-zinc-400">
              {formatDuration(event.duration)}
            </span>
          )}
          {event.scope && (
            <span className="text-xs font-mono text-zinc-500 uppercase tracking-wide">
              {event.scope}
            </span>
          )}
          {event.label && !event.scope && (
            <span className="text-[10px] font-mono text-zinc-600">
              {event.label}
            </span>
          )}
        </div>
      </div>

      {/* AI assessment text — italic, indented to align past the play button */}
      {evalSummary && (
        <div
          className="text-sm italic text-zinc-400 mt-1 leading-relaxed line-clamp-2"
          style={{ paddingLeft: 'calc(28px + 12px)' }}
        >
          {evalSummary}
        </div>
      )}
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
