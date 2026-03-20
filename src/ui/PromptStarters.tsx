/* eslint-disable react-refresh/only-export-components -- pure helper fn co-located with component */
// src/ui/PromptStarters.tsx
// Context-aware prompt starter chips shown when chat is empty.
// Static templates selected by client-side logic — no model call, no latency.

import type { Track, ChatMessage } from '../engine/types';
import { MASTER_BUS_ID, getTrackKind } from '../engine/types';
import { createBusTrack, createEmptyTrack } from '../engine/session';

/** Starter pools keyed by project state. */
const EMPTY_PROJECT_STARTERS = [
  'Something dark and heavy',
  'Warm and hypnotic',
  'Bright and chaotic',
  'Slow and deep',
  'A dub techno groove',
  'Lo-fi beat with vinyl crackle',
  'Ambient drone that evolves',
  'Acid house bassline',
];

const TRACKS_EXIST_STARTERS = [
  'Listen and tell me what you hear',
  'What would you change?',
  'Add something that complements this',
  'Make it more interesting',
];

const RESUME_STARTERS = [
  'Remind me where we left off',
  'What\'s the current mix state?',
  'What should we work on next?',
];

export type ProjectState = 'empty' | 'tracks-exist' | 'resume';

const EMPTY_AUDIO_TEMPLATE = createEmptyTrack('__template-audio__');
const EMPTY_BUS_TEMPLATE = createBusTrack('__template-bus__');

function hasTrackContent(track: Track): boolean {
  if (track.id === MASTER_BUS_ID) return false;

  const template = getTrackKind(track) === 'bus' ? EMPTY_BUS_TEMPLATE : EMPTY_AUDIO_TEMPLATE;

  if ((track.patterns?.some(pattern => pattern.events.length > 0) ?? false) || (track._hiddenEvents?.length ?? 0) > 0) {
    return true;
  }
  if ((track.processors?.length ?? 0) > 0 || (track.modulators?.length ?? 0) > 0 || (track.modulations?.length ?? 0) > 0) {
    return true;
  }
  if ((track.sends?.length ?? 0) > 0) {
    return true;
  }
  if (track.volume !== template.volume || track.pan !== template.pan) {
    return true;
  }
  if (track.kind !== 'bus' && (track.engine !== template.engine || track.model !== template.model)) {
    return true;
  }
  const paramKeys = new Set([...Object.keys(template.params), ...Object.keys(track.params ?? {})]);
  for (const key of paramKeys) {
    if ((track.params ?? {})[key] !== template.params[key]) {
      return true;
    }
  }
  if (track.controlProvenance && Object.keys(track.controlProvenance).length > 0) {
    return true;
  }
  return false;
}

/** Determine project state and return appropriate starters. */
export function selectStarters(
  tracks: Track[],
  messages: ChatMessage[],
): { state: ProjectState; starters: string[] } {
  if (messages.length > 0) {
    return { state: 'resume', starters: RESUME_STARTERS };
  }
  if (tracks.some(hasTrackContent)) {
    return { state: 'tracks-exist', starters: TRACKS_EXIST_STARTERS };
  }
  return { state: 'empty', starters: EMPTY_PROJECT_STARTERS };
}

interface Props {
  tracks: Track[];
  messages: ChatMessage[];
  onSelect: (prompt: string) => void;
  /** Called when the user clicks "Skip" to dismiss onboarding. */
  onDismiss?: () => void;
}

export function PromptStarters({ tracks, messages, onSelect, onDismiss }: Props) {
  const { state, starters } = selectStarters(tracks, messages);

  return (
    <div className="flex flex-col items-center justify-center h-full px-4" style={{ gap: 0 }}>
      {state === 'empty' && (
        <>
          <span
            className="select-none"
            style={{
              fontFamily: 'var(--font-sans, Syne, system-ui, sans-serif)',
              fontWeight: 700,
              fontSize: 32,
              color: 'var(--text-primary, #e5e2dc)',
              letterSpacing: '-0.04em',
              textTransform: 'lowercase' as const,
              opacity: 0.9,
              marginBottom: 12,
            }}
          >gluon</span>
          <span
            style={{
              fontFamily: 'var(--font-sans, Syne, system-ui, sans-serif)',
              fontSize: 16,
              fontWeight: 400,
              color: 'var(--text-muted, #7c776e)',
              textAlign: 'center' as const,
              marginBottom: 40,
            }}
          >Describe what you want to make.</span>
        </>
      )}
      {state !== 'empty' && (
        <svg viewBox="0 0 24 24" className="w-10 h-10 text-zinc-100 opacity-[0.06]" style={{ marginBottom: 24 }}>
          <path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
        </svg>
      )}
      <div
        className="flex flex-wrap justify-center"
        style={{
          gap: 8,
          maxWidth: 560,
          animation: 'fade-up 0.2s ease-out',
        }}
      >
        {starters.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onSelect(prompt)}
            className="transition-colors cursor-pointer"
            style={{
              padding: '7px 14px',
              background: 'var(--bg-raised, #282523)',
              border: '1px solid var(--border, rgba(61,57,53,0.6))',
              borderRadius: 20,
              fontFamily: 'var(--font-sans, Syne, system-ui, sans-serif)',
              fontSize: 13,
              fontWeight: 400,
              color: 'var(--text-secondary, #a8a39a)',
              lineHeight: 1.3,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover, #3d3935)';
              e.currentTarget.style.borderColor = 'var(--zinc-600, #57534e)';
              e.currentTarget.style.color = 'var(--text-primary, #e5e2dc)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-raised, #282523)';
              e.currentTarget.style.borderColor = 'var(--border, rgba(61,57,53,0.6))';
              e.currentTarget.style.color = 'var(--text-secondary, #a8a39a)';
            }}
          >
            {prompt}
          </button>
        ))}
      </div>
      {state === 'empty' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            gap: 12,
            marginTop: 36,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono, "DM Mono", ui-monospace, monospace)',
              fontSize: 10,
              color: 'var(--text-faint, #57534e)',
              letterSpacing: '0.02em',
              opacity: 0.7,
            }}
          >Everything is undoable. Start anywhere.</span>
          {onDismiss && (
            <button
              onClick={onDismiss}
              style={{
                fontFamily: 'var(--font-sans, Syne, system-ui, sans-serif)',
                fontSize: 12,
                color: 'var(--text-faint, #57534e)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 8px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-muted, #7c776e)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-faint, #57534e)';
              }}
            >Skip</button>
          )}
        </div>
      )}
    </div>
  );
}
