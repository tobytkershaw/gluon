// src/ui/EmptyState.tsx
// Minimal empty-state for instrument views when the session has no content yet.
// Defers to the Chat tab onboarding for the primary entry point.

interface Props {
  onAddTrack: () => void;
  onSendPrompt: (prompt: string) => void;
  onDismiss?: () => void;
}

export function EmptyState({ onAddTrack, onSendPrompt, onDismiss }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-[13px] text-zinc-500">
          No instruments yet. Add a track or describe what you want in Chat.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onAddTrack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-zinc-700 hover:border-zinc-600 bg-zinc-800/50 hover:bg-zinc-800 text-[12px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            Add Track
          </button>
          <button
            onClick={() => onSendPrompt('Something dark and heavy')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-zinc-700 hover:border-zinc-600 bg-zinc-800/50 hover:bg-zinc-800 text-[12px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            Try Chat
          </button>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-[11px] text-zinc-600 hover:text-zinc-500 transition-colors cursor-pointer mt-1"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
