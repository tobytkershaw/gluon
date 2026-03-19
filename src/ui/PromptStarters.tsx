// src/ui/PromptStarters.tsx
// Context-aware prompt starter chips shown when chat is empty.
// Static templates selected by client-side logic — no model call, no latency.

import type { Track, ChatMessage } from '../engine/types';
import { MASTER_BUS_ID, getTrackKind } from '../engine/types';
import { createBusTrack, createEmptyTrack } from '../engine/session';

/** Starter pools keyed by project state. */
const EMPTY_PROJECT_STARTERS = [
  'Start a dark techno kick',
  'Sketch a bass gesture',
  'Set up a pad with slow modulation',
  'What can you do?',
];

const TRACKS_EXIST_STARTERS = [
  'Make the hats looser',
  'Listen and tell me what clashes',
  'Give me two directions for the bass',
  'Add some variation to the pattern',
  'What would you change about this mix?',
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
}

export function PromptStarters({ tracks, messages, onSelect }: Props) {
  const { starters } = selectStarters(tracks, messages);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-4">
      <svg viewBox="0 0 24 24" className="w-10 h-10 text-zinc-100 opacity-[0.06]">
        <path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
      </svg>
      <div className="flex flex-wrap justify-center gap-2 max-w-sm" style={{ animation: 'fade-up 0.2s ease-out' }}>
        {starters.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onSelect(prompt)}
            className="px-3 py-1.5 rounded-full text-[12px] text-zinc-500 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/40 transition-colors cursor-pointer"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
