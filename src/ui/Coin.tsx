// src/ui/Coin.tsx
// The Coin: 36px round floating button, fixed bottom-right, present on all tabs.
// Idle state: inner dot + hint label showing destination. Click or Cmd+K flips view.
// Notification cards attach LEFT of the Coin on instrument tabs only.
import { useEffect, useRef, useState } from 'react';
import type { ViewMode } from './view-types';
import type { OpenDecision } from '../engine/types';

export interface CoinNotificationProps {
  isThinking: boolean;
  openDecisions: OpenDecision[];
  lastCompletionSummary: string | null;
}

interface Props extends CoinNotificationProps {
  currentView: ViewMode;
  lastNonChatView: ViewMode;
  onFlip: () => void;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type CardState = 'working' | 'attention' | 'complete' | null;

function deriveCardState(
  isChat: boolean,
  isThinking: boolean,
  openDecisions: OpenDecision[],
  lastCompletionSummary: string | null,
): CardState {
  if (isChat) return null;
  // Priority: attention > working > complete
  if (openDecisions.length > 0) return 'attention';
  if (isThinking) return 'working';
  if (lastCompletionSummary) return 'complete';
  return null;
}

function cardText(
  state: CardState,
  openDecisions: OpenDecision[],
  lastCompletionSummary: string | null,
): string {
  switch (state) {
    case 'working': return 'Thinking\u2026';
    case 'attention': return openDecisions[0]?.question ?? 'Needs your input';
    case 'complete': return lastCompletionSummary ?? 'Done';
    default: return '';
  }
}

/** 8px status dot color classes by card state */
function dotClasses(state: CardState): string {
  switch (state) {
    case 'working': return 'bg-emerald-400 animate-[pulse-soft_2s_ease-in-out_infinite]';
    case 'attention': return 'bg-amber-400 animate-[pulse-soft_2s_ease-in-out_infinite]';
    case 'complete': return 'bg-emerald-400';
    default: return '';
  }
}

/** Coin button glow animation class by card state */
function coinGlow(state: CardState): string {
  switch (state) {
    case 'working': return 'animate-[coin-pulse-emerald_2s_ease-in-out_infinite]';
    case 'attention': return 'animate-[coin-pulse-amber_2s_ease-in-out_infinite]';
    default: return '';
  }
}

export function Coin({
  currentView, lastNonChatView, onFlip,
  isThinking, openDecisions, lastCompletionSummary,
}: Props) {
  const isChat = currentView === 'chat';
  const hintLabel = isChat
    ? `${capitalize(lastNonChatView)} \u2318K`
    : 'Chat \u2318K';

  const state = deriveCardState(isChat, isThinking, openDecisions, lastCompletionSummary);

  // Track previous state for exit animation
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const prevStateRef = useRef<CardState>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    if (state !== null && prevStateRef.current === null) {
      // Entering: show card with enter animation
      setVisible(true);
      setAnimating(true);
      timeoutRef.current = setTimeout(() => setAnimating(false), 250);
    } else if (state === null && prevStateRef.current !== null) {
      // Exiting: play fade-out then hide
      setAnimating(true);
      timeoutRef.current = setTimeout(() => {
        setVisible(false);
        setAnimating(false);
      }, 250);
    }

    prevStateRef.current = state;
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [state]);

  const showCard = visible || state !== null;
  const isExiting = state === null && visible;
  const isEntering = state !== null && animating;

  // Use the state for rendering; if exiting, use the previous state content
  const renderState = state ?? prevStateRef.current;

  return (
    <div className="fixed bottom-12 right-6 z-30 flex flex-col items-end gap-1.5">
      <div className="flex items-center">
        {/* Notification card — left of Coin */}
        {showCard && renderState && (
          <div
            className={`
              flex items-center gap-2 px-3 h-9
              bg-zinc-900 border border-zinc-700/50 border-r-0
              rounded-l-2xl
              max-w-[280px]
              transition-all duration-250
              ${isExiting ? 'animate-[fade-out_250ms_ease_forwards] translate-x-2' : ''}
              ${isEntering ? 'animate-[fade-in_250ms_ease_forwards]' : ''}
            `}
            data-testid="coin-notification-card"
            data-card-state={renderState}
          >
            {/* Status dot */}
            <div className={`w-2 h-2 rounded-full shrink-0 ${dotClasses(renderState)}`} />
            {/* Text */}
            <span className="text-[13px] text-zinc-300 truncate select-none">
              {cardText(renderState, openDecisions, lastCompletionSummary)}
            </span>
          </div>
        )}
        {/* The Coin button */}
        <button
          onClick={onFlip}
          className={`w-9 h-9 rounded-full bg-zinc-900 border border-zinc-700/50 flex items-center justify-center hover:border-zinc-600/70 transition-colors cursor-pointer shrink-0 ${
            showCard && renderState ? 'rounded-l-none border-l-0' : ''
          } ${coinGlow(state)}`}
          title={isChat ? `Switch to ${capitalize(lastNonChatView)}` : 'Switch to Chat'}
          aria-label={isChat ? `Switch to ${capitalize(lastNonChatView)}` : 'Switch to Chat'}
        >
          <div className="w-2 h-2 rounded-full bg-zinc-600" />
        </button>
      </div>
      <span className="text-[10px] text-zinc-600 select-none whitespace-nowrap pr-1">
        {hintLabel}
      </span>
    </div>
  );
}
