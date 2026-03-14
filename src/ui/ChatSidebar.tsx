// src/ui/ChatSidebar.tsx
// Persistent collapsible chat sidebar — always visible across all views.
// Open: full sidebar with messages + composer on the left.
// Collapsed: floating composer input at bottom-left over the main content.
import { useState, useEffect } from 'react';
import type { ChatMessage } from '../engine/types';
import { ChatPanel } from './ChatPanel';
import { ChatComposer } from './ChatComposer';
import { ApiKeyInput } from './ApiKeyInput';

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  isThinking?: boolean;
  isListening?: boolean;
  apiConfigured: boolean;
  onApiKey: (key: string) => void;
  open: boolean;
  onToggle: () => void;
}

export function ChatSidebar({
  messages, onSend, isThinking = false, isListening = false,
  apiConfigured, onApiKey, open, onToggle,
}: Props) {
  const [lastSeenCount, setLastSeenCount] = useState(messages.length);
  const hasUnread = !open && messages.length > lastSeenCount;

  useEffect(() => {
    if (open) setLastSeenCount(messages.length);
  }, [open, messages.length]);

  const handleSend = (text: string) => {
    onSend(text);
    if (!open) onToggle();
  };

  // Collapsed: floating composer over main content
  if (!open) {
    return (
      <div className="absolute bottom-4 left-4 z-40 flex items-center gap-2" style={{ animation: 'fade-up 0.15s ease-out' }}>
        <div className="w-80">
          <ChatComposer onSend={handleSend} disabled={isThinking || isListening} floating />
        </div>
        {/* Status indicators next to the input */}
        <div className="flex items-center gap-1.5">
          {(isThinking || isListening) && (
            <span
              className="w-2 h-2 rounded-full bg-amber-400"
              style={{ animation: 'pulse-soft 1.5s ease-in-out infinite' }}
              title={isListening ? 'Listening...' : 'Thinking...'}
            />
          )}
          {hasUnread && (
            <button
              onClick={onToggle}
              className="text-[9px] font-mono text-amber-400/70 hover:text-amber-300 transition-colors px-2 py-1 rounded bg-zinc-800/60 border border-zinc-700/40"
              title="New messages — click to expand"
            >
              new
            </button>
          )}
          <button
            onClick={onToggle}
            className="group p-1.5 rounded hover:bg-zinc-800/50 transition-colors"
            title="Expand chat (Cmd+/)"
          >
            <svg viewBox="0 0 16 16" className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors">
              <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Expanded: full sidebar
  return (
    <div className="w-80 border-r border-zinc-800/40 flex flex-col min-h-0 bg-zinc-950/80">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/40">
        <ApiKeyInput onSubmit={onApiKey} isConfigured={apiConfigured} />
        <div className="flex-1" />
        <button
          onClick={onToggle}
          className="group p-1.5 rounded hover:bg-zinc-800/50 transition-colors"
          title="Collapse chat (Cmd+/)"
        >
          <svg viewBox="0 0 16 16" className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors fill-current">
            <path d="M10 4l-4 4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <ChatPanel
        messages={messages}
        onSend={onSend}
        isThinking={isThinking}
        isListening={isListening}
      />
    </div>
  );
}
