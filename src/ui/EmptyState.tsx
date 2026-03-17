// src/ui/EmptyState.tsx
// Welcome / empty-state panel shown when the session has no content yet.
// Orients new users with a clear starting action and quick-start suggestions
// that send a prompt to the AI chat.

interface Props {
  onAddTrack: () => void;
  onSendPrompt: (prompt: string) => void;
  chatOpen: boolean;
  onOpenChat: () => void;
  onDismiss?: () => void;
}

const QUICK_STARTS = [
  'Create a 4-bar drum pattern',
  'Add a bass synth with a simple line',
  'Set up a pad with slow modulation',
];

export function EmptyState({ onAddTrack, onSendPrompt, chatOpen, onOpenChat, onDismiss }: Props) {
  const handleQuickStart = (prompt: string) => {
    if (!chatOpen) onOpenChat();
    onSendPrompt(prompt);
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-6">
        {/* Primary CTA */}
        <div className="space-y-2">
          <h2 className="text-lg font-medium text-zinc-200">
            Welcome to Gluon
          </h2>
          <p className="text-sm text-zinc-500">
            Add a track to start making sound, or ask the AI for help.
          </p>
        </div>

        <button
          onClick={onAddTrack}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-500 text-sm font-medium text-white transition-colors"
        >
          <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M8 3v10M3 8h10" />
          </svg>
          Add Track
        </button>

        {/* Quick-start suggestions */}
        <div className="space-y-2">
          <p className="text-xs text-zinc-600 uppercase tracking-wider">
            Or try a quick start
          </p>
          <div className="flex flex-col gap-1.5">
            {QUICK_STARTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => handleQuickStart(prompt)}
                className="px-3 py-1.5 rounded border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 text-sm text-zinc-400 hover:text-zinc-200 transition-colors text-left"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Skip — I know what I'm doing
          </button>
        )}
      </div>
    </div>
  );
}
