// src/ui/App.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioEngine } from '../audio/audio-engine';
import { AudioExporter } from '../audio/audio-exporter';
import { renderOffline, renderOfflinePcm } from '../audio/render-offline';
import type { Session, AIAction, ApprovalLevel, ParamSnapshot, PatternEditSnapshot, ActionGroupSnapshot, SynthParamValues, UndoEntry, ProcessorStateSnapshot, ProcessorSnapshot, ModulatorStateSnapshot, ModulatorSnapshot, ModulationRoutingSnapshot, ModulationRouting, ModulationTarget, SemanticControlDef, Snapshot, ToolCallEntry, TrackPropertySnapshot } from '../engine/types';
import type { MusicalEvent as CanonicalMusicalEvent, ControlState, NoteEvent } from '../engine/canonical-types';
import { getActiveTrack, getActivePattern, getTrack, updateTrack, getTrackKind, getOrderedTracks, MASTER_BUS_ID } from '../engine/types';
import { normalizePatternEvents } from '../engine/region-helpers';
import { reprojectTrackStepGrid } from '../engine/region-projection';
import { createPlaitsAdapter } from '../audio/plaits-adapter';
import {
  createSession, setAgency, setApproval, updateTrackParams, setModel,
  setActiveTrack, toggleMute, toggleSolo, setTransportBpm, setTransportSwing, playTransport, pauseTransport, stopTransport,
  renameTrack, setMaster, setTrackVolume, setTrackPan,
  addTrack, removeTrack,
  addSend, removeSend, setSendLevel,
  toggleMetronome, setMetronomeVolume,
  addReaction, setTrackImportance,
  addPattern, removePattern, duplicatePattern, renamePattern, setActivePatternOnTrack,
  setTimeSignature, setTransportMode,
  addPatternRef, removePatternRef, reorderPatternRef,
  captureABSnapshot, restoreABSnapshot,
} from '../engine/session';
import type { ABSnapshot } from '../engine/session';
import { loadSession } from '../engine/persistence';
import { useProjectLifecycle } from './useProjectLifecycle';
import { applyParamDirect, applyUndo, applyRedo } from '../engine/primitives';
import { executeOperations, prevalidateAction } from '../engine/operation-executor';
import { toggleStepGate, toggleStepAccent, setStepParamLock, clearPattern, setPatternLength, insertAutomationEvent, quantizeRegion } from '../engine/pattern-primitives';
import { runtimeParamToControlId, controlIdToRuntimeParam } from '../audio/instrument-registry';
import { addEvent, updateEvent, removeEvent, removeEventsByIndices, addEvents } from '../engine/event-primitives';
import { rotateRegion, transposeRegion, reverseRegion, duplicateRegionEvents } from '../engine/transform-operations';
import type { EventSelector } from '../engine/event-primitives';
import type { MusicalEvent } from '../engine/canonical-types';
import { addView, removeView } from '../engine/view-primitives';
import type { SequencerViewKind } from '../engine/types';
import type { ScheduledParameterEvent } from '../engine/sequencer-types';
import { GluonAI } from '../ai/api';
import { OpenAIPlannerProvider } from '../ai/providers/openai-planner';
import { GeminiListenerProvider } from '../ai/providers/gemini-listener';
import { Arbitrator } from '../engine/arbitration';
import { AutomationEngine } from '../ai/automation';
import { InstrumentView } from './InstrumentView';
import { TrackerView } from './TrackerView';
import { RackView } from './RackView';
import { PatchView } from './PatchView';
import { TrackMixStrip } from './TrackMixStrip';
import { AppShell } from './AppShell';
import { useShortcuts } from './useShortcuts';
import { ShortcutsPanel } from './ShortcutsPanel';
import { useKeyboardPiano } from './useKeyboardPiano';
import { useNotePreview } from './useNotePreview';
import type { ViewMode } from './view-types';
import { clearQaAudioTrace, recordQaAudioTrace } from '../qa/audio-trace';
import { computeSemanticRawUpdates } from './SemanticControlsSection';
import { useTransportController } from './useTransportController';

// TODO(#215): Module-level singleton — works fine in production but may
// interfere with test isolation if App is mounted multiple times in a test suite.
// Low risk since adapter is stateless; revisit if tests require separate instances.
const plaitsAdapter = createPlaitsAdapter();

function createAI(openaiKey: string, geminiKey: string): GluonAI {
  return new GluonAI(
    new OpenAIPlannerProvider(openaiKey),
    new GeminiListenerProvider(geminiKey),
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

export default function App() {
  const audioRef = useRef(new AudioEngine());
  const [openaiKey, setOpenaiKey] = useState(import.meta.env.VITE_OPENAI_API_KEY ?? '');
  const [geminiKey, setGeminiKey] = useState(import.meta.env.VITE_GOOGLE_API_KEY ?? '');
  const aiRef = useRef(createAI(openaiKey, geminiKey));
  // Signal to discard in-progress tracker inline edits when switching views.
  // mousedown on ViewToggle sets this true before blur fires on EditableCell.
  const cancelEditRef = useRef(false);

  const [session, setSessionRaw] = useState<Session>(() => loadSession() ?? createSession());

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
  const [apiConfigured, setApiConfigured] = useState(() => aiRef.current.isConfigured());
  const [globalStep, setGlobalStep] = useState(0);
  const globalStepRef = useRef(0);
  /** Cursor step position in the tracker (region-local). */
  const trackerCursorStepRef = useRef<number | null>(null);
  const [recordArmed, setRecordArmed] = useState(false);
  const recordArmedRef = useRef(false);
  recordArmedRef.current = recordArmed;
  const wavExporterRef = useRef(new AudioExporter());
  const [exportingWav, setExportingWav] = useState(false);
  /** Tracks whether we've pushed an undo snapshot for the current recording session. */
  const recordingSnapshotPushed = useRef(false);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [stepPage, setStepPage] = useState(0);
  const [view, setView] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('gluon-view');
    if (saved === 'tracker' || saved === 'rack' || saved === 'patch') return saved;
    return 'surface'; // default; also migrates legacy 'control' value
  });
  const [chatOpen, setChatOpen] = useState(() => {
    const saved = localStorage.getItem('gluon-chat-open');
    return saved !== 'false'; // default open
  });
  const [chatWidth, setChatWidth] = useState(() => {
    const saved = localStorage.getItem('gluon-chat-width');
    return saved ? Number(saved) : 320;
  });
  const [selectedProcessorId, setSelectedProcessorId] = useState<string | null>(null);
  const [selectedModulatorId, setSelectedModulatorId] = useState<string | null>(null);
  const [activityMap, setActivityMap] = useState<Record<string, number>>({});
  const [deepViewModuleId, setDeepViewModuleId] = useState<string | null>(null);
  // A/B comparison state
  const [abSnapshot, setAbSnapshot] = useState<ABSnapshot | null>(null);
  const [abActive, setAbActive] = useState<'a' | 'b' | null>(null);
  const arbRef = useRef(new Arbitrator());
  const [holdGeneration, setHoldGeneration] = useState(0);
  const autoRef = useRef(new AutomationEngine());
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // When arbitration hold expires, bump generation to re-trigger sync effects
  useEffect(() => {
    arbRef.current.setOnHoldExpired(() => setHoldGeneration(g => g + 1));
  }, []);

  // Dirty-check refs for sync effects (#142)
  const prevTrackStateRef = useRef<Map<string, { model: number; params?: Record<string, number> }>>(new Map());
  const prevProcessorStateRef = useRef<Map<string, { model: number; params: Record<string, number>; enabled?: boolean }>>(new Map());
  const prevModulatorStateRef = useRef<Map<string, { model: number; params: Record<string, number> }>>(new Map());

  // Capture param + region state at interaction start for undo
  const interactionUndoRef = useRef<{
    trackId: string;
    prevParams: Partial<SynthParamValues>;
    prevProvenance?: Partial<ControlState>;
    prevEvents?: CanonicalMusicalEvent[];
  } | null>(null);

  // Persist view and chat state to localStorage
  useEffect(() => { localStorage.setItem('gluon-view', view); }, [view]);
  useEffect(() => { localStorage.setItem('gluon-chat-open', String(chatOpen)); }, [chatOpen]);
  useEffect(() => { localStorage.setItem('gluon-chat-width', String(chatWidth)); }, [chatWidth]);

  useEffect(() => {
    clearQaAudioTrace();
  }, []);

  const ensureAudio = useCallback(async () => {
    if (audioStarted) return;
    const s = sessionRef.current;
    const audioTrackIds = s.tracks.filter(t => getTrackKind(t) === 'audio').map(t => t.id);
    const busTrackIds = s.tracks.filter(t => getTrackKind(t) === 'bus').map(t => t.id);
    const masterBusId = s.tracks.find(t => t.id === MASTER_BUS_ID) ? MASTER_BUS_ID : undefined;
    await audioRef.current.start(audioTrackIds, busTrackIds, masterBusId);
    for (const track of s.tracks) {
      if (track.model !== -1 && getTrackKind(track) === 'audio') {
        audioRef.current.setTrackModel(track.id, track.model);
        audioRef.current.setTrackParams(track.id, track.params);
      }
    }
    // Sync initial sends
    for (const track of s.tracks) {
      if (track.sends && track.sends.length > 0) {
        audioRef.current.syncSends(track.id, track.sends);
      }
    }
    setAudioStarted(true);
  }, [audioStarted]);

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
    // Add engine slots for tracks not yet in the audio engine
    for (const track of session.tracks) {
      if (!audio.hasTrack(track.id)) {
        const isBus = getTrackKind(track) === 'bus';
        void audio.addTrack(track.id, isBus).then(() => {
          // After the async add, sync model/params from current session
          const s = sessionRef.current;
          const t = s.tracks.find(v => v.id === track.id);
          if (t && t.model !== -1 && !isBus) {
            audio.setTrackModel(t.id, t.model);
            audio.setTrackParams(t.id, t.params);
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

      // Skip model/param sync for empty tracks (model -1 = no source module)
      if (track.model === -1) {
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
      // Keep the live audio engine aligned with session state even while a human
      // interaction is active. Arbitration still blocks AI writes separately;
      // suppressing human param sync makes the instrument feel unresponsive.
      prevTrackStateRef.current.set(key, {
        model: track.model,
        params: { ...track.params },
      });
    }
  }, [session.tracks, audioStarted, holdGeneration]);

  // Sync mute/solo state
  useEffect(() => {
    if (!audioStarted) return;
    const anySoloed = session.tracks.some(v => v.solo);
    for (const track of session.tracks) {
      const audible = anySoloed ? track.solo : !track.muted;
      audioRef.current.muteTrack(track.id, !audible);
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

  const dispatchAIActions = useCallback((actions: AIAction[], toolCalls?: ToolCallEntry[]) => {
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
    if (!recordArmedRef.current || !s.transport.status === 'playing') return;
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

  const handleSourceInteractionStart = useCallback(() => {
    const s = sessionRef.current;
    arbRef.current.humanInteractionStart(s.activeTrackId);
    const track = getActiveTrack(s);
    const prevProvenance: Partial<ControlState> = {};
    if (track.controlProvenance) {
      for (const key of ['timbre', 'morph']) {
        const controlId = plaitsAdapter.mapRuntimeParamKey(key);
        if (controlId && track.controlProvenance[controlId]) {
          prevProvenance[controlId] = { ...track.controlProvenance[controlId] };
        }
      }
    }
    interactionUndoRef.current = {
      trackId: s.activeTrackId,
      prevParams: { timbre: track.params.timbre, morph: track.params.morph },
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

        // Check if params changed
        const currentValues: Partial<SynthParamValues> = {};
        for (const [param, prevValue] of Object.entries(captured.prevParams)) {
          const cur = track.params[param] ?? 0;
          if (Math.abs(cur - (prevValue as number)) > 0.001) {
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

  const handleModelChange = useCallback((model: number) => {
    ensureAudio();
    setSession((s) => setModel(s, s.activeTrackId, model));
  }, [ensureAudio]);

  const handleAgencyChange = useCallback((agency: 'OFF' | 'ON') => {
    ensureAudio();
    setSession((s) => setAgency(s, s.activeTrackId, agency));
  }, [ensureAudio]);

  const handleUndo = useCallback(() => {
    ensureAudio();
    setSession((s) => {
      if (s.undoStack.length === 0) return s;
      const topEntry = s.undoStack[s.undoStack.length - 1];
      const description = topEntry.description ?? 'last action';
      const undone = applyUndo(s);
      return {
        ...undone,
        messages: [
          ...undone.messages,
          { role: 'system' as const, text: `Undid: ${description}`, timestamp: Date.now() },
        ],
      };
    });
  }, [ensureAudio]);

  const handleUndoMessage = useCallback((messageIndex: number) => {
    ensureAudio();
    setSession((s) => {
      const msg = s.messages[messageIndex];
      if (!msg || msg.undoStackIndex == null) return s;
      // Only allow undo when the message's entry is on top of the stack
      if (msg.undoStackIndex !== s.undoStack.length - 1) return s;
      const topEntry = s.undoStack[s.undoStack.length - 1];
      const description = topEntry.description ?? 'AI action';
      const undone = applyUndo(s);
      // Clear the undoStackIndex on the message so the button disappears
      const updatedMessages = undone.messages.map((m, i) =>
        i === messageIndex ? { ...m, undoStackIndex: undefined } : m,
      );
      return {
        ...undone,
        messages: [
          ...updatedMessages,
          { role: 'system' as const, text: `Undid: ${description}`, timestamp: Date.now() },
        ],
      };
    });
  }, [ensureAudio]);

  const handleRedo = useCallback(() => {
    ensureAudio();
    setSession((s) => {
      if ((s.redoStack ?? []).length === 0) return s;
      const topEntry = s.redoStack[s.redoStack.length - 1];
      const description = topEntry.description ?? 'last action';
      const redone = applyRedo(s);
      return {
        ...redone,
        messages: [
          ...redone.messages,
          { role: 'system' as const, text: `Redid: ${description}`, timestamp: Date.now() },
        ],
      };
    });
  }, [ensureAudio]);

  const requestIdRef = useRef(0);
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [streamingText, setStreamingText] = useState('');

  const handleSend = useCallback(async (message: string) => {
    const thisRequest = ++requestIdRef.current;
    setIsThinking(true);
    setStreamingText('');
    await ensureAudio();
    setSession((s) => ({
      ...s,
      messages: [...s.messages, { role: 'human' as const, text: message, timestamp: Date.now() }],
    }));

    // Accumulate streaming text in a ref so the callback closure always
    // has the latest value (React state updates are async).
    let accumulated = '';
    const collectedToolCalls: ToolCallEntry[] = [];

    try {
      const actions = await aiRef.current.ask(sessionRef.current, message, {
        listen: {
          renderOffline: (s, vIds, bars) => renderOffline(s, vIds, bars),
          renderOfflinePcm: (s, vIds, bars) => renderOfflinePcm(s, vIds, bars),
          onListening: setIsListening,
        },
        isStale: () => thisRequest !== requestIdRef.current,
        validateAction: (action) => prevalidateAction(
          sessionRef.current, action, plaitsAdapter, arbRef.current,
        ),
        onStreamText: (chunk) => {
          if (thisRequest !== requestIdRef.current) return;
          accumulated += chunk;
          setStreamingText(accumulated);
        },
        onToolCall: (name, args) => {
          if (thisRequest !== requestIdRef.current) return;
          collectedToolCalls.push({ name, args });
        },
      });
      if (thisRequest !== requestIdRef.current) return;
      setStreamingText('');
      dispatchAIActions(actions, collectedToolCalls);
    } catch {
      // Error already handled by GluonAI.handleError — no additional action needed
    } finally {
      if (thisRequest === requestIdRef.current) {
        setIsThinking(false);
        setIsListening(false);
        setStreamingText('');
      }
    }
  }, [ensureAudio, dispatchAIActions]);

  const handleReaction = useCallback((messageIndex: number, verdict: 'approved' | 'rejected') => {
    setSession((s) => {
      // Toggle off if clicking the same verdict again
      const existing = (s.reactionHistory ?? []).find(r => r.actionGroupIndex === messageIndex);
      if (existing && existing.verdict === verdict) {
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
        timestamp: Date.now(),
      });
    });
  }, []);

  const handleApiKey = useCallback((newOpenaiKey: string, newGeminiKey: string) => {
    setOpenaiKey(newOpenaiKey);
    setGeminiKey(newGeminiKey);
    aiRef.current = createAI(newOpenaiKey, newGeminiKey);
    setApiConfigured(aiRef.current.isConfigured());
  }, []);

  const handleTogglePlay = useCallback(async () => {
    await ensureAudio();
    // Resume AudioContext if browser auto-suspended it after idle.
    // Must happen during user gesture to satisfy autoplay policy.
    await audioRef.current.resume();
    setSession((s) => s.transport.status === 'playing' ? pauseTransport(s) : playTransport(s));
  }, [ensureAudio]);

  const handlePlayFromCursor = useCallback(async () => {
    await ensureAudio();
    await audioRef.current.resume();
    const cursorStep = trackerCursorStepRef.current;
    // Always start playing from cursor (TransportController handles restart if already playing)
    setSession((s) => playTransport(s, cursorStep ?? 0));
  }, [ensureAudio]);

  const handleCursorStepChange = useCallback((step: number) => {
    trackerCursorStepRef.current = step;
  }, []);

  // Note preview: short audition when hovering or cursor-selecting tracker note cells
  const { previewNote, cancelPreview } = useNotePreview(audioRef, activeTrack);
  const handleNotePreview = useCallback((pitch: number | null) => {
    if (pitch !== null) {
      previewNote(pitch);
    } else {
      cancelPreview();
    }
  }, [previewNote, cancelPreview]);

  /** Play from a specific row step (e.g. double-click in tracker). */
  const handlePlayFromRow = useCallback(async (step: number) => {
    await ensureAudio();
    await audioRef.current.resume();
    setSession((s) => playTransport(s, step));
  }, [ensureAudio]);

  /** Hard stop: stop sequencing AND immediately silence all voices/tails. */
  const handleHardStop = useCallback(async () => {
    await ensureAudio();
    transportControllerRef.current?.requestHardStop();
    setSession((s) => stopTransport(s));
  }, [ensureAudio]);

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
    setSession((s) => setActiveTrack(s, trackId));
    setStepPage(0);
    setSelectedProcessorId(null);
    setSelectedModulatorId(null);
    setDeepViewModuleId(null);
  }, []);

  const handleToggleMute = useCallback((trackId: string) => {
    ensureAudio();
    setSession((s) => toggleMute(s, trackId));
  }, [ensureAudio]);

  const handleToggleSolo = useCallback((trackId: string, additive?: boolean) => {
    ensureAudio();
    setSession((s) => toggleSolo(s, trackId, !additive));
  }, [ensureAudio]);

  const handleRenameTrack = useCallback((trackId: string, name: string) => {
    setSession((s) => renameTrack(s, trackId, name));
  }, []);

  const handleSetImportance = useCallback((trackId: string, importance: number) => {
    setSession((s) => {
      const track = s.tracks.find(t => t.id === trackId);
      if (!track) return s;
      const clamped = Math.max(0, Math.min(1, importance));
      const snapshot: TrackPropertySnapshot = {
        kind: 'track-property',
        trackId,
        prevProps: { importance: track.importance, musicalRole: track.musicalRole },
        timestamp: Date.now(),
        description: `Set importance: ${track.importance ?? 'unset'} → ${clamped}`,
      };
      const next = setTrackImportance(s, trackId, importance);
      return { ...next, undoStack: [...next.undoStack, snapshot] };
    });
  }, []);

  const handleSetMusicalRole = useCallback((trackId: string, role: string) => {
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
      const next = setTrackImportance(s, trackId, undefined, role);
      return { ...next, undoStack: [...next.undoStack, snapshot] };
    });
  }, []);

  const handleChangeVolume = useCallback((trackId: string, value: number) => {
    ensureAudio();
    setSession((s) => setTrackVolume(s, trackId, value));
  }, [ensureAudio]);

  const handleChangePan = useCallback((trackId: string, value: number) => {
    ensureAudio();
    setSession((s) => setTrackPan(s, trackId, value));
  }, [ensureAudio]);

  const handleAddTrack = useCallback((kind?: import('../engine/types').TrackKind) => {
    setSession((s) => {
      const result = addTrack(s, kind ?? 'audio');
      if (!result) return s;
      // Audio engine slot is provisioned by the sync effect watching session.tracks
      return result;
    });
    setSelectedProcessorId(null);
    setSelectedModulatorId(null);
    setDeepViewModuleId(null);
  }, []);

  const handleRemoveTrack = useCallback((trackId: string) => {
    setSession((s) => {
      const result = removeTrack(s, trackId);
      if (!result) return s;
      // Audio engine slot is torn down by the sync effect watching session.tracks
      return result;
    });
    setSelectedProcessorId(null);
    setSelectedModulatorId(null);
    setDeepViewModuleId(null);
  }, []);

  const handleMasterVolumeChange = useCallback((v: number) => {
    ensureAudio();
    setSession((s) => setMaster(s, { volume: v }));
  }, [ensureAudio]);

  const handleMasterPanChange = useCallback((p: number) => {
    ensureAudio();
    setSession((s) => setMaster(s, { pan: p }));
  }, [ensureAudio]);

  const handleStepToggle = useCallback((stepIndex: number) => {
    ensureAudio();
    setSession((s) => toggleStepGate(s, s.activeTrackId, stepIndex));
  }, [ensureAudio]);

  const handleStepAccent = useCallback((stepIndex: number) => {
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

  const handleAddView = useCallback((kind: SequencerViewKind) => {
    setSession((s) => addView(s, s.activeTrackId, kind));
  }, []);

  const handleRemoveView = useCallback((viewId: string) => {
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
      return {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? updatedTrack : v),
        undoStack: [...s.undoStack, undoEntry],
      };
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
      const changed = Object.keys(captured.prevParams).some(
        k => Math.abs((mod.params[k] ?? 0) - captured.prevParams[k]) > 0.001
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
  } | null>(null);

  const handleSemanticInteractionStart = useCallback((def: SemanticControlDef) => {
    const s = sessionRef.current;
    const track = getActiveTrack(s);
    // Capture prev values for all params this semantic control touches
    const prevSourceParams: Partial<SynthParamValues> = {};
    const prevProcessorParams = new Map<string, Record<string, number>>();

    for (const w of def.weights) {
      if (w.moduleId === 'source') {
        const runtimeKey = semanticCanonicalToRuntime[w.controlId] ?? w.controlId;
        prevSourceParams[runtimeKey] = track.params[runtimeKey] ?? 0.5;
        // Mark as human-touched for arbitration
        arbRef.current.humanTouched(s.activeTrackId, runtimeKey, track.params[runtimeKey] ?? 0.5, 'source');
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
    };
  }, []);

  const handleSemanticInteractionEnd = useCallback((_def: SemanticControlDef) => {
    const captured = semanticUndoRef.current;
    if (!captured) return;
    semanticUndoRef.current = null;

    setSession((s) => {
      const track = getTrack(s, captured.trackId);
      const snapshots: Snapshot[] = [];

      // Check source param changes
      if (Object.keys(captured.prevSourceParams).length > 0) {
        const currentValues: Partial<SynthParamValues> = {};
        for (const [param, prevValue] of Object.entries(captured.prevSourceParams)) {
          const cur = track.params[param] ?? 0;
          if (Math.abs(cur - (prevValue as number)) > 0.001) {
            currentValues[param] = cur;
          }
        }
        if (Object.keys(currentValues).length > 0) {
          snapshots.push({
            kind: 'param',
            trackId: captured.trackId,
            prevValues: captured.prevSourceParams,
            aiTargetValues: currentValues,
            timestamp: Date.now(),
            description: 'Semantic knob change (source)',
          });
        }
      }

      // Check processor param changes
      for (const [procId, prevParams] of captured.prevProcessorParams) {
        const proc = (track.processors ?? []).find(p => p.id === procId);
        if (!proc) continue;
        const changed = Object.keys(prevParams).some(
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

  const handleSemanticChange = useCallback((def: SemanticControlDef, knobValue: number) => {
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
        params: {} as Record<string, number>,
      };
      const snapshot: ProcessorSnapshot = {
        kind: 'processor',
        trackId: vid,
        prevProcessors: processors.map(p => ({ ...p, params: { ...p.params } })),
        timestamp: Date.now(),
        description: `Add ${type} processor`,
      };
      return {
        ...s,
        tracks: s.tracks.map(v => v.id === vid ? { ...track, processors: [...processors, newProcessor] } : v),
        undoStack: [...s.undoStack, snapshot],
      };
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
        params: {} as Record<string, number>,
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
    onToggleTransportMode: () => setSession(s => setTransportMode(s, (s.transport.mode ?? 'pattern') === 'pattern' ? 'song' : 'pattern')),
    setView,
    setChatOpen,
  });

  // Keyboard piano: map computer keys to musical notes for real-time audition
  useKeyboardPiano(audioRef, session, recordArmed, globalStepRef, handleRecordEvents);

  return (
    <>
    <AppShell
      tracks={session.tracks}
      activeTrackId={session.activeTrackId}
      activityMap={activityMap}
      onSelectTrack={handleSelectTrack}
      onToggleMute={handleToggleMute}
      onToggleSolo={handleToggleSolo}
      onRenameTrack={handleRenameTrack}
      onToggleAgency={(trackId) => {
        setSession(s => {
          const track = s.tracks.find(v => v.id === trackId);
          if (!track) return s;
          return setAgency(s, trackId, track.agency === 'OFF' ? 'ON' : 'OFF');
        });
      }}
      onCycleApproval={(trackId) => {
        const cycle: ApprovalLevel[] = ['exploratory', 'liked', 'approved', 'anchor'];
        setSession(s => {
          const track = s.tracks.find(v => v.id === trackId);
          if (!track) return s;
          const current = track.approval ?? 'exploratory';
          const nextIdx = (cycle.indexOf(current) + 1) % cycle.length;
          return setApproval(s, trackId, cycle[nextIdx]);
        });
      }}
      onAddTrack={handleAddTrack}
      onRemoveTrack={handleRemoveTrack}
      onSetImportance={handleSetImportance}
      onSetMusicalRole={handleSetMusicalRole}
      messages={session.messages}
      onSend={handleSend}
      isThinking={isThinking}
      isListening={isListening}
      streamingText={streamingText}
      reactions={session.reactionHistory}
      onReaction={handleReaction}
      apiConfigured={apiConfigured}
      onApiKey={handleApiKey}
      currentOpenaiKey={openaiKey}
      currentGeminiKey={geminiKey}
      chatOpen={chatOpen}
      onChatToggle={() => setChatOpen(o => !o)}
      chatWidth={chatWidth}
      onChatResize={setChatWidth}
      projectName={project.projectName}
      projects={project.projects}
      saveError={project.saveError}
      saveStatus={project.saveStatus}
      onProjectRename={project.renameActiveProject}
      onProjectNew={() => project.createProject()}
      onProjectOpen={project.switchProject}
      onProjectDuplicate={project.duplicateActiveProject}
      onProjectDelete={project.deleteActiveProject}
      onProjectExport={project.exportActiveProject}
      onProjectImport={project.importProject}
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
      onBpmChange={(bpm) => { ensureAudio(); setSession(s => setTransportBpm(s, bpm)); }}
      onSwingChange={(swing) => { ensureAudio(); setSession(s => setTransportSwing(s, swing)); }}
      onToggleRecord={handleToggleRecord}
      metronomeEnabled={session.transport.metronome.enabled}
      metronomeVolume={session.transport.metronome.volume}
      onToggleMetronome={() => setSession(s => toggleMetronome(s))}
      onMetronomeVolumeChange={(v) => setSession(s => setMetronomeVolume(s, v))}
      transportMode={session.transport.mode ?? 'pattern'}
      onTransportModeChange={(mode: import('../engine/sequencer-types').TransportMode) => setSession(s => setTransportMode(s, mode))}
      timeSignatureNumerator={session.transport.timeSignature?.numerator ?? 4}
      timeSignatureDenominator={session.transport.timeSignature?.denominator ?? 4}
      onTimeSignatureChange={(num, den) => setSession(s => setTimeSignature(s, num, den))}
      view={view}
      onViewChange={setView}
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
      abActive={abActive}
      onAbCapture={handleAbCapture}
      onAbToggle={handleAbToggle}
      onAbClear={handleAbClear}
    >
        <TrackMixStrip
          activeTrack={activeTrack}
          onChangeVolume={(v) => handleChangeVolume(activeTrack.id, v)}
          onChangePan={(v) => handleChangePan(activeTrack.id, v)}
        />
        {view === 'surface' && (
          <InstrumentView
            session={session}
            activeTrack={activeTrack}
            playing={session.transport.status === 'playing'}
            globalStep={globalStep}
            onParamChange={handleParamChange}
            onInteractionStart={handleSourceInteractionStart}
            onInteractionEnd={handleSourceInteractionEnd}
            onModelChange={handleModelChange}
            onAgencyChange={handleAgencyChange}
            onNoteChange={handleNoteChange}
            onHarmonicsChange={handleHarmonicsChange}
            selectedProcessorId={selectedProcessorId}
            onSelectProcessor={setSelectedProcessorId}
            onProcessorParamChange={handleProcessorParamChange}
            onProcessorInteractionStart={handleProcessorInteractionStart}
            onProcessorInteractionEnd={handleProcessorInteractionEnd}
            onProcessorModelChange={handleProcessorModelChange}
            onRemoveProcessor={handleRemoveProcessor}
            onToggleProcessorEnabled={handleToggleProcessorEnabled}
            selectedModulatorId={selectedModulatorId}
            onSelectModulator={setSelectedModulatorId}
            onModulatorParamChange={handleModulatorParamChange}
            onModulatorInteractionStart={handleModulatorInteractionStart}
            onModulatorInteractionEnd={handleModulatorInteractionEnd}
            onModulatorModelChange={handleModulatorModelChange}
            onRemoveModulator={handleRemoveModulator}
            onSemanticChange={handleSemanticChange}
            onSemanticInteractionStart={handleSemanticInteractionStart}
            onSemanticInteractionEnd={handleSemanticInteractionEnd}
            onAddView={handleAddView}
            onRemoveView={handleRemoveView}
            stepPage={stepPage}
            onStepToggle={handleStepToggle}
            onStepAccent={handleStepAccent}
            selectedStep={selectedStep}
            onStepSelect={setSelectedStep}
            onPatternLength={handlePatternLength}
            onPageChange={setStepPage}
            onClearPattern={handleClearPattern}
            onChangeVolume={(v) => handleChangeVolume(activeTrack.id, v)}
            onChangePan={(v) => handleChangePan(activeTrack.id, v)}
            deepViewModuleId={deepViewModuleId}
            onOpenDeepView={setDeepViewModuleId}
            analyser={audioRef.current.getAnalyser()}
          />
        )}
        {view === 'rack' && (
          <RackView
            activeTrack={activeTrack}
            onParamChange={handleParamChange}
            onInteractionStart={handleSourceInteractionStart}
            onInteractionEnd={handleSourceInteractionEnd}
            onModelChange={handleModelChange}
            onNoteChange={handleNoteChange}
            onHarmonicsChange={handleHarmonicsChange}
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
            onNavigateToPatch={() => setView('patch')}
          />
        )}
        {view === 'patch' && (
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
        {view === 'tracker' && (
          <TrackerView
            session={session}
            activeTrack={activeTrack}
            playing={session.transport.status === 'playing'}
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
            onAddRegion={handleAddRegion}
            onRemoveRegion={handleRemoveRegion}
            onDuplicateRegion={handleDuplicateRegion}
            onRenameRegion={handleRenameRegion}
            onSetActiveRegion={handleSetActiveRegion}
            onCursorStepChange={handleCursorStepChange}
            onNotePreview={handleNotePreview}
            onPlayFromRow={handlePlayFromRow}
            onAddPatternRef={handleAddPatternRef}
            onRemovePatternRef={handleRemovePatternRef}
            onReorderPatternRef={handleReorderPatternRef}
          />
        )}
    </AppShell>
    {showShortcuts && <ShortcutsPanel onClose={toggleShortcuts} />}
    </>
  );
}
