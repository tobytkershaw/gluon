// src/ui/ChatSidebar.tsx
// Persistent collapsible chat sidebar — always visible across all views.
// Open: full sidebar with messages and composer at bottom.
// Collapsed: renders nothing (composer moves to the global footer).
import { useCallback, useRef } from 'react';
import type { ChatMessage } from '../engine/types';
import { ChatMessages } from './ChatMessages';
import { ChatComposer } from './ChatComposer';
import { ApiKeyInput } from './ApiKeyInput';

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  isThinking?: boolean;
  isListening?: boolean;
  apiConfigured: boolean;
  onApiKey: (openaiKey: string, geminiKey: string) => void;
  currentOpenaiKey?: string;
  currentGeminiKey?: string;
  open: boolean;
  width: number;
  onResize: (width: number) => void;
}

export function ChatSidebar({
  messages, onSend, isThinking = false, isListening = false,
  apiConfigured, onApiKey, currentOpenaiKey, currentGeminiKey,
  open, width, onResize,
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

  // Expanded: full sidebar with composer at bottom
  return (
    <div className="relative border-r border-zinc-800/40 flex flex-col min-h-0 bg-zinc-950/80" style={{ width }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/40">
        <ApiKeyInput onSubmit={onApiKey} isConfigured={apiConfigured} currentOpenaiKey={currentOpenaiKey} currentGeminiKey={currentGeminiKey} />
      </div>

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <ChatMessages messages={messages} isThinking={isThinking} isListening={isListening} />
      </div>

      {/* Composer at bottom of sidebar */}
      <div className="shrink-0 border-t border-zinc-800/40">
        <ChatComposer onSend={onSend} disabled={isThinking || isListening} variant="sidebar" />
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
