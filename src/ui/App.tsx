// src/ui/App.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioEngine } from '../audio/audio-engine';
import { AudioExporter } from '../audio/audio-exporter';
import type { Session, AIAction, ParamSnapshot, RegionSnapshot, ActionGroupSnapshot, SynthParamValues, UndoEntry, ProcessorStateSnapshot, ProcessorSnapshot, ModulatorStateSnapshot, ModulatorSnapshot } from '../engine/types';
import type { MusicalEvent as CanonicalMusicalEvent, ControlState } from '../engine/canonical-types';
import { getActiveVoice, getVoice } from '../engine/types';
import { createPlaitsAdapter } from '../audio/plaits-adapter';
import {
  createSession, setAgency, updateVoiceParams, setModel,
  setActiveVoice, toggleMute, toggleSolo, setTransportBpm, setTransportSwing, togglePlaying,
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
import { AppShell } from './AppShell';
import { useShortcuts } from './useShortcuts';
import type { ViewMode } from './view-types';
import { clearQaAudioTrace, recordQaAudioTrace } from '../qa/audio-trace';

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
  const exporterRef = useRef(new AudioExporter());
  const aiRef = useRef(new GluonAI());

  const [session, setSession] = useState<Session>(() => loadSession() ?? createSession());
  const project = useProjectLifecycle(session, setSession);
  const [audioStarted, setAudioStarted] = useState(false);
  const [apiConfigured, setApiConfigured] = useState(() => aiRef.current.isConfigured());
  const [globalStep, setGlobalStep] = useState(0);
  const [recording, setRecording] = useState(false);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [stepPage, setStepPage] = useState(0);
  const [view, setView] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('gluon-view');
    return saved === 'tracker' ? 'tracker' : 'control';
  });
  const [chatOpen, setChatOpen] = useState(() => {
    const saved = localStorage.getItem('gluon-chat-open');
    return saved !== 'false'; // default open
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
  const prevVoiceStateRef = useRef<Map<string, { model: number; params: Record<string, number> }>>(new Map());
  const prevProcessorStateRef = useRef<Map<string, { model: number; params: Record<string, number> }>>(new Map());
  const prevModulatorStateRef = useRef<Map<string, { model: number; params: Record<string, number> }>>(new Map());

  // Capture param + region state at interaction start for undo
  const interactionUndoRef = useRef<{
    voiceId: string;
    prevParams: Partial<SynthParamValues>;
    prevProvenance?: Partial<ControlState>;
    prevEvents?: CanonicalMusicalEvent[];
  } | null>(null);

  // Persist view and chat state to localStorage
  useEffect(() => { localStorage.setItem('gluon-view', view); }, [view]);
  useEffect(() => { localStorage.setItem('gluon-chat-open', String(chatOpen)); }, [chatOpen]);

  useEffect(() => {
    clearQaAudioTrace();
  }, []);

  const schedulerRef = useRef<Scheduler | null>(null);

  const ensureAudio = useCallback(async () => {
    if (audioStarted) return;
    const s = sessionRef.current;
    await audioRef.current.start(s.voices.map(v => v.id));
    for (const voice of s.voices) {
      audioRef.current.setVoiceModel(voice.id, voice.model);
      audioRef.current.setVoiceParams(voice.id, voice.params);
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
      (step) => setGlobalStep(step),
      (voiceId) => arbRef.current.getHeldParams(voiceId),
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

  // Sync audio params for all voices when session changes
  useEffect(() => {
    if (!audioStarted) return;
    for (const voice of session.voices) {
      const key = voice.id;
      const prev = prevVoiceStateRef.current.get(key);

      const holding = arbRef.current.isHoldingSource(voice.id);

      // Model always syncs — hold only suppresses params (#141)
      if (!prev || prev.model !== voice.model) {
        audioRef.current.setVoiceModel(voice.id, voice.model);
      }
      if (!holding && (!prev || !shallowEqual(prev.params, voice.params))) {
        audioRef.current.setVoiceParams(voice.id, voice.params);
      }
      // Only advance cache for dimensions that were actually written
      prevVoiceStateRef.current.set(key, {
        model: voice.model,
        params: holding ? (prev?.params ?? { ...voice.params }) : { ...voice.params },
      });
    }
  }, [session.voices, audioStarted, holdGeneration]);

  // Sync mute/solo state
  useEffect(() => {
    if (!audioStarted) return;
    const anySoloed = session.voices.some(v => v.solo);
    for (const voice of session.voices) {
      const audible = anySoloed ? voice.solo : !voice.muted;
      audioRef.current.muteVoice(voice.id, !audible);
    }
  }, [session.voices, audioStarted]);

  // Sync processor chains to audio engine
  useEffect(() => {
    if (!audioStarted) return;
    const audio = audioRef.current;
    for (const voice of session.voices) {
      const sessionProcs = voice.processors ?? [];
      const engineProcs = audio.getProcessors(voice.id);

      // Remove processors no longer in session
      for (const ep of engineProcs) {
        if (!sessionProcs.some(sp => sp.id === ep.id)) {
          audio.removeProcessor(voice.id, ep.id);
        }
      }

      // Add new or sync existing processors
      for (const sp of sessionProcs) {
        const pKey = `${voice.id}:${sp.id}`;
        if (!engineProcs.some(ep => ep.id === sp.id)) {
          // #138: read fresh state from sessionRef inside .then() to avoid stale closure
          void audio.addProcessor(voice.id, sp.type, sp.id).then(() => {
            const v = sessionRef.current.voices.find(sv => sv.id === voice.id);
            const fresh = v?.processors?.find(p => p.id === sp.id);
            if (!fresh) return; // removed during WASM load
            audio.setProcessorModel(voice.id, sp.id, fresh.model);
            audio.setProcessorPatch(voice.id, sp.id, fresh.params);
            prevProcessorStateRef.current.set(pKey, { model: fresh.model, params: { ...fresh.params } });
          });
        } else {
          // #142: dirty-check before syncing existing processors
          const prev = prevProcessorStateRef.current.get(pKey);
          if (!prev || prev.model !== sp.model) {
            audio.setProcessorModel(voice.id, sp.id, sp.model);
          }
          if (!prev || !shallowEqual(prev.params, sp.params)) {
            audio.setProcessorPatch(voice.id, sp.id, sp.params);
          }
          prevProcessorStateRef.current.set(pKey, { model: sp.model, params: { ...sp.params } });
        }
      }

      // Prune stale cache entries for removed processors
      const prefix = `${voice.id}:`;
      for (const k of prevProcessorStateRef.current.keys()) {
        if (k.startsWith(prefix) && !sessionProcs.some(sp => k === `${voice.id}:${sp.id}`)) {
          prevProcessorStateRef.current.delete(k);
        }
      }
    }
  }, [session.voices, audioStarted]);

  // Sync modulator state to audio engine
  useEffect(() => {
    if (!audioStarted) return;
    const audio = audioRef.current;
    for (const voice of session.voices) {
      const sessionMods = voice.modulators ?? [];
      const engineMods = audio.getModulators(voice.id);

      // Remove modulators no longer in session
      for (const em of engineMods) {
        if (!sessionMods.some(sm => sm.id === em.id)) {
          audio.removeModulator(voice.id, em.id);
        }
      }

      // Helper: sync modulation routes for this voice against current engine state
      const syncRoutes = (vid: string) => {
        const v = sessionRef.current.voices.find(sv => sv.id === vid);
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
        const mKey = `${voice.id}:${sm.id}`;
        if (!engineMods.some(em => em.id === sm.id)) {
          // #138: read fresh state from sessionRef inside .then() to avoid stale closure
          void audio.addModulator(voice.id, sm.type, sm.id).then(() => {
            const v = sessionRef.current.voices.find(sv => sv.id === voice.id);
            const fresh = v?.modulators?.find(m => m.id === sm.id);
            if (!fresh) return; // removed during WASM load
            audio.setModulatorModel(voice.id, sm.id, fresh.model);
            audio.setModulatorPatch(voice.id, sm.id, fresh.params);
            prevModulatorStateRef.current.set(mKey, { model: fresh.model, params: { ...fresh.params } });
            // Connect routes after modulator WASM loads (fixes race condition)
            syncRoutes(voice.id);
          });
        } else {
          // #142: dirty-check before syncing existing modulators
          const prev = prevModulatorStateRef.current.get(mKey);
          if (!prev || prev.model !== sm.model) {
            audio.setModulatorModel(voice.id, sm.id, sm.model);
          }
          if (!prev || !shallowEqual(prev.params, sm.params)) {
            audio.setModulatorPatch(voice.id, sm.id, sm.params);
          }
          prevModulatorStateRef.current.set(mKey, { model: sm.model, params: { ...sm.params } });
        }
      }

      // Prune stale cache entries for removed modulators
      const mPrefix = `${voice.id}:`;
      for (const k of prevModulatorStateRef.current.keys()) {
        if (k.startsWith(mPrefix) && !sessionMods.some(sm => k === `${voice.id}:${sm.id}`)) {
          prevModulatorStateRef.current.delete(k);
        }
      }

      // Sync routes now (for already-loaded modulators)
      syncRoutes(voice.id);
    }
  }, [session.voices, audioStarted]);

  const activeVoice = getActiveVoice(session);

  const dispatchAIActions = useCallback((actions: AIAction[]) => {
    setSession((s) => {
      const report = executeOperations(s, actions, plaitsAdapter, arbRef.current);

      // Start drift animations for accepted moves with `over`
      for (let i = 0; i < report.accepted.length; i++) {
        const action = report.accepted[i];
        if (action.type === 'move' && action.over) {
          const vid = action.voiceId ?? s.activeVoiceId;
          const runtimeParam = report.resolvedParams.get(i) ?? action.param;
          const voice = getVoice(s, vid);
          const currentVal = voice.params[runtimeParam] ?? 0;
          const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
          const targetVal = Math.max(0, Math.min(1, rawTarget));
          autoRef.current.start(vid, runtimeParam, currentVal, targetVal, action.over, (p, value) => {
            if (!arbRef.current.canAIAct(vid, p)) return;
            setSession((s2) => applyParamDirect(s2, vid, p, value));
          });
          autoRef.current.startLoop();
        }
      }

      // Track activity for touched voices (skip non-voice actions)
      const now = Date.now();
      const touchedVoices = new Set<string>();
      for (const action of report.accepted) {
        if (action.type === 'say' || action.type === 'set_transport') continue;
        if (!('voiceId' in action) || !action.voiceId) continue;
        touchedVoices.add(action.voiceId);
      }
      if (touchedVoices.size > 0) {
        setActivityMap(prev => {
          const next = { ...prev };
          for (const vid of touchedVoices) next[vid] = now;
          return next;
        });
      }

      return report.session;
    });
  }, []);

  const handleParamChange = useCallback((timbre: number, morph: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeVoiceId;
    autoRef.current.cancel(vid, 'timbre');
    autoRef.current.cancel(vid, 'morph');
    arbRef.current.humanTouched(vid, 'timbre', timbre, 'source');
    arbRef.current.humanTouched(vid, 'morph', morph, 'source');
    setSession((s) => {
      let next = updateVoiceParams(s, vid, { timbre, morph }, true, plaitsAdapter);

      // If a step is held, apply param lock (no per-frame undo — captured at interaction end)
      if (selectedStep !== null) {
        next = setStepParamLock(next, vid, selectedStep, { timbre, morph }, { pushUndo: false });
      }

      return next;
    });
  }, [selectedStep, ensureAudio]);

  const handleNoteChange = useCallback((note: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeVoiceId;
    autoRef.current.cancel(vid, 'note');
    arbRef.current.humanTouched(vid, 'note', note, 'source');
    setSession((s) => {
      const voice = getVoice(s, vid);
      const prevNote = voice.params.note ?? 0;
      const next = updateVoiceParams(s, vid, { note }, true, plaitsAdapter);
      if (Math.abs(note - prevNote) < 0.001) return next;
      const controlId = plaitsAdapter.mapRuntimeParamKey('note');
      const prevProvenance: Partial<ControlState> = {};
      if (controlId && voice.controlProvenance?.[controlId]) {
        prevProvenance[controlId] = { ...voice.controlProvenance[controlId] };
      }
      const snapshot: ParamSnapshot = {
        kind: 'param', voiceId: vid,
        prevValues: { note: prevNote }, aiTargetValues: { note },
        prevProvenance: Object.keys(prevProvenance).length > 0 ? prevProvenance : undefined,
        timestamp: Date.now(), description: `Note change`,
      };
      return { ...next, undoStack: [...next.undoStack, snapshot] };
    });
  }, [ensureAudio]);

  const handleHarmonicsChange = useCallback((harmonics: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeVoiceId;
    autoRef.current.cancel(vid, 'harmonics');
    arbRef.current.humanTouched(vid, 'harmonics', harmonics, 'source');
    setSession((s) => {
      const voice = getVoice(s, vid);
      const prevHarmonics = voice.params.harmonics ?? 0;
      const next = updateVoiceParams(s, vid, { harmonics }, true, plaitsAdapter);
      if (Math.abs(harmonics - prevHarmonics) < 0.001) return next;
      const controlId = plaitsAdapter.mapRuntimeParamKey('harmonics');
      const prevProvenance: Partial<ControlState> = {};
      if (controlId && voice.controlProvenance?.[controlId]) {
        prevProvenance[controlId] = { ...voice.controlProvenance[controlId] };
      }
      const snapshot: ParamSnapshot = {
        kind: 'param', voiceId: vid,
        prevValues: { harmonics: prevHarmonics }, aiTargetValues: { harmonics },
        prevProvenance: Object.keys(prevProvenance).length > 0 ? prevProvenance : undefined,
        timestamp: Date.now(), description: `Harmonics change`,
      };
      return { ...next, undoStack: [...next.undoStack, snapshot] };
    });
  }, [ensureAudio]);

  const handleModelChange = useCallback((model: number) => {
    ensureAudio();
    setSession((s) => setModel(s, s.activeVoiceId, model));
  }, [ensureAudio]);

  const handleAgencyChange = useCallback((agency: 'OFF' | 'ON') => {
    ensureAudio();
    setSession((s) => setAgency(s, s.activeVoiceId, agency));
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
          getAudioDestination: () => audioRef.current.getMediaStreamDestination(),
          captureNBars: (dest, bars, len, bpm) => exporterRef.current.captureNBars(dest, bars, len, bpm),
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

  const handleToggleRecord = useCallback(async () => {
    if (recording) {
      const blob = await exporterRef.current.stop();
      setRecording(false);
      recordQaAudioTrace({
        type: 'recording.state',
        recording: false,
        reason: 'stop',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gluon-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      await ensureAudio();
      const dest = audioRef.current.getMediaStreamDestination();
      if (dest) {
        exporterRef.current.start(dest);
        setRecording(true);
        recordQaAudioTrace({
          type: 'recording.state',
          recording: true,
          reason: 'start',
        });
      } else {
        recordQaAudioTrace({
          type: 'recording.state',
          recording: false,
          reason: 'no-destination',
        });
      }
    }
  }, [recording, ensureAudio]);

  const handleSelectVoice = useCallback((voiceId: string) => {
    setSession((s) => setActiveVoice(s, voiceId));
    setStepPage(0);
    setSelectedProcessorId(null);
    setSelectedModulatorId(null);
    setDeepViewModuleId(null);
  }, []);

  const handleToggleMute = useCallback((voiceId: string) => {
    ensureAudio();
    setSession((s) => toggleMute(s, voiceId));
  }, [ensureAudio]);

  const handleToggleSolo = useCallback((voiceId: string) => {
    ensureAudio();
    setSession((s) => toggleSolo(s, voiceId));
  }, [ensureAudio]);

  const handleStepToggle = useCallback((stepIndex: number) => {
    ensureAudio();
    setSession((s) => toggleStepGate(s, s.activeVoiceId, stepIndex));
  }, [ensureAudio]);

  const handleStepAccent = useCallback((stepIndex: number) => {
    ensureAudio();
    setSession((s) => toggleStepAccent(s, s.activeVoiceId, stepIndex));
  }, [ensureAudio]);

  const handlePatternLength = useCallback((length: number) => {
    ensureAudio();
    setSession((s) => setPatternLength(s, s.activeVoiceId, length));
    setStepPage(0);
  }, [ensureAudio]);

  const handleClearPattern = useCallback(() => {
    ensureAudio();
    setSession((s) => clearPattern(s, s.activeVoiceId));
  }, [ensureAudio]);

  const handleEventUpdate = useCallback((selector: EventSelector, updates: Partial<MusicalEvent>) => {
    setSession((s) => updateEvent(s, s.activeVoiceId, selector, updates));
  }, []);

  const handleEventDelete = useCallback((selector: EventSelector) => {
    setSession((s) => removeEvent(s, s.activeVoiceId, selector));
  }, []);

  const handleAddView = useCallback((kind: SequencerViewKind) => {
    setSession((s) => addView(s, s.activeVoiceId, kind));
  }, []);

  const handleRemoveView = useCallback((viewId: string) => {
    setSession((s) => removeView(s, s.activeVoiceId, viewId));
  }, []);

  // Capture processor state at drag start for single-gesture undo
  const processorUndoRef = useRef<{
    voiceId: string;
    processorId: string;
    prevParams: Record<string, number>;
    prevModel: number;
  } | null>(null);

  const handleProcessorInteractionStart = useCallback((processorId: string) => {
    const s = sessionRef.current;
    const voice = getActiveVoice(s);
    const proc = (voice.processors ?? []).find(p => p.id === processorId);
    if (!proc) return;
    processorUndoRef.current = {
      voiceId: s.activeVoiceId,
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
      const voice = getVoice(s, captured.voiceId);
      const proc = (voice.processors ?? []).find(p => p.id === processorId);
      if (!proc) return s;
      // Check if anything actually changed
      const changed = Object.keys(captured.prevParams).some(
        k => Math.abs((proc.params[k] ?? 0) - captured.prevParams[k]) > 0.001
      );
      if (!changed) return s;
      const snapshot: ProcessorStateSnapshot = {
        kind: 'processor-state',
        voiceId: captured.voiceId,
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
    setSession((s) => {
      const vid = s.activeVoiceId;
      const voice = getVoice(s, vid);
      const proc = (voice.processors ?? []).find(p => p.id === processorId);
      if (!proc) return s;

      const prevValue = proc.params[param] ?? 0;
      if (Math.abs(value - prevValue) < 0.001) return s;

      const updatedProc = { ...proc, params: { ...proc.params, [param]: value } };
      const updatedVoice = {
        ...voice,
        processors: (voice.processors ?? []).map(p => p.id === processorId ? updatedProc : p),
      };
      return {
        ...s,
        voices: s.voices.map(v => v.id === vid ? updatedVoice : v),
      };
    });
  }, [ensureAudio]);

  const handleProcessorModelChange = useCallback((processorId: string, model: number) => {
    ensureAudio();
    setSession((s) => {
      const vid = s.activeVoiceId;
      const voice = getVoice(s, vid);
      const proc = (voice.processors ?? []).find(p => p.id === processorId);
      if (!proc || proc.model === model) return s;

      const updatedProc = { ...proc, model };
      const updatedVoice = {
        ...voice,
        processors: (voice.processors ?? []).map(p => p.id === processorId ? updatedProc : p),
      };
      const snapshot: ProcessorStateSnapshot = {
        kind: 'processor-state',
        voiceId: vid,
        processorId,
        prevParams: { ...proc.params },
        prevModel: proc.model,
        timestamp: Date.now(),
        description: `Processor model change`,
      };
      return {
        ...s,
        voices: s.voices.map(v => v.id === vid ? updatedVoice : v),
        undoStack: [...s.undoStack, snapshot],
      };
    });
  }, [ensureAudio]);

  const handleRemoveProcessor = useCallback((processorId: string) => {
    ensureAudio();
    setSession((s) => {
      const vid = s.activeVoiceId;
      const voice = getVoice(s, vid);
      const processors = voice.processors ?? [];
      if (!processors.some(p => p.id === processorId)) return s;
      const prevModulations = voice.modulations ?? [];
      const filteredModulations = prevModulations.filter(
        route => route.target.kind !== 'processor' || route.target.processorId !== processorId,
      );

      const processorSnapshot: ProcessorSnapshot = {
        kind: 'processor',
        voiceId: vid,
        prevProcessors: processors.map(p => ({ ...p, params: { ...p.params } })),
        timestamp: Date.now(),
        description: `Remove processor`,
      };
      const snapshots: UndoEntry[] = [processorSnapshot];
      if (filteredModulations.length !== prevModulations.length) {
        snapshots.push({
          kind: 'modulation-routing',
          voiceId: vid,
          prevModulations: prevModulations.map(route => ({ ...route })),
          timestamp: Date.now(),
          description: `Remove processor routings`,
        });
      }
      const updatedVoice = {
        ...voice,
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
        voices: s.voices.map(v => v.id === vid ? updatedVoice : v),
        undoStack: [...s.undoStack, undoEntry],
      };
    });
    setSelectedProcessorId(null);
  }, [ensureAudio]);

  // Capture modulator state at drag start for single-gesture undo
  const modulatorUndoRef = useRef<{
    voiceId: string;
    modulatorId: string;
    prevParams: Record<string, number>;
    prevModel: number;
  } | null>(null);

  const handleModulatorInteractionStart = useCallback((modulatorId: string) => {
    const s = sessionRef.current;
    const voice = getActiveVoice(s);
    const mod = (voice.modulators ?? []).find(m => m.id === modulatorId);
    if (!mod) return;
    modulatorUndoRef.current = {
      voiceId: s.activeVoiceId,
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
      const voice = getVoice(s, captured.voiceId);
      const mod = (voice.modulators ?? []).find(m => m.id === modulatorId);
      if (!mod) return s;
      const changed = Object.keys(captured.prevParams).some(
        k => Math.abs((mod.params[k] ?? 0) - captured.prevParams[k]) > 0.001
      );
      if (!changed) return s;
      const snapshot: ModulatorStateSnapshot = {
        kind: 'modulator-state',
        voiceId: captured.voiceId,
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
    setSession((s) => {
      const vid = s.activeVoiceId;
      const voice = getVoice(s, vid);
      const mod = (voice.modulators ?? []).find(m => m.id === modulatorId);
      if (!mod) return s;

      const prevValue = mod.params[param] ?? 0;
      if (Math.abs(value - prevValue) < 0.001) return s;

      const updatedMod = { ...mod, params: { ...mod.params, [param]: value } };
      const updatedVoice = {
        ...voice,
        modulators: (voice.modulators ?? []).map(m => m.id === modulatorId ? updatedMod : m),
      };
      return {
        ...s,
        voices: s.voices.map(v => v.id === vid ? updatedVoice : v),
      };
    });
  }, [ensureAudio]);

  const handleModulatorModelChange = useCallback((modulatorId: string, model: number) => {
    ensureAudio();
    setSession((s) => {
      const vid = s.activeVoiceId;
      const voice = getVoice(s, vid);
      const mod = (voice.modulators ?? []).find(m => m.id === modulatorId);
      if (!mod || mod.model === model) return s;

      const updatedMod = { ...mod, model };
      const updatedVoice = {
        ...voice,
        modulators: (voice.modulators ?? []).map(m => m.id === modulatorId ? updatedMod : m),
      };
      const snapshot: ModulatorStateSnapshot = {
        kind: 'modulator-state',
        voiceId: vid,
        modulatorId,
        prevParams: { ...mod.params },
        prevModel: mod.model,
        timestamp: Date.now(),
        description: `Modulator model change`,
      };
      return {
        ...s,
        voices: s.voices.map(v => v.id === vid ? updatedVoice : v),
        undoStack: [...s.undoStack, snapshot],
      };
    });
  }, [ensureAudio]);

  const handleRemoveModulator = useCallback((modulatorId: string) => {
    ensureAudio();
    setSession((s) => {
      const vid = s.activeVoiceId;
      const voice = getVoice(s, vid);
      const modulators = voice.modulators ?? [];
      if (!modulators.some(m => m.id === modulatorId)) return s;

      const snapshot: ModulatorSnapshot = {
        kind: 'modulator',
        voiceId: vid,
        prevModulators: modulators.map(m => ({ ...m, params: { ...m.params } })),
        prevModulations: (voice.modulations ?? []).map(r => ({ ...r })),
        timestamp: Date.now(),
        description: `Remove modulator`,
      };
      const updatedVoice = {
        ...voice,
        modulators: modulators.filter(m => m.id !== modulatorId),
        modulations: (voice.modulations ?? []).filter(r => r.modulatorId !== modulatorId),
      };
      return {
        ...s,
        voices: s.voices.map(v => v.id === vid ? updatedVoice : v),
        undoStack: [...s.undoStack, snapshot],
      };
    });
    setSelectedModulatorId(null);
  }, [ensureAudio]);

  // Global keyboard shortcuts (extracted to hook)
  useShortcuts({ onUndo: handleUndo, onTogglePlay: handleTogglePlay, setView, setChatOpen });

  return (
    <AppShell
      voices={session.voices}
      activeVoiceId={session.activeVoiceId}
      activityMap={activityMap}
      onSelectVoice={handleSelectVoice}
      onToggleMute={handleToggleMute}
      onToggleSolo={handleToggleSolo}
      onToggleAgency={(voiceId) => {
        const voice = session.voices.find(v => v.id === voiceId);
        if (voice) setSession(s => setAgency(s, voiceId, voice.agency === 'OFF' ? 'ON' : 'OFF'));
      }}
      messages={session.messages}
      onSend={handleSend}
      isThinking={isThinking}
      isListening={isListening}
      apiConfigured={apiConfigured}
      onApiKey={handleApiKey}
      chatOpen={chatOpen}
      onChatToggle={() => setChatOpen(o => !o)}
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
    >
        {view === 'control' ? (
          <InstrumentView
            session={session}
            activeVoice={activeVoice}
            view={view}
            onViewChange={setView}
            playing={session.transport.playing}
            bpm={session.transport.bpm}
            swing={session.transport.swing}
            recording={recording}
            globalStep={globalStep}
            onTogglePlay={handleTogglePlay}
            onBpmChange={(bpm) => { ensureAudio(); setSession(s => setTransportBpm(s, bpm)); }}
            onSwingChange={(swing) => { ensureAudio(); setSession(s => setTransportSwing(s, swing)); }}
            onToggleRecord={handleToggleRecord}
            onParamChange={handleParamChange}
            onInteractionStart={() => {
              const s = sessionRef.current;
              arbRef.current.humanInteractionStart(s.activeVoiceId);
              const voice = getActiveVoice(s);
              const prevProvenance: Partial<ControlState> = {};
              if (voice.controlProvenance) {
                for (const key of ['timbre', 'morph']) {
                  const controlId = plaitsAdapter.mapRuntimeParamKey(key);
                  if (controlId && voice.controlProvenance[controlId]) {
                    prevProvenance[controlId] = { ...voice.controlProvenance[controlId] };
                  }
                }
              }
              interactionUndoRef.current = {
                voiceId: s.activeVoiceId,
                prevParams: { timbre: voice.params.timbre, morph: voice.params.morph },
                prevProvenance: Object.keys(prevProvenance).length > 0 ? prevProvenance : undefined,
                prevEvents: voice.regions.length > 0 ? [...voice.regions[0].events] : undefined,
              };
            }}
            onInteractionEnd={() => {
              arbRef.current.humanInteractionEnd();
              const captured = interactionUndoRef.current;
              if (captured) {
                interactionUndoRef.current = null;
                setSession((s) => {
                  const voice = getVoice(s, captured.voiceId);
                  const snapshots: (ParamSnapshot | RegionSnapshot)[] = [];

                  // Check if params changed
                  const currentValues: Partial<SynthParamValues> = {};
                  for (const [param, prevValue] of Object.entries(captured.prevParams)) {
                    const cur = voice.params[param] ?? 0;
                    if (Math.abs(cur - (prevValue as number)) > 0.001) {
                      currentValues[param] = cur;
                    }
                  }
                  if (Object.keys(currentValues).length > 0) {
                    snapshots.push({
                      kind: 'param',
                      voiceId: captured.voiceId,
                      prevValues: captured.prevParams,
                      aiTargetValues: currentValues,
                      prevProvenance: captured.prevProvenance,
                      timestamp: Date.now(),
                      description: `Param change: ${Object.keys(currentValues).join(', ')}`,
                    });
                  }

                  // Check if region events changed (param lock during drag)
                  if (captured.prevEvents && voice.regions.length > 0) {
                    const curEvents = voice.regions[0].events;
                    const eventsChanged = curEvents.length !== captured.prevEvents.length ||
                      curEvents.some((e, i) => JSON.stringify(e) !== JSON.stringify(captured.prevEvents![i]));
                    if (eventsChanged) {
                      snapshots.push({
                        kind: 'region',
                        voiceId: captured.voiceId,
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
            }}
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
            onUndo={handleUndo}
            deepViewModuleId={deepViewModuleId}
            onOpenDeepView={setDeepViewModuleId}
            analyser={audioRef.current.getAnalyser()}
          />
        ) : (
          <TrackerView
            session={session}
            activeVoice={activeVoice}
            view={view}
            onViewChange={setView}
            playing={session.transport.playing}
            bpm={session.transport.bpm}
            swing={session.transport.swing}
            recording={recording}
            globalStep={globalStep}
            onTogglePlay={handleTogglePlay}
            onBpmChange={(bpm) => { ensureAudio(); setSession(s => setTransportBpm(s, bpm)); }}
            onSwingChange={(swing) => { ensureAudio(); setSession(s => setTransportSwing(s, swing)); }}
            onToggleRecord={handleToggleRecord}
            onEventUpdate={handleEventUpdate}
            onEventDelete={handleEventDelete}
            onUndo={handleUndo}
          />
        )}
    </AppShell>
  );
}
