// src/ui/AppShell.tsx
// Layout shell: view-driven workstation with chat as a first-class tab.
// Global top bar: Left = ProjectMenu + ViewToggle + TransportStrip | Right = Undo/Redo + A/B
// Footer: AudioLoadMeter + MasterStrip (workstation width only)
import { useEffect, useMemo, useRef, useCallback, type ReactNode, type MutableRefObject, type RefObject } from 'react';
import type { Track, ChatMessage, UndoEntry, Reaction, OpenDecision, LiveControlModule } from '../engine/types';
import type { ProjectMeta } from '../engine/project-store';
import type { ViewMode } from './view-types';
import type { SaveStatus } from './useProjectLifecycle';
import type { ListenerMode } from '../ai/api';
import { TrackList } from './TrackList';
import { Coin } from './Coin';
import type { CoinNotificationProps } from './Coin';
import { ChatMessages } from './ChatMessages';
import { ChatComposer } from './ChatComposer';
import { ApiKeyInput } from './ApiKeyInput';
import { ApiKeySetup } from './ApiKeySetup';
import { ModelStatusIndicator } from './ModelStatusIndicator';
import { ProjectMenu } from './ProjectMenu';
import { ViewToggle } from './ViewToggle';
import { TransportStrip } from './TransportStrip';
import { ABControls } from './TransportStrip';
import { UndoButton } from './UndoButton';
import { RedoButton } from './RedoButton';
import { PeakMeter as PeakMeterFooter } from './MasterStrip';
import { AudioLoadMeter } from './AudioLoadMeter';
import { OpenDecisionsPanel } from './OpenDecisionsPanel';
import { LiveControlsPanel } from './LiveControlsPanel';
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
  onRenameTrack: (trackId: string, name: string) => void;
  onToggleClaim?: (trackId: string) => void;
  onAddTrack?: (kind?: import('../engine/types').TrackKind) => void;
  onRemoveTrack?: (trackId: string) => void;
  onSetMusicalRole?: (trackId: string, role: string) => void;
  onSetImportance?: (trackId: string, importance: number) => void;
  // Send routing
  onAddSend?: (trackId: string, busId: string, level?: number) => void;
  onRemoveSend?: (trackId: string, busId: string) => void;
  onSetSendLevel?: (trackId: string, busId: string, level: number) => void;
  runtimeDegradation?: string | null;
  onContinueWithoutAI?: () => void;
  /** True when the user has dismissed the API key setup to use manual mode. */
  setupDismissed?: boolean;
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
  // Audition (inline chat previews)
  onAuditionStart?: (config: import('./AuditionControl').AuditionConfig) => void;
  onAuditionStop?: () => void;
  activeAuditionId?: string | null;
  openDecisions?: OpenDecision[];
  onDecisionRespond?: (decision: OpenDecision, response: string) => void;
  apiConfigured: boolean;
  listenerConfigured?: boolean;
  onApiKey: (openaiKey: string, geminiKey: string, listenerMode?: ListenerMode) => void;
  currentOpenaiKey?: string;
  currentGeminiKey?: string;
  listenerMode?: ListenerMode;
  onCoinFlip: () => void;
  // Coin notification card state
  coinNotification: CoinNotificationProps;
  // Project
  projectName: string;
  projects: ProjectMeta[];
  saveError: boolean;
  saveStatus: SaveStatus;
  projectActionError?: string | null;
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
  onBpmCommit?: (bpm: number) => void;
  onSwingChange: (swing: number) => void;
  onSwingCommit?: (swing: number) => void;
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
  /** Ref tracking the last non-chat view, managed by App. Used by Escape to return to instrument. */
  lastNonChatViewRef?: RefObject<ViewMode>;
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
  onMasterInteractionStart?: () => void;
  onMasterInteractionEnd?: () => void;
  // Live Controls
  liveControlModules: LiveControlModule[];
  onLiveModuleTouch: (moduleId: string) => void;
  onLiveModuleAddToSurface: (liveModule: LiveControlModule) => void;
  // Main content
  children: ReactNode;
}

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
  onSelectTrack, onToggleTrackExpanded, onToggleMute, onToggleSolo, onRenameTrack, onToggleClaim,
  onAddTrack, onRemoveTrack, onSetMusicalRole, onSetImportance,
  onAddSend, onRemoveSend, onSetSendLevel,
  runtimeDegradation,
  onContinueWithoutAI,
  setupDismissed = false,
  messages, onSend, isThinking, isListening, streamingText, streamingLogEntries, streamingRejections,
  reactions, onReaction,
  onAuditionStart, onAuditionStop, activeAuditionId,
  openDecisions = [], onDecisionRespond,
  apiConfigured, listenerConfigured = false, onApiKey, currentOpenaiKey, currentGeminiKey, listenerMode,
  onCoinFlip,
  coinNotification,
  projectName, projects, saveError, saveStatus, projectActionError = null,
  onProjectRename, onProjectNew, onProjectOpen, onProjectDuplicate,
  onProjectDelete, onProjectExport, onProjectImport,
  onExportWav, exportingWav,
  playing, bpm, swing, recordArmed, globalStep, patternLength,
  onTogglePlay, onHardStop, onBpmChange, onBpmCommit, onSwingChange, onSwingCommit, onToggleRecord,
  metronomeEnabled, metronomeVolume, onToggleMetronome, onMetronomeVolumeChange,
  transportMode, loop, onTransportModeChange, onLoopChange,
  timeSignatureNumerator, timeSignatureDenominator, onTimeSignatureChange,
  view, onViewChange, lastNonChatViewRef: lastNonChatViewProp,
  undoStack, redoStack, onUndo, onRedo, onUndoMessage,
  cancelEditRef,
  abActive, onAbCapture, onAbToggle, onAbClear,
  masterVolume, masterPan: _masterPan, analyser: _analyser, stereoAnalysers, audioContext, audioEngine, onMasterVolumeChange, onMasterPanChange: _onMasterPanChange, onMasterInteractionStart, onMasterInteractionEnd,
  liveControlModules, onLiveModuleTouch, onLiveModuleAddToSurface,
  children,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const instrumentRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ChatComposerHandle>(null);
  const pendingComposerFocusRef = useRef<{ selectAll: boolean } | null>(null);
  const pendingInstrumentFocusRef = useRef(false);
  // Use the App-provided ref when available; fall back to a local ref for standalone usage.
  const localLastNonChatViewRef = useRef<ViewMode>(view === 'chat' ? 'surface' : view);
  const lastNonChatViewRef = lastNonChatViewProp ?? localLastNonChatViewRef;

  const isActive = isThinking || isListening;
  const hasRuntimeDegradation = Boolean(runtimeDegradation);
  const lastHumanMessage = useMemo(() => getLastHumanMessage(messages), [messages]);
  const followUpChips = useMemo(() => getLatestFollowUpChips(messages), [messages]);

  // Keep local fallback ref in sync (only fires when no prop ref is provided).
  useEffect(() => {
    if (!lastNonChatViewProp && view !== 'chat') {
      localLastNonChatViewRef.current = view;
    }
  }, [lastNonChatViewProp, view]);

  useEffect(() => {
    const pending = pendingComposerFocusRef.current;
    if (!pending) return;
    if (view !== 'chat') return;

    const raf = requestAnimationFrame(() => {
      composerRef.current?.focus({ selectAll: pending.selectAll });
    });
    pendingComposerFocusRef.current = null;
    return () => cancelAnimationFrame(raf);
  }, [view]);

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
    if (view !== 'chat') {
      onViewChange('chat');
      return;
    }
    composerRef.current?.focus({ selectAll });
    pendingComposerFocusRef.current = null;
  }, [onViewChange, view]);

  const focusInstrument = useCallback(() => {
    if (view === 'chat') {
      pendingInstrumentFocusRef.current = true;
      onViewChange(lastNonChatViewRef.current);
      return;
    }
    instrumentRef.current?.focus({ preventScroll: true });
  }, [onViewChange, view]);

  // Section-jump refs for F6 cycling between major UI regions
  const transportRef = useRef<HTMLDivElement>(null);
  const trackListRef = useRef<HTMLDivElement>(null);

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
      return;
    }

    // F6 cycles focus between major UI regions: transport → tracks → instrument → chat
    if (e.key === 'F6') {
      e.preventDefault();
      const regions = [
        transportRef.current,
        trackListRef.current,
        instrumentRef.current,
      ].filter(Boolean) as HTMLElement[];

      // Find which region currently has focus
      const currentIndex = regions.findIndex(r => r.contains(activeElement));
      const nextIndex = (currentIndex + (e.shiftKey ? -1 + regions.length : 1)) % regions.length;
      const target = regions[nextIndex];
      // Focus the first focusable child or the region itself
      const focusable = target?.querySelector<HTMLElement>('button, [tabindex="0"], input, select, textarea');
      if (focusable) {
        focusable.focus();
      } else {
        target?.focus();
      }
    }
  }, [focusComposer, focusInstrument, view]);

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
              projectActionError={projectActionError}
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
          <div className="shrink-0 flex items-center gap-2 px-3">
            <ABControls
              abActive={abActive}
              onAbCapture={onAbCapture}
              onAbToggle={onAbToggle}
              onAbClear={onAbClear}
            />
            <div className="w-px h-4 bg-zinc-800/60" />
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
            <div className="w-px h-4 bg-zinc-800/60" />
            <span className="text-[11px] font-semibold text-zinc-500 tracking-tight lowercase select-none shrink-0">gluon</span>
            <div className="w-px h-4 bg-zinc-800/60" />
            <ModelStatusIndicator plannerConfigured={apiConfigured} listenerConfigured={listenerConfigured} compact />
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Chat main content (flex-1) */}
          <div className="flex-1 flex flex-col min-h-0 items-center" style={{ background: '#13111C' }}>
            <div className="flex flex-col flex-1 min-h-0 w-full" style={{ maxWidth: 800 }}>
              <div className="flex items-center gap-2 px-4 py-2.5">
                <span className="text-[11px] uppercase tracking-[0.2em] text-violet-400/50 font-medium select-none">Gluon</span>
                <div className="flex-1" />
                <ModelStatusIndicator plannerConfigured={apiConfigured} listenerConfigured={listenerConfigured} />
                {apiConfigured && (
                  <ApiKeyInput
                    onSubmit={onApiKey}
                    isConfigured={apiConfigured}
                    disabled={isActive}
                    currentOpenaiKey={currentOpenaiKey}
                    currentGeminiKey={currentGeminiKey}
                    listenerMode={listenerMode}
                  />
                )}
              </div>

              {!apiConfigured && (
                <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2 text-[11px] leading-5 text-amber-200/80" data-testid="degraded-banner">
                  Gluon is running in manual mode. Add an API key to enable AI collaboration.
                </div>
              )}

              {(apiConfigured || setupDismissed) ? (
                <>
                  <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                    <ChatMessages messages={messages} isThinking={isThinking} isListening={isListening} streamingText={streamingText} streamingLogEntries={streamingLogEntries} streamingRejections={streamingRejections} reactions={reactions} onReaction={onReaction} undoStack={undoStack} onUndoMessage={onUndoMessage} tracks={tracks} sessionMessages={messages} onStarterSelect={onSend} onAuditionStart={onAuditionStart} onAuditionStop={onAuditionStop} activeAuditionId={activeAuditionId} />
                  </div>

                  <div className="shrink-0">
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
                <ApiKeySetup onSubmit={onApiKey} onContinueWithoutAI={onContinueWithoutAI} />
              )}
            </div>
          </div>

          {/* Live Controls panel (right side) */}
          <LiveControlsPanel
            modules={liveControlModules}
            tracks={tracks}
            onTouch={onLiveModuleTouch}
            onAddToSurface={onLiveModuleAddToSurface}
          />
        </div>
        {onDecisionRespond && openDecisions.length > 0 && (
          <div className="pointer-events-none absolute right-4 top-14 z-20">
            <OpenDecisionsPanel decisions={openDecisions} onRespond={onDecisionRespond} />
          </div>
        )}

        {/* Global footer bar (same as instrument tabs) */}
        <div className="flex items-center h-7 border-t border-zinc-700/40 shrink-0">
          <div className="flex-1 flex items-center gap-3 px-3">
            <AudioLoadMeter audioContext={audioContext} />
            <div className="w-px h-3 bg-zinc-800" />
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
            <span className="text-[11px] text-zinc-600 uppercase tracking-wider">
              {transportMode === 'song' ? 'Song' : 'Pattern'}
            </span>
            <div className="w-px h-3 bg-zinc-800" />
            <span className="text-[11px] text-zinc-600">
              {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
            </span>
            <div className="w-px h-3 bg-zinc-800" />
            <span className="text-[11px] text-zinc-600">
              {Math.round(bpm)} BPM
            </span>
            <div className="flex-1" />
            <PeakMeterFooter stereoAnalysers={stereoAnalysers} />
            <div className="w-px h-3 bg-zinc-800" />
            {apiConfigured && (
              <span
                className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                  isListening
                    ? 'bg-teal-400 animate-breathing'
                    : isThinking
                      ? 'bg-violet-500 animate-breathing'
                      : 'bg-violet-500 opacity-40'
                }`}
                title={
                  isListening
                    ? 'Listening \u2014 evaluating audio'
                    : isThinking
                      ? 'Thinking\u2026'
                      : 'AI connected'
                }
              />
            )}
          </div>
        </div>
        <Coin currentView={view} lastNonChatView={lastNonChatViewRef.current} onFlip={onCoinFlip} {...coinNotification} />
      </div>
    );
  }

  // ── Instrument-focused layout (original) ─────────────────────────────
  return (
    <div ref={shellRef} onKeyDownCapture={handleShellKeyDown} className="h-screen flex flex-col bg-zinc-950 text-zinc-100 relative">
      {/* Global top bar — split into workstation (left) and collaboration (right) zones */}
      <div ref={transportRef} className="flex items-center h-9 border-b border-zinc-700/40 shrink-0" role="banner" aria-label="Top bar">
        {/* Left zone: workstation controls */}
        <div className="flex-1 flex items-center gap-3 px-3">
          <ProjectMenu
            projectName={projectName}
            projects={projects}
            saveError={saveError}
            saveStatus={saveStatus}
            projectActionError={projectActionError}
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
            onBpmCommit={onBpmCommit}
            onSwingChange={onSwingChange}
            onSwingCommit={onSwingCommit}
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
        {/* Right zone: A/B + undo/redo + wordmark + status dot */}
        <div className="shrink-0 flex items-center gap-2 px-3">
          <ABControls
            abActive={abActive}
            onAbCapture={onAbCapture}
            onAbToggle={onAbToggle}
            onAbClear={onAbClear}
          />
          <div className="w-px h-4 bg-zinc-800/60" />
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
          <div className="w-px h-4 bg-zinc-800/60" />
          <span className="text-[11px] font-semibold text-zinc-500 tracking-tight lowercase select-none shrink-0">gluon</span>
          <div className="w-px h-4 bg-zinc-800/60" />
          <ModelStatusIndicator plannerConfigured={apiConfigured} listenerConfigured={listenerConfigured} compact />
        </div>
      </div>

      {hasRuntimeDegradation && (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] leading-5 text-amber-100">
          <span className="uppercase tracking-[0.18em] text-amber-300/70">Audio degraded</span>
          <span className="ml-2">{runtimeDegradation}</span>
        </div>
      )}

      {/* Body row */}
      <div className="flex-1 flex min-h-0">
        {/* Workstation: instrument + track list */}
        <div className="flex-1 flex min-h-0">
          {/* Track sidebar (LEFT per mockup 09) */}
          <div ref={trackListRef} role="region" aria-label="Track list">
          <TrackList
            tracks={tracks}
            activeTrackId={activeTrackId}
            expandedTrackIds={expandedTrackIds}
            activityMap={activityMap}
            onSelectTrack={onSelectTrack}
            onToggleTrackExpanded={onToggleTrackExpanded}
            onToggleMute={onToggleMute}
            onToggleSolo={onToggleSolo}

            onRenameTrack={onRenameTrack}
            onToggleClaim={onToggleClaim}
            onAddTrack={onAddTrack}
            onRemoveTrack={onRemoveTrack}
            onSetMusicalRole={onSetMusicalRole}
            onSetImportance={onSetImportance}
            onAddSend={onAddSend}
            onRemoveSend={onRemoveSend}
            onSetSendLevel={onSetSendLevel}
            audioEngine={audioEngine}
            masterVolume={masterVolume}
            masterStereoAnalysers={stereoAnalysers}
            onMasterVolumeChange={onMasterVolumeChange}
            onMasterInteractionStart={onMasterInteractionStart}
            onMasterInteractionEnd={onMasterInteractionEnd}
            variant={view === 'surface' ? 'stage' : 'default'}
          />
          </div>
          {/* Main content (instrument view) */}
          <div ref={instrumentRef} tabIndex={-1} role="main" aria-label="Instrument view" data-shortcut-scope="instrument" className="flex-1 min-w-0 flex flex-col outline-none">
            {children}
          </div>
        </div>

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
          <div className="w-px h-3 bg-zinc-800" />
          {/* BPM */}
          <span className="text-[11px] text-zinc-600">
            {Math.round(bpm)} BPM
          </span>
          <div className="flex-1" />
          <PeakMeterFooter stereoAnalysers={stereoAnalysers} />
          <div className="w-px h-3 bg-zinc-800" />
          {/* AI activity dot */}
          {apiConfigured && (
            <span
              className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                isListening
                  ? 'bg-teal-400 animate-breathing'
                  : isThinking
                    ? 'bg-violet-500 animate-breathing'
                    : 'bg-violet-500 opacity-40'
              }`}
              title={
                isListening
                  ? 'Listening \u2014 evaluating audio'
                  : isThinking
                    ? 'Thinking\u2026'
                    : 'AI connected'
              }
            />
          )}
        </div>
      </div>
      <Coin currentView={view} lastNonChatView={lastNonChatViewRef.current} onFlip={onCoinFlip} {...coinNotification} />
    </div>
  );
}
