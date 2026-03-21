/* eslint-disable react-refresh/only-export-components -- pure helper fn co-located with component */
// src/ui/App.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioEngine } from '../audio/audio-engine';
import { AudioExporter } from '../audio/audio-exporter';
import { LiveAudioMetricsStore } from '../audio/live-audio-metrics';
import { renderOffline, renderOfflinePcm } from '../audio/render-offline';
import { clearSnapshots } from '../audio/snapshot-store';
import type { Session, AIAction, ParamSnapshot, PatternEditSnapshot, ActionGroupSnapshot, SynthParamValues, UndoEntry, ProcessorStateSnapshot, ProcessorSnapshot, ModulatorStateSnapshot, ModulatorSnapshot, ModulationRoutingSnapshot, ModulationRouting, ModulationTarget, SemanticControlDef, Snapshot, ToolCallEntry, ListenEvent, TrackPropertySnapshot, MasterSnapshot, TransportSnapshot, UserSelection, OpenDecision, SurfaceModule, SurfaceSnapshot, TrackSurface, LiveControlModule } from '../engine/types';
import type { MusicalEvent as CanonicalMusicalEvent, ControlState, NoteEvent } from '../engine/canonical-types';
import { getActiveTrack, getActivePattern, getTrack, updateTrack, getTrackKind, getOrderedTracks, MASTER_BUS_ID } from '../engine/types';
import { normalizePatternEvents } from '../engine/region-helpers';
import { shouldSkipTrackModelSync } from './track-sync';
import { reprojectTrackStepGrid } from '../engine/region-projection';
import { createPlaitsAdapter } from '../audio/plaits-adapter';
import {
  createSession, toggleClaim, updateTrackParams, setModel,
  setActiveTrack, toggleTrackExpanded, toggleMute, toggleSolo, setTransportBpm, setTransportBpmNoUndo, setTransportSwing, setTransportSwingNoUndo, playTransport, pauseTransport, stopTransport,
  renameTrack, setMaster, setMasterNoUndo, setTrackVolume, setTrackVolumeNoUndo, setTrackPan, setTrackPanNoUndo,
  addTrack, removeTrack,
  addSend, removeSend, setSendLevel,
  toggleMetronome, setMetronomeVolume,
  addReaction, setTrackImportance,
  addPattern, removePattern, duplicatePattern, renamePattern, setActivePatternOnTrack,
  setTimeSignature, setTransportMode,
  addPatternRef, removePatternRef, reorderPatternRef, setSequenceAutomation, clearSequenceAutomation,
  captureABSnapshot, restoreABSnapshot,
  setTransportLoop,
  resolveDecision,
} from '../engine/session';
import type { ABSnapshot } from '../engine/session';
import { loadSession } from '../engine/persistence';
import { useProjectLifecycle } from './useProjectLifecycle';
import { applyParamDirect, applyUndo, applyRedo } from '../engine/primitives';
import { executeOperations, executeStepActions, finalizeAITurn, prevalidateAction } from '../engine/operation-executor';
import type { OnStepCallback, StepExecutor } from '../ai/types';
import type { ExecutionReportLogEntry } from '../engine/canonical-types';
import { toggleStepGate, toggleStepAccent, setStepParamLock, clearPattern, setPatternLength, insertAutomationEvent, quantizeRegion } from '../engine/pattern-primitives';
import { runtimeParamToControlId, controlIdToRuntimeParam, getProcessorDefaultParams, getModulatorDefaultParams } from '../audio/instrument-registry';
import { addEvent, updateEvent, removeEvent, removeEventsByIndices, addEvents, transposeEventsByIndices } from '../engine/event-primitives';
import { rotateRegion, transposeRegion, reverseRegion, duplicateRegionEvents } from '../engine/transform-operations';
import type { EventSelector } from '../engine/event-primitives';
import type { MusicalEvent } from '../engine/canonical-types';
import { addView, removeView } from '../engine/view-primitives';
import type { SequencerViewKind } from '../engine/types';
import type { ScheduledParameterEvent, SequenceAutomationPoint } from '../engine/sequencer-types';
import { GluonAI } from '../ai/api';
import type { ListenerProvider } from '../ai/types';
import { GeminiPlannerProvider } from '../ai/providers/gemini-planner';
import { GeminiListenerProvider } from '../ai/providers/gemini-listener';
import { Arbitrator } from '../engine/arbitration';
import { AutomationEngine } from '../ai/automation';
import { SurfaceCanvas } from './surface/SurfaceCanvas';
import { TrackerView } from './TrackerView';
import { RackView } from './RackView';
import { PatchView } from './PatchView';

import { AppShell } from './AppShell';
import { EmptyState } from './EmptyState';
import { useShortcuts } from './useShortcuts';
import { ShortcutsPanel } from './ShortcutsPanel';
import { useKeyboardPiano } from './useKeyboardPiano';
import { useNotePreview } from './useNotePreview';
import type { ViewMode } from './view-types';
import { clearQaAudioTrace, recordQaAudioTrace } from '../qa/audio-trace';
import { computeSemanticRawUpdates } from './surface/semantic-utils';
import { maybeApplySurfaceTemplate } from '../engine/surface-templates';
import { useTransportController } from './useTransportController';
import { isTrackAudibleInMixer } from '../engine/sequencer-helpers';
import { AUDIO_DEGRADED_EVENT, type AudioDegradedDetail } from '../audio/runtime-events';
import { validateSurface } from '../engine/surface-templates';
import { useAiTurnBoundary } from './useAiTurnBoundary';

// TODO(#215): Module-level singleton — works fine in production but may
// interfere with test isolation if App is mounted multiple times in a test suite.
// Low risk since adapter is stateless; revisit if tests require separate instances.
const plaitsAdapter = createPlaitsAdapter();

function createAI(geminiKey: string): GluonAI {
  const geminiListener = new GeminiListenerProvider(geminiKey);
  const primary: ListenerProvider = geminiListener;
  const listeners: ListenerProvider[] = [geminiListener];

  return new GluonAI(
    new GeminiPlannerProvider(geminiKey),
    primary,
    listeners,
  );
}

function shallowEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function appendAudioRuntimeDegradationMessage(prev: string | null, message: string): string {
  const PREFIX = 'Audio runtime degraded: ';
  if (!prev) return `${PREFIX}${message}`;
  const body = prev.startsWith(PREFIX) ? prev.slice(PREFIX.length) : prev;
  const existingMessages = body.split('; ');
  if (existingMessages.includes(message)) return prev;
  return `${PREFIX}${[...existingMessages, message].join('; ')}`;
}

export function getExplicitViewPreference(storage: Pick<Storage, 'getItem'> = localStorage): ViewMode | null {
  const saved = storage.getItem('gluon-view');
  if (saved === 'chat' || saved === 'surface' || saved === 'tracker' || saved === 'rack' || saved === 'patch') {
    return saved;
  }
  const savedChatFocused = storage.getItem('gluon-chat-focused');
  if (savedChatFocused === 'true') return 'chat';
  if (savedChatFocused === 'false') return 'surface';
  return null;
}

export function inferDefaultView(session: Session): ViewMode {
  const audioTracks = session.tracks.filter(t => getTrackKind(t) === 'audio');
  const hasContent = audioTracks.length > 1 || audioTracks.some(t => t.patterns.some(p => p.events.length > 0));
  return hasContent ? 'surface' : 'chat';
}

export function reconcileAutoManagedView(
  currentView: ViewMode,
  autoManagedView: ViewMode | null,
  session: Session,
): { nextView: ViewMode; nextAutoManagedView: ViewMode | null } {
  if (autoManagedView === null || currentView !== autoManagedView) {
    return { nextView: currentView, nextAutoManagedView: null };
  }
  const nextAutoManagedView = inferDefaultView(session);
  return { nextView: nextAutoManagedView, nextAutoManagedView };
}

export default function App() {
  const audioRef = useRef(new AudioEngine());
  const audioMetricsRef = useRef(new LiveAudioMetricsStore());
  const [geminiKey, setGeminiKey] = useState(import.meta.env.VITE_GOOGLE_API_KEY ?? '');
  const aiRef = useRef(createAI(geminiKey));
  // Signal to discard in-progress tracker inline edits when switching views.
  // mousedown on ViewToggle sets this true before blur fires on EditableCell.
  const cancelEditRef = useRef(false);

  const [session, setSessionRaw] = useState<Session>(() => loadSession() ?? createSession());
  const explicitInitialViewRef = useRef<ViewMode | null>(getExplicitViewPreference());
  const autoManagedViewRef = useRef<ViewMode | null>(
    explicitInitialViewRef.current === null ? inferDefaultView(session) : null,
  );
  const lastAutoManagedProjectIdRef = useRef<string | null>(null);

  // Wrap setSession to auto-clear redoStack when a new undo entry is pushed
  // (standard undo/redo behavior: new actions invalidate the redo stack).
  // applyUndo/applyRedo manage both stacks themselves, so this only fires
  // for genuine new actions.
  const setSession = useCallback((updater: Session | ((prev: Session) => Session)) => {
    setSessionRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next === prev) return prev;
      // If undoStack grew and redoStack wasn't already cleared by applyUndo/applyRedo
      if (next.undoStack.length > prev.undoStack.length && (next.redoStack ?? []).length > 0
          && next.redoStack === prev.redoStack) {
        return { ...next, redoStack: [] };
      }
      return next;
    });
  }, []);

  const project = useProjectLifecycle(session, setSession);

  const [audioStarted, setAudioStarted] = useState(false);
  const [plannerConfigured, setPlannerConfigured] = useState(() => aiRef.current.isPlannerConfigured());
  const [listenerConfigured, setListenerConfigured] = useState(() => aiRef.current.isListenerConfigured());
  const [manualModeDismissed, setManualModeDismissed] = useState(false);
  // Legacy alias — planner gates chat availability
  const apiConfigured = plannerConfigured;
  const [globalStep, setGlobalStep] = useState(0);
  const globalStepRef = useRef(0);
  /** Cursor step position in the tracker (region-local). */
  const trackerCursorStepRef = useRef<number | null>(null);
  /** Current tracker selection (step range + event indices), null when no selection active. */
  const trackerSelectionRef = useRef<{ stepRange: [number, number]; eventIndices: number[] } | null>(null);
  const [recordArmed, setRecordArmed] = useState(false);
  const recordArmedRef = useRef(false);
  recordArmedRef.current = recordArmed;
  const _wavExporterRef = useRef(new AudioExporter());
  const [exportingWav, setExportingWav] = useState(false);
  /** Tracks whether we've pushed an undo snapshot for the current recording session. */
  const recordingSnapshotPushed = useRef(false);
  const [selectedStep, _setSelectedStep] = useState<number | null>(null);
  const [_stepPage, setStepPage] = useState(0);
  const [view, setViewRaw] = useState<ViewMode>(() => explicitInitialViewRef.current ?? inferDefaultView(session));
  const setView = useCallback((updater: ViewMode | ((prev: ViewMode) => ViewMode)) => {
    setViewRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next !== prev) autoManagedViewRef.current = null;
      return next;
    });
  }, []);
  const [_selectedProcessorId, setSelectedProcessorId] = useState<string | null>(null);
  const [_selectedModulatorId, setSelectedModulatorId] = useState<string | null>(null);
  const [activityMap, setActivityMap] = useState<Record<string, number>>({});
  const [_deepViewModuleId, setDeepViewModuleId] = useState<string | null>(null);
  const [audioDegradedMessage, setAudioDegradedMessage] = useState<string | null>(null);
  // A/B comparison state
  const [abSnapshot, setAbSnapshot] = useState<ABSnapshot | null>(null);
  const [abActive, setAbActive] = useState<'a' | 'b' | null>(null);

  // Audition state — snapshot/restore transport for inline chat audition controls
  const [activeAuditionId, setActiveAuditionId] = useState<string | null>(null);
  const auditionSnapshotRef = useRef<{
    soloStates: Record<string, boolean>;
    loopEnabled: boolean;
    transportMode: 'pattern' | 'song';
    wasPlaying: boolean;
  } | null>(null);

  const arbRef = useRef(new Arbitrator());
  const [holdGeneration, setHoldGeneration] = useState(0);
  const autoRef = useRef(new AutomationEngine());
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // Derive live control modules from session state (migrated from useState)
  const liveControlModules = session.liveControls;

  // When arbitration hold expires, bump generation to re-trigger sync effects
  useEffect(() => {
    arbRef.current.setOnHoldExpired(() => setHoldGeneration(g => g + 1));
  }, []);

  useEffect(() => {
    if (explicitInitialViewRef.current !== null || project.projectId === null) return;
    if (lastAutoManagedProjectIdRef.current === project.projectId) return;
    lastAutoManagedProjectIdRef.current = project.projectId;

    setViewRaw((currentView) => {
      const { nextView, nextAutoManagedView } = reconcileAutoManagedView(
        currentView,
        autoManagedViewRef.current,
        session,
      );
      autoManagedViewRef.current = nextAutoManagedView;
      return nextView;
    });
  }, [project.projectId, session]);

  // Dirty-check refs for sync effects (#142)
  const prevTrackStateRef = useRef<Map<string, { model: number; params?: Record<string, number> }>>(new Map());
  const prevProcessorStateRef = useRef<Map<string, { model: number; params: Record<string, number>; enabled?: boolean }>>(new Map());
  const prevModulatorStateRef = useRef<Map<string, { model: number; params: Record<string, number> }>>(new Map());
  const prevSidechainStateRef = useRef<Map<string, string | undefined>>(new Map());

  // Capture param + region state at interaction start for undo
  const interactionUndoRef = useRef<{
    trackId: string;
    prevParams: Partial<SynthParamValues>;
    prevProvenance?: Partial<ControlState>;
    prevEvents?: CanonicalMusicalEvent[];
  } | null>(null);

  // Track the last non-chat view for Cmd+K "coin flip" toggle.
  // Promoted from AppShell so it's accessible to sibling components (e.g. The Coin).
  const lastNonChatViewRef = useRef<ViewMode>(view === 'chat' ? 'surface' : view);
  useEffect(() => {
    if (view !== 'chat') lastNonChatViewRef.current = view;
  }, [view]);

  const handleCoinFlip = useCallback(() => {
    setView(v => v === 'chat' ? lastNonChatViewRef.current : 'chat');
  }, []);

  // Persist view and chat state to localStorage
  useEffect(() => { localStorage.setItem('gluon-view', view); }, [view]);

  useEffect(() => {
    clearQaAudioTrace();
  }, []);

  const reportAudioDegradation = useCallback((message: string) => {
    setAudioDegradedMessage(prev => appendAudioRuntimeDegradationMessage(prev, message));
  }, []);

  useEffect(() => {
    const handleAudioDegraded = (event: Event) => {
      const detail = (event as CustomEvent<AudioDegradedDetail>).detail;
      if (detail?.message) reportAudioDegradation(detail.message);
    };

    window.addEventListener(AUDIO_DEGRADED_EVENT, handleAudioDegraded as EventListener);
    return () => window.removeEventListener(AUDIO_DEGRADED_EVENT, handleAudioDegraded as EventListener);
  }, [reportAudioDegradation]);

  const ensureAudio = useCallback(async () => {
    if (audioStarted) return true;
    try {
      const s = sessionRef.current;
      const audioTrackIds = s.tracks.filter(t => getTrackKind(t) === 'audio').map(t => t.id);
      const busTrackIds = s.tracks.filter(t => getTrackKind(t) === 'bus').map(t => t.id);
      const drumRackTrackIds = s.tracks.filter(t => t.engine === 'drum-rack').map(t => t.id);
      const masterBusId = s.tracks.find(t => t.id === MASTER_BUS_ID) ? MASTER_BUS_ID : undefined;
      await audioRef.current.start(audioTrackIds, busTrackIds, masterBusId, drumRackTrackIds);
      for (const track of s.tracks) {
        if (track.engine === 'drum-rack' && track.drumRack) {
          // Sync drum rack pads on startup
          for (const pad of track.drumRack.pads) {
            void audioRef.current.addDrumPad(
              track.id, pad.id, pad.source.model, pad.source.params,
              pad.level, pad.pan, pad.chokeGroup,
            );
          }
        } else if (track.model !== -1 && getTrackKind(track) === 'audio') {
          audioRef.current.setTrackModel(track.id, track.model);
          audioRef.current.setTrackParams(track.id, track.params);
          const modeInt = track.portamentoMode === 'always' ? 1 : track.portamentoMode === 'legato' ? 2 : 0;
          audioRef.current.setTrackPortamento(track.id, track.portamentoTime ?? 0, modeInt);
        }
      }
      // Sync initial sends
      for (const track of s.tracks) {
        if (track.sends && track.sends.length > 0) {
          audioRef.current.syncSends(track.id, track.sends);
        }
      }
      setAudioStarted(true);
      setAudioDegradedMessage(null);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      reportAudioDegradation(`audio startup failed: ${reason}`);
      console.error('Audio startup failed:', error);
      return false;
    }
  }, [audioStarted, reportAudioDegradation]);

  const handleTransportPositionChange = useCallback((step: number) => {
    globalStepRef.current = step;
    setGlobalStep(step);
  }, []);

  const getHeldTransportParams = useCallback((trackId: string) => {
    return arbRef.current.getHeldParams(trackId);
  }, []);

  const handleTransportParameterEvent = useCallback(({ trackId, controlId, value }: ScheduledParameterEvent) => {
    const runtimeParam = controlIdToRuntimeParam[controlId] ?? controlId;
    if (arbRef.current.isHoldingSource(trackId)) return;
    setSession(s => {
      const track = getTrack(s, trackId);
      if (typeof value !== 'number') return s;
      if (Math.abs((track.params[runtimeParam] ?? 0) - value) < 0.001) return s;
      return updateTrackParams(s, trackId, { [runtimeParam]: value }, false, plaitsAdapter);
    });
  }, []);

  const getCurrentSession = useCallback(() => sessionRef.current, []);

  const handleSequenceEnd = useCallback(() => {
    setSession((s) => stopTransport(s));
  }, []);

  const transportControllerRef = useTransportController({
    audioStarted,
    audio: audioRef.current,
    session,
    getSession: getCurrentSession,
    onPositionChange: handleTransportPositionChange,
    getHeldParams: getHeldTransportParams,
    onParameterEvent: handleTransportParameterEvent,
    onSequenceEnd: handleSequenceEnd,
  });

  useEffect(() => {
    recordQaAudioTrace({
      type: 'transport.settings',
      bpm: session.transport.bpm,
      swing: session.transport.swing,
    });
  }, [session.transport.bpm, session.transport.swing]);

  // Ensure audio engine slots match session tracks (handles add, remove, undo)
  useEffect(() => {
    if (!audioStarted) return;
    const audio = audioRef.current;
    // Slot type (audio vs drum-rack) is baked at creation time by addTrack().
    // Pad sync (line 442) only fires when isTrackDrumRack() is true.
    // When promotion or undo changes the engine type, recreate the slot.
    for (const track of session.tracks) {
      if (!audio.hasTrack(track.id)) continue;
      const wantsDrumRack = track.engine === 'drum-rack';
      const isDrumRack = audio.isTrackDrumRack(track.id);
      if (wantsDrumRack !== isDrumRack) {
        audio.removeTrack(track.id);
        // Will be re-added with correct type in the add loop below
      }
    }
    // Add engine slots for tracks not yet in the audio engine
    for (const track of session.tracks) {
      if (!audio.hasTrack(track.id)) {
        const isBus = getTrackKind(track) === 'bus';
        const isDrumRack = track.engine === 'drum-rack';
        void audio.addTrack(track.id, isBus, isDrumRack).then(() => {
          // After the async add, sync model/params from current session
          const s = sessionRef.current;
          const t = s.tracks.find(v => v.id === track.id);
          if (t && t.model !== -1 && !isBus && !isDrumRack) {
            audio.setTrackModel(t.id, t.model);
            audio.setTrackParams(t.id, t.params);
            const modeInt = t.portamentoMode === 'always' ? 1 : t.portamentoMode === 'legato' ? 2 : 0;
            audio.setTrackPortamento(t.id, t.portamentoTime ?? 0, modeInt);
          }
          // Sync drum rack pads after track creation
          if (t && isDrumRack && t.drumRack) {
            for (const pad of t.drumRack.pads) {
              void audio.addDrumPad(
                t.id, pad.id, pad.source.model, pad.source.params,
                pad.level, pad.pan, pad.chokeGroup,
              );
            }
          }
          // If this is the master bus, set it as such
          if (track.id === MASTER_BUS_ID) {
            audio.setMasterBus(MASTER_BUS_ID);
          }
        });
      }
    }
    // Remove engine slots for tracks no longer in session (undo of track-add)
    for (const engineTrackId of audio.getTrackIds()) {
      if (!session.tracks.some(t => t.id === engineTrackId)) {
        audio.removeTrack(engineTrackId);
      }
    }
  }, [session.tracks, audioStarted]);

  // Sync audio params for all tracks when session changes
  useEffect(() => {
    if (!audioStarted) return;
    for (const track of session.tracks) {
      const key = track.id;
      const prev = prevTrackStateRef.current.get(key);

      // Skip model/param sync for empty tracks (model -1 = no source module),
      // but NOT for drum-rack tracks whose pads still need reconciliation (#1129).
      if (shouldSkipTrackModelSync(track)) {
        prevTrackStateRef.current.set(key, {
          model: track.model,
          params: { ...track.params },
        });
        continue;
      }

      // Model always syncs — hold only suppresses params (#141)
      if (!prev || prev.model !== track.model) {
        audioRef.current.setTrackModel(track.id, track.model);
      }
      if (!prev || !prev.params || !shallowEqual(prev.params, track.params)) {
        audioRef.current.setTrackParams(track.id, track.params);
      }
      // Sync portamento — cheap call, always idempotent in the worklet
      {
        const modeInt = track.portamentoMode === 'always' ? 1 : track.portamentoMode === 'legato' ? 2 : 0;
        audioRef.current.setTrackPortamento(track.id, track.portamentoTime ?? 0, modeInt);
      }
      // Keep the live audio engine aligned with session state even while a human
      // interaction is active. Arbitration still blocks AI writes separately;
      // suppressing human param sync makes the instrument feel unresponsive.
      prevTrackStateRef.current.set(key, {
        model: track.model,
        params: { ...track.params },
      });

      // Sync drum rack pads — add/remove/update as needed
      if (track.engine === 'drum-rack' && track.drumRack && audioRef.current.isTrackDrumRack(track.id)) {
        const desiredPadIds = new Set(track.drumRack.pads.map(p => p.id));
        const currentPadIds = new Set(audioRef.current.getDrumPadIds(track.id));
        // Remove pads that no longer exist
        for (const existingId of currentPadIds) {
          if (!desiredPadIds.has(existingId)) {
            audioRef.current.removeDrumPad(track.id, existingId);
          }
        }
        // Add or update pads — collect promises for newly added pads so we can
        // invalidate the scheduler after the async WASM instantiation completes.
        // Without this, the scheduler silently drops notes for pads that don't
        // exist yet in the audio engine (#1428).
        const newPadPromises: Promise<void>[] = [];
        for (const pad of track.drumRack.pads) {
          if (!currentPadIds.has(pad.id)) {
            newPadPromises.push(
              audioRef.current.addDrumPad(
                track.id, pad.id, pad.source.model, pad.source.params,
                pad.level, pad.pan, pad.chokeGroup,
              ),
            );
          } else {
            // Sync model, params, level, pan, choke group
            audioRef.current.setDrumPadModel(track.id, pad.id, pad.source.model);
            audioRef.current.setDrumPadParams(track.id, pad.id, pad.source.params);
            audioRef.current.setDrumPadLevel(track.id, pad.id, pad.level);
            audioRef.current.setDrumPadPan(track.id, pad.id, pad.pan);
            audioRef.current.setDrumPadChokeGroup(track.id, pad.id, pad.chokeGroup);
          }
        }
        // After all new pads are instantiated, invalidate the track in the
        // scheduler so it re-visits events that were silently dropped (#1428).
        if (newPadPromises.length > 0) {
          const trackId = track.id;
          void Promise.all(newPadPromises).then(() => {
            transportControllerRef.current?.invalidateTrackNow(trackId);
          });
        }
      }
    }
  }, [session.tracks, audioStarted, holdGeneration]);

  // Sync mute/solo state
  useEffect(() => {
    if (!audioStarted) return;
    for (const track of session.tracks) {
      audioRef.current.muteTrack(track.id, !isTrackAudibleInMixer(session.tracks, track.id));
    }
  }, [session.tracks, audioStarted]);

  // Sync per-track volume/pan to audio engine
  useEffect(() => {
    if (!audioStarted) return;
    for (const track of session.tracks) {
      audioRef.current.setTrackVolume(track.id, track.volume);
      audioRef.current.setTrackPan(track.id, track.pan);
    }
  }, [session.tracks, audioStarted]);

  // Sync sends to audio engine
  useEffect(() => {
    if (!audioStarted) return;
    for (const track of session.tracks) {
      audioRef.current.syncSends(track.id, track.sends ?? []);
    }
  }, [session.tracks, audioStarted]);

  // Sync sidechain routing to audio engine
  useEffect(() => {
    if (!audioStarted) return;
    const audio = audioRef.current;
    for (const track of session.tracks) {
      for (const proc of track.processors ?? []) {
        if (proc.type !== 'compressor') continue;
        const key = `${track.id}:${proc.id}`;
        const prev = prevSidechainStateRef.current.get(key);
        const current = proc.sidechainSourceId;
        if (prev !== current) {
          if (current) {
            audio.setSidechain(current, track.id, proc.id);
          } else {
            audio.removeSidechain(track.id, proc.id);
          }
          prevSidechainStateRef.current.set(key, current);
        }
      }
      // Prune stale cache entries for removed processors
      const prefix = `${track.id}:`;
      for (const k of prevSidechainStateRef.current.keys()) {
        if (k.startsWith(prefix) && !(track.processors ?? []).some(p => k === `${track.id}:${p.id}`)) {
          prevSidechainStateRef.current.delete(k);
        }
      }
    }
  }, [session.tracks, audioStarted]);

  // Sync master channel to audio engine
  useEffect(() => {
    if (!audioStarted) return;
    audioRef.current.setMasterVolume(session.master.volume);
    audioRef.current.setMasterPan(session.master.pan);
  }, [session.master.volume, session.master.pan, audioStarted]);

  // Sync metronome volume to audio engine
  useEffect(() => {
    if (!audioStarted) return;
    audioRef.current.setMetronomeVolume(session.transport.metronome?.volume ?? 0.5);
  }, [session.transport.metronome?.volume, audioStarted]);

  // Sync processor chains to audio engine
  useEffect(() => {
    if (!audioStarted) return;
    const audio = audioRef.current;
    for (const track of session.tracks) {
      const sessionProcs = track.processors ?? [];
      const engineProcs = audio.getProcessors(track.id);

      // Remove processors no longer in session
      for (const ep of engineProcs) {
        if (!sessionProcs.some(sp => sp.id === ep.id)) {
          audio.removeProcessor(track.id, ep.id);
        }
      }

      // Add new or sync existing processors
      for (const sp of sessionProcs) {
        const pKey = `${track.id}:${sp.id}`;
        if (!engineProcs.some(ep => ep.id === sp.id)) {
          // #138: read fresh state from sessionRef inside .then() to avoid stale closure
          void audio.addProcessor(track.id, sp.type, sp.id).then(() => {
            const v = sessionRef.current.tracks.find(sv => sv.id === track.id);
            const fresh = v?.processors?.find(p => p.id === sp.id);
            if (!fresh) return; // removed during WASM load
            audio.setProcessorModel(track.id, sp.id, fresh.model);
            audio.setProcessorPatch(track.id, sp.id, fresh.params);
            prevProcessorStateRef.current.set(pKey, { model: fresh.model, params: { ...fresh.params }, enabled: fresh.enabled !== false });
          }).catch((error) => {
            const reason = error instanceof Error ? error.message : String(error);
            reportAudioDegradation(`processor load failed for ${sp.type} (${sp.id}): ${reason}`);
          });
        } else {
          // #142: dirty-check before syncing existing processors
          const prev = prevProcessorStateRef.current.get(pKey);
          if (!prev || prev.model !== sp.model) {
            audio.setProcessorModel(track.id, sp.id, sp.model);
          }
          if (!prev || !shallowEqual(prev.params, sp.params)) {
            audio.setProcessorPatch(track.id, sp.id, sp.params);
          }
          // #436: sync bypass state
          const spEnabled = sp.enabled !== false;
          if (!prev || prev.enabled !== spEnabled) {
            audio.setProcessorEnabled(track.id, sp.id, spEnabled);
          }
          prevProcessorStateRef.current.set(pKey, { model: sp.model, params: { ...sp.params }, enabled: spEnabled });
        }
      }

      // Prune stale cache entries for removed processors
      const prefix = `${track.id}:`;
      for (const k of prevProcessorStateRef.current.keys()) {
        if (k.startsWith(prefix) && !sessionProcs.some(sp => k === `${track.id}:${sp.id}`)) {
          prevProcessorStateRef.current.delete(k);
        }
      }
    }
  }, [session.tracks, audioStarted]);

  // Sync modulator state to audio engine
  useEffect(() => {
    if (!audioStarted) return;
    const audio = audioRef.current;
    for (const track of session.tracks) {
      const sessionMods = track.modulators ?? [];
      const engineMods = audio.getModulators(track.id);

      // Remove modulators no longer in session
      for (const em of engineMods) {
        if (!sessionMods.some(sm => sm.id === em.id)) {
          audio.removeModulator(track.id, em.id);
        }
      }

      // Helper: sync modulation routes for this track against current engine state
      const syncRoutes = (vid: string) => {
        const v = sessionRef.current.tracks.find(sv => sv.id === vid);
        if (!v) return;
        const sRoutes = v.modulations ?? [];
        const eRoutes = audio.getModulationRoutes(vid);
        for (const er of eRoutes) {
          if (!sRoutes.some(sr => sr.id === er.id)) {
            audio.removeModulationRoute(vid, er.id);
          }
        }
        const eRoutesAfter = audio.getModulationRoutes(vid);
        for (const sr of sRoutes) {
          if (!eRoutesAfter.some(er => er.id === sr.id)) {
            audio.addModulationRoute(vid, sr.id, sr.modulatorId, sr.target, sr.depth);
          } else {
            audio.setModulationDepth(vid, sr.id, sr.depth);
          }
        }
      };

      // Add new or sync existing modulators
      for (const sm of sessionMods) {
        const mKey = `${track.id}:${sm.id}`;
        if (!engineMods.some(em => em.id === sm.id)) {
          // #138: read fresh state from sessionRef inside .then() to avoid stale closure
          void audio.addModulator(track.id, sm.type, sm.id).then(() => {
            const v = sessionRef.current.tracks.find(sv => sv.id === track.id);
            const fresh = v?.modulators?.find(m => m.id === sm.id);
            if (!fresh) return; // removed during WASM load
            audio.setModulatorModel(track.id, sm.id, fresh.model);
            audio.setModulatorPatch(track.id, sm.id, fresh.params);
            prevModulatorStateRef.current.set(mKey, { model: fresh.model, params: { ...fresh.params } });
            // Connect routes after modulator WASM loads (fixes race condition)
            syncRoutes(track.id);
          }).catch((error) => {
            const reason = error instanceof Error ? error.message : String(error);
            reportAudioDegradation(`modulator load failed for ${sm.type} (${sm.id}): ${reason}`);
          });
        } else {
          // #142: dirty-check before syncing existing modulators
          const prev = prevModulatorStateRef.current.get(mKey);
          if (!prev || prev.model !== sm.model) {
            audio.setModulatorModel(track.id, sm.id, sm.model);
          }
          if (!prev || !shallowEqual(prev.params, sm.params)) {
            audio.setModulatorPatch(track.id, sm.id, sm.params);
          }
          prevModulatorStateRef.current.set(mKey, { model: sm.model, params: { ...sm.params } });
        }
      }

      // Prune stale cache entries for removed modulators
      const mPrefix = `${track.id}:`;
      for (const k of prevModulatorStateRef.current.keys()) {
        if (k.startsWith(mPrefix) && !sessionMods.some(sm => k === `${track.id}:${sm.id}`)) {
          prevModulatorStateRef.current.delete(k);
        }
      }

      // Sync routes now (for already-loaded modulators)
      syncRoutes(track.id);
    }
  }, [session.tracks, audioStarted]);

  const activeTrack = getActiveTrack(session);
  const activeTrackIndex = session.tracks.findIndex(t => t.id === session.activeTrackId);

  const _dispatchAIActions = useCallback((actions: AIAction[], toolCalls?: ToolCallEntry[]) => {
    setSession((s) => {
      const report = executeOperations(s, actions, plaitsAdapter, arbRef.current, toolCalls);

      // Start drift animations for accepted moves with `over`
      for (let i = 0; i < report.accepted.length; i++) {
        const action = report.accepted[i];
        if (action.type === 'move' && action.over) {
          const vid = action.trackId ?? s.activeTrackId;
          const runtimeParam = report.resolvedParams.get(i) ?? action.param;
          const track = getTrack(report.session, vid);
          const currentVal = track.params[runtimeParam] ?? 0;
          const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
          const targetVal = Math.max(0, Math.min(1, rawTarget));
          autoRef.current.start(vid, runtimeParam, currentVal, targetVal, action.over, (p, value) => {
            if (!arbRef.current.canAIAct(vid, p)) return;
            setSession((s2) => applyParamDirect(s2, vid, p, value));
          });
          autoRef.current.startLoop();
        }
      }

      // Track activity for touched tracks (skip non-track actions)
      const now = Date.now();
      const touchedTracks = new Set<string>();
      for (const action of report.accepted) {
        if (action.type === 'say' || action.type === 'set_transport') continue;
        if (!('trackId' in action) || !action.trackId) continue;
        touchedTracks.add(action.trackId);
      }
      if (touchedTracks.size > 0) {
        setActivityMap(prev => {
          const next = { ...prev };
          for (const vid of touchedTracks) next[vid] = now;
          return next;
        });
      }

      // Surface silently-rejected actions so the user knows the AI's
      // claim doesn't match reality (race between validation and execution).
      const rejectedNonSay = report.rejected.filter(r => r.op.type !== 'say');
      if (rejectedNonSay.length > 0) {
        const reasons = rejectedNonSay.map(r => r.reason);
        const unique = [...new Set(reasons)];
        const summary = rejectedNonSay.length === 1
          ? `1 action rejected: ${unique[0]}`
          : `${rejectedNonSay.length} actions rejected: ${unique.join('; ')}`;
        return {
          ...report.session,
          messages: [
            ...report.session.messages,
            { role: 'system' as const, text: summary, timestamp: Date.now() },
          ],
        };
      }

      return report.session;
    });
  }, []);

  /** Record a parameter automation event if recording is active (armed + playing). */
  const maybeRecordAutomation = useCallback((trackId: string, runtimeParam: string, value: number) => {
    const s = sessionRef.current;
    if (!recordArmedRef.current || s.transport.status !== 'playing') return;
    const controlId = runtimeParamToControlId[runtimeParam] ?? runtimeParam;
    const at = globalStepRef.current;
    setSession(prev => insertAutomationEvent(prev, trackId, at, controlId, value));
  }, []);

  const handleParamChange = useCallback((timbre: number, morph: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeTrackId;
    autoRef.current.cancel(vid, 'timbre');
    autoRef.current.cancel(vid, 'morph');
    arbRef.current.humanTouched(vid, 'timbre', timbre, 'source');
    arbRef.current.humanTouched(vid, 'morph', morph, 'source');
    setSession((s) => {
      let next = updateTrackParams(s, vid, { timbre, morph }, true, plaitsAdapter);

      // If a step is held, apply param lock (no per-frame undo — captured at interaction end)
      if (selectedStep !== null) {
        next = setStepParamLock(next, vid, selectedStep, { timbre, morph }, { pushUndo: false });
      }

      return next;
    });

    // Record automation if recording
    maybeRecordAutomation(vid, 'timbre', timbre);
    maybeRecordAutomation(vid, 'morph', morph);
  }, [selectedStep, ensureAudio, maybeRecordAutomation]);

  const handleNoteChange = useCallback((note: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeTrackId;
    autoRef.current.cancel(vid, 'note');
    arbRef.current.humanTouched(vid, 'note', note, 'source');
    setSession((s) => {
      const track = getTrack(s, vid);
      const prevNote = track.params.note ?? 0;
      const next = updateTrackParams(s, vid, { note }, true, plaitsAdapter);
      if (Math.abs(note - prevNote) < 0.001) return next;
      const controlId = plaitsAdapter.mapRuntimeParamKey('note');
      const prevProvenance: Partial<ControlState> = {};
      if (controlId && track.controlProvenance?.[controlId]) {
        prevProvenance[controlId] = { ...track.controlProvenance[controlId] };
      }
      const snapshot: ParamSnapshot = {
        kind: 'param', trackId: vid,
        prevValues: { note: prevNote }, aiTargetValues: { note },
        prevProvenance: Object.keys(prevProvenance).length > 0 ? prevProvenance : undefined,
        timestamp: Date.now(), description: `Note change`,
      };
      return { ...next, undoStack: [...next.undoStack, snapshot] };
    });

    // Record automation if recording
    maybeRecordAutomation(vid, 'note', note);
  }, [ensureAudio, maybeRecordAutomation]);

  const handleHarmonicsChange = useCallback((harmonics: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeTrackId;
    autoRef.current.cancel(vid, 'harmonics');
    arbRef.current.humanTouched(vid, 'harmonics', harmonics, 'source');
    setSession((s) => {
      const track = getTrack(s, vid);
      const prevHarmonics = track.params.harmonics ?? 0;
      const next = updateTrackParams(s, vid, { harmonics }, true, plaitsAdapter);
      if (Math.abs(harmonics - prevHarmonics) < 0.001) return next;
      const controlId = plaitsAdapter.mapRuntimeParamKey('harmonics');
      const prevProvenance: Partial<ControlState> = {};
      if (controlId && track.controlProvenance?.[controlId]) {
        prevProvenance[controlId] = { ...track.controlProvenance[controlId] };
      }
      const snapshot: ParamSnapshot = {
        kind: 'param', trackId: vid,
        prevValues: { harmonics: prevHarmonics }, aiTargetValues: { harmonics },
        prevProvenance: Object.keys(prevProvenance).length > 0 ? prevProvenance : undefined,
        timestamp: Date.now(), description: `Harmonics change`,
      };
      return { ...next, undoStack: [...next.undoStack, snapshot] };
    });

    // Record automation if recording
    maybeRecordAutomation(vid, 'harmonics', harmonics);
  }, [ensureAudio, maybeRecordAutomation]);

  const handleExtendedSourceParamChange = useCallback((runtimeParam: string, value: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeTrackId;
    autoRef.current.cancel(vid, runtimeParam);
    arbRef.current.humanTouched(vid, runtimeParam, value, 'source');
    setSession((s) => {
      const track = getTrack(s, vid);
      const prevValue = track.params[runtimeParam] ?? 0;
      const next = updateTrackParams(s, vid, { [runtimeParam]: value }, true, plaitsAdapter);
      if (Math.abs(value - prevValue) < 0.001) return next;

      // If a gesture is in progress (interactionUndoRef active), skip per-change
      // undo push — the gesture end handler will capture the entire diff as one entry.
      if (interactionUndoRef.current) return next;

      const controlId = plaitsAdapter.mapRuntimeParamKey(runtimeParam);
      const prevProvenance: Partial<ControlState> = {};
      if (controlId && track.controlProvenance?.[controlId]) {
        prevProvenance[controlId] = { ...track.controlProvenance[controlId] };
      }
      const snapshot: ParamSnapshot = {
        kind: 'param',
        trackId: vid,
        prevValues: { [runtimeParam]: prevValue },
        aiTargetValues: { [runtimeParam]: value },
        prevProvenance: Object.keys(prevProvenance).length > 0 ? prevProvenance : undefined,
        timestamp: Date.now(),
        description: `${controlId ?? runtimeParam} change`,
      };
      return { ...next, undoStack: [...next.undoStack, snapshot] };
    });

    // Record automation if recording
    maybeRecordAutomation(vid, runtimeParam, value);
  }, [ensureAudio, maybeRecordAutomation]);

  /** Handle portamento changes — writes to track-level fields with undo support. */
  const handlePortamentoChange = useCallback((field: 'portamentoTime' | 'portamentoMode', value: number | string) => {
    ensureAudio();
    const vid = sessionRef.current.activeTrackId;
    setSession((s) => {
      const track = getTrack(s, vid);
      const prevProps: Partial<import('../engine/types').Track> = {};
      const update: Partial<import('../engine/types').Track> = {};

      if (field === 'portamentoTime') {
        const numValue = typeof value === 'number' ? value : 0;
        prevProps.portamentoTime = track.portamentoTime;
        update.portamentoTime = Math.max(0, Math.min(1, numValue));
      } else {
        // portamento-mode: enum control passes numeric index — convert to string
        const modeMap = ['off', 'always', 'legato'] as const;
        const modeValue = typeof value === 'number' ? modeMap[Math.round(value)] ?? 'off' : value as 'off' | 'always' | 'legato';
        prevProps.portamentoMode = track.portamentoMode;
        update.portamentoMode = modeValue;
      }

      const snapshot: TrackPropertySnapshot = {
        kind: 'track-property',
        trackId: vid,
        prevProps,
        timestamp: Date.now(),
        description: `${field} change`,
      };

      return {
        ...updateTrack(s, vid, update),
        undoStack: [...s.undoStack, snapshot],
      };
    });
  }, [ensureAudio]);

  const handleSourceInteractionStart = useCallback(() => {
    const s = sessionRef.current;
    arbRef.current.humanInteractionStart(s.activeTrackId);
    const track = getActiveTrack(s);
    const prevProvenance: Partial<ControlState> = {};
    if (track.controlProvenance) {
      for (const key of Object.keys(track.params)) {
        const controlId = plaitsAdapter.mapRuntimeParamKey(key);
        if (controlId && track.controlProvenance[controlId]) {
          prevProvenance[controlId] = { ...track.controlProvenance[controlId] };
        }
      }
    }
    // Capture ALL source params so that any knob (not just XY pad) gets single-gesture undo
    interactionUndoRef.current = {
      trackId: s.activeTrackId,
      prevParams: { ...track.params },
      prevProvenance: Object.keys(prevProvenance).length > 0 ? prevProvenance : undefined,
      prevEvents: track.patterns.length > 0 ? [...getActivePattern(track).events] : undefined,
    };
  }, []);

  const handleSourceInteractionEnd = useCallback(() => {
    arbRef.current.humanInteractionEnd();
    const captured = interactionUndoRef.current;
    if (captured) {
      interactionUndoRef.current = null;
      setSession((s) => {
        const track = getTrack(s, captured.trackId);
        const snapshots: (ParamSnapshot | PatternEditSnapshot)[] = [];

        // Check if params changed (union of prev + current keys to catch new params)
        const currentValues: Partial<SynthParamValues> = {};
        const allParamKeys = new Set([
          ...Object.keys(captured.prevParams),
          ...Object.keys(track.params),
        ]);
        for (const param of allParamKeys) {
          const prev = (captured.prevParams as Record<string, number>)[param] ?? 0;
          const cur = track.params[param] ?? 0;
          if (Math.abs(cur - prev) > 0.001) {
            currentValues[param] = cur;
          }
        }
        if (Object.keys(currentValues).length > 0) {
          snapshots.push({
            kind: 'param',
            trackId: captured.trackId,
            prevValues: captured.prevParams,
            aiTargetValues: currentValues,
            prevProvenance: captured.prevProvenance,
            timestamp: Date.now(),
            description: `Param change: ${Object.keys(currentValues).join(', ')}`,
          });
        }

        // Check if region events changed (param lock during drag)
        if (captured.prevEvents && track.patterns.length > 0) {
          const curEvents = getActivePattern(track).events;
          const eventsChanged = curEvents.length !== captured.prevEvents.length ||
            curEvents.some((e, i) => JSON.stringify(e) !== JSON.stringify(captured.prevEvents![i]));
          if (eventsChanged) {
            snapshots.push({
              kind: 'pattern-edit',
              trackId: captured.trackId,
              prevEvents: captured.prevEvents,
              timestamp: Date.now(),
              description: 'Param lock change',
            });
          }
        }

        if (snapshots.length === 0) return s;
        // Group multiple snapshots into one undo entry
        let entry: UndoEntry;
        if (snapshots.length === 1) {
          entry = snapshots[0];
        } else {
          entry = {
            kind: 'group',
            snapshots,
            timestamp: Date.now(),
            description: 'XY pad drag with param lock',
          } as ActionGroupSnapshot;
        }
        return { ...s, undoStack: [...s.undoStack, entry] };
      });
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Surface interaction handlers — capture all source + processor state for
  // single-gesture undo. Used by SurfaceCanvas.
  // ---------------------------------------------------------------------------

  const surfaceUndoRef = useRef<{
    trackId: string;
    prevSourceParams: Record<string, number>;
    prevProcessors: { id: string; params: Record<string, number> }[];
    prevProvenance?: Partial<ControlState>;
  } | null>(null);

  const handleSurfaceInteractionStart = useCallback(() => {
    const s = sessionRef.current;
    const track = getActiveTrack(s);
    arbRef.current.humanInteractionStart(s.activeTrackId);
    // #1167: capture prevProvenance for surface source gestures
    const prevProvenance: Partial<ControlState> = {};
    if (track.controlProvenance) {
      for (const paramKey of Object.keys(track.params)) {
        const cid = plaitsAdapter.mapRuntimeParamKey(paramKey);
        if (cid && track.controlProvenance[cid]) {
          prevProvenance[cid] = { ...track.controlProvenance[cid] };
        }
      }
    }
    surfaceUndoRef.current = {
      trackId: s.activeTrackId,
      prevSourceParams: { ...track.params },
      prevProcessors: (track.processors ?? []).map(p => ({
        id: p.id,
        params: { ...p.params },
      })),
      prevProvenance: Object.keys(prevProvenance).length > 0 ? prevProvenance : undefined,
    };
  }, []);

  const handleSurfaceInteractionEnd = useCallback(() => {
    arbRef.current.humanInteractionEnd();
    const captured = surfaceUndoRef.current;
    if (!captured) return;
    surfaceUndoRef.current = null;

    setSession((s) => {
      const track = getTrack(s, captured.trackId);
      const snapshots: Snapshot[] = [];

      // Check source params (union of prev + current keys to catch new params)
      const changedSource: Record<string, number> = {};
      const allSourceKeys = new Set([
        ...Object.keys(captured.prevSourceParams),
        ...Object.keys(track.params),
      ]);
      for (const param of allSourceKeys) {
        const prev = captured.prevSourceParams[param] ?? 0;
        const cur = track.params[param] ?? 0;
        if (Math.abs(cur - prev) > 0.001) {
          changedSource[param] = cur;
        }
      }
      if (Object.keys(changedSource).length > 0) {
        snapshots.push({
          kind: 'param',
          trackId: captured.trackId,
          prevValues: captured.prevSourceParams,
          aiTargetValues: changedSource,
          prevProvenance: captured.prevProvenance,
          timestamp: Date.now(),
          description: `Surface param change: ${Object.keys(changedSource).join(', ')}`,
        } as ParamSnapshot);
      }

      // Check each processor
      for (const prevProc of captured.prevProcessors) {
        const curProc = (track.processors ?? []).find(p => p.id === prevProc.id);
        if (!curProc) continue;
        const allKeys = new Set([...Object.keys(prevProc.params), ...Object.keys(curProc.params)]);
        const changed = [...allKeys].some(
          k => Math.abs((curProc.params[k] ?? 0) - (prevProc.params[k] ?? 0)) > 0.001,
        );
        if (changed) {
          snapshots.push({
            kind: 'processor-state',
            trackId: captured.trackId,
            processorId: prevProc.id,
            prevParams: prevProc.params,
            prevModel: curProc.model,
            timestamp: Date.now(),
            description: 'Surface processor param change',
          } as ProcessorStateSnapshot);
        }
      }

      if (snapshots.length === 0) return s;
      if (snapshots.length === 1) {
        return { ...s, undoStack: [...s.undoStack, snapshots[0]] };
      }
      const group: ActionGroupSnapshot = {
        kind: 'group',
        snapshots,
        timestamp: Date.now(),
        description: 'Surface control gesture',
      };
      return { ...s, undoStack: [...s.undoStack, group] };
    });
  }, []);

  /** Add a module to the active track's surface (human parity with set_surface). */
  const handleAddSurfaceModule = useCallback((module: SurfaceModule) => {
    setSession((s) => {
      const track = getActiveTrack(s);
      const newSurface: TrackSurface = {
        ...track.surface,
        modules: [...track.surface.modules, module],
      };
      // #1148: Validate before committing, matching the AI set_surface path
      const validationError = validateSurface(newSurface, track);
      if (validationError) {
        console.warn(`[surface] Add module rejected: ${validationError}`);
        return s;
      }
      const prevSurface: TrackSurface = {
        ...track.surface,
        modules: track.surface.modules.map(m => ({
          ...m,
          bindings: [...m.bindings],
          position: { ...m.position },
          config: structuredClone(m.config),
        })),
      };
      const snapshot: SurfaceSnapshot = {
        kind: 'surface',
        trackId: s.activeTrackId,
        prevSurface,
        timestamp: Date.now(),
        description: `Added ${module.label} module`,
      };
      return {
        ...updateTrack(s, s.activeTrackId, { surface: newSurface }),
        undoStack: [...s.undoStack, snapshot],
      };
    });
  }, []);

  /** Source param change without per-frame undo — used during surface drags. */
  const handleSurfaceSourceParamChange = useCallback((runtimeParam: string, value: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeTrackId;
    autoRef.current.cancel(vid, runtimeParam);
    arbRef.current.humanTouched(vid, runtimeParam, value, 'source');
    setSession((s) => updateTrackParams(s, vid, { [runtimeParam]: value }, true, plaitsAdapter));
  }, [ensureAudio]);

  /** Processor param change without per-frame undo — used during surface drags. */
  const handleSurfaceProcessorParamChange = useCallback((processorId: string, param: string, value: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeTrackId;
    arbRef.current.humanTouched(vid, `${processorId}:${param}`, value, 'processor');
    setSession((s) => {
      const track = getTrack(s, vid);
      const processors = (track.processors ?? []).map(p => {
        if (p.id !== processorId) return p;
        return { ...p, params: { ...p.params, [param]: Math.max(0, Math.min(1, value)) } };
      });
      return updateTrack(s, vid, { processors });
    });
  }, [ensureAudio]);

  /** Drum pad param change without per-frame undo — used during surface drags. */
  const handleSurfaceDrumPadParamChange = useCallback((padId: string, param: string, value: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeTrackId;
    arbRef.current.humanTouched(vid, `${padId}.${param}`, value, 'source');
    setSession((s) => {
      const track = getTrack(s, vid);
      if (!track.drumRack) return s;
      const clamped = Math.max(0, Math.min(1, value));
      const newPads = track.drumRack.pads.map(p => {
        if (p.id !== padId) return p;
        if (param === 'level') return { ...p, level: clamped };
        if (param === 'pan') return { ...p, pan: clamped };
        return { ...p, source: { ...p.source, params: { ...p.source.params, [param]: clamped } } };
      });
      return updateTrack(s, vid, { drumRack: { ...track.drumRack, pads: newPads } });
    });
  }, [ensureAudio]);

  /** Update a surface module (label, bindings) with undo. */
  const handleSurfaceUpdateModule = useCallback((updated: SurfaceModule) => {
    setSession((s) => {
      const trackId = s.activeTrackId;
      const track = getTrack(s, trackId);
      const newModules = track.surface.modules.map(m => m.id === updated.id ? updated : m);
      const newSurface: TrackSurface = { ...track.surface, modules: newModules };
      // #1148: Validate before committing, matching the AI set_surface path
      const validationError = validateSurface(newSurface, track);
      if (validationError) {
        console.warn(`[surface] Update module rejected: ${validationError}`);
        return s;
      }
      const prevSurface = {
        ...track.surface,
        modules: track.surface.modules.map(m => ({ ...m, bindings: [...m.bindings], position: { ...m.position }, config: structuredClone(m.config) })),
      };
      const snapshot: SurfaceSnapshot = {
        kind: 'surface',
        trackId,
        prevSurface,
        timestamp: Date.now(),
        description: `Update surface module "${updated.label}"`,
      };
      return {
        ...updateTrack(s, trackId, { surface: newSurface }),
        undoStack: [...s.undoStack, snapshot],
      };
    });
  }, []);

  /** Remove a surface module with undo. */
  const handleSurfaceRemoveModule = useCallback((moduleId: string) => {
    setSession((s) => {
      const trackId = s.activeTrackId;
      const track = getTrack(s, trackId);
      const prevSurface = {
        ...track.surface,
        modules: track.surface.modules.map(m => ({ ...m, bindings: [...m.bindings], position: { ...m.position }, config: structuredClone(m.config) })),
      };
      const newModules = track.surface.modules.filter(m => m.id !== moduleId);
      const snapshot: SurfaceSnapshot = {
        kind: 'surface',
        trackId,
        prevSurface,
        timestamp: Date.now(),
        description: `Remove surface module`,
      };
      return {
        ...updateTrack(s, trackId, { surface: { ...track.surface, modules: newModules } }),
        undoStack: [...s.undoStack, snapshot],
      };
    });
  }, []);

  // ── Live Controls panel handlers ────────────────────────────────────────

  /** Mark a live control module as touched (user interacted with a knob). */
  const handleLiveModuleTouch = useCallback((moduleId: string) => {
    setSession(s => ({
      ...s,
      liveControls: s.liveControls.map(m => m.id === moduleId ? { ...m, touched: true } : m),
    }));
  }, []);

  /** Copy a live module to its bound track's surface and remove from liveControls. */
  const handleLiveModuleAddToSurface = useCallback((liveModule: LiveControlModule) => {
    setSession((s) => {
      const track = getTrack(s, liveModule.trackId);
      const newSurface: TrackSurface = {
        ...track.surface,
        modules: [...track.surface.modules, liveModule.module],
      };
      const validationError = validateSurface(newSurface, track);
      if (validationError) {
        console.warn(`[live-controls] Add to surface rejected: ${validationError}`);
        return s;
      }
      const prevSurface: TrackSurface = {
        ...track.surface,
        modules: track.surface.modules.map(m => ({
          ...m,
          bindings: [...m.bindings],
          position: { ...m.position },
          config: structuredClone(m.config),
        })),
      };
      const snapshot: SurfaceSnapshot = {
        kind: 'surface',
        trackId: liveModule.trackId,
        prevSurface,
        prevLiveControls: [...s.liveControls],
        timestamp: Date.now(),
        description: `Added ${liveModule.module.label} from Live Controls`,
      };
      return {
        ...updateTrack(s, liveModule.trackId, { surface: newSurface }),
        undoStack: [...s.undoStack, snapshot],
        liveControls: s.liveControls.filter(m => m.id !== liveModule.id),
      };
    });
  }, []);

  /** Clear stale live controls and increment turn counter. Pure function so
   *  callers can apply it synchronously to sessionRef before building the
   *  session snapshot that goes to the planner. Removes:
   *  - untouched modules (proposals from last turn)
   *  - touched modules past 3-turn grace period
   *  - modules whose trackId no longer exists */
  const clearStaleLiveControls = useCallback((s: Session): Session => {
    const currentTurn = s.turnCount;
    const trackIds = new Set(s.tracks.map(t => t.id));
    const filtered = s.liveControls.filter(m => {
      if (!trackIds.has(m.trackId)) return false;
      if (!m.touched) return false;
      if (currentTurn - m.createdAtTurn > 3) return false;
      return true;
    });
    return {
      ...s,
      liveControls: filtered,
      turnCount: currentTurn + 1,
    };
  }, []);

  /** Pin/unpin a control to/from the Surface view. Toggle behaviour. */
  const handlePinControl = useCallback((moduleId: string, controlId: string) => {
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const target = moduleId === 'source' ? controlId : `${moduleId}:${controlId}`;
      const alreadyPinned = track.surface.modules.some(
        m => m.config.pinned === true && m.bindings.some(b => b.target === target),
      );
      const action: AIAction = alreadyPinned
        ? { type: 'unpin', trackId: vid, moduleId, controlId, description: `Unpin ${controlId}` }
        : { type: 'pin', trackId: vid, moduleId, controlId, description: `Pin ${controlId}` };
      const report = executeOperations(s, [action], plaitsAdapter, arbRef.current);
      return report.session;
    });
  }, []);

  /** Compute the set of pinned control IDs for a given module on the active track. */
  const getPinnedControlIds = useCallback((moduleId: string): Set<string> => {
    const track = getActiveTrack(sessionRef.current);
    const pinned = new Set<string>();
    const prefix = moduleId + ':';
    for (const m of track.surface.modules) {
      if (m.config.pinned !== true) continue;
      for (const b of m.bindings) {
        if (b.target.startsWith(prefix)) {
          pinned.add(b.target.slice(prefix.length));
        }
      }
    }
    return pinned;
  }, []);

  const handleModelChange = useCallback((model: number) => {
    ensureAudio();
    setSession((s) => setModel(s, s.activeTrackId, model));
  }, [ensureAudio]);

  /** Human-initiated timed parameter ramp (Shift+Click on knob). */
  const handleHumanRamp = useCallback((controlId: string, targetValue: number, durationMs: number, processorId?: string) => {
    ensureAudio();
    const vid = sessionRef.current.activeTrackId;
    const runtimeParam = controlIdToRuntimeParam[controlId] ?? controlId;
    const track = getTrack(sessionRef.current, vid);

    // Resolve start value from processor or source params
    let startValue: number;
    if (processorId) {
      const proc = (track.processors ?? []).find(p => p.id === processorId);
      startValue = proc?.params[runtimeParam] ?? 0;
    } else {
      startValue = track.params[runtimeParam] ?? 0;
    }

    // Guard: no-op if target already equals current value
    if (Math.abs(targetValue - startValue) < 0.001) return;

    // Signal arbitration that a human is touching this param
    arbRef.current.humanTouched(vid, runtimeParam, startValue, processorId ? `processor:${processorId}` : 'source');

    // Push undo snapshot inside setSession to avoid stale closure
    setSession((s) => {
      const currentTrack = getTrack(s, vid);
      const now = Date.now();
      if (processorId) {
        const proc = (currentTrack.processors ?? []).find(p => p.id === processorId);
        const currentValue = proc?.params[runtimeParam] ?? 0;
        const snapshot: ProcessorStateSnapshot = {
          kind: 'processor-state',
          trackId: vid,
          processorId,
          prevParams: proc ? { ...proc.params } : { [runtimeParam]: currentValue },
          prevModel: proc?.model ?? 0,
          timestamp: now,
          description: `Ramp ${controlId} to ${targetValue.toFixed(2)} over ${(durationMs / 1000).toFixed(1)}s`,
        };
        return {
          ...s,
          undoStack: [...s.undoStack, snapshot],
          // #1166: track ramp as human action
          recentHumanActions: [
            ...s.recentHumanActions,
            { kind: 'param' as const, trackId: vid, param: runtimeParam, from: currentValue, to: targetValue, timestamp: now },
          ].slice(-20),
        };
      } else {
        const currentValue = currentTrack.params[runtimeParam] ?? 0;
        // #1164: capture prevProvenance before ramp
        const mappedControlId = plaitsAdapter.mapRuntimeParamKey(runtimeParam);
        const prevProvenance: Partial<ControlState> = {};
        if (mappedControlId && currentTrack.controlProvenance?.[mappedControlId]) {
          prevProvenance[mappedControlId] = { ...currentTrack.controlProvenance[mappedControlId] };
        }
        const snapshot: ParamSnapshot = {
          kind: 'param',
          trackId: vid,
          prevValues: { [runtimeParam]: currentValue },
          aiTargetValues: { [runtimeParam]: targetValue },
          prevProvenance: Object.keys(prevProvenance).length > 0 ? prevProvenance : undefined,
          timestamp: now,
          description: `Ramp ${controlId} to ${targetValue.toFixed(2)} over ${(durationMs / 1000).toFixed(1)}s`,
        };
        return {
          ...s,
          undoStack: [...s.undoStack, snapshot],
          // #1166: track ramp as human action
          recentHumanActions: [
            ...s.recentHumanActions,
            { kind: 'param' as const, trackId: vid, param: runtimeParam, from: currentValue, to: targetValue, timestamp: now },
          ].slice(-20),
        };
      }
    });

    // Start the animation using the same AutomationEngine used for AI drift
    autoRef.current.start(vid, runtimeParam, startValue, targetValue, durationMs, (p, value) => {
      if (processorId) {
        setSession((s2) => {
          const t = getTrack(s2, vid);
          const proc = (t.processors ?? []).find(pr => pr.id === processorId);
          if (!proc) return s2;
          const updatedProc = { ...proc, params: { ...proc.params, [p]: Math.max(0, Math.min(1, value)) } };
          return {
            ...s2,
            tracks: s2.tracks.map(v => v.id === vid ? {
              ...t,
              processors: (t.processors ?? []).map(pr => pr.id === processorId ? updatedProc : pr),
            } : v),
          };
        });
      } else {
        // #1180: update provenance during ramp to reflect human control
        setSession((s2) => updateTrackParams(s2, vid, { [p]: value }, true, plaitsAdapter));
      }
    });
    autoRef.current.startLoop();
  }, [ensureAudio]);


  /** Cancel all active automations/ramps associated with an undo entry. */
  const cancelAutomationsForEntry = useCallback((entry: UndoEntry) => {
    if (entry.kind === 'param') {
      for (const param of Object.keys(entry.prevValues)) {
        autoRef.current.cancel(entry.trackId, param);
      }
    } else if (entry.kind === 'processor-state') {
      for (const param of Object.keys(entry.prevParams)) {
        autoRef.current.cancel(entry.trackId, param);
      }
    } else if (entry.kind === 'group') {
      for (const snapshot of entry.snapshots) {
        cancelAutomationsForEntry(snapshot);
      }
    }
  }, []);

  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingLogEntries, setStreamingLogEntries] = useState<import('../engine/types').ActionLogEntry[]>([]);
  const [streamingRejections, setStreamingRejections] = useState<{ reason: string }[]>([]);
  const [lastCompletionSummary, setLastCompletionSummary] = useState<string | null>(null);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleInvalidateActiveTurn = useCallback(() => {
    setIsThinking(false);
    setIsListening(false);
    setStreamingText('');
    setStreamingLogEntries([]);
    setStreamingRejections([]);
  }, []);
  const handleProjectBoundaryReset = useCallback(() => {
    setAbSnapshot(null);
    setAbActive(null);
    setAudioDegradedMessage(null);
    setActivityMap({});
    setSelectedProcessorId(null);
    setSelectedModulatorId(null);
    setDeepViewModuleId(null);
    setSession(s => ({ ...s, liveControls: [] }));
    if (completionTimerRef.current) { clearTimeout(completionTimerRef.current); completionTimerRef.current = null; }
    setLastCompletionSummary(null);
    auditionSnapshotRef.current = null;
    setActiveAuditionId(null);
    trackerSelectionRef.current = null;
    trackerCursorStepRef.current = null;
    audioMetricsRef.current.clear();
  }, []);
  const {
    beginTurn,
    invalidateActiveTurn: invalidateActiveAITurn,
    isCurrentTurn,
    runWithActiveTurnInvalidation,
    wrapProjectBoundaryAction,
  } = useAiTurnBoundary({
    projectId: project.projectId,
    sessionMessages: session.messages,
    isTurnActive: isThinking || isListening,
    ai: aiRef.current,
    onInvalidateActiveTurn: handleInvalidateActiveTurn,
    onProjectBoundaryReset: handleProjectBoundaryReset,
  });

  const handleUndo = useCallback(() => {
    if (isThinking || isListening) invalidateActiveAITurn();
    ensureAudio();
    // Cancel active automations for params being undone (side-effect hoisted out of setSession)
    const currentSession = sessionRef.current;
    if (currentSession.undoStack.length > 0) {
      const topEntry = currentSession.undoStack[currentSession.undoStack.length - 1];
      cancelAutomationsForEntry(topEntry);
    }
    setSession((s) => {
      if (s.undoStack.length === 0) return s;
      const topEntry = s.undoStack[s.undoStack.length - 1];
      const description = topEntry.description ?? 'last action';

      const undone = applyUndo(s);
      const now = Date.now();
      return {
        ...undone,
        recentHumanActions: [
          ...undone.recentHumanActions,
          { kind: 'undo' as const, description, timestamp: now },
        ].slice(-20),
      };
    });
  }, [ensureAudio, cancelAutomationsForEntry, invalidateActiveAITurn, isListening, isThinking]);

  const handleUndoMessage = useCallback((messageIndex: number) => {
    if (isThinking || isListening) invalidateActiveAITurn();
    ensureAudio();
    // Cancel active automations for all entries being undone (side-effect hoisted out of setSession)
    const currentSession = sessionRef.current;
    const msg = currentSession.messages[messageIndex];
    if (msg?.undoStackRange) {
      const { start, end } = msg.undoStackRange;
      if (end === currentSession.undoStack.length - 1) {
        for (let i = start; i <= end; i++) {
          cancelAutomationsForEntry(currentSession.undoStack[i]);
        }
      }
    }
    setSession((s) => {
      const msg = s.messages[messageIndex];
      if (!msg?.undoStackRange) return s;
      const { start, end } = msg.undoStackRange;
      // Only allow undo when the entire turn is contiguous at the top of the stack
      if (end !== s.undoStack.length - 1) return s;

      let result = s;
      const count = end - start + 1;
      for (let i = 0; i < count; i++) {
        result = applyUndo(result);
      }

      const topEntry = s.undoStack[end];
      const description = topEntry?.description ?? 'AI turn';
      const now = Date.now();
      const updatedMessages = result.messages.map((m, i) =>
        i === messageIndex ? { ...m, undoStackRange: undefined } : m,
      );
      return {
        ...result,
        recentHumanActions: [
          ...result.recentHumanActions,
          { kind: 'undo' as const, description, timestamp: now },
        ].slice(-20),
        messages: updatedMessages,
      };
    });
  }, [ensureAudio, cancelAutomationsForEntry, invalidateActiveAITurn, isListening, isThinking]);

  const handleRedo = useCallback(() => {
    if (isThinking || isListening) invalidateActiveAITurn();
    ensureAudio();
    setSession((s) => {
      if ((s.redoStack ?? []).length === 0) return s;
      const topEntry = s.redoStack[s.redoStack.length - 1];
      const description = topEntry.description ?? 'last action';
      const redone = applyRedo(s);
      const now = Date.now();
      return {
        ...redone,
        recentHumanActions: [
          ...redone.recentHumanActions,
          { kind: 'redo' as const, description, timestamp: now },
        ].slice(-20),
      };
    });
  }, [ensureAudio, invalidateActiveAITurn, isListening, isThinking]);

  useEffect(() => {
    if (!audioStarted) {
      audioMetricsRef.current.clear();
      return;
    }

    const sample = () => {
      audioMetricsRef.current.sample(sessionRef.current, audioRef.current);
    };

    sample();
    const intervalId = window.setInterval(sample, 250);
    return () => window.clearInterval(intervalId);
  }, [audioStarted]);

  const handleSend = useCallback(async (message: string) => {
    if (!aiRef.current.isPlannerConfigured()) return;
    const thisRequest = beginTurn();
    setIsThinking(true);
    setStreamingText('');
    setStreamingLogEntries([]);
    setStreamingRejections([]);
    // Clear any lingering completion card from previous turn
    if (completionTimerRef.current) { clearTimeout(completionTimerRef.current); completionTimerRef.current = null; }
    setLastCompletionSummary(null);
    if (!await ensureAudio()) {
      setIsThinking(false);
      return;
    }
    // Clear stale live controls and increment turn counter synchronously
    // before building the session snapshot for the planner.
    const cleaned = clearStaleLiveControls(sessionRef.current);
    // Add human message to session synchronously via ref so askStreaming
    // receives the session with the message already present. Without this,
    // onStep's setSession(() => updatedSession) overwrites the React state
    // with a snapshot that predates the human message, making it disappear.
    const humanMsg = { role: 'human' as const, text: message, timestamp: Date.now() };
    const withHumanMsg = {
      ...cleaned,
      messages: [...cleaned.messages, humanMsg],
    };
    sessionRef.current = withHumanMsg;
    setSession(withHumanMsg);

    let accumulated = '';
    const collectedToolCalls: ToolCallEntry[] = [];
    const collectedListenEvents: ListenEvent[] = [];
    const allSayTexts: string[] = [];
    const allLog: ExecutionReportLogEntry[] = [];
    let collectedSuggestedReactions: string[] | undefined;
    const undoBaseline = sessionRef.current.undoStack.length;

    // Capture current tracker selection (if any) so the AI knows what the human is pointing at.
    const sel = trackerSelectionRef.current;
    const userSelection: UserSelection | undefined = sel
      ? { trackId: sessionRef.current.activeTrackId, stepRange: sel.stepRange, eventIndices: sel.eventIndices }
      : undefined;

    const ctx = {
      listen: {
        renderOffline: (s: Session, vIds: string[], bars: number) => renderOffline(s, vIds, bars),
        renderOfflinePcm: (s: Session, vIds: string[], bars: number) => renderOfflinePcm(s, vIds, bars),
        onListening: setIsListening,
      },
      isStale: () => !isCurrentTurn(thisRequest),
      validateAction: (sess: Session, action: AIAction) => prevalidateAction(
        sess, action, plaitsAdapter, arbRef.current,
      ),
      onStreamText: (chunk: string) => {
        if (!isCurrentTurn(thisRequest)) return;
        accumulated += chunk;
        setStreamingText(accumulated);
      },
      onToolCall: (name: string, args: Record<string, unknown>) => {
        if (!isCurrentTurn(thisRequest)) return;
        collectedToolCalls.push({ name, args });
      },
      onListenEvent: (event: ListenEvent) => {
        if (!isCurrentTurn(thisRequest)) return;
        collectedListenEvents.push(event);
      },
      onActionsExecuted: (report: { log: import('../engine/types').ActionLogEntry[]; rejected: { op: import('../engine/types').AIAction; reason: string }[] }) => {
        if (!isCurrentTurn(thisRequest)) return;
        if (report.log.length > 0) setStreamingLogEntries(prev => [...prev, ...report.log]);
        if (report.rejected.length > 0) setStreamingRejections(prev => [...prev, ...report.rejected.map(r => ({ reason: r.reason }))]);
      },
      userSelection,
      audioMetrics: audioMetricsRef.current.getSnapshot(sessionRef.current.transport.status === 'playing'),
    };

    // Step executor: GluonAI calls this to execute actions against real state.
    const stepExecutor: StepExecutor = (sess, actions) => {
      return executeStepActions(sess, actions, plaitsAdapter, arbRef.current);
    };

    // Step callback: GluonAI calls this after each step for UI rendering.
    const onStep: OnStepCallback = (stepResult, updatedSession) => {
      // Guard: if a new request superseded this one, don't push stale state
      if (!isCurrentTurn(thisRequest)) return;

      // Collect say texts for the final ChatMessage
      for (const a of stepResult.actions) {
        if (a.type === 'say') allSayTexts.push(a.text);
      }

      // Capture AI-suggested reactions (last step wins if multiple)
      if (stepResult.suggestedReactions) {
        collectedSuggestedReactions = stepResult.suggestedReactions;
      }

      // Collect log entries
      if (stepResult.executionReport) {
        allLog.push(...stepResult.executionReport.log);

        // Start drift animations for accepted moves with `over`
        for (let i = 0; i < stepResult.executionReport.accepted.length; i++) {
          const action = stepResult.executionReport.accepted[i];
          if (action.type === 'move' && action.over) {
            const vid = action.trackId ?? updatedSession.activeTrackId;
            const runtimeParam = stepResult.executionReport.resolvedParams.get(i) ?? action.param;
            const track = getTrack(updatedSession, vid);
            const currentVal = track.params[runtimeParam] ?? 0;
            const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
            const targetVal = Math.max(0, Math.min(1, rawTarget));
            autoRef.current.start(vid, runtimeParam, currentVal, targetVal, action.over, (p, value) => {
              if (!arbRef.current.canAIAct(vid, p)) return;
              setSession((s2) => applyParamDirect(s2, vid, p, value));
            });
            autoRef.current.startLoop();
          }
        }

        // Track activity for touched tracks
        const now = Date.now();
        const touchedTracks = new Set<string>();
        for (const action of stepResult.executionReport.accepted) {
          if (action.type === 'say' || action.type === 'set_transport') continue;
          if (!('trackId' in action) || !action.trackId) continue;
          touchedTracks.add(action.trackId);
        }
        if (touchedTracks.size > 0) {
          setActivityMap(prev => {
            const next = { ...prev };
            for (const vid of touchedTracks) next[vid] = now;
            return next;
          });
        }
      }

      // Push updated session to React for rendering
      setSession(() => updatedSession);
    };

    try {
      await aiRef.current.askStreaming(
        sessionRef.current, message, ctx, stepExecutor, onStep,
      );
    } catch {
      // Error already handled by GluonAI.handleError
      } finally {
        if (isCurrentTurn(thisRequest)) {
          // Finalize: create ChatMessage without collapsing — per-step groups are already in place
          setSession(s => finalizeAITurn(s, undoBaseline, allSayTexts, allLog, collectedToolCalls, false, collectedSuggestedReactions, collectedListenEvents));
          clearSnapshots();
          setIsThinking(false);
          setIsListening(false);
          setStreamingText('');
          setStreamingLogEntries([]);
          setStreamingRejections([]);

          // Show completion card if there were tool calls (i.e. the AI did something)
          if (collectedToolCalls.length > 0) {
            const summary = allSayTexts.length > 0
              ? allSayTexts[allSayTexts.length - 1].slice(0, 80)
              : `${collectedToolCalls.length} action${collectedToolCalls.length === 1 ? '' : 's'} completed`;
            if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
            setLastCompletionSummary(summary);
            completionTimerRef.current = setTimeout(() => {
              setLastCompletionSummary(null);
              completionTimerRef.current = null;
            }, 5000);
          }
        }
    }
  }, [beginTurn, clearStaleLiveControls, ensureAudio, isCurrentTurn]);

  const handleReaction = useCallback((messageIndex: number, verdict: 'approved' | 'rejected', rationale?: string) => {
    setSession((s) => {
      // Toggle off if clicking the same verdict again (only when no rationale — chip clicks always apply)
      const existing = (s.reactionHistory ?? []).find(r => r.actionGroupIndex === messageIndex);
      if (!rationale && existing && existing.verdict === verdict) {
        // Remove the reaction (toggle off)
        return {
          ...s,
          reactionHistory: (s.reactionHistory ?? []).filter(r => r.actionGroupIndex !== messageIndex),
        };
      }
      // Replace any existing reaction for this message, or add new
      const filtered = (s.reactionHistory ?? []).filter(r => r.actionGroupIndex !== messageIndex);
      return addReaction({ ...s, reactionHistory: filtered }, {
        actionGroupIndex: messageIndex,
        verdict,
        ...(rationale ? { rationale } : {}),
        timestamp: Date.now(),
      });
    });
  }, []);

  const handleDecisionRespond = useCallback((decision: OpenDecision, response: string) => {
    const nextSession = resolveDecision(sessionRef.current, decision.id);

    sessionRef.current = nextSession;
    setSession(() => nextSession);

    const decisionReply = `Decision resolved: ${response}. ${decision.question}`;
    void handleSend(decisionReply);
  }, [handleSend]);

  const handleApiKey = useCallback((newGeminiKey: string) => {
    invalidateActiveAITurn();
    setGeminiKey(newGeminiKey);
    aiRef.current = createAI(newGeminiKey);
    // Restore conversation context from the current session into the new provider
    if (sessionRef.current.messages.length > 0) {
      aiRef.current.restoreHistory(sessionRef.current.messages);
    }
    setPlannerConfigured(aiRef.current.isPlannerConfigured());
    setListenerConfigured(aiRef.current.isListenerConfigured());
  }, [invalidateActiveAITurn]);

  const handleContinueWithoutAI = useCallback(() => {
    setManualModeDismissed(true);
  }, []);

  const handleProjectRename = useCallback(async (name: string) => {
    return project.renameActiveProject(name);
  }, [project]);

  const handleProjectNew = useCallback(async () => {
    return wrapProjectBoundaryAction(() => project.createProject());
  }, [project, wrapProjectBoundaryAction]);

  const handleProjectOpen = useCallback(async (id: string) => {
    return wrapProjectBoundaryAction(() => project.switchProject(id));
  }, [project, wrapProjectBoundaryAction]);

  const handleProjectDuplicate = useCallback(async () => {
    return wrapProjectBoundaryAction(() => project.duplicateActiveProject());
  }, [project, wrapProjectBoundaryAction]);

  const handleProjectDelete = useCallback(async () => {
    return wrapProjectBoundaryAction(() => project.deleteActiveProject());
  }, [project, wrapProjectBoundaryAction]);

  const handleProjectImport = useCallback(async (file: File) => {
    return wrapProjectBoundaryAction(() => project.importProject(file));
  }, [project, wrapProjectBoundaryAction]);

  const handleTogglePlay = useCallback(async () => {
    return runWithActiveTurnInvalidation(async () => {
      if (!await ensureAudio()) return;
      // Resume AudioContext if browser auto-suspended it after idle.
      // Must happen during user gesture to satisfy autoplay policy.
      await audioRef.current.resume();
      setSession((s) => s.transport.status === 'playing' ? pauseTransport(s) : playTransport(s));
    });
  }, [ensureAudio, runWithActiveTurnInvalidation]);

  const handlePlayFromCursor = useCallback(async () => {
    return runWithActiveTurnInvalidation(async () => {
      if (!await ensureAudio()) return;
      await audioRef.current.resume();
      const cursorStep = trackerCursorStepRef.current;
      // Always start playing from cursor (TransportController handles restart if already playing)
      setSession((s) => playTransport(s, cursorStep ?? 0));
    });
  }, [ensureAudio, runWithActiveTurnInvalidation]);

  const handleCursorStepChange = useCallback((step: number) => {
    trackerCursorStepRef.current = step;
  }, []);

  const handleTrackerSelectionChange = useCallback((selection: { stepRange: [number, number]; eventIndices: number[] } | null) => {
    trackerSelectionRef.current = selection;
  }, []);

  // Note preview: short audition when hovering or cursor-selecting tracker note cells
  const { previewNote, cancelPreview } = useNotePreview(audioRef, activeTrack, session.transport.status);
  const handleNotePreview = useCallback((pitch: number | null) => {
    if (pitch !== null) {
      previewNote(pitch);
    } else {
      cancelPreview();
    }
  }, [previewNote, cancelPreview]);

  /** Play from a specific row step (e.g. double-click in tracker). */
  const handlePlayFromRow = useCallback(async (step: number) => {
    return runWithActiveTurnInvalidation(async () => {
      await ensureAudio();
      await audioRef.current.resume();
      setSession((s) => playTransport(s, step));
    });
  }, [ensureAudio, runWithActiveTurnInvalidation]);

  /** Hard stop: stop sequencing AND immediately silence all voices/tails. */
  const handleHardStop = useCallback(async () => {
    return runWithActiveTurnInvalidation(async () => {
      await ensureAudio();
      transportControllerRef.current?.requestHardStop();
      setSession((s) => stopTransport(s));
    });
  }, [ensureAudio, runWithActiveTurnInvalidation]);

  const handleToggleTransportMode = useCallback(() => {
    void runWithActiveTurnInvalidation(() => {
      setSession(s => setTransportMode(s, (s.transport.mode ?? 'pattern') === 'pattern' ? 'song' : 'pattern'));
    });
  }, [runWithActiveTurnInvalidation]);

  const handleTransportModeChange = useCallback((mode: import('../engine/sequencer-types').TransportMode) => {
    void runWithActiveTurnInvalidation(() => {
      setSession(s => setTransportMode(s, mode));
    });
  }, [runWithActiveTurnInvalidation]);

  const handleLoopChange = useCallback((loop: boolean) => {
    void runWithActiveTurnInvalidation(() => {
      setSession(s => setTransportLoop(s, loop));
    });
  }, [runWithActiveTurnInvalidation]);

  // --- Audition handlers (chat inline preview) ---

  const handleAuditionStart = useCallback(async (config: import('./AuditionControl').AuditionConfig) => {
    // Stop any active audition before starting a new one — restore previous
    // snapshot inline since handleAuditionStop may not yet be defined.
    const prevSnapshot = auditionSnapshotRef.current;
    if (prevSnapshot) {
      transportControllerRef.current?.requestHardStop();
      setSession(prev => ({
        ...prev,
        tracks: prev.tracks.map(t => ({
          ...t,
          solo: prevSnapshot.soloStates[t.id] ?? false,
        })),
        transport: {
          ...prev.transport,
          loop: prevSnapshot.loopEnabled,
          mode: prevSnapshot.transportMode,
          status: prevSnapshot.wasPlaying ? 'playing' as const : 'stopped' as const,
        },
      }));
      auditionSnapshotRef.current = null;
      setActiveAuditionId(null);
    }

    if (!await ensureAudio()) return;
    await audioRef.current.resume();
    const s = sessionRef.current;

    // Snapshot current transport state
    const soloStates: Record<string, boolean> = {};
    for (const t of s.tracks) soloStates[t.id] = t.solo;
    auditionSnapshotRef.current = {
      soloStates,
      loopEnabled: s.transport.loop ?? true,
      transportMode: (s.transport.mode ?? 'pattern') as 'pattern' | 'song',
      wasPlaying: s.transport.status === 'playing',
    };

    // Create a unique ID for this audition
    const auditionId = `${config.trackIds.join('-')}-${config.barRange[0]}-${config.barRange[1]}`;
    setActiveAuditionId(auditionId);

    // Apply audition state: solo only listed tracks, set loop, start playback
    setSession(prev => {
      let next = { ...prev };
      // Solo only audition tracks
      next = {
        ...next,
        tracks: next.tracks.map(t => ({
          ...t,
          solo: config.trackIds.includes(t.id),
        })),
      };
      // Enable loop and set to pattern mode
      next = {
        ...next,
        transport: {
          ...next.transport,
          loop: config.loop,
          mode: 'pattern' as const,
          status: 'playing' as const,
        },
      };
      return next;
    });
  }, [ensureAudio]);

  const handleAuditionStop = useCallback(() => {
    const snapshot = auditionSnapshotRef.current;
    if (!snapshot) {
      setActiveAuditionId(null);
      return;
    }

    // Stop playback first
    transportControllerRef.current?.requestHardStop();

    // Restore snapshot
    setSession(prev => {
      let next = { ...prev };
      // Restore solo states
      next = {
        ...next,
        tracks: next.tracks.map(t => ({
          ...t,
          solo: snapshot.soloStates[t.id] ?? false,
        })),
      };
      // Restore transport settings
      next = {
        ...next,
        transport: {
          ...next.transport,
          loop: snapshot.loopEnabled,
          mode: snapshot.transportMode,
          status: snapshot.wasPlaying ? 'playing' as const : 'stopped' as const,
        },
      };
      return next;
    });

    auditionSnapshotRef.current = null;
    setActiveAuditionId(null);
  }, []);

  const handleTimeSignatureChange = useCallback((num: number, den: number) => {
    void runWithActiveTurnInvalidation(() => {
      setSession(s => setTimeSignature(s, num, den));
    });
  }, [runWithActiveTurnInvalidation]);

  const handleToggleRecord = useCallback(() => {
    setRecordArmed(prev => {
      const next = !prev;
      recordQaAudioTrace({
        type: 'recording.state',
        recordArmed: next,
      });
      return next;
    });
  }, []);

  const handleExportWav = useCallback(async (bars: number) => {
    setExportingWav(true);
    try {
      const blob = await renderOffline(sessionRef.current, undefined, bars, true);
      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.projectName || 'gluon-export'}-${bars}bar.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('WAV export failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setSession(prev => ({
        ...prev,
        messages: [
          ...prev.messages,
          { role: 'system' as const, text: `WAV export failed: ${msg}`, timestamp: Date.now() },
        ],
      }));
    } finally {
      setExportingWav(false);
    }
  }, [project.projectName]);

  // Push a single undo snapshot when a recording session starts (armed + playing).
  // The snapshot covers the entire session: from arm to disarm/stop.
  const isRecordingActive = recordArmed && session.transport.status === 'playing';
  useEffect(() => {
    if (isRecordingActive && !recordingSnapshotPushed.current) {
      // Snapshot the active track's region before recording starts
      const s = sessionRef.current;
      const track = getActiveTrack(s);
      const region = track && track.patterns.length > 0 ? getActivePattern(track) : undefined;
      if (region && track) {
        const snapshot: PatternEditSnapshot = {
          kind: 'pattern-edit',
          trackId: track.id,
          patternId: region.id,
          prevEvents: [...region.events],
          prevDuration: region.duration,
          prevHiddenEvents: track._hiddenEvents ? [...track._hiddenEvents] : undefined,
          timestamp: Date.now(),
          description: `Live recording on ${track.name ?? track.id}`,
        };
        setSession(s2 => ({
          ...s2,
          undoStack: [...s2.undoStack, snapshot],
        }));
        recordingSnapshotPushed.current = true;
      }
    }
    if (!isRecordingActive) {
      recordingSnapshotPushed.current = false;
    }
  }, [isRecordingActive]);

  // Callback for useKeyboardPiano to write recorded events into the region
  const handleRecordEvents = useCallback((trackId: string, events: NoteEvent[]) => {
    setSession(s => {
      const track = getTrack(s, trackId);
      if (track.patterns.length === 0) return s;
      const region = getActivePattern(track);

      // Ensure an undo snapshot exists for this recording session.
      // The useEffect above may not have fired yet (effects are async),
      // so push the snapshot here on first invocation if needed.
      let session = s;
      if (!recordingSnapshotPushed.current) {
        const snapshot: PatternEditSnapshot = {
          kind: 'pattern-edit',
          trackId: track.id,
          patternId: region.id,
          prevEvents: [...region.events],
          prevDuration: region.duration,
          prevHiddenEvents: track._hiddenEvents ? [...track._hiddenEvents] : undefined,
          timestamp: Date.now(),
          description: `Live recording on ${track.name ?? track.id}`,
        };
        session = {
          ...session,
          undoStack: [...session.undoStack, snapshot],
        };
        recordingSnapshotPushed.current = true;
      }

      // Overdub: merge new events with existing
      const merged = [...region.events, ...events];
      const updatedRegion = normalizePatternEvents({ ...region, events: merged });
      const newPatterns = track.patterns.map(r => r.id === region.id ? updatedRegion : r);

      // Reproject stepGrid (derived cache) and mark dirty for transport invalidation
      const reprojected = reprojectTrackStepGrid({ ...track, patterns: newPatterns });
      return updateTrack(session, trackId, {
        patterns: reprojected.patterns,
        stepGrid: reprojected.stepGrid,
        _patternDirty: true,
      });
    });
  }, []);

  const handleSelectTrack = useCallback((trackId: string) => {
    setSession((s) => {
      let next = setActiveTrack(s, trackId);
      // Auto-expand the selected track if it isn't already expanded
      const expanded = next.expandedTrackIds ?? [];
      if (!expanded.includes(trackId)) {
        next = { ...next, expandedTrackIds: [...expanded, trackId] };
      }
      return next;
    });
    setStepPage(0);
    setSelectedProcessorId(null);
    setSelectedModulatorId(null);
    setDeepViewModuleId(null);
  }, []);

  const handleToggleTrackExpanded = useCallback((trackId: string) => {
    setSession((s) => toggleTrackExpanded(s, trackId));
  }, []);

  const handleToggleMute = useCallback((trackId: string) => {
    void runWithActiveTurnInvalidation(() => {
      ensureAudio();
      setSession((s) => toggleMute(s, trackId));
    });
  }, [ensureAudio, runWithActiveTurnInvalidation]);

  const handleToggleSolo = useCallback((trackId: string, additive?: boolean) => {
    void runWithActiveTurnInvalidation(() => {
      ensureAudio();
      setSession((s) => toggleSolo(s, trackId, !additive));
    });
  }, [ensureAudio, runWithActiveTurnInvalidation]);

  const handleRenameTrack = useCallback((trackId: string, name: string) => {
    void runWithActiveTurnInvalidation(() => {
      setSession((s) => renameTrack(s, trackId, name));
    });
  }, [runWithActiveTurnInvalidation]);

  const handleSetMusicalRole = useCallback((trackId: string, role: string) => {
    void runWithActiveTurnInvalidation(() => {
      setSession((s) => {
        const track = s.tracks.find(t => t.id === trackId);
        if (!track) return s;
        const snapshot: TrackPropertySnapshot = {
          kind: 'track-property',
          trackId,
          prevProps: { importance: track.importance, musicalRole: track.musicalRole },
          timestamp: Date.now(),
          description: `Set musical role: ${track.musicalRole ?? 'unset'} → ${role}`,
        };
        // Default importance to 0.5 if unset — AI's set_track_meta requires importance before musicalRole
        const importance = track.importance ?? 0.5;
        const next = setTrackImportance(s, trackId, importance, role);
        return { ...next, undoStack: [...next.undoStack, snapshot] };
      });
    });
  }, [runWithActiveTurnInvalidation]);

  const handleSetImportance = useCallback((trackId: string, importance: number) => {
    void runWithActiveTurnInvalidation(() => {
      arbRef.current.humanTouched(trackId, 'importance', importance, 'meta');
      setSession((s) => {
        const track = s.tracks.find(t => t.id === trackId);
        if (!track) return s;
        const snapshot: TrackPropertySnapshot = {
          kind: 'track-property',
          trackId,
          prevProps: { importance: track.importance, musicalRole: track.musicalRole },
          timestamp: Date.now(),
          description: `Set importance: ${Math.round((track.importance ?? 0.5) * 100)}% → ${Math.round(importance * 100)}%`,
        };
        const next = setTrackImportance(s, trackId, importance);
        return { ...next, undoStack: [...next.undoStack, snapshot] };
      });
    });
  }, [runWithActiveTurnInvalidation]);

  // --- Track mix strip gesture-level undo ---
  const mixStripUndoRef = useRef<{
    trackId: string;
    prevVolume: number;
    prevPan: number;
  } | null>(null);

  const handleChangeVolume = useCallback((trackId: string, value: number) => {
    ensureAudio();
    // During a gesture, suppress per-frame undo snapshots
    if (mixStripUndoRef.current) {
      setSession((s) => setTrackVolumeNoUndo(s, trackId, value));
    } else {
      setSession((s) => setTrackVolume(s, trackId, value));
    }
  }, [ensureAudio]);

  const handleChangePan = useCallback((trackId: string, value: number) => {
    ensureAudio();
    if (mixStripUndoRef.current) {
      setSession((s) => setTrackPanNoUndo(s, trackId, value));
    } else {
      setSession((s) => setTrackPan(s, trackId, value));
    }
  }, [ensureAudio]);

  const handleMixStripInteractionStart = useCallback(() => {
    void runWithActiveTurnInvalidation(() => {
      const s = sessionRef.current;
      const track = getActiveTrack(s);
      mixStripUndoRef.current = {
        trackId: s.activeTrackId,
        prevVolume: track.volume,
        prevPan: track.pan,
      };
    });
  }, [runWithActiveTurnInvalidation]);

  const handleMixStripInteractionEnd = useCallback(() => {
    const captured = mixStripUndoRef.current;
    if (!captured) return;
    mixStripUndoRef.current = null;
    setSession((s) => {
      const track = s.tracks.find(t => t.id === captured.trackId);
      if (!track) return s;
      // Check if anything actually changed
      const volChanged = Math.abs(track.volume - captured.prevVolume) > 0.001;
      const panChanged = Math.abs(track.pan - captured.prevPan) > 0.001;
      if (!volChanged && !panChanged) return s;
      const prevProps: Partial<import('../engine/types').Track> = {};
      if (volChanged) prevProps.volume = captured.prevVolume;
      if (panChanged) prevProps.pan = captured.prevPan;
      const snapshot: TrackPropertySnapshot = {
        kind: 'track-property',
        trackId: captured.trackId,
        prevProps,
        timestamp: Date.now(),
        description: `Mix strip: ${[volChanged && 'volume', panChanged && 'pan'].filter(Boolean).join(', ')}`,
      };
      return { ...s, undoStack: [...s.undoStack, snapshot] };
    });
  }, []);

  const handleAddTrack = useCallback((kind?: import('../engine/types').TrackKind) => {
    void runWithActiveTurnInvalidation(() => {
      setSession((s) => {
        const result = addTrack(s, kind ?? 'audio');
        if (!result) return s;
        // Audio engine slot is provisioned by the sync effect watching session.tracks
        return result;
      });
      setSelectedProcessorId(null);
      setSelectedModulatorId(null);
      setDeepViewModuleId(null);
      setView((current) => (current === 'chat' ? 'surface' : current));
    });
  }, [runWithActiveTurnInvalidation]);

  const handleRemoveTrack = useCallback((trackId: string) => {
    void runWithActiveTurnInvalidation(() => {
      setSession((s) => {
        const result = removeTrack(s, trackId);
        if (!result) return s;
        // Audio engine slot is torn down by the sync effect watching session.tracks
        return result;
      });
      setSelectedProcessorId(null);
      setSelectedModulatorId(null);
      setDeepViewModuleId(null);
    });
  }, [runWithActiveTurnInvalidation]);

  const handleAddSend = useCallback((trackId: string, busId: string, level?: number) => {
    void runWithActiveTurnInvalidation(() => {
      setSession((s) => addSend(s, trackId, busId, level) ?? s);
    });
  }, [runWithActiveTurnInvalidation]);

  const handleRemoveSend = useCallback((trackId: string, busId: string) => {
    void runWithActiveTurnInvalidation(() => {
      setSession((s) => removeSend(s, trackId, busId) ?? s);
    });
  }, [runWithActiveTurnInvalidation]);

  const handleSetSendLevel = useCallback((trackId: string, busId: string, level: number) => {
    void runWithActiveTurnInvalidation(() => {
      setSession((s) => setSendLevel(s, trackId, busId, level));
    });
  }, [runWithActiveTurnInvalidation]);

  // --- Master strip gesture-level undo ---
  const masterStripUndoRef = useRef<{
    prevVolume: number;
    prevPan: number;
  } | null>(null);

  const handleMasterVolumeChange = useCallback((v: number) => {
    ensureAudio();
    if (masterStripUndoRef.current) {
      setSession((s) => setMasterNoUndo(s, { volume: v }));
    } else {
      setSession((s) => setMaster(s, { volume: v }));
    }
  }, [ensureAudio]);

  const handleMasterPanChange = useCallback((p: number) => {
    ensureAudio();
    if (masterStripUndoRef.current) {
      setSession((s) => setMasterNoUndo(s, { pan: p }));
    } else {
      setSession((s) => setMaster(s, { pan: p }));
    }
  }, [ensureAudio]);

  const handleMasterInteractionStart = useCallback(() => {
    void runWithActiveTurnInvalidation(() => {
      const s = sessionRef.current;
      masterStripUndoRef.current = {
        prevVolume: s.master.volume,
        prevPan: s.master.pan,
      };
    });
  }, [runWithActiveTurnInvalidation]);

  const handleMasterInteractionEnd = useCallback(() => {
    const captured = masterStripUndoRef.current;
    if (!captured) return;
    masterStripUndoRef.current = null;
    setSession((s) => {
      const volChanged = Math.abs(s.master.volume - captured.prevVolume) > 0.001;
      const panChanged = Math.abs(s.master.pan - captured.prevPan) > 0.001;
      if (!volChanged && !panChanged) return s;
      const snapshot: MasterSnapshot = {
        kind: 'master',
        prevMaster: { volume: captured.prevVolume, pan: captured.prevPan },
        timestamp: Date.now(),
        description: `Master: ${[volChanged && 'volume', panChanged && 'pan'].filter(Boolean).join(', ')}`,
      };
      return { ...s, undoStack: [...s.undoStack, snapshot] };
    });
  }, []);

  // --- Transport (BPM/swing) gesture-level undo ---
  // DraggableNumber calls onChange per frame (no undo) and onCommit once at drag end.
  // We capture pre-gesture transport state on the first onChange and push the snapshot on commit.
  const transportPreGestureRef = useRef<import('../engine/types').Transport | null>(null);

  const handleTransportCommit = useCallback((_field: 'bpm' | 'swing', _value: number) => {
    const captured = transportPreGestureRef.current;
    if (!captured) return;
    transportPreGestureRef.current = null;
    setSession((s) => {
      const snapshot: TransportSnapshot = {
        kind: 'transport',
        prevTransport: captured,
        timestamp: Date.now(),
        description: _field === 'bpm' ? `Set BPM` : `Set swing`,
      };
      return { ...s, undoStack: [...s.undoStack, snapshot] };
    });
  }, []);

  const _handleStepToggle = useCallback((stepIndex: number) => {
    ensureAudio();
    setSession((s) => toggleStepGate(s, s.activeTrackId, stepIndex));
  }, [ensureAudio]);

  const handleSurfaceStepToggle = useCallback((trackId: string, stepIndex: number, patternId?: string, options?: { pushUndo?: boolean }) => {
    ensureAudio();
    setSession((s) => toggleStepGate(s, trackId, stepIndex, patternId, options));
  }, [ensureAudio]);

  const handleSurfaceStepAccentToggle = useCallback((trackId: string, stepIndex: number, patternId?: string) => {
    ensureAudio();
    setSession((s) => toggleStepAccent(s, trackId, stepIndex, patternId));
  }, [ensureAudio]);

  const handlePaintComplete = useCallback((trackId: string, patternId: string | undefined, prevEvents: import('../engine/canonical-types').MusicalEvent[]) => {
    setSession((s) => {
      const track = getTrack(s, trackId);
      const pattern = patternId ? track.patterns.find(p => p.id === patternId) : getActivePattern(track);
      if (!pattern) return s;
      const snapshot: PatternEditSnapshot = {
        kind: 'pattern-edit',
        trackId,
        patternId: pattern.id,
        prevEvents,
        timestamp: Date.now(),
        description: 'Paint steps',
      };
      return { ...s, undoStack: [...s.undoStack, snapshot] };
    });
  }, []);

  const _handleStepAccent = useCallback((stepIndex: number) => {
    ensureAudio();
    setSession((s) => toggleStepAccent(s, s.activeTrackId, stepIndex));
  }, [ensureAudio]);

  const handlePatternLength = useCallback((length: number) => {
    ensureAudio();
    setSession((s) => setPatternLength(s, s.activeTrackId, length));
    setStepPage(0);
  }, [ensureAudio]);

  const handleClearPattern = useCallback(() => {
    ensureAudio();
    setSession((s) => clearPattern(s, s.activeTrackId));
  }, [ensureAudio]);

  const handleEventUpdate = useCallback((selector: EventSelector, updates: Partial<MusicalEvent>) => {
    setSession((s) => updateEvent(s, s.activeTrackId, selector, updates));
  }, []);

  const handleEventDelete = useCallback((selector: EventSelector) => {
    setSession((s) => removeEvent(s, s.activeTrackId, selector));
  }, []);

  const handleEventAdd = useCallback((_step: number, event: MusicalEvent) => {
    setSession((s) => addEvent(s, s.activeTrackId, event));
  }, []);

  const handleDeleteByIndices = useCallback((indices: number[]) => {
    setSession((s) => removeEventsByIndices(s, s.activeTrackId, indices));
  }, []);

  const handlePasteEvents = useCallback((events: MusicalEvent[]) => {
    setSession((s) => addEvents(s, s.activeTrackId, events));
  }, []);

  const handleTransposeByIndices = useCallback((indices: number[], semitones: number) => {
    setSession((s) => transposeEventsByIndices(s, s.activeTrackId, indices, semitones));
  }, []);

  const handleQuantize = useCallback(() => {
    setSession((s) => quantizeRegion(s, s.activeTrackId));
  }, []);

  const handleRotate = useCallback((steps: number) => {
    setSession((s) => rotateRegion(s, s.activeTrackId, steps));
  }, []);

  const handleTranspose = useCallback((semitones: number) => {
    setSession((s) => transposeRegion(s, s.activeTrackId, semitones));
  }, []);

  const handleReverse = useCallback(() => {
    setSession((s) => reverseRegion(s, s.activeTrackId));
  }, []);

  const handleDuplicate = useCallback(() => {
    setSession((s) => duplicateRegionEvents(s, s.activeTrackId));
  }, []);

  // --- Region CRUD ---
  const handleAddRegion = useCallback(() => {
    setSession((s) => addPattern(s, s.activeTrackId) ?? s);
  }, []);

  const handleRemoveRegion = useCallback((patternId: string) => {
    setSession((s) => removePattern(s, s.activeTrackId, patternId) ?? s);
  }, []);

  const handleDuplicateRegion = useCallback((patternId: string) => {
    setSession((s) => duplicatePattern(s, s.activeTrackId, patternId) ?? s);
  }, []);

  const handleRenameRegion = useCallback((patternId: string, name: string) => {
    setSession((s) => renamePattern(s, s.activeTrackId, patternId, name));
  }, []);

  const handleSetActiveRegion = useCallback((patternId: string) => {
    setSession((s) => setActivePatternOnTrack(s, s.activeTrackId, patternId));
  }, []);

  // --- Sequence (arrangement) editing ---
  const handleAddPatternRef = useCallback((patternId: string) => {
    setSession((s) => addPatternRef(s, s.activeTrackId, patternId));
  }, []);

  const handleRemovePatternRef = useCallback((sequenceIndex: number) => {
    setSession((s) => removePatternRef(s, s.activeTrackId, sequenceIndex));
  }, []);

  const handleReorderPatternRef = useCallback((fromIndex: number, toIndex: number) => {
    setSession((s) => reorderPatternRef(s, s.activeTrackId, fromIndex, toIndex));
  }, []);

  const handleSetSequenceAutomation = useCallback((controlId: string, points: SequenceAutomationPoint[]) => {
    setSession((s) => setSequenceAutomation(s, s.activeTrackId, controlId, points));
  }, []);

  const handleClearSequenceAutomation = useCallback((controlId: string) => {
    setSession((s) => clearSequenceAutomation(s, s.activeTrackId, controlId));
  }, []);

  const _handleAddView = useCallback((kind: SequencerViewKind) => {
    setSession((s) => addView(s, s.activeTrackId, kind));
  }, []);

  const _handleRemoveView = useCallback((viewId: string) => {
    setSession((s) => removeView(s, s.activeTrackId, viewId));
  }, []);

  // Capture processor state at drag start for single-gesture undo
  const processorUndoRef = useRef<{
    trackId: string;
    processorId: string;
    prevParams: Record<string, number>;
    prevModel: number;
  } | null>(null);

  const handleProcessorInteractionStart = useCallback((processorId: string) => {
    const s = sessionRef.current;
    const track = getActiveTrack(s);
    const proc = (track.processors ?? []).find(p => p.id === processorId);
    if (!proc) return;
    processorUndoRef.current = {
      trackId: s.activeTrackId,
      processorId,
      prevParams: { ...proc.params },
      prevModel: proc.model,
    };
  }, []);

  const handleProcessorInteractionEnd = useCallback((processorId: string) => {
    const captured = processorUndoRef.current;
    if (!captured || captured.processorId !== processorId) return;
    processorUndoRef.current = null;
    setSession((s) => {
      const track = getTrack(s, captured.trackId);
      const proc = (track.processors ?? []).find(p => p.id === processorId);
      if (!proc) return s;
      // Check if anything actually changed (including new params not in prevParams)
      const allKeys = new Set([...Object.keys(captured.prevParams), ...Object.keys(proc.params)]);
      const changed = [...allKeys].some(
        k => Math.abs((proc.params[k] ?? 0) - (captured.prevParams[k] ?? 0)) > 0.001
      );
      if (!changed) return s;
      const snapshot: ProcessorStateSnapshot = {
        kind: 'processor-state',
        trackId: captured.trackId,
        processorId,
        prevParams: captured.prevParams,
        prevModel: captured.prevModel,
        timestamp: Date.now(),
        description: `Processor param change`,
      };
      return { ...s, undoStack: [...s.undoStack, snapshot] };
    });
  }, []);

  const handleProcessorParamChange = useCallback((processorId: string, param: string, value: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeTrackId;
    arbRef.current.humanTouched(vid, param, value, `processor:${processorId}`);
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const proc = (track.processors ?? []).find(p => p.id === processorId);
      if (!proc) return s;

      const prevValue = proc.params[param] ?? 0;
      if (Math.abs(value - prevValue) < 0.001) return s;

      const updatedProc = { ...proc, params: { ...proc.params, [param]: value } };
      const updatedTrack = {
        ...track,
        processors: (track.processors ?? []).map(p => p.id === processorId ? updatedProc : p),
      };
      return {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? updatedTrack : v),
      };
    });
  }, [ensureAudio]);

  const handleProcessorModelChange = useCallback((processorId: string, model: number) => {
    ensureAudio();
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const proc = (track.processors ?? []).find(p => p.id === processorId);
      if (!proc || proc.model === model) return s;

      const updatedProc = { ...proc, model };
      const updatedTrack = {
        ...track,
        processors: (track.processors ?? []).map(p => p.id === processorId ? updatedProc : p),
      };
      const snapshot: ProcessorStateSnapshot = {
        kind: 'processor-state',
        trackId: vid,
        processorId,
        prevParams: { ...proc.params },
        prevModel: proc.model,
        timestamp: Date.now(),
        description: `Processor model change`,
      };
      return {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? updatedTrack : v),
        undoStack: [...s.undoStack, snapshot],
      };
    });
  }, [ensureAudio]);

  const handleRemoveProcessor = useCallback((processorId: string) => {
    ensureAudio();
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const processors = track.processors ?? [];
      if (!processors.some(p => p.id === processorId)) return s;
      const prevModulations = track.modulations ?? [];
      const filteredModulations = prevModulations.filter(
        route => route.target.kind !== 'processor' || route.target.processorId !== processorId,
      );

      const processorSnapshot: ProcessorSnapshot = {
        kind: 'processor',
        trackId: vid,
        prevProcessors: processors.map(p => ({ ...p, params: { ...p.params } })),
        timestamp: Date.now(),
        description: `Remove processor`,
      };
      const snapshots: UndoEntry[] = [processorSnapshot];
      if (filteredModulations.length !== prevModulations.length) {
        snapshots.push({
          kind: 'modulation-routing',
          trackId: vid,
          prevModulations: prevModulations.map(route => ({ ...route })),
          timestamp: Date.now(),
          description: `Remove processor routings`,
        });
      }
      const updatedTrack = {
        ...track,
        processors: processors.filter(p => p.id !== processorId),
        modulations: filteredModulations,
      };
      const undoEntry: UndoEntry = snapshots.length === 1 ? snapshots[0] : {
        kind: 'group',
        snapshots,
        timestamp: Date.now(),
        description: 'Remove processor and dependent modulation routes',
      } as ActionGroupSnapshot;
      const next: Session = {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? updatedTrack : v),
        undoStack: [...s.undoStack, undoEntry],
      };
      return maybeApplySurfaceTemplate(next, vid, undoEntry.description);
    });
    setSelectedProcessorId(null);
  }, [ensureAudio]);

  const handleToggleProcessorEnabled = useCallback((processorId: string) => {
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const processors = track.processors ?? [];
      const proc = processors.find(p => p.id === processorId);
      if (!proc) return s;

      const snapshot: ProcessorSnapshot = {
        kind: 'processor',
        trackId: vid,
        prevProcessors: processors.map(p => ({ ...p, params: { ...p.params } })),
        timestamp: Date.now(),
        description: proc.enabled === false ? 'Enable processor' : 'Bypass processor',
      };

      const newEnabled = proc.enabled === false ? undefined : false;
      return {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? {
          ...v,
          processors: processors.map(p => p.id === processorId ? { ...p, enabled: newEnabled } : p),
        } : v),
        undoStack: [...s.undoStack, snapshot],
      };
    });
  }, []);

  // Capture modulator state at drag start for single-gesture undo
  const modulatorUndoRef = useRef<{
    trackId: string;
    modulatorId: string;
    prevParams: Record<string, number>;
    prevModel: number;
  } | null>(null);

  const handleModulatorInteractionStart = useCallback((modulatorId: string) => {
    const s = sessionRef.current;
    const track = getActiveTrack(s);
    const mod = (track.modulators ?? []).find(m => m.id === modulatorId);
    if (!mod) return;
    modulatorUndoRef.current = {
      trackId: s.activeTrackId,
      modulatorId,
      prevParams: { ...mod.params },
      prevModel: mod.model,
    };
  }, []);

  const handleModulatorInteractionEnd = useCallback((modulatorId: string) => {
    const captured = modulatorUndoRef.current;
    if (!captured || captured.modulatorId !== modulatorId) return;
    modulatorUndoRef.current = null;
    setSession((s) => {
      const track = getTrack(s, captured.trackId);
      const mod = (track.modulators ?? []).find(m => m.id === modulatorId);
      if (!mod) return s;
      const allKeys = new Set([...Object.keys(captured.prevParams), ...Object.keys(mod.params)]);
      const changed = [...allKeys].some(
        k => Math.abs((mod.params[k] ?? 0) - (captured.prevParams[k] ?? 0)) > 0.001
      );
      if (!changed) return s;
      const snapshot: ModulatorStateSnapshot = {
        kind: 'modulator-state',
        trackId: captured.trackId,
        modulatorId,
        prevParams: captured.prevParams,
        prevModel: captured.prevModel,
        timestamp: Date.now(),
        description: `Modulator param change`,
      };
      return { ...s, undoStack: [...s.undoStack, snapshot] };
    });
  }, []);

  const handleModulatorParamChange = useCallback((modulatorId: string, param: string, value: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeTrackId;
    arbRef.current.humanTouched(vid, param, value, `modulator:${modulatorId}`);
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const mod = (track.modulators ?? []).find(m => m.id === modulatorId);
      if (!mod) return s;

      const prevValue = mod.params[param] ?? 0;
      if (Math.abs(value - prevValue) < 0.001) return s;

      const updatedMod = { ...mod, params: { ...mod.params, [param]: value } };
      const updatedTrack = {
        ...track,
        modulators: (track.modulators ?? []).map(m => m.id === modulatorId ? updatedMod : m),
      };
      return {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? updatedTrack : v),
      };
    });
  }, [ensureAudio]);

  const handleModulatorModelChange = useCallback((modulatorId: string, model: number) => {
    ensureAudio();
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const mod = (track.modulators ?? []).find(m => m.id === modulatorId);
      if (!mod || mod.model === model) return s;

      const updatedMod = { ...mod, model };
      const updatedTrack = {
        ...track,
        modulators: (track.modulators ?? []).map(m => m.id === modulatorId ? updatedMod : m),
      };
      const snapshot: ModulatorStateSnapshot = {
        kind: 'modulator-state',
        trackId: vid,
        modulatorId,
        prevParams: { ...mod.params },
        prevModel: mod.model,
        timestamp: Date.now(),
        description: `Modulator model change`,
      };
      return {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? updatedTrack : v),
        undoStack: [...s.undoStack, snapshot],
      };
    });
  }, [ensureAudio]);

  const handleRemoveModulator = useCallback((modulatorId: string) => {
    ensureAudio();
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const modulators = track.modulators ?? [];
      if (!modulators.some(m => m.id === modulatorId)) return s;

      const snapshot: ModulatorSnapshot = {
        kind: 'modulator',
        trackId: vid,
        prevModulators: modulators.map(m => ({ ...m, params: { ...m.params } })),
        prevModulations: (track.modulations ?? []).map(r => ({ ...r })),
        timestamp: Date.now(),
        description: `Remove modulator`,
      };
      const updatedTrack = {
        ...track,
        modulators: modulators.filter(m => m.id !== modulatorId),
        modulations: (track.modulations ?? []).filter(r => r.modulatorId !== modulatorId),
      };
      return {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? updatedTrack : v),
        undoStack: [...s.undoStack, snapshot],
      };
    });
    setSelectedModulatorId(null);
  }, [ensureAudio]);

  // Capture pre-drag modulation state for single-gesture undo
  const modulationUndoRef = useRef<{
    trackId: string;
    prevModulations: import('../engine/types').ModulationRouting[];
  } | null>(null);

  const handleModulationDepthChange = useCallback((routeId: string, depth: number) => {
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const modulations = track.modulations ?? [];
      const route = modulations.find(r => r.id === routeId);
      if (!route) return s;
      // Capture prev state on first change of a drag gesture
      if (!modulationUndoRef.current) {
        modulationUndoRef.current = {
          trackId: vid,
          prevModulations: modulations.map(r => ({ ...r })),
        };
      }
      return {
        ...s,
        tracks: s.tracks.map(v => v.id === vid
          ? { ...track, modulations: modulations.map(r => r.id === routeId ? { ...r, depth } : r) }
          : v),
      };
    });
  }, []);

  const handleModulationDepthCommit = useCallback((routeId: string, depth: number) => {
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const modulations = track.modulations ?? [];
      const captured = modulationUndoRef.current;
      modulationUndoRef.current = null;
      // Apply final depth value
      const updatedModulations = modulations.map(r => r.id === routeId ? { ...r, depth } : r);
      // Only push undo if we have a captured prev state (from onChange during drag)
      if (!captured) return s;
      const snapshot: ModulationRoutingSnapshot = {
        kind: 'modulation-routing',
        trackId: vid,
        prevModulations: captured.prevModulations,
        timestamp: Date.now(),
        description: 'Edit modulation depth',
      };
      return {
        ...s,
        tracks: s.tracks.map(v => v.id === vid
          ? { ...track, modulations: updatedModulations }
          : v),
        undoStack: [...s.undoStack, snapshot],
      };
    });
  }, []);

  const handleRemoveModulation = useCallback((routeId: string) => {
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const modulations = track.modulations ?? [];
      if (!modulations.some(r => r.id === routeId)) return s;
      const snapshot: ModulationRoutingSnapshot = {
        kind: 'modulation-routing',
        trackId: vid,
        prevModulations: modulations.map(r => ({ ...r })),
        timestamp: Date.now(),
        description: 'Remove modulation route',
      };
      return {
        ...s,
        tracks: s.tracks.map(v => v.id === vid
          ? { ...track, modulations: modulations.filter(r => r.id !== routeId) }
          : v),
        undoStack: [...s.undoStack, snapshot],
      };
    });
  }, []);

  const handleConnectModulator = useCallback((modulatorId: string, target: ModulationTarget, depth: number) => {
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const modulations = track.modulations ?? [];
      const prevModulations = modulations.map(r => ({ ...r }));
      // Check for existing route with same identity
      const existingIdx = modulations.findIndex(r =>
        r.modulatorId === modulatorId &&
        r.target.kind === target.kind &&
        r.target.param === target.param &&
        (target.kind === 'source' || (target.kind === 'processor' && r.target.kind === 'processor' && r.target.processorId === target.processorId))
      );
      let newModulations: ModulationRouting[];
      if (existingIdx >= 0) {
        // Update depth on existing route
        newModulations = [...modulations];
        newModulations[existingIdx] = { ...newModulations[existingIdx], depth };
      } else {
        // Create new route
        const newRouting: ModulationRouting = {
          id: `mod-${Date.now()}`,
          modulatorId,
          target,
          depth,
        };
        newModulations = [...modulations, newRouting];
      }
      const snapshot: ModulationRoutingSnapshot = {
        kind: 'modulation-routing',
        trackId: vid,
        prevModulations,
        timestamp: Date.now(),
        description: 'Connect modulation route',
      };
      return {
        ...s,
        tracks: s.tracks.map(v => v.id === vid
          ? { ...track, modulations: newModulations }
          : v),
        undoStack: [...s.undoStack, snapshot],
      };
    });
  }, []);

  // --- Semantic control handlers ---
  // Maps canonical controlId → runtime param for source controls.
  // After #392, most are identity (timbre→timbre, harmonics→harmonics, morph→morph).
  // Only frequency→note still needs explicit mapping.
  const semanticCanonicalToRuntime: Record<string, string> = {
    frequency: 'note',
  };

  const semanticUndoRef = useRef<{
    trackId: string;
    prevSourceParams: Partial<SynthParamValues>;
    prevProcessorParams: Map<string, Record<string, number>>;
    prevProvenance?: Partial<ControlState>;
  } | null>(null);

  const _handleSemanticInteractionStart = useCallback((def: SemanticControlDef) => {
    const s = sessionRef.current;
    const track = getActiveTrack(s);
    // Capture prev values for all params this semantic control touches
    const prevSourceParams: Partial<SynthParamValues> = {};
    const prevProcessorParams = new Map<string, Record<string, number>>();
    // #1168: capture prevProvenance for source params touched by semantic knob
    const prevProvenance: Partial<ControlState> = {};

    for (const w of def.weights) {
      if (w.moduleId === 'source') {
        const runtimeKey = semanticCanonicalToRuntime[w.controlId] ?? w.controlId;
        prevSourceParams[runtimeKey] = track.params[runtimeKey] ?? 0.5;
        // Mark as human-touched for arbitration
        arbRef.current.humanTouched(s.activeTrackId, runtimeKey, track.params[runtimeKey] ?? 0.5, 'source');
        // Capture provenance for undo
        const cid = plaitsAdapter.mapRuntimeParamKey(runtimeKey);
        if (cid && track.controlProvenance?.[cid]) {
          prevProvenance[cid] = { ...track.controlProvenance[cid] };
        }
      } else {
        const proc = (track.processors ?? []).find(p => p.id === w.moduleId);
        if (proc) {
          if (!prevProcessorParams.has(proc.id)) {
            prevProcessorParams.set(proc.id, { ...proc.params });
          }
          arbRef.current.humanTouched(s.activeTrackId, w.controlId, proc.params[w.controlId] ?? 0.5, `processor:${proc.id}`);
        }
      }
    }

    semanticUndoRef.current = {
      trackId: s.activeTrackId,
      prevSourceParams,
      prevProcessorParams,
      prevProvenance: Object.keys(prevProvenance).length > 0 ? prevProvenance : undefined,
    };
  }, []);

  const _handleSemanticInteractionEnd = useCallback((_def: SemanticControlDef) => {
    const captured = semanticUndoRef.current;
    if (!captured) return;
    semanticUndoRef.current = null;

    setSession((s) => {
      const track = getTrack(s, captured.trackId);
      const snapshots: Snapshot[] = [];

      // Check source param changes (union of prev + current keys)
      if (Object.keys(captured.prevSourceParams).length > 0) {
        const currentValues: Partial<SynthParamValues> = {};
        const allSrcKeys = new Set([
          ...Object.keys(captured.prevSourceParams),
          ...Object.keys(track.params),
        ]);
        for (const param of allSrcKeys) {
          const prev = (captured.prevSourceParams as Record<string, number>)[param] ?? 0;
          const cur = track.params[param] ?? 0;
          if (Math.abs(cur - prev) > 0.001) {
            currentValues[param] = cur;
          }
        }
        if (Object.keys(currentValues).length > 0) {
          snapshots.push({
            kind: 'param',
            trackId: captured.trackId,
            prevValues: captured.prevSourceParams,
            aiTargetValues: currentValues,
            prevProvenance: captured.prevProvenance,
            timestamp: Date.now(),
            description: 'Semantic knob change (source)',
          });
        }
      }

      // Check processor param changes (union of prev + current keys)
      for (const [procId, prevParams] of captured.prevProcessorParams) {
        const proc = (track.processors ?? []).find(p => p.id === procId);
        if (!proc) continue;
        const allProcKeys = new Set([...Object.keys(prevParams), ...Object.keys(proc.params)]);
        const changed = [...allProcKeys].some(
          k => Math.abs((proc.params[k] ?? 0) - (prevParams[k] ?? 0)) > 0.001
        );
        if (changed) {
          snapshots.push({
            kind: 'processor-state',
            trackId: captured.trackId,
            processorId: procId,
            prevParams,
            prevModel: proc.model,
            timestamp: Date.now(),
            description: 'Semantic knob change (processor)',
          });
        }
      }

      if (snapshots.length === 0) return s;

      const entry: UndoEntry = snapshots.length === 1
        ? snapshots[0]
        : {
            kind: 'group',
            snapshots,
            timestamp: Date.now(),
            description: 'Semantic knob change',
          } as ActionGroupSnapshot;

      return { ...s, undoStack: [...s.undoStack, entry] };
    });
  }, []);

  const _handleSemanticChange = useCallback((def: SemanticControlDef, knobValue: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeTrackId;

    setSession((s) => {
      const track = getTrack(s, vid);
      const updates = computeSemanticRawUpdates(track, def, knobValue);

      let updatedTrack = { ...track };

      for (const u of updates) {
        if (u.moduleId === 'source') {
          const runtimeKey = semanticCanonicalToRuntime[u.controlId] ?? u.controlId;
          updatedTrack = {
            ...updatedTrack,
            params: { ...updatedTrack.params, [runtimeKey]: u.value },
          };
        } else {
          const processors = updatedTrack.processors ?? [];
          updatedTrack = {
            ...updatedTrack,
            processors: processors.map(p =>
              p.id === u.moduleId
                ? { ...p, params: { ...p.params, [u.controlId]: u.value } }
                : p
            ),
          };
        }
      }

      return {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? updatedTrack : v),
      };
    });
  }, [ensureAudio]);

  const handleAddProcessor = useCallback((type: string) => {
    ensureAudio();
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const processors = track.processors ?? [];
      const newProcessor = {
        id: crypto.randomUUID(),
        type,
        model: 0,
        params: getProcessorDefaultParams(type, 0),
      };
      const snapshot: ProcessorSnapshot = {
        kind: 'processor',
        trackId: vid,
        prevProcessors: processors.map(p => ({ ...p, params: { ...p.params } })),
        timestamp: Date.now(),
        description: `Add ${type} processor`,
      };
      const next: Session = {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? { ...track, processors: [...processors, newProcessor] } : v),
        undoStack: [...s.undoStack, snapshot],
      };
      return maybeApplySurfaceTemplate(next, vid, snapshot.description);
    });
  }, [ensureAudio]);

  const handleReplaceProcessor = useCallback((processorId: string, newModuleType: string) => {
    ensureAudio();
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const processors = track.processors ?? [];
      const idx = processors.findIndex(p => p.id === processorId);
      if (idx === -1) return s;
      const prevModulations = track.modulations ?? [];
      const filteredModulations = prevModulations.filter(
        route => route.target.kind !== 'processor' || route.target.processorId !== processorId,
      );
      const newProcessor = {
        id: crypto.randomUUID(),
        type: newModuleType,
        model: 0,
        params: getProcessorDefaultParams(newModuleType, 0),
      };
      const newProcessors = [...processors];
      newProcessors[idx] = newProcessor;
      const processorSnapshot: ProcessorSnapshot = {
        kind: 'processor',
        trackId: vid,
        prevProcessors: processors.map(p => ({ ...p, params: { ...p.params } })),
        timestamp: Date.now(),
        description: `Swap processor: ${processors[idx].type} → ${newModuleType}`,
      };
      const snapshots: UndoEntry[] = [processorSnapshot];
      if (filteredModulations.length !== prevModulations.length) {
        snapshots.push({
          kind: 'modulation-routing',
          trackId: vid,
          prevModulations: prevModulations.map(route => ({ ...route })),
          timestamp: Date.now(),
          description: `Swap processor: clear dependent modulation routes`,
        });
      }
      const undoEntry: UndoEntry = snapshots.length === 1 ? snapshots[0] : {
        kind: 'group',
        snapshots,
        timestamp: Date.now(),
        description: `Swap processor: ${processors[idx].type} → ${newModuleType}`,
      } as ActionGroupSnapshot;
      const next: Session = {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? {
          ...track,
          processors: newProcessors,
          modulations: filteredModulations,
        } : v),
        undoStack: [...s.undoStack, undoEntry],
      };
      return maybeApplySurfaceTemplate(next, vid, undoEntry.description);
    });
  }, [ensureAudio]);

  const handleAddModulator = useCallback((type: string) => {
    ensureAudio();
    setSession((s) => {
      const vid = s.activeTrackId;
      const track = getTrack(s, vid);
      const modulators = track.modulators ?? [];
      const newModulator = {
        id: crypto.randomUUID(),
        type,
        model: 1, // default to Looping mode
        params: getModulatorDefaultParams(type, 1),
      };
      const snapshot: ModulatorSnapshot = {
        kind: 'modulator',
        trackId: vid,
        prevModulators: modulators.map(m => ({ ...m, params: { ...m.params } })),
        prevModulations: (track.modulations ?? []).map(r => ({ ...r })),
        timestamp: Date.now(),
        description: `Add ${type} modulator`,
      };
      return {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? { ...track, modulators: [...modulators, newModulator] } : v),
        undoStack: [...s.undoStack, snapshot],
      };
    });
  }, [ensureAudio]);

  // Track up/down navigation for keyboard shortcuts
  const handleTrackUp = useCallback(() => {
    setSession((s) => {
      const ordered = getOrderedTracks(s);
      const idx = ordered.findIndex(t => t.id === s.activeTrackId);
      if (idx <= 0) return s;
      return setActiveTrack(s, ordered[idx - 1].id);
    });
  }, []);

  const handleTrackDown = useCallback(() => {
    setSession((s) => {
      const ordered = getOrderedTracks(s);
      const idx = ordered.findIndex(t => t.id === s.activeTrackId);
      if (idx < 0 || idx >= ordered.length - 1) return s;
      return setActiveTrack(s, ordered[idx + 1].id);
    });
  }, []);

  const handleBpmNudge = useCallback((delta: number) => {
    ensureAudio();
    setSession((s) => setTransportBpm(s, s.transport.bpm + delta));
  }, [ensureAudio]);

  // --- A/B comparison handlers ---
  const handleAbCapture = useCallback(() => {
    setAbSnapshot(captureABSnapshot(sessionRef.current));
    setAbActive('a');
  }, []);

  const handleAbToggle = useCallback(() => {
    if (!abSnapshot || !abActive) return;
    const current = captureABSnapshot(sessionRef.current);
    setSession(s => restoreABSnapshot(s, abSnapshot));
    setAbSnapshot(current);
    setAbActive(abActive === 'a' ? 'b' : 'a');
  }, [abSnapshot, abActive]);

  const handleAbClear = useCallback(() => {
    setAbSnapshot(null);
    setAbActive(null);
  }, []);

  // Global keyboard shortcuts (extracted to hook)
  const { showShortcuts, toggleShortcuts } = useShortcuts({
    onUndo: handleUndo,
    onRedo: handleRedo,
    onTogglePlay: handleTogglePlay,
    onPlayFromCursor: handlePlayFromCursor,
    onHardStop: handleHardStop,
    onToggleRecord: handleToggleRecord,
    onToggleMute: () => handleToggleMute(session.activeTrackId),
    onToggleSolo: (additive) => handleToggleSolo(session.activeTrackId, additive),
    onTrackUp: handleTrackUp,
    onTrackDown: handleTrackDown,
    onBpmNudge: handleBpmNudge,
    onToggleTransportMode: handleToggleTransportMode,
    onCoinFlip: handleCoinFlip,
    setView,
  });

  // Keyboard piano: map computer keys to musical notes for real-time audition
  useKeyboardPiano(audioRef, session, recordArmed, globalStepRef, handleRecordEvents);

  // Detect fresh/empty session — no events in any audio track and no chat messages.
  // When true, show a welcome empty state instead of the normal view content.
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const audioTracks = session.tracks.filter(t => getTrackKind(t) === 'audio');
  const isSessionEmpty = !welcomeDismissed &&
    session.messages.length === 0 &&
    audioTracks.length <= 1 &&
    audioTracks.every(t => t.patterns.every(p => p.events.length === 0));

  return (
    <>
    <AppShell
      tracks={session.tracks}
      activeTrackId={session.activeTrackId}
      expandedTrackIds={session.expandedTrackIds}
      activityMap={activityMap}
      onSelectTrack={handleSelectTrack}
      onToggleTrackExpanded={handleToggleTrackExpanded}
      onToggleMute={handleToggleMute}
      onToggleSolo={handleToggleSolo}
      onRenameTrack={handleRenameTrack}
      onToggleClaim={(trackId) => {
        setSession(s => toggleClaim(s, trackId));
      }}
      onAddTrack={handleAddTrack}
      onRemoveTrack={handleRemoveTrack}
      onSetMusicalRole={handleSetMusicalRole}
      onSetImportance={handleSetImportance}
      onAddSend={handleAddSend}
      onRemoveSend={handleRemoveSend}
      onSetSendLevel={handleSetSendLevel}
      runtimeDegradation={audioDegradedMessage}
      messages={session.messages}
      onSend={handleSend}
      isThinking={isThinking}
      isListening={isListening}
      streamingText={streamingText}
      streamingLogEntries={streamingLogEntries}
      streamingRejections={streamingRejections}
      reactions={session.reactionHistory}
      onReaction={handleReaction}
      onAuditionStart={handleAuditionStart}
      onAuditionStop={handleAuditionStop}
      activeAuditionId={activeAuditionId}
      openDecisions={(session.openDecisions ?? []).filter(d => !d.resolved)}
      onDecisionRespond={handleDecisionRespond}
      apiConfigured={apiConfigured}
      listenerConfigured={listenerConfigured}
      onApiKey={handleApiKey}
      onContinueWithoutAI={handleContinueWithoutAI}
      setupDismissed={manualModeDismissed}
      currentGeminiKey={geminiKey}
      onCoinFlip={handleCoinFlip}
      coinNotification={{
        isThinking,
        openDecisions: (session.openDecisions ?? []).filter(d => !d.resolved),
        lastCompletionSummary,
      }}
      projectName={project.projectName}
      projects={project.projects}
      saveError={project.saveError}
      saveStatus={project.saveStatus}
      projectActionError={project.projectActionError}
      onProjectRename={handleProjectRename}
      onProjectNew={handleProjectNew}
      onProjectOpen={handleProjectOpen}
      onProjectDuplicate={handleProjectDuplicate}
      onProjectDelete={handleProjectDelete}
      onProjectExport={project.exportActiveProject}
      onProjectImport={handleProjectImport}
      onExportWav={handleExportWav}
      exportingWav={exportingWav}
      playing={session.transport.status === 'playing'}
      bpm={session.transport.bpm}
      swing={session.transport.swing}
      recordArmed={recordArmed}
      globalStep={globalStep}
      patternLength={getActivePattern(activeTrack).duration}
      onTogglePlay={handleTogglePlay}
      onHardStop={handleHardStop}
      onBpmChange={(bpm) => {
        ensureAudio();
        if (!transportPreGestureRef.current) {
          transportPreGestureRef.current = { ...sessionRef.current.transport };
        }
        setSession(s => setTransportBpmNoUndo(s, bpm));
      }}
      onBpmCommit={(bpm) => { handleTransportCommit('bpm', bpm); }}
      onSwingChange={(swing) => {
        ensureAudio();
        if (!transportPreGestureRef.current) {
          transportPreGestureRef.current = { ...sessionRef.current.transport };
        }
        setSession(s => setTransportSwingNoUndo(s, swing));
      }}
      onSwingCommit={(swing) => { handleTransportCommit('swing', swing); }}
      onToggleRecord={handleToggleRecord}
      metronomeEnabled={session.transport.metronome.enabled}
      metronomeVolume={session.transport.metronome.volume}
      onToggleMetronome={() => setSession(s => toggleMetronome(s))}
      onMetronomeVolumeChange={(v) => setSession(s => setMetronomeVolume(s, v))}
      transportMode={session.transport.mode ?? 'pattern'}
      loop={session.transport.loop ?? true}
      onTransportModeChange={handleTransportModeChange}
      onLoopChange={handleLoopChange}
      timeSignatureNumerator={session.transport.timeSignature?.numerator ?? 4}
      timeSignatureDenominator={session.transport.timeSignature?.denominator ?? 4}
      onTimeSignatureChange={handleTimeSignatureChange}
      view={view}
      onViewChange={setView}
      lastNonChatViewRef={lastNonChatViewRef}
      undoStack={session.undoStack}
      redoStack={session.redoStack ?? []}
      onUndo={handleUndo}
      onRedo={handleRedo}
      onUndoMessage={handleUndoMessage}
      cancelEditRef={cancelEditRef}
      masterVolume={session.master.volume}
      masterPan={session.master.pan}
      analyser={audioStarted ? audioRef.current.getAnalyser() : null}
      stereoAnalysers={audioStarted ? audioRef.current.getStereoAnalysers() : null}
      audioContext={audioStarted ? audioRef.current.getAudioContext() : null}
      audioEngine={audioStarted ? audioRef.current : null}
      onMasterVolumeChange={handleMasterVolumeChange}
      onMasterPanChange={handleMasterPanChange}
      onMasterInteractionStart={handleMasterInteractionStart}
      onMasterInteractionEnd={handleMasterInteractionEnd}
      abActive={abActive}
      onAbCapture={handleAbCapture}
      onAbToggle={handleAbToggle}
      onAbClear={handleAbClear}
      liveControlModules={liveControlModules}
      onLiveModuleTouch={handleLiveModuleTouch}
      onLiveModuleAddToSurface={handleLiveModuleAddToSurface}
    >
        {isSessionEmpty && (
          <EmptyState
            onAddTrack={() => handleAddTrack()}
            onSendPrompt={(prompt) => {
              setView('chat');
              void handleSend(prompt);
            }}
            onDismiss={() => setWelcomeDismissed(true)}
          />
        )}
        {!isSessionEmpty && view === 'surface' && (
          <SurfaceCanvas
            track={activeTrack}
            trackIndex={activeTrackIndex}
            onParamChange={handleSurfaceSourceParamChange}
            onProcessorParamChange={handleSurfaceProcessorParamChange}
            onDrumPadParamChange={handleSurfaceDrumPadParamChange}
            onInteractionStart={handleSurfaceInteractionStart}
            onInteractionEnd={handleSurfaceInteractionEnd}
            onAddModule={handleAddSurfaceModule}
            onUpdateModule={handleSurfaceUpdateModule}
            onRemoveModule={handleSurfaceRemoveModule}
            onToggleProcessorEnabled={handleToggleProcessorEnabled}
            onStepToggle={handleSurfaceStepToggle}
            onStepAccentToggle={handleSurfaceStepAccentToggle}
            onPaintComplete={handlePaintComplete}
          />
        )}
        {!isSessionEmpty && view === 'rack' && (
          <RackView
            activeTrack={activeTrack}
            onParamChange={handleParamChange}
            onInteractionStart={handleSourceInteractionStart}
            onInteractionEnd={handleSourceInteractionEnd}
            onModelChange={handleModelChange}
            onNoteChange={handleNoteChange}
            onHarmonicsChange={handleHarmonicsChange}
            onExtendedSourceParamChange={handleExtendedSourceParamChange}
            onPortamentoChange={handlePortamentoChange}
            onProcessorParamChange={handleProcessorParamChange}
            onProcessorInteractionStart={handleProcessorInteractionStart}
            onProcessorInteractionEnd={handleProcessorInteractionEnd}
            onProcessorModelChange={handleProcessorModelChange}
            onRemoveProcessor={handleRemoveProcessor}
            onToggleProcessorEnabled={handleToggleProcessorEnabled}
            onModulatorParamChange={handleModulatorParamChange}
            onModulatorInteractionStart={handleModulatorInteractionStart}
            onModulatorInteractionEnd={handleModulatorInteractionEnd}
            onModulatorModelChange={handleModulatorModelChange}
            onRemoveModulator={handleRemoveModulator}
            onModulationDepthChange={handleModulationDepthChange}
            onModulationDepthCommit={handleModulationDepthCommit}
            onRemoveModulation={handleRemoveModulation}
            onAddProcessor={handleAddProcessor}
            onAddModulator={handleAddModulator}
            onReplaceProcessor={handleReplaceProcessor}
            onRampRequest={handleHumanRamp}
            onPinControl={handlePinControl}
            pinnedControlIds={getPinnedControlIds}
            onNavigateToPatch={() => setView('patch')}
          />
        )}
        {!isSessionEmpty && view === 'patch' && (
          <PatchView
            session={session}
            onModulationDepthChange={handleModulationDepthChange}
            onModulationDepthCommit={handleModulationDepthCommit}
            onConnectModulator={handleConnectModulator}
            onRemoveModulation={handleRemoveModulation}
            onAddProcessor={handleAddProcessor}
            onAddModulator={handleAddModulator}
            onRemoveProcessor={handleRemoveProcessor}
            onRemoveModulator={handleRemoveModulator}
          />
        )}
        {!isSessionEmpty && view === 'tracker' && (
          <TrackerView
            session={session}
            activeTrack={activeTrack}
            playing={session.transport.status !== 'stopped'}
            globalStep={globalStep}
            onEventUpdate={handleEventUpdate}
            onEventDelete={handleEventDelete}
            onEventAdd={handleEventAdd}
            onQuantize={handleQuantize}
            onPatternLengthChange={handlePatternLength}
            onClearPattern={handleClearPattern}
            onRotate={handleRotate}
            onTranspose={handleTranspose}
            onReverse={handleReverse}
            onDuplicate={handleDuplicate}
            cancelEditRef={cancelEditRef}
            onDeleteByIndices={handleDeleteByIndices}
            onPasteEvents={handlePasteEvents}
            onTransposeByIndices={handleTransposeByIndices}
            onAddRegion={handleAddRegion}
            onRemoveRegion={handleRemoveRegion}
            onDuplicateRegion={handleDuplicateRegion}
            onRenameRegion={handleRenameRegion}
            onSetActiveRegion={handleSetActiveRegion}
            onCursorStepChange={handleCursorStepChange}
            onSelectionChange={handleTrackerSelectionChange}
            onNotePreview={handleNotePreview}
            onPlayFromRow={handlePlayFromRow}
            onAddPatternRef={handleAddPatternRef}
            onRemovePatternRef={handleRemovePatternRef}
            onReorderPatternRef={handleReorderPatternRef}
            onSetSequenceAutomation={handleSetSequenceAutomation}
            onClearSequenceAutomation={handleClearSequenceAutomation}
          />
        )}
    </AppShell>
    {showShortcuts && <ShortcutsPanel onClose={toggleShortcuts} />}
    </>
  );
}
