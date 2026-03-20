// src/ui/Coin.tsx
// The Coin: 36px round floating button, fixed bottom-right, present on all tabs.
// Idle state: inner dot + hint label showing destination. Click or Cmd+K flips view.
import type { ViewMode } from './view-types';

interface Props {
  currentView: ViewMode;
  lastNonChatView: ViewMode;
  onFlip: () => void;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function Coin({ currentView, lastNonChatView, onFlip }: Props) {
  const isChat = currentView === 'chat';
  const hintLabel = isChat
    ? `${capitalize(lastNonChatView)} \u2318K`
    : 'Chat \u2318K';

  return (
    <div className="fixed bottom-6 right-6 z-30 flex flex-col items-center gap-1.5">
      <button
        onClick={onFlip}
        className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-700/50 flex items-center justify-center hover:border-zinc-600/70 transition-colors cursor-pointer"
        title={isChat ? `Switch to ${capitalize(lastNonChatView)}` : 'Switch to Chat'}
        aria-label={isChat ? `Switch to ${capitalize(lastNonChatView)}` : 'Switch to Chat'}
      >
        <div className="w-2 h-2 rounded-full bg-zinc-600" />
      </button>
      <span className="text-[10px] text-zinc-600 select-none whitespace-nowrap">
        {hintLabel}
      </span>
    </div>
  );
}
