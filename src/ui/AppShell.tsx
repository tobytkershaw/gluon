// src/ui/AppShell.tsx
// Layout shell: view-driven workstation with chat as a first-class tab.
// Global top bar: Left = ProjectMenu + ViewToggle + TransportStrip | Right = Undo/Redo + A/B
// Footer: AudioLoadMeter + MasterStrip (workstation width only)
import { useEffect, useMemo, useRef, useCallback, type ReactNode, type MutableRefObject } from 'react';
import type { Track, ChatMessage, UndoEntry, Reaction, OpenDecision } from '../engine/types';
import type { ProjectMeta } from '../engine/project-store';
import type { ViewMode } from './view-types';
import type { SaveStatus } from './useProjectLifecycle';
import type { ListenerMode } from '../ai/api';
import { TrackList } from './TrackList';
import { ChatSidebar } from './ChatSidebar';
import { ChatMessages } from './ChatMessages';
import { ChatComposer } from './ChatComposer';
import { ApiKeyInput } from './ApiKeyInput';
import { ApiKeySetup } from './ApiKeySetup';
import { ProjectMenu } from './ProjectMenu';
import { ViewToggle } from './ViewToggle';
import { TransportStrip } from './TransportStrip';
import { ABControls } from './TransportStrip';
import { UndoButton } from './UndoButton';
import { RedoButton } from './RedoButton';
import { PeakMeter as PeakMeterFooter } from './MasterStrip';
import { AudioLoadMeter } from './AudioLoadMeter';
import { OpenDecisionsPanel } from './OpenDecisionsPanel';
import { deriveFollowUps, type FollowUpChip } from './TurnSummaryCard';
import type { ChatComposerHandle } from './ChatComposer';
import type { AudioEngine } from '../audio/audio-engine';

interface Props {
  // Track sidebar
  tracks: Track[];
  activeTrackId: string;
  expandedTrackIds?: string[];
  activityMap: Record<string, number>;
  onSelectTrack: (trackId: string) => void;
  onToggleTrackExpanded?: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string, additive?: boolean) => void;
  onToggleAgency: (trackId: string) => void;
  onRenameTrack: (trackId: string, name: string) => void;
  onCycleApproval?: (trackId: string) => void;
  onAddTrack?: (kind?: import('../engine/types').TrackKind) => void;
  onRemoveTrack?: (trackId: string) => void;
  onSetMusicalRole?: (trackId: string, role: string) => void;
  // Send routing
  onAddSend?: (trackId: string, busId: string, level?: number) => void;
  onRemoveSend?: (trackId: string, busId: string) => void;
  onSetSendLevel?: (trackId: string, busId: string, level: number) => void;
  // Chat sidebar
  messages: ChatMessage[];
  onSend: (message: string) => void;
  isThinking: boolean;
  isListening: boolean;
  streamingText?: string;
  streamingLogEntries?: import('../engine/types').ActionLogEntry[];
  streamingRejections?: { reason: string }[];
  reactions?: Reaction[];
  onReaction?: (messageIndex: number, verdict: 'approved' | 'rejected') => void;
  openDecisions?: OpenDecision[];
  onDecisionRespond?: (decision: OpenDecision, response: string) => void;
  apiConfigured: boolean;
  onApiKey: (openaiKey: string, geminiKey: string, listenerMode?: ListenerMode) => void;
  currentOpenaiKey?: string;
  currentGeminiKey?: string;
  listenerMode?: ListenerMode;
  chatOpen: boolean;
  onChatToggle: () => void;
  chatWidth: number;
  onChatResize: (width: number) => void;
  // Project
  projectName: string;
  projects: ProjectMeta[];
  saveError: boolean;
  saveStatus: SaveStatus;
  onProjectRename: (name: string) => void;
  onProjectNew: () => void;
  onProjectOpen: (id: string) => void;
  onProjectDuplicate: () => void;
  onProjectDelete: () => void;
  onProjectExport: () => void;
  onProjectImport: (file: File) => void;
  onExportWav?: (bars: number) => void;
  exportingWav?: boolean;
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
  // Metronome
  metronomeEnabled: boolean;
  metronomeVolume: number;
  onToggleMetronome: () => void;
  onMetronomeVolumeChange: (v: number) => void;
  // Transport mode & loop
  transportMode: import('../engine/sequencer-types').TransportMode;
  loop: boolean;
  onTransportModeChange: (mode: import('../engine/sequencer-types').TransportMode) => void;
  onLoopChange: (loop: boolean) => void;
  // Time signature
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  onTimeSignatureChange: (numerator: number, denominator: number) => void;
  // View
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  // Undo / Redo
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  onUndo: () => void;
  onRedo: () => void;
  onUndoMessage?: (messageIndex: number) => void;
  /** Shared ref: when true on blur, in-progress inline edits discard instead of committing. */
  cancelEditRef?: MutableRefObject<boolean>;
  // A/B comparison
  abActive: 'a' | 'b' | null;
  onAbCapture: () => void;
  onAbToggle: () => void;
  onAbClear: () => void;
  // Master channel
  masterVolume: number;
  masterPan: number;
  analyser: AnalyserNode | null;
  stereoAnalysers: [AnalyserNode, AnalyserNode] | null;
  audioContext: AudioContext | null;
  audioEngine?: AudioEngine | null;
  onMasterVolumeChange: (v: number) => void;
  onMasterPanChange: (p: number) => void;
  // Main content
  children: ReactNode;
}

const CHAT_COLLAPSE_WIDTH = 1280;

function getLastHumanMessage(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'human' && msg.text.trim()) return msg.text;
  }
  return undefined;
}

function getLatestFollowUpChips(messages: ChatMessage[]): FollowUpChip[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'ai' && msg.actions && msg.actions.length > 0) {
      return deriveFollowUps(msg.actions).slice(0, 4);
    }
  }
  return [];
}

export function AppShell({
  tracks, activeTrackId, expandedTrackIds, activityMap,
  onSelectTrack, onToggleTrackExpanded, onToggleMute, onToggleSolo, onToggleAgency, onRenameTrack, onCycleApproval,
  onAddTrack, onRemoveTrack, onSetMusicalRole,
  onAddSend, onRemoveSend, onSetSendLevel,
  messages, onSend, isThinking, isListening, streamingText, streamingLogEntries, streamingRejections,
  reactions, onReaction,
  openDecisions = [], onDecisionRespond,
  apiConfigured, onApiKey, currentOpenaiKey, currentGeminiKey, listenerMode,
  chatOpen, onChatToggle, chatWidth, onChatResize,
  projectName, projects, saveError, saveStatus,
  onProjectRename, onProjectNew, onProjectOpen, onProjectDuplicate,
  onProjectDelete, onProjectExport, onProjectImport,
  onExportWav, exportingWav,
  playing, bpm, swing, recordArmed, globalStep, patternLength,
  onTogglePlay, onHardStop, onBpmChange, onSwingChange, onToggleRecord,
  metronomeEnabled, metronomeVolume, onToggleMetronome, onMetronomeVolumeChange,
  transportMode, loop, onTransportModeChange, onLoopChange,
  timeSignatureNumerator, timeSignatureDenominator, onTimeSignatureChange,
  view, onViewChange,
  undoStack, redoStack, onUndo, onRedo, onUndoMessage,
  cancelEditRef,
  abActive, onAbCapture, onAbToggle, onAbClear,
  masterVolume, masterPan, analyser, stereoAnalysers, audioContext, audioEngine, onMasterVolumeChange, onMasterPanChange,
  children,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const instrumentRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ChatComposerHandle>(null);
  const prevNarrowRef = useRef(false);
  const autoCollapsedRef = useRef(false);
  const resizeTogglingRef = useRef(false);
  const prevChatOpenRef = useRef(chatOpen);
  const pendingComposerFocusRef = useRef<{ selectAll: boolean } | null>(null);
  const pendingInstrumentFocusRef = useRef(false);
  const lastNonChatViewRef = useRef<ViewMode>(view === 'chat' ? 'surface' : view);

  const isActive = isThinking || isListening;
  const lastHumanMessage = useMemo(() => getLastHumanMessage(messages), [messages]);
  const followUpChips = useMemo(() => getLatestFollowUpChips(messages), [messages]);

  useEffect(() => {
    if (view !== 'chat') {
      lastNonChatViewRef.current = view;
    }
  }, [view]);

  useEffect(() => {
    const pending = pendingComposerFocusRef.current;
    if (!pending) return;
    if (view !== 'chat' && !chatOpen) return;

    const raf = requestAnimationFrame(() => {
      composerRef.current?.focus({ selectAll: pending.selectAll });
    });
    pendingComposerFocusRef.current = null;
    return () => cancelAnimationFrame(raf);
  }, [chatOpen, view]);

  useEffect(() => {
    if (!pendingInstrumentFocusRef.current) return;
    if (view === 'chat') return;

    const raf = requestAnimationFrame(() => {
      instrumentRef.current?.focus({ preventScroll: true });
    });
    pendingInstrumentFocusRef.current = false;
    return () => cancelAnimationFrame(raf);
  }, [view]);

  const focusComposer = useCallback((selectAll: boolean) => {
    pendingComposerFocusRef.current = { selectAll };
    if (view !== 'chat' && !chatOpen) {
      onChatToggle();
      return;
    }
    composerRef.current?.focus({ selectAll });
    pendingComposerFocusRef.current = null;
  }, [chatOpen, onChatToggle, view]);

  const focusInstrument = useCallback(() => {
    if (view === 'chat') {
      pendingInstrumentFocusRef.current = true;
      onViewChange(lastNonChatViewRef.current);
      return;
    }
    instrumentRef.current?.focus({ preventScroll: true });
  }, [onViewChange, view]);

  const handleShellKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const isMod = e.metaKey || e.ctrlKey;
    const activeElement = document.activeElement as HTMLElement | null;
    const isChatComposer = !!activeElement?.closest?.('[data-chat-composer="true"]');

    if (isMod && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      focusComposer(true);
      return;
    }

    if (e.key === 'Escape' && (view === 'chat' || isChatComposer)) {
      e.preventDefault();
      focusInstrument();
    }
  }, [focusComposer, focusInstrument, view]);

  useEffect(() => {
    if (chatOpen !== prevChatOpenRef.current) {
      if (!resizeTogglingRef.current) {
        autoCollapsedRef.current = false;
      }
      prevChatOpenRef.current = chatOpen;
    }
  }, [chatOpen]);

  useEffect(() => {
    if (view === 'chat') return;
    const el = shellRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const isNarrow = entry.contentRect.width < CHAT_COLLAPSE_WIDTH;
        if (isNarrow && !prevNarrowRef.current && chatOpen) {
          autoCollapsedRef.current = true;
          resizeTogglingRef.current = true;
          onChatToggle();
          resizeTogglingRef.current = false;
        }
        if (!isNarrow && prevNarrowRef.current && !chatOpen && autoCollapsedRef.current) {
          autoCollapsedRef.current = false;
          resizeTogglingRef.current = true;
          onChatToggle();
          resizeTogglingRef.current = false;
        }
        prevNarrowRef.current = isNarrow;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [chatOpen, onChatToggle, view]);

  // ── Chat view ────────────────────────────────────────────────────────
  if (view === 'chat') {
    return (
      <div ref={shellRef} onKeyDownCapture={handleShellKeyDown} className="h-screen flex flex-col bg-zinc-950 text-zinc-100 relative">
        <div className="flex items-center h-9 border-b border-zinc-700/40 shrink-0">
          <div className="flex-1 flex items-center gap-3 px-3">
            <ProjectMenu
              projectName={projectName}
              projects={projects}
              saveError={saveError}
              saveStatus={saveStatus}
              onRename={onProjectRename}
              onNew={onProjectNew}
              onOpen={onProjectOpen}
              onDuplicate={onProjectDuplicate}
              onDelete={onProjectDelete}
              onExport={onProjectExport}
              onImport={onProjectImport}
              onExportWav={onExportWav}
              exportingWav={exportingWav}
            />
            <div className="w-px h-4 bg-zinc-800" />
            <ViewToggle view={view} onViewChange={onViewChange} cancelEditRef={cancelEditRef} />
            <div className="w-px h-4 bg-zinc-800" />
            <TransportStrip
              playing={playing}
              bpm={bpm}
              swing={swing}
              recordArmed={recordArmed}
              globalStep={globalStep}
              patternLength={patternLength}
              transportMode={transportMode}
              loop={loop}
              onTogglePlay={onTogglePlay}
              onHardStop={onHardStop}
              onBpmChange={onBpmChange}
              onSwingChange={onSwingChange}
              onToggleRecord={onToggleRecord}
              metronomeEnabled={metronomeEnabled}
              metronomeVolume={metronomeVolume}
              onToggleMetronome={onToggleMetronome}
              onMetronomeVolumeChange={onMetronomeVolumeChange}
              onLoopChange={onLoopChange}
              onTransportModeChange={onTransportModeChange}
              timeSignatureNumerator={timeSignatureNumerator}
              timeSignatureDenominator={timeSignatureDenominator}
              onTimeSignatureChange={onTimeSignatureChange}
            />
          </div>
          <div className="shrink-0 flex items-center gap-1 px-3 border-l border-zinc-800/30">
            <UndoButton
              onClick={onUndo}
              disabled={undoStack.length === 0}
              description={undoStack.length > 0 ? undoStack[undoStack.length - 1].description : undefined}
              undoStack={undoStack}
            />
            <RedoButton
              onClick={onRedo}
              disabled={redoStack.length === 0}
              description={redoStack.length > 0 ? redoStack[redoStack.length - 1].description : undefined}
            />
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0 items-center">
          <div className="flex flex-col flex-1 min-h-0 w-full" style={{ maxWidth: 800 }}>
            <div className="flex items-center gap-2 px-4 py-2.5">
              <span className="text-[11px] uppercase tracking-[0.2em] text-violet-400/50 font-medium select-none">Gluon</span>
              <div className="flex-1" />
              {apiConfigured && (
                <ApiKeyInput onSubmit={onApiKey} isConfigured={apiConfigured} currentOpenaiKey={currentOpenaiKey} currentGeminiKey={currentGeminiKey} listenerMode={listenerMode} />
              )}
            </div>

            {apiConfigured ? (
              <>
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                  <ChatMessages messages={messages} isThinking={isThinking} isListening={isListening} streamingText={streamingText} streamingLogEntries={streamingLogEntries} streamingRejections={streamingRejections} reactions={reactions} onReaction={onReaction} undoStack={undoStack} onUndoMessage={onUndoMessage} tracks={tracks} sessionMessages={messages} onStarterSelect={onSend} />
                </div>

                <div className="shrink-0 border-t border-zinc-800/40 pb-2">
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
          </div>
        </div>
        {onDecisionRespond && openDecisions.length > 0 && (
          <div className="pointer-events-none absolute right-4 top-14 z-20">
            <OpenDecisionsPanel decisions={openDecisions} onRespond={onDecisionRespond} />
          </div>
        )}
      </div>
    );
  }

  // ── Instrument-focused layout (original) ─────────────────────────────
  return (
    <div ref={shellRef} onKeyDownCapture={handleShellKeyDown} className="h-screen flex flex-col bg-zinc-950 text-zinc-100 relative">
      {/* Global top bar — split into workstation (left) and collaboration (right) zones */}
      <div className="flex items-center h-9 border-b border-zinc-700/40 shrink-0">
        {/* Left zone: workstation controls */}
        <div className="flex-1 flex items-center gap-3 px-3">
          <ProjectMenu
            projectName={projectName}
            projects={projects}
            saveError={saveError}
            saveStatus={saveStatus}
            onRename={onProjectRename}
            onNew={onProjectNew}
            onOpen={onProjectOpen}
            onDuplicate={onProjectDuplicate}
            onDelete={onProjectDelete}
            onExport={onProjectExport}
            onImport={onProjectImport}
            onExportWav={onExportWav}
            exportingWav={exportingWav}
          />
          <div className="w-px h-4 bg-zinc-800" />
          <ViewToggle view={view} onViewChange={onViewChange} cancelEditRef={cancelEditRef} />
          <div className="w-px h-4 bg-zinc-800" />
          <TransportStrip
            playing={playing}
            bpm={bpm}
            swing={swing}
            recordArmed={recordArmed}
            globalStep={globalStep}
            patternLength={patternLength}
            transportMode={transportMode}
            loop={loop}
            onTogglePlay={onTogglePlay}
            onHardStop={onHardStop}
            onBpmChange={onBpmChange}
            onSwingChange={onSwingChange}
            onToggleRecord={onToggleRecord}
            metronomeEnabled={metronomeEnabled}
            metronomeVolume={metronomeVolume}
            onToggleMetronome={onToggleMetronome}
            onMetronomeVolumeChange={onMetronomeVolumeChange}
            onLoopChange={onLoopChange}
            onTransportModeChange={onTransportModeChange}
            timeSignatureNumerator={timeSignatureNumerator}
            timeSignatureDenominator={timeSignatureDenominator}
            onTimeSignatureChange={onTimeSignatureChange}
          />
        </div>
        {/* Right zone: collaboration controls (undo/redo + A/B) */}
        <div className="shrink-0 flex items-center gap-1 px-3 border-l border-zinc-800/30">
          <UndoButton
            onClick={onUndo}
            disabled={undoStack.length === 0}
            description={undoStack.length > 0 ? undoStack[undoStack.length - 1].description : undefined}
            undoStack={undoStack}
          />
          <RedoButton
            onClick={onRedo}
            disabled={redoStack.length === 0}
            description={redoStack.length > 0 ? redoStack[redoStack.length - 1].description : undefined}
          />
          <div className="w-px h-4 bg-zinc-800" />
          <ABControls
            abActive={abActive}
            onAbCapture={onAbCapture}
            onAbToggle={onAbToggle}
            onAbClear={onAbClear}
          />
        </div>
      </div>

      {/* Body row */}
      <div className="flex-1 flex min-h-0">
        {/* Workstation: instrument + track list */}
        <div className="flex-1 flex min-h-0">
          {/* Main content (instrument view) */}
          <div ref={instrumentRef} tabIndex={-1} data-shortcut-scope="instrument" className="flex-1 min-w-0 flex flex-col outline-none">
            {children}
          </div>
          {/* Track sidebar */}
          <TrackList
            tracks={tracks}
            activeTrackId={activeTrackId}
            expandedTrackIds={expandedTrackIds}
            activityMap={activityMap}
            onSelectTrack={onSelectTrack}
            onToggleTrackExpanded={onToggleTrackExpanded}
            onToggleMute={onToggleMute}
            onToggleSolo={onToggleSolo}
            onToggleAgency={onToggleAgency}
            onRenameTrack={onRenameTrack}
            onCycleApproval={onCycleApproval}
            onAddTrack={onAddTrack}
            onRemoveTrack={onRemoveTrack}
            onSetMusicalRole={onSetMusicalRole}
            onAddSend={onAddSend}
            onRemoveSend={onRemoveSend}
            onSetSendLevel={onSetSendLevel}
            audioEngine={audioEngine}
            masterVolume={masterVolume}
            masterStereoAnalysers={stereoAnalysers}
            onMasterVolumeChange={onMasterVolumeChange}
          />
        </div>

        <ChatSidebar
          messages={messages}
          onSend={onSend}
          isThinking={isThinking}
          isListening={isListening}
          streamingText={streamingText}
          streamingLogEntries={streamingLogEntries}
          streamingRejections={streamingRejections}
          reactions={reactions}
          onReaction={onReaction}
          undoStack={undoStack}
          onUndoMessage={onUndoMessage}
          tracks={tracks}
          sessionMessages={messages}
          apiConfigured={apiConfigured}
          onApiKey={onApiKey}
          currentOpenaiKey={currentOpenaiKey}
          currentGeminiKey={currentGeminiKey}
          listenerMode={listenerMode}
          open={chatOpen}
          width={chatWidth}
          onResize={onChatResize}
          composerRef={composerRef}
          lastHumanMessage={lastHumanMessage}
          followUpChips={followUpChips}
        />

      </div>

      {onDecisionRespond && openDecisions.length > 0 && (
        <div className="pointer-events-none absolute right-4 top-14 z-20">
          <OpenDecisionsPanel decisions={openDecisions} onRespond={onDecisionRespond} />
        </div>
      )}

      {/* Global footer bar */}
      <div className="flex items-center h-7 border-t border-zinc-700/40 shrink-0">
        {/* Workstation footer: audio load + position + info + stereo meter */}
        <div className="flex-1 flex items-center gap-3 px-3">
          <AudioLoadMeter audioContext={audioContext} />
          <div className="w-px h-3 bg-zinc-800" />
          {/* Playback position */}
          <span className="text-[12px] font-mono text-zinc-500 tabular-nums" title="Playback position (bar : beat)">
            {(() => {
              const beatsPerBar = timeSignatureNumerator || 4;
              const currentBeat = Math.floor(globalStep) + 1;
              const bar = Math.floor((currentBeat - 1) / beatsPerBar) + 1;
              const beat = ((currentBeat - 1) % beatsPerBar) + 1;
              return `${String(bar).padStart(3, '\u2007')}:${beat}`;
            })()}
          </span>
          <div className="w-px h-3 bg-zinc-800" />
          {/* Transport mode */}
          <span className="text-[11px] text-zinc-600 uppercase tracking-wider">
            {transportMode === 'song' ? 'Song' : 'Pattern'}
          </span>
          <div className="w-px h-3 bg-zinc-800" />
          {/* Track count */}
          <span className="text-[11px] text-zinc-600">
            {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
          </span>
          <div className="flex-1" />
          <PeakMeterFooter stereoAnalysers={stereoAnalysers} />
        </div>
        <div className="shrink-0 flex items-center px-3 border-l border-zinc-800/30">
          <button
            onClick={onChatToggle}
            className="group shrink-0 p-1.5 rounded hover:bg-zinc-800/50 transition-colors mr-2"
            title={chatOpen ? 'Collapse chat sidebar' : 'Expand chat sidebar'}
          >
            <svg viewBox="0 0 16 16" className="w-3 h-3 text-zinc-600 group-hover:text-violet-400 transition-colors">
              {chatOpen ? (
                <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M10 4l-4 4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
          {isActive && (
            <span
              className="shrink-0 w-2 h-2 rounded-full bg-violet-400"
              style={{ animation: 'pulse-soft 1.5s ease-in-out infinite' }}
              title={isListening ? 'Listening \u2014 evaluating audio' : (streamingLogEntries && streamingLogEntries.length > 0 ? `Applying ${streamingLogEntries.length} ${streamingLogEntries.length === 1 ? 'change' : 'changes'}` : 'Thinking\u2026')}
            />
          )}
        </div>
      </div>
    </div>
  );
}
