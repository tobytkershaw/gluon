// src/ui/AppShell.tsx
// Three-column layout shell: TrackList | main content | ChatSidebar
// Global top bar: ProjectMenu | ViewToggle | TransportStrip | UndoButton
// Handles responsive collapse thresholds via ResizeObserver.
import { useRef, useEffect, useCallback, type ReactNode, type MutableRefObject } from 'react';
import type { Track, ChatMessage, UndoEntry } from '../engine/types';
import type { ProjectMeta } from '../engine/project-store';
import type { ViewMode } from './view-types';
import { TrackList } from './TrackList';
import { ChatSidebar } from './ChatSidebar';
import { ChatComposer } from './ChatComposer';
import { ProjectMenu } from './ProjectMenu';
import { ViewToggle } from './ViewToggle';
import { TransportStrip } from './TransportStrip';
import { UndoButton } from './UndoButton';
import { MasterStrip } from './MasterStrip';

interface Props {
  // Track sidebar
  tracks: Track[];
  activeTrackId: string;
  activityMap: Record<string, number>;
  onSelectTrack: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onToggleAgency: (trackId: string) => void;
  onRenameTrack: (trackId: string, name: string) => void;
  onCycleApproval?: (trackId: string) => void;
  onChangeVolume?: (trackId: string, value: number) => void;
  onChangePan?: (trackId: string, value: number) => void;
  // Chat sidebar
  messages: ChatMessage[];
  onSend: (message: string) => void;
  isThinking: boolean;
  isListening: boolean;
  apiConfigured: boolean;
  onApiKey: (openaiKey: string, geminiKey: string) => void;
  currentOpenaiKey?: string;
  currentGeminiKey?: string;
  chatOpen: boolean;
  onChatToggle: () => void;
  chatWidth: number;
  onChatResize: (width: number) => void;
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
  // Transport (global top bar)
  playing: boolean;
  bpm: number;
  swing: number;
  recordArmed: boolean;
  globalStep: number;
  patternLength: number;
  onTogglePlay: () => void;
  onHardStop: () => void;
  onBpmChange: (bpm: number) => void;
  onSwingChange: (swing: number) => void;
  onToggleRecord: () => void;
  // View
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  // Undo
  undoStack: UndoEntry[];
  onUndo: () => void;
  /** Shared ref: when true on blur, in-progress inline edits discard instead of committing. */
  cancelEditRef?: MutableRefObject<boolean>;
  // Master channel
  masterVolume: number;
  masterPan: number;
  analyser: AnalyserNode | null;
  onMasterVolumeChange: (v: number) => void;
  onMasterPanChange: (p: number) => void;
  // Main content
  children: ReactNode;
}

const CHAT_COLLAPSE_WIDTH = 1280;

export function AppShell({
  tracks, activeTrackId, activityMap,
  onSelectTrack, onToggleMute, onToggleSolo, onToggleAgency, onRenameTrack, onCycleApproval, onChangeVolume, onChangePan,
  messages, onSend, isThinking, isListening,
  apiConfigured, onApiKey, currentOpenaiKey, currentGeminiKey,
  chatOpen, onChatToggle, chatWidth, onChatResize,
  projectName, projects, saveError,
  onProjectRename, onProjectNew, onProjectOpen, onProjectDuplicate,
  onProjectDelete, onProjectExport, onProjectImport,
  playing, bpm, swing, recordArmed, globalStep, patternLength,
  onTogglePlay, onHardStop, onBpmChange, onSwingChange, onToggleRecord,
  view, onViewChange,
  undoStack, onUndo,
  cancelEditRef,
  masterVolume, masterPan, analyser, onMasterVolumeChange, onMasterPanChange,
  children,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const prevNarrowRef = useRef(false);

  // Sending from the collapsed footer composer reopens the sidebar
  const handleFooterSend = useCallback((message: string) => {
    onSend(message);
    if (!chatOpen) onChatToggle();
  }, [onSend, chatOpen, onChatToggle]);

  // Responsive: auto-collapse chat when crossing below threshold.
  // Only triggers the collapse on the transition from wide -> narrow,
  // not continuously — so the user can manually reopen below 1280px.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const isNarrow = entry.contentRect.width < CHAT_COLLAPSE_WIDTH;
        if (isNarrow && !prevNarrowRef.current && chatOpen) {
          onChatToggle(); // auto-collapse once on transition
        }
        prevNarrowRef.current = isNarrow;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [chatOpen, onChatToggle]);

  return (
    <div ref={shellRef} className="h-screen flex flex-col bg-zinc-950 text-zinc-100 relative">
      {/* Global top bar — mirrors three-column body layout */}
      <div className="flex items-center h-9 border-b border-zinc-800/50 shrink-0">
        {/* Chat-column zone: project menu */}
        {chatOpen && (
          <div style={{ width: chatWidth }} className="shrink-0 flex items-center px-3 border-r border-zinc-800/30">
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
        )}
        {!chatOpen && (
          <div className="shrink-0 flex items-center px-3 border-r border-zinc-800/30">
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
        )}
        {/* Content-column zone: view toggle, transport, undo */}
        <div className="flex-1 flex items-center gap-3 px-3">
          <ViewToggle view={view} onViewChange={onViewChange} cancelEditRef={cancelEditRef} />
          <div className="w-px h-4 bg-zinc-800" />
          <TransportStrip
            playing={playing}
            bpm={bpm}
            swing={swing}
            recordArmed={recordArmed}
            globalStep={globalStep}
            patternLength={patternLength}
            onTogglePlay={onTogglePlay}
            onHardStop={onHardStop}
            onBpmChange={onBpmChange}
            onSwingChange={onSwingChange}
            onToggleRecord={onToggleRecord}
          />
          <div className="flex-1" />
          <UndoButton
            onClick={onUndo}
            disabled={undoStack.length === 0}
            description={undoStack.length > 0 ? undoStack[undoStack.length - 1].description : undefined}
          />
        </div>
      </div>

      {/* Body row */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Chat sidebar */}
        <ChatSidebar
          messages={messages}
          onSend={onSend}
          isThinking={isThinking}
          isListening={isListening}
          apiConfigured={apiConfigured}
          onApiKey={onApiKey}
          currentOpenaiKey={currentOpenaiKey}
          currentGeminiKey={currentGeminiKey}
          open={chatOpen}
          width={chatWidth}
          onResize={onChatResize}
        />

        {/* Center: Main content */}
        <div className="flex-1 min-w-0 flex flex-col">
          {children}
        </div>

        {/* Right: Track sidebar */}
        <TrackList
          tracks={tracks}
          activeTrackId={activeTrackId}
          activityMap={activityMap}
          onSelectTrack={onSelectTrack}
          onToggleMute={onToggleMute}
          onToggleSolo={onToggleSolo}
          onToggleAgency={onToggleAgency}
          onRenameTrack={onRenameTrack}
          onCycleApproval={onCycleApproval}
          onChangeVolume={onChangeVolume}
          onChangePan={onChangePan}
        />
      </div>

      {/* Global footer bar */}
      <div className="flex items-center h-10 border-t border-zinc-800/50 shrink-0">
        {/* Chat-column zone: toggle always here, composer only when collapsed */}
        <div
          style={{ width: chatOpen ? chatWidth : 320 }}
          className={`shrink-0 flex items-center ${chatOpen ? 'border-r border-zinc-800/30' : ''}`}
        >
          <button
            onClick={onChatToggle}
            className="group shrink-0 p-1.5 rounded hover:bg-zinc-800/50 transition-colors"
            title={chatOpen ? 'Collapse chat (Cmd+/)' : 'Expand chat (Cmd+/)'}
          >
            <svg viewBox="0 0 16 16" className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors">
              <path d={chatOpen ? 'M10 4l-4 4 4 4' : 'M6 4l4 4-4 4'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {!chatOpen && (
            <>
              <ChatComposer onSend={handleFooterSend} disabled={isThinking || isListening} variant="footer" />
              {(isThinking || isListening) && (
                <span
                  className="shrink-0 w-2 h-2 rounded-full bg-amber-400 mr-2"
                  style={{ animation: 'pulse-soft 1.5s ease-in-out infinite' }}
                  title={isListening ? 'Listening...' : 'Thinking...'}
                />
              )}
            </>
          )}
          {chatOpen && (isThinking || isListening) && (
            <span
              className="shrink-0 w-2 h-2 rounded-full bg-amber-400 ml-1"
              style={{ animation: 'pulse-soft 1.5s ease-in-out infinite' }}
              title={isListening ? 'Listening...' : 'Thinking...'}
            />
          )}
        </div>
        {/* Master channel strip */}
        <div className="flex-1 flex items-center justify-end">
          <MasterStrip
            volume={masterVolume}
            pan={masterPan}
            analyser={analyser}
            onVolumeChange={onMasterVolumeChange}
            onPanChange={onMasterPanChange}
          />
        </div>
      </div>
    </div>
  );
}
