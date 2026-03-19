// src/ui/ChatSidebar.tsx
// Persistent collapsible chat sidebar — the AI collaborator's space.
// Open: full sidebar with messages, composer, and bold visual identity.
// Collapsed: renders nothing (floating composer pill appears in AppShell).
import { useCallback, useRef, type Ref } from 'react';
import type { ChatMessage, Track, Reaction, UndoEntry } from '../engine/types';
import type { ListenerMode } from '../ai/api';
import type { FollowUpChip } from './TurnSummaryCard';
import type { ChatComposerHandle } from './ChatComposer';
import { ChatMessages } from './ChatMessages';
import { ChatComposer } from './ChatComposer';
import { ApiKeyInput } from './ApiKeyInput';
import { ApiKeySetup } from './ApiKeySetup';

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  isThinking?: boolean;
  isListening?: boolean;
  streamingText?: string;
  streamingLogEntries?: import('../engine/types').ActionLogEntry[];
  streamingRejections?: { reason: string }[];
  reactions?: Reaction[];
  onReaction?: (messageIndex: number, verdict: 'approved' | 'rejected') => void;
  undoStack?: UndoEntry[];
  onUndoMessage?: (messageIndex: number) => void;
  tracks?: Track[];
  sessionMessages?: ChatMessage[];
  apiConfigured: boolean;
  onApiKey: (openaiKey: string, geminiKey: string, listenerMode?: ListenerMode) => void;
  currentOpenaiKey?: string;
  currentGeminiKey?: string;
  listenerMode?: ListenerMode;
  open: boolean;
  width: number;
  onResize: (width: number) => void;
  composerRef?: Ref<ChatComposerHandle>;
  lastHumanMessage?: string;
  followUpChips?: FollowUpChip[];
}

export function ChatSidebar({
  messages, onSend, isThinking = false, isListening = false, streamingText = '', streamingLogEntries, streamingRejections,
  reactions, onReaction, undoStack, onUndoMessage,
  tracks, sessionMessages,
  apiConfigured, onApiKey, currentOpenaiKey, currentGeminiKey, listenerMode,
  open, width, onResize,
  composerRef, lastHumanMessage, followUpChips = [],
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
    <div className="relative flex min-h-0 my-1.5">
      {/* AI space — the curved left edge IS the membrane */}
      <div
        className={`ai-space ai-space--bordered flex flex-col min-h-0 flex-1 rounded-l-2xl overflow-hidden ${isActive ? 'ai-space--active' : ''}`}
        style={{ width }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-violet-900/20">
          <span className="text-[11px] uppercase tracking-[0.2em] text-violet-400/50 font-medium select-none">Gluon</span>
          <div className="flex-1" />
          {apiConfigured && (
            <ApiKeyInput onSubmit={onApiKey} isConfigured={apiConfigured} currentOpenaiKey={currentOpenaiKey} currentGeminiKey={currentGeminiKey} listenerMode={listenerMode} />
          )}
        </div>

        {apiConfigured ? (
          <>
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <ChatMessages messages={messages} isThinking={isThinking} isListening={isListening} streamingText={streamingText} streamingLogEntries={streamingLogEntries} streamingRejections={streamingRejections} reactions={reactions} onReaction={onReaction} undoStack={undoStack} onUndoMessage={onUndoMessage} tracks={tracks} sessionMessages={sessionMessages} onStarterSelect={onSend} />
            </div>

            {/* Composer at bottom of sidebar */}
            <div className="shrink-0 border-t border-violet-900/20">
              <ChatComposer
                ref={composerRef}
                onSend={onSend}
                disabled={isThinking || isListening}
                variant="sidebar"
                lastUserMessage={lastHumanMessage}
                followUpChips={followUpChips}
              />
            </div>
          </>
        ) : (
          <ApiKeySetup onSubmit={onApiKey} />
        )}

        {/* Drag handle on LEFT edge */}
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
