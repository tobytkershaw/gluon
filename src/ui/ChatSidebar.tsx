// src/ui/ChatSidebar.tsx
// Persistent collapsible chat sidebar — the AI collaborator's space.
// Open: full sidebar with messages, composer, and bold visual identity.
// Collapsed: renders nothing (floating composer pill appears in AppShell).
import { useCallback, useRef } from 'react';
import type { ChatMessage, Reaction, UndoEntry } from '../engine/types';
import { ChatMessages } from './ChatMessages';
import { ChatComposer } from './ChatComposer';
import { ApiKeyInput } from './ApiKeyInput';

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  isThinking?: boolean;
  isListening?: boolean;
  streamingText?: string;
  reactions?: Reaction[];
  onReaction?: (messageIndex: number, verdict: 'approved' | 'rejected') => void;
  undoStack?: UndoEntry[];
  onUndoMessage?: (messageIndex: number) => void;
  apiConfigured: boolean;
  onApiKey: (openaiKey: string, geminiKey: string) => void;
  currentOpenaiKey?: string;
  currentGeminiKey?: string;
  open: boolean;
  width: number;
  onResize: (width: number) => void;
}

export function ChatSidebar({
  messages, onSend, isThinking = false, isListening = false, streamingText = '',
  reactions, onReaction, undoStack, onUndoMessage,
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
    // Chat is on the right — left edge resize: window width minus pointer X = new width
    const newWidth = Math.min(600, Math.max(240, window.innerWidth - e.clientX));
    onResize(newWidth);
  }, [onResize]);

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const handleDoubleClick = useCallback(() => {
    onResize(320);
  }, [onResize]);

  const isActive = isThinking || isListening;

  // Collapsed: render nothing — floating composer pill is in AppShell
  if (!open) {
    return null;
  }

  // Expanded: full sidebar with bold visual identity
  return (
    <div className="relative flex min-h-0">
      {/* Bioelectric membrane — the seam between workstation and AI */}
      <div className={`ai-membrane shrink-0 ${isActive ? 'ai-membrane--active' : ''}`} />

      {/* AI space */}
      <div
        className={`ai-space flex flex-col min-h-0 flex-1 ${isActive ? 'ai-space--active' : ''}`}
        style={{ width: width - 2 }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-violet-900/20">
          <span className="text-[9px] uppercase tracking-[0.2em] text-violet-400/50 font-medium select-none">AI</span>
          <div className="flex-1" />
          <ApiKeyInput onSubmit={onApiKey} isConfigured={apiConfigured} currentOpenaiKey={currentOpenaiKey} currentGeminiKey={currentGeminiKey} />
        </div>

        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <ChatMessages messages={messages} isThinking={isThinking} isListening={isListening} streamingText={streamingText} reactions={reactions} onReaction={onReaction} undoStack={undoStack} onUndoMessage={onUndoMessage} />
        </div>

        {/* Composer at bottom of sidebar */}
        <div className="shrink-0 border-t border-violet-900/20">
          <ChatComposer onSend={onSend} disabled={isThinking || isListening} variant="sidebar" />
        </div>

        {/* Drag handle on LEFT edge (overlays the membrane) */}
        <div
          className="absolute top-0 left-0 w-2 h-full cursor-col-resize hover:bg-violet-500/10 active:bg-violet-400/15 transition-colors z-10"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        />
      </div>
    </div>
  );
}
