// src/ui/App.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioEngine } from '../audio/audio-engine';
import { renderOffline } from '../audio/render-offline';
import type { Session, AIAction, ParamSnapshot, RegionSnapshot, ActionGroupSnapshot, SynthParamValues, UndoEntry, ProcessorStateSnapshot, ProcessorSnapshot, ModulatorStateSnapshot, ModulatorSnapshot } from '../engine/types';
import type { MusicalEvent as CanonicalMusicalEvent, ControlState, NoteEvent } from '../engine/canonical-types';
import { getActiveTrack, getTrack, updateTrack } from '../engine/types';
import { normalizeRegionEvents } from '../engine/region-helpers';
import { createPlaitsAdapter } from '../audio/plaits-adapter';
import {
  createSession, setAgency, updateTrackParams, setModel,
  setActiveTrack, toggleMute, toggleSolo, setTransportBpm, setTransportSwing, togglePlaying,
  renameTrack, setMaster,
} from '../engine/session';
import { loadSession } from '../engine/persistence';
import { useProjectLifecycle } from './useProjectLifecycle';
import { applyParamDirect, applyUndo } from '../engine/primitives';
import { executeOperations, prevalidateAction } from '../engine/operation-executor';
import { toggleStepGate, toggleStepAccent, setStepParamLock, clearPattern, setPatternLength } from '../engine/pattern-primitives';
import { updateEvent, removeEvent } from '../engine/event-primitives';
import type { EventSelector } from '../engine/event-primitives';
import type { MusicalEvent } from '../engine/canonical-types';
import { addView, removeView } from '../engine/view-primitives';
import type { SequencerViewKind } from '../engine/types';
import { GluonAI } from '../ai/api';
import { Arbitrator } from '../engine/arbitration';
import { AutomationEngine } from '../ai/automation';
import { Scheduler } from '../engine/scheduler';
import { InstrumentView } from './InstrumentView';
import { TrackerView } from './TrackerView';
import { RackView } from './RackView';
import { PatchView } from './PatchView';
import { AppShell } from './AppShell';
import { useShortcuts } from './useShortcuts';
import { useKeyboardPiano } from './useKeyboardPiano';
import type { ViewMode } from './view-types';
import { clearQaAudioTrace, recordQaAudioTrace } from '../qa/audio-trace';

// TODO(#215): Module-level singleton — works fine in production but may
// interfere with test isolation if App is mounted multiple times in a test suite.
// Low risk since adapter is stateless; revisit if tests require separate instances.
const plaitsAdapter = createPlaitsAdapter();

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
  const aiRef = useRef(new GluonAI());
  // Signal to discard in-progress tracker inline edits when switching views.
  // mousedown on ViewToggle sets this true before blur fires on EditableCell.
  const cancelEditRef = useRef(false);

  const [session, setSession] = useState<Session>(() => loadSession() ?? createSession());
  const project = useProjectLifecycle(session, setSession);
  const [audioStarted, setAudioStarted] = useState(false);
  const [apiConfigured, setApiConfigured] = useState(() => aiRef.current.isConfigured());
  const [globalStep, setGlobalStep] = useState(0);
  const globalStepRef = useRef(0);
  const [recordArmed, setRecordArmed] = useState(false);
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
  const prevProcessorStateRef = useRef<Map<string, { model: number; params: Record<string, number> }>>(new Map());
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

  const schedulerRef = useRef<Scheduler | null>(null);

  const ensureAudio = useCallback(async () => {
    if (audioStarted) return;
    const s = sessionRef.current;
    await audioRef.current.start(s.tracks.map(v => v.id));
    for (const track of s.tracks) {
      audioRef.current.setTrackModel(track.id, track.model);
      audioRef.current.setTrackParams(track.id, track.params);
    }
    setAudioStarted(true);
  }, [audioStarted]);

  // Create scheduler once audio starts
  useEffect(() => {
    if (!audioStarted) return;
    schedulerRef.current = new Scheduler(
      () => sessionRef.current,
      () => audioRef.current.getCurrentTime(),
      () => audioRef.current.getState(),
      (note) => audioRef.current.scheduleNote(note),
      (step) => { globalStepRef.current = step; setGlobalStep(step); },
      (trackId) => arbRef.current.getHeldParams(trackId),
    );
    return () => { schedulerRef.current?.stop(); };
  }, [audioStarted]);

  // Control scheduler from transport state
  useEffect(() => {
    if (!schedulerRef.current) return;
    if (session.transport.playing) {
      audioRef.current.restoreBaseline();
      schedulerRef.current.start();
      recordQaAudioTrace({
        type: 'transport.play-start',
        audioTime: audioRef.current.getCurrentTime(),
      });
    } else {
      schedulerRef.current.stop();
      audioRef.current.silenceAll();
    }
    recordQaAudioTrace({
      type: 'transport.state',
      playing: session.transport.playing,
      bpm: session.transport.bpm,
      swing: session.transport.swing,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bpm/swing logged as context, not dependencies
  }, [session.transport.playing]);

  useEffect(() => {
    recordQaAudioTrace({
      type: 'transport.settings',
      bpm: session.transport.bpm,
      swing: session.transport.swing,
    });
  }, [session.transport.bpm, session.transport.swing]);

  // Sync audio params for all tracks when session changes
  useEffect(() => {
    if (!audioStarted) return;
    for (const track of session.tracks) {
      const key = track.id;
      const prev = prevTrackStateRef.current.get(key);

      const holding = arbRef.current.isHoldingSource(track.id);

      // Model always syncs — hold only suppresses params (#141)
      if (!prev || prev.model !== track.model) {
        audioRef.current.setTrackModel(track.id, track.model);
      }
      if (!holding && (!prev || !prev.params || !shallowEqual(prev.params, track.params))) {
        audioRef.current.setTrackParams(track.id, track.params);
      }
      // Only advance cache for dimensions that were actually written
      prevTrackStateRef.current.set(key, {
        model: track.model,
        params: holding ? (prev?.params ?? undefined) : { ...track.params },
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

  // Sync master channel to audio engine
  useEffect(() => {
    if (!audioStarted) return;
    audioRef.current.setMasterVolume(session.master.volume);
    audioRef.current.setMasterPan(session.master.pan);
  }, [session.master.volume, session.master.pan, audioStarted]);

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
            prevProcessorStateRef.current.set(pKey, { model: fresh.model, params: { ...fresh.params } });
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
          prevProcessorStateRef.current.set(pKey, { model: sp.model, params: { ...sp.params } });
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

  const dispatchAIActions = useCallback((actions: AIAction[]) => {
    setSession((s) => {
      const report = executeOperations(s, actions, plaitsAdapter, arbRef.current);

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
  }, [selectedStep, ensureAudio]);

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
  }, [ensureAudio]);

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
  }, [ensureAudio]);

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
      prevEvents: track.regions.length > 0 ? [...track.regions[0].events] : undefined,
    };
  }, []);

  const handleSourceInteractionEnd = useCallback(() => {
    arbRef.current.humanInteractionEnd();
    const captured = interactionUndoRef.current;
    if (captured) {
      interactionUndoRef.current = null;
      setSession((s) => {
        const track = getTrack(s, captured.trackId);
        const snapshots: (ParamSnapshot | RegionSnapshot)[] = [];

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
        if (captured.prevEvents && track.regions.length > 0) {
          const curEvents = track.regions[0].events;
          const eventsChanged = curEvents.length !== captured.prevEvents.length ||
            curEvents.some((e, i) => JSON.stringify(e) !== JSON.stringify(captured.prevEvents![i]));
          if (eventsChanged) {
            snapshots.push({
              kind: 'region',
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

  const requestIdRef = useRef(0);
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const handleSend = useCallback(async (message: string) => {
    const thisRequest = ++requestIdRef.current;
    setIsThinking(true);
    await ensureAudio();
    setSession((s) => ({
      ...s,
      messages: [...s.messages, { role: 'human' as const, text: message, timestamp: Date.now() }],
    }));

    try {
      const actions = await aiRef.current.ask(sessionRef.current, message, {
        listen: {
          renderOffline: (s, vIds, bars) => renderOffline(s, vIds, bars),
          onListening: setIsListening,
        },
        isStale: () => thisRequest !== requestIdRef.current,
        validateAction: (action) => prevalidateAction(
          sessionRef.current, action, plaitsAdapter, arbRef.current,
        ),
      });
      if (thisRequest !== requestIdRef.current) return;
      dispatchAIActions(actions);
    } catch {
      // Error already handled by GluonAI.handleError — no additional action needed
    } finally {
      if (thisRequest === requestIdRef.current) {
        setIsThinking(false);
        setIsListening(false);
      }
    }
  }, [ensureAudio, dispatchAIActions]);

  const handleApiKey = useCallback((key: string) => {
    aiRef.current.setApiKey(key);
    setApiConfigured(true);
  }, []);

  const handleTogglePlay = useCallback(async () => {
    await ensureAudio();
    // Resume AudioContext if browser auto-suspended it after idle.
    // Must happen during user gesture to satisfy autoplay policy.
    await audioRef.current.resume();
    setSession((s) => togglePlaying(s));
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

  // Push a single undo snapshot when a recording session starts (armed + playing).
  // The snapshot covers the entire session: from arm to disarm/stop.
  const isRecordingActive = recordArmed && session.transport.playing;
  useEffect(() => {
    if (isRecordingActive && !recordingSnapshotPushed.current) {
      // Snapshot the active track's region before recording starts
      const s = sessionRef.current;
      const track = getActiveTrack(s);
      const region = track?.regions[0];
      if (region) {
        const snapshot: RegionSnapshot = {
          kind: 'region',
          trackId: track.id,
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
      const region = track.regions[0];
      if (!region) return s;

      // Overdub: merge new events with existing
      const merged = [...region.events, ...events];
      const updatedRegion = normalizeRegionEvents({ ...region, events: merged });

      return updateTrack(s, trackId, {
        regions: track.regions.map((r, i) => i === 0 ? updatedRegion : r),
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

  const handleToggleSolo = useCallback((trackId: string) => {
    ensureAudio();
    setSession((s) => toggleSolo(s, trackId));
  }, [ensureAudio]);

  const handleRenameTrack = useCallback((trackId: string, name: string) => {
    setSession((s) => renameTrack(s, trackId, name));
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

  // Global keyboard shortcuts (extracted to hook)
  useShortcuts({ onUndo: handleUndo, onTogglePlay: handleTogglePlay, setView, setChatOpen });

  // Keyboard piano: map computer keys to musical notes for real-time audition
  useKeyboardPiano(audioRef, session, recordArmed, globalStepRef, handleRecordEvents);

  return (
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
      messages={session.messages}
      onSend={handleSend}
      isThinking={isThinking}
      isListening={isListening}
      apiConfigured={apiConfigured}
      onApiKey={handleApiKey}
      chatOpen={chatOpen}
      onChatToggle={() => setChatOpen(o => !o)}
      chatWidth={chatWidth}
      onChatResize={setChatWidth}
      projectName={project.projectName}
      projects={project.projects}
      saveError={project.saveError}
      onProjectRename={project.renameActiveProject}
      onProjectNew={() => project.createProject()}
      onProjectOpen={project.switchProject}
      onProjectDuplicate={project.duplicateActiveProject}
      onProjectDelete={project.deleteActiveProject}
      onProjectExport={project.exportActiveProject}
      onProjectImport={project.importProject}
      playing={session.transport.playing}
      bpm={session.transport.bpm}
      swing={session.transport.swing}
      recordArmed={recordArmed}
      globalStep={globalStep}
      patternLength={activeTrack.pattern.length}
      onTogglePlay={handleTogglePlay}
      onBpmChange={(bpm) => { ensureAudio(); setSession(s => setTransportBpm(s, bpm)); }}
      onSwingChange={(swing) => { ensureAudio(); setSession(s => setTransportSwing(s, swing)); }}
      onToggleRecord={handleToggleRecord}
      view={view}
      onViewChange={setView}
      undoStack={session.undoStack}
      onUndo={handleUndo}
      cancelEditRef={cancelEditRef}
      masterVolume={session.master.volume}
      masterPan={session.master.pan}
      analyser={audioStarted ? audioRef.current.getAnalyser() : null}
      onMasterVolumeChange={handleMasterVolumeChange}
      onMasterPanChange={handleMasterPanChange}
    >
        {view === 'surface' && (
          <InstrumentView
            session={session}
            activeTrack={activeTrack}
            playing={session.transport.playing}
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
            selectedModulatorId={selectedModulatorId}
            onSelectModulator={setSelectedModulatorId}
            onModulatorParamChange={handleModulatorParamChange}
            onModulatorInteractionStart={handleModulatorInteractionStart}
            onModulatorInteractionEnd={handleModulatorInteractionEnd}
            onModulatorModelChange={handleModulatorModelChange}
            onRemoveModulator={handleRemoveModulator}
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
            deepViewModuleId={deepViewModuleId}
            onOpenDeepView={setDeepViewModuleId}
            analyser={audioRef.current.getAnalyser()}
          />
        )}
        {view === 'rack' && (
          <RackView
            session={session}
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
            onModulatorParamChange={handleModulatorParamChange}
            onModulatorInteractionStart={handleModulatorInteractionStart}
            onModulatorInteractionEnd={handleModulatorInteractionEnd}
            onModulatorModelChange={handleModulatorModelChange}
            onRemoveModulator={handleRemoveModulator}
            onAddProcessor={handleAddProcessor}
            onAddModulator={handleAddModulator}
          />
        )}
        {view === 'patch' && <PatchView session={session} />}
        {view === 'tracker' && (
          <TrackerView
            session={session}
            activeTrack={activeTrack}
            playing={session.transport.playing}
            globalStep={globalStep}
            onEventUpdate={handleEventUpdate}
            onEventDelete={handleEventDelete}
            cancelEditRef={cancelEditRef}
          />
        )}
    </AppShell>
  );
}
