// src/ui/ChatSidebar.tsx
// Persistent collapsible chat sidebar — always visible across all views.
// Open: full sidebar with messages on the left.
// Collapsed: renders nothing (composer lives in the global footer).
import { useState, useCallback, useRef } from 'react';
import type { ChatMessage } from '../engine/types';
import { ChatPanel } from './ChatPanel';
import { ApiKeyInput } from './ApiKeyInput';

interface Props {
  messages: ChatMessage[];
  isThinking?: boolean;
  isListening?: boolean;
  apiConfigured: boolean;
  onApiKey: (key: string) => void;
  open: boolean;
  onToggle: () => void;
  width: number;
  onResize: (width: number) => void;
}

export function ChatSidebar({
  messages, isThinking = false, isListening = false,
  apiConfigured, onApiKey, open, onToggle, width, onResize,
}: Props) {
  const dragging = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const newWidth = Math.min(600, Math.max(240, e.clientX));
    onResize(newWidth);
  }, [onResize]);

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const handleDoubleClick = useCallback(() => {
    onResize(320);
  }, [onResize]);

  // Collapsed: render nothing — composer is in the global footer
  if (!open) {
    return null;
  }

  // Expanded: full sidebar (without composer — it's in the footer)
  return (
    <div className="relative border-r border-zinc-800/40 flex flex-col min-h-0 bg-zinc-950/80" style={{ width }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/40">
        <ApiKeyInput onSubmit={onApiKey} isConfigured={apiConfigured} />
      </div>

      <ChatPanel
        messages={messages}
        isThinking={isThinking}
        isListening={isListening}
      />

      {/* Footer: collapse toggle pinned to bottom */}
      <div className="flex items-center px-3 py-2 border-t border-zinc-800/40">
        <button
          onClick={onToggle}
          className="group p-1.5 rounded hover:bg-zinc-800/50 transition-colors"
          title="Collapse chat (Cmd+/)"
        >
          <svg viewBox="0 0 16 16" className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors">
            <path d="M10 4l-4 4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Drag handle on right edge */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-zinc-500/40 active:bg-zinc-400/50 transition-colors"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
}
