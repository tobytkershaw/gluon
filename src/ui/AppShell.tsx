// src/ui/AppShell.tsx
// Three-column layout shell: TrackList | main content | ChatSidebar
// Handles responsive collapse thresholds via ResizeObserver.
import { useRef, useEffect, useState, type ReactNode } from 'react';
import type { Voice, ChatMessage } from '../engine/types';
import type { ProjectMeta } from '../engine/project-store';
import { TrackList } from './TrackList';
import { ChatSidebar } from './ChatSidebar';
import { ProjectMenu } from './ProjectMenu';

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
  // Project
  projectName: string;
  projects: ProjectMeta[];
  saveError: boolean;
  onProjectRename: (name: string) => void;
  onProjectNew: () => void;
  onProjectOpen: (id: string) => void;
  onProjectDuplicate: () => void;
  onProjectDelete: () => void;
  onProjectExport: () => void;
  onProjectImport: (file: File) => void;
  // Main content
  children: ReactNode;
}

const CHAT_COLLAPSE_WIDTH = 1280;

export function AppShell({
  voices, activeVoiceId, activityMap,
  onSelectVoice, onToggleMute, onToggleSolo, onToggleAgency,
  messages, onSend, isThinking, isListening,
  apiConfigured, onApiKey, chatOpen, onChatToggle,
  projectName, projects, saveError,
  onProjectRename, onProjectNew, onProjectOpen, onProjectDuplicate,
  onProjectDelete, onProjectExport, onProjectImport,
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
        {/* Project bar */}
        <div className="flex items-center px-2 py-1 border-b border-zinc-800/30">
          <ProjectMenu
            projectName={projectName}
            projects={projects}
            saveError={saveError}
            onRename={onProjectRename}
            onNew={onProjectNew}
            onOpen={onProjectOpen}
            onDuplicate={onProjectDuplicate}
            onDelete={onProjectDelete}
            onExport={onProjectExport}
            onImport={onProjectImport}
          />
        </div>
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
