// src/ui/AppShell.tsx
// Layout shell: Workstation (instrument + tracks) left, AI Collaborator right.
// Global top bar: Left = ProjectMenu + ViewToggle + TransportStrip | Right = Undo/Redo + A/B
// Footer: AudioLoadMeter + MasterStrip (workstation width only)
// When chat collapsed: floating composer pill at bottom-right.
import { useRef, useEffect, type ReactNode, type MutableRefObject } from 'react';
import type { Track, ChatMessage, UndoEntry, Reaction } from '../engine/types';
import type { ProjectMeta } from '../engine/project-store';
import type { ViewMode } from './view-types';
import type { SaveStatus } from './useProjectLifecycle';
import { TrackList } from './TrackList';
import { ChatSidebar } from './ChatSidebar';
import { ProjectMenu } from './ProjectMenu';
import { ViewToggle } from './ViewToggle';
import { TransportStrip } from './TransportStrip';
import { ABControls } from './TransportStrip';
import { UndoButton } from './UndoButton';
import { RedoButton } from './RedoButton';
import { PeakMeter as PeakMeterFooter } from './MasterStrip';
import { AudioLoadMeter } from './AudioLoadMeter';
import type { AudioEngine } from '../audio/audio-engine';

interface Props {
  // Track sidebar
  tracks: Track[];
  activeTrackId: string;
  activityMap: Record<string, number>;
  onSelectTrack: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string, additive?: boolean) => void;
  onToggleAgency: (trackId: string) => void;
  onRenameTrack: (trackId: string, name: string) => void;
  onCycleApproval?: (trackId: string) => void;
  onAddTrack?: (kind?: import('../engine/types').TrackKind) => void;
  onRemoveTrack?: (trackId: string) => void;
  onSetImportance?: (trackId: string, importance: number) => void;
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
  reactions?: Reaction[];
  onReaction?: (messageIndex: number, verdict: 'approved' | 'rejected') => void;
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
  // Transport mode
  transportMode: import('../engine/sequencer-types').TransportMode;
  onTransportModeChange: (mode: import('../engine/sequencer-types').TransportMode) => void;
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

export function AppShell({
  tracks, activeTrackId, activityMap,
  onSelectTrack, onToggleMute, onToggleSolo, onToggleAgency, onRenameTrack, onCycleApproval,
  onAddTrack, onRemoveTrack, onSetImportance, onSetMusicalRole,
  onAddSend, onRemoveSend, onSetSendLevel,
  messages, onSend, isThinking, isListening, streamingText,
  reactions, onReaction,
  apiConfigured, onApiKey, currentOpenaiKey, currentGeminiKey,
  chatOpen, onChatToggle, chatWidth, onChatResize,
  projectName, projects, saveError, saveStatus,
  onProjectRename, onProjectNew, onProjectOpen, onProjectDuplicate,
  onProjectDelete, onProjectExport, onProjectImport,
  onExportWav, exportingWav,
  playing, bpm, swing, recordArmed, globalStep, patternLength,
  onTogglePlay, onHardStop, onBpmChange, onSwingChange, onToggleRecord,
  metronomeEnabled, metronomeVolume, onToggleMetronome, onMetronomeVolumeChange,
  transportMode, onTransportModeChange,
  timeSignatureNumerator, timeSignatureDenominator, onTimeSignatureChange,
  view, onViewChange,
  undoStack, redoStack, onUndo, onRedo, onUndoMessage,
  cancelEditRef,
  abActive, onAbCapture, onAbToggle, onAbClear,
  masterVolume, masterPan, analyser, stereoAnalysers, audioContext, audioEngine, onMasterVolumeChange, onMasterPanChange,
  children,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const prevNarrowRef = useRef(false);

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
      {/* Global top bar — split into workstation (left) and collaboration (right) zones */}
      <div className="flex items-center h-9 border-b border-zinc-800/50 shrink-0">
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
            onTogglePlay={onTogglePlay}
            onHardStop={onHardStop}
            onBpmChange={onBpmChange}
            onSwingChange={onSwingChange}
            onToggleRecord={onToggleRecord}
            metronomeEnabled={metronomeEnabled}
            metronomeVolume={metronomeVolume}
            onToggleMetronome={onToggleMetronome}
            onMetronomeVolumeChange={onMetronomeVolumeChange}
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
          <div className="flex-1 min-w-0 flex flex-col">
            {children}
          </div>
          {/* Track sidebar */}
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
            onAddTrack={onAddTrack}
            onRemoveTrack={onRemoveTrack}
            onSetImportance={onSetImportance}
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

        {/* AI Collaborator */}
        <ChatSidebar
          messages={messages}
          onSend={onSend}
          isThinking={isThinking}
          isListening={isListening}
          streamingText={streamingText}
          reactions={reactions}
          onReaction={onReaction}
          undoStack={undoStack}
          onUndoMessage={onUndoMessage}
          apiConfigured={apiConfigured}
          onApiKey={onApiKey}
          currentOpenaiKey={currentOpenaiKey}
          currentGeminiKey={currentGeminiKey}
          open={chatOpen}
          width={chatWidth}
          onResize={onChatResize}
        />
      </div>

      {/* Global footer bar */}
      <div className="flex items-center h-7 border-t border-zinc-800/50 shrink-0">
        {/* Workstation footer: audio load + position + info + stereo meter */}
        <div className="flex-1 flex items-center gap-3 px-3">
          <AudioLoadMeter audioContext={audioContext} />
          <div className="w-px h-3 bg-zinc-800" />
          {/* Playback position */}
          <span className="text-[10px] font-mono text-zinc-500 tabular-nums" title="Playback position (bar : beat)">
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
          <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
            {transportMode === 'song' ? 'Song' : 'Pattern'}
          </span>
          <div className="w-px h-3 bg-zinc-800" />
          {/* Track count */}
          <span className="text-[10px] text-zinc-600">
            {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
          </span>
          <div className="flex-1" />
          <PeakMeterFooter stereoAnalysers={stereoAnalysers} />
        </div>
        {/* Chat toggle button */}
        <div className="shrink-0 flex items-center px-1 border-l border-zinc-800/30">
          <button
            onClick={onChatToggle}
            className="group shrink-0 p-1.5 rounded hover:bg-zinc-800/50 transition-colors"
            title={chatOpen ? 'Collapse chat (Cmd+/)' : 'Expand chat (Cmd+/)'}
          >
            <svg viewBox="0 0 16 16" className="w-3 h-3 text-zinc-600 group-hover:text-violet-400 transition-colors">
              {chatOpen ? (
                <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M10 4l-4 4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
          {chatOpen && (isThinking || isListening) && (
            <span
              className="shrink-0 w-2 h-2 rounded-full bg-violet-400 mr-1"
              style={{ animation: 'pulse-soft 1.5s ease-in-out infinite' }}
              title={isListening ? 'Listening...' : 'Thinking...'}
            />
          )}
        </div>
      </div>

      {/* Floating composer — hidden when chat collapsed to avoid overlapping the footer */}
    </div>
  );
}
