import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
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

/** Generate deterministic waveform sample values from a seed string. */
function generateWaveformSamples(seed: string, count: number): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const samples: number[] = [];
  for (let i = 0; i < count; i++) {
    hash = ((hash * 1103515245 + 12345) & 0x7fffffff);
    const raw = (hash % 1000) / 1000;
    // Shape: fade in, sustain, fade out — more natural waveform envelope
    const pos = i / count;
    const envelope = Math.min(pos * 5, 1) * Math.min((1 - pos) * 4, 1);
    samples.push((0.1 + raw * 0.9) * envelope);
  }
  return samples;
}

/** Build an SVG path string from waveform samples (mirrored top/bottom). */
function buildWaveformPath(samples: number[], width: number, height: number): string {
  const mid = height / 2;
  const step = width / samples.length;
  // Top half
  let d = `M 0 ${mid}`;
  for (let i = 0; i < samples.length; i++) {
    const x = i * step;
    const y = mid - samples[i] * mid * 0.85;
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  d += ` L ${width} ${mid}`;
  // Bottom half (mirror)
  for (let i = samples.length - 1; i >= 0; i--) {
    const x = i * step;
    const y = mid + samples[i] * mid * 0.85;
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  d += ' Z';
  return d;
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

  // Generate deterministic waveform from scope + duration
  const waveformSeed = `${event.scope ?? 'mix'}-${event.duration ?? 0}`;
  const sampleCount = 64;
  const waveformSamples = useMemo(
    () => generateWaveformSamples(waveformSeed, sampleCount),
    [waveformSeed],
  );

  const svgWidth = 240;
  const svgHeight = 28;
  const waveformPath = useMemo(
    () => buildWaveformPath(waveformSamples, svgWidth, svgHeight),
    [waveformSamples],
  );

  // Clip path for the "played" portion
  const clipX = progress * svgWidth;

  return (
    <div>
      {/* Card */}
      <div
        className="flex items-center gap-3 rounded-lg bg-zinc-900/70 border border-zinc-800/50 px-3 py-2"
        style={{ animation: 'fade-up 0.15s ease-out' }}
      >
        {/* Play/pause button — violet circle */}
        <button
          onClick={togglePlay}
          disabled={!event.audioUrl}
          className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-violet-500/20 border border-violet-400/30 hover:bg-violet-500/30 hover:border-violet-400/50 transition-all disabled:opacity-30 disabled:hover:bg-violet-500/20 disabled:hover:border-violet-400/30"
          title={playing ? 'Pause' : 'Play what the AI heard'}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" className="w-3 h-3 text-violet-400" fill="currentColor">
              <rect x="3.5" y="3" width="3" height="10" rx="0.75" />
              <rect x="9.5" y="3" width="3" height="10" rx="0.75" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" className="w-3 h-3 text-violet-400 ml-0.5" fill="currentColor">
              <polygon points="3,1 14,8 3,15" />
            </svg>
          )}
        </button>

        {/* Waveform visualization — SVG with progress overlay */}
        <div className="flex-1 min-w-0">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-7"
            preserveAspectRatio="none"
          >
            <defs>
              <clipPath id={`played-${waveformSeed}`}>
                <rect x="0" y="0" width={clipX} height={svgHeight} />
              </clipPath>
              <clipPath id={`unplayed-${waveformSeed}`}>
                <rect x={clipX} y="0" width={svgWidth - clipX} height={svgHeight} />
              </clipPath>
            </defs>
            {/* Unplayed portion */}
            <path
              d={waveformPath}
              fill="rgb(113 113 122 / 0.5)"
              clipPath={`url(#unplayed-${waveformSeed})`}
            />
            {/* Played portion */}
            <path
              d={waveformPath}
              fill="rgb(167 139 250 / 0.7)"
              clipPath={`url(#played-${waveformSeed})`}
            />
          </svg>
        </div>

        {/* Duration + scope metadata */}
        <div className="flex-shrink-0 flex items-center gap-2">
          {event.isDiff && (
            <span className="text-[9px] font-mono font-medium text-amber-400/80 uppercase tracking-widest bg-amber-500/10 px-1.5 py-0.5 rounded">diff</span>
          )}
          {event.duration != null && (
            <span className="text-[11px] font-mono text-zinc-400 tabular-nums">
              {formatDuration(event.duration)}
            </span>
          )}
          {event.scope && (
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
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
        <p className="text-[13px] italic text-zinc-500 mt-1.5 ml-11 leading-relaxed line-clamp-2">
          {evalSummary}
        </p>
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
