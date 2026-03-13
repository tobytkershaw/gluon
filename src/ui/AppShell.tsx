// src/ui/AppShell.tsx
// Three-column layout shell: TrackList | main content | ChatSidebar
// Handles responsive collapse thresholds via ResizeObserver.
import { useRef, useEffect, useState, type ReactNode } from 'react';
import type { Voice, ChatMessage } from '../engine/types';
import { TrackList } from './TrackList';
import { ChatSidebar } from './ChatSidebar';

interface Props {
  // Track sidebar
  voices: Voice[];
  activeVoiceId: string;
  activityMap: Record<string, number>;
  onSelectVoice: (voiceId: string) => void;
  onToggleMute: (voiceId: string) => void;
  onToggleSolo: (voiceId: string) => void;
  onToggleAgency: (voiceId: string) => void;
  // Chat sidebar
  messages: ChatMessage[];
  onSend: (message: string) => void;
  isThinking: boolean;
  isListening: boolean;
  apiConfigured: boolean;
  onApiKey: (key: string) => void;
  chatOpen: boolean;
  onChatToggle: () => void;
  // Main content
  children: ReactNode;
}

const CHAT_COLLAPSE_WIDTH = 1280;

export function AppShell({
  voices, activeVoiceId, activityMap,
  onSelectVoice, onToggleMute, onToggleSolo, onToggleAgency,
  messages, onSend, isThinking, isListening,
  apiConfigured, onApiKey, chatOpen, onChatToggle,
  children,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);

  // Responsive: auto-collapse chat below threshold
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setNarrow(entry.contentRect.width < CHAT_COLLAPSE_WIDTH);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const effectiveChatOpen = narrow ? false : chatOpen;

  return (
    <div ref={shellRef} className="h-screen flex bg-zinc-950 text-zinc-100 relative">
      {/* Left: Chat sidebar */}
      <ChatSidebar
        messages={messages}
        onSend={onSend}
        isThinking={isThinking}
        isListening={isListening}
        apiConfigured={apiConfigured}
        onApiKey={onApiKey}
        open={effectiveChatOpen}
        onToggle={onChatToggle}
      />

      {/* Center: Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {children}
      </div>

      {/* Right: Track sidebar */}
      <TrackList
        voices={voices}
        activeVoiceId={activeVoiceId}
        activityMap={activityMap}
        onSelectVoice={onSelectVoice}
        onToggleMute={onToggleMute}
        onToggleSolo={onToggleSolo}
        onToggleAgency={onToggleAgency}
      />
    </div>
  );
}
