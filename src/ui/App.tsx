// src/ui/App.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioEngine } from '../audio/audio-engine';
import { AudioExporter } from '../audio/audio-exporter';
import type { Session, AIAction } from '../engine/types';
import { getActiveVoice, getVoice } from '../engine/types';
import { createPlaitsAdapter } from '../audio/plaits-adapter';
import {
  createSession, setAgency, updateVoiceParams, setModel,
  setActiveVoice, toggleMute, toggleSolo, setTransportBpm, setTransportSwing, togglePlaying,
} from '../engine/session';
import { applyParamDirect, applyUndo } from '../engine/primitives';
import { executeOperations } from '../engine/operation-executor';
import { toggleStepGate, toggleStepAccent, setStepParamLock, clearPattern, setPatternLength } from '../engine/pattern-primitives';
import { GluonAI } from '../ai/api';
import { Arbitrator } from '../engine/arbitration';
import { AutomationEngine } from '../ai/automation';
import { Scheduler } from '../engine/scheduler';
import { ChatView } from './ChatView';
import { InstrumentView } from './InstrumentView';
import type { ViewMode } from './view-types';

const plaitsAdapter = createPlaitsAdapter();

export default function App() {
  const audioRef = useRef(new AudioEngine());
  const exporterRef = useRef(new AudioExporter());
  const aiRef = useRef(new GluonAI());

  const [session, setSession] = useState<Session>(createSession);
  const [audioStarted, setAudioStarted] = useState(false);
  const [apiConfigured, setApiConfigured] = useState(() => aiRef.current.isConfigured());
  const [globalStep, setGlobalStep] = useState(0);
  const [recording, setRecording] = useState(false);
  const [heldStep, setHeldStep] = useState<number | null>(null);
  const [stepPage, setStepPage] = useState(0);
  const [view, setView] = useState<ViewMode>('chat');
  const arbRef = useRef(new Arbitrator());
  const autoRef = useRef(new AutomationEngine());
  const sessionRef = useRef(session);
  sessionRef.current = session;

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
      schedulerRef.current.start();
    } else {
      schedulerRef.current.stop();
    }
  }, [session.transport.playing]);

  // Sync audio params for all voices when session changes
  useEffect(() => {
    if (!audioStarted) return;
    for (const voice of session.voices) {
      audioRef.current.setVoiceParams(voice.id, voice.params);
      audioRef.current.setVoiceModel(voice.id, voice.model);
    }
  }, [session.voices, audioStarted]);

  // Sync mute/solo state
  useEffect(() => {
    if (!audioStarted) return;
    const anySoloed = session.voices.some(v => v.solo);
    for (const voice of session.voices) {
      const audible = anySoloed ? voice.solo : !voice.muted;
      audioRef.current.muteVoice(voice.id, !audible);
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
          autoRef.current.start(runtimeParam, currentVal, targetVal, action.over, (p, value) => {
            setSession((s2) => applyParamDirect(s2, vid, p, value));
          });
          autoRef.current.startLoop();
        }
      }

      return report.session;
    });
  }, []);

  const handleParamChange = useCallback((timbre: number, morph: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeVoiceId;
    arbRef.current.humanTouched(vid, 'timbre', timbre);
    arbRef.current.humanTouched(vid, 'morph', morph);
    setSession((s) => {
      let next = updateVoiceParams(s, vid, { timbre, morph }, true, plaitsAdapter);

      // If a step is held, apply param lock
      if (heldStep !== null) {
        next = setStepParamLock(next, vid, heldStep, { timbre, morph });
      }

      return next;
    });
  }, [heldStep]);

  const handleNoteChange = useCallback((note: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeVoiceId;
    arbRef.current.humanTouched(vid, 'note', note);
    setSession((s) => updateVoiceParams(s, vid, { note }, true, plaitsAdapter));
  }, [ensureAudio]);

  const handleHarmonicsChange = useCallback((harmonics: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeVoiceId;
    arbRef.current.humanTouched(vid, 'harmonics', harmonics);
    setSession((s) => updateVoiceParams(s, vid, { harmonics }, true, plaitsAdapter));
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
          { role: 'ai' as const, text: `Undid: ${description}`, timestamp: Date.now() },
        ],
      };
    });
  }, [ensureAudio]);

  const requestIdRef = useRef(0);
  const [isThinking, setIsThinking] = useState(false);

  const isListenIntent = (msg: string): boolean => {
    const lower = msg.toLowerCase();
    return /\b(listen|how does it sound|what do you think|how('s| is) it|evaluate|critique|review)\b/.test(lower);
  };

  const [isListening, setIsListening] = useState(false);

  const handleListen = useCallback(async (question: string) => {
    const s = sessionRef.current;
    if (!s.transport.playing) {
      setSession((prev) => ({
        ...prev,
        messages: [...prev.messages, {
          role: 'ai' as const,
          text: 'Press play first — I need to hear the audio to evaluate it.',
          timestamp: Date.now(),
        }],
      }));
      return;
    }

    setIsListening(true);
    const dest = audioRef.current.getMediaStreamDestination();
    if (!dest) {
      setIsListening(false);
      return;
    }

    try {
      const activePattern = getActiveVoice(s).pattern;
      const wavBlob = await exporterRef.current.captureNBars(
        dest, 2, activePattern.length, s.transport.bpm,
      );

      const critique = await aiRef.current.evaluateAudio(
        sessionRef.current, wavBlob, 'audio/wav', question,
      );

      setSession((prev) => ({
        ...prev,
        messages: [...prev.messages, {
          role: 'ai' as const,
          text: critique,
          timestamp: Date.now(),
        }],
      }));
    } catch {
      setSession((prev) => ({
        ...prev,
        messages: [...prev.messages, {
          role: 'ai' as const,
          text: 'Audio evaluation failed — try again.',
          timestamp: Date.now(),
        }],
      }));
    } finally {
      setIsListening(false);
    }
  }, []);

  const handleSend = useCallback(async (message: string) => {
    const thisRequest = ++requestIdRef.current;
    setIsThinking(true);
    await ensureAudio();
    setSession((s) => ({
      ...s,
      messages: [...s.messages, { role: 'human' as const, text: message, timestamp: Date.now() }],
    }));

    // Route to listen mode if the message is a listen intent
    if (isListenIntent(message)) {
      try {
        await handleListen(message);
      } finally {
        if (thisRequest === requestIdRef.current) {
          setIsThinking(false);
        }
      }
      return;
    }

    try {
      const actions = await aiRef.current.ask(sessionRef.current, message);
      // Discard stale responses if another request was fired
      if (thisRequest !== requestIdRef.current) return;
      dispatchAIActions(actions);
    } catch {
      // Error already handled by GluonAI.handleError — no additional action needed
    } finally {
      if (thisRequest === requestIdRef.current) {
        setIsThinking(false);
      }
    }
  }, [ensureAudio, dispatchAIActions, handleListen]);

  const handleApiKey = useCallback((key: string) => {
    aiRef.current.setApiKey(key);
    setApiConfigured(true);
  }, []);

  const handleTogglePlay = useCallback(async () => {
    await ensureAudio();
    setSession((s) => togglePlaying(s));
  }, [ensureAudio]);

  const handleToggleRecord = useCallback(async () => {
    if (recording) {
      const blob = await exporterRef.current.stop();
      setRecording(false);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gluon-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const dest = audioRef.current.getMediaStreamDestination();
      if (dest) {
        exporterRef.current.start(dest);
        setRecording(true);
      }
    }
  }, [recording]);

  const handleSelectVoice = useCallback((voiceId: string) => {
    setSession((s) => setActiveVoice(s, voiceId));
    setStepPage(0);
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

  // Focus-safe keyboard shortcuts
  useEffect(() => {
    const isEditable = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
    };

    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
      // Cmd+1 / Cmd+2 for view switching
      if ((e.metaKey || e.ctrlKey) && e.key === '1') {
        e.preventDefault();
        setView('chat');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '2') {
        e.preventDefault();
        setView('instrument');
      }
      // Tab toggles views when not in editable
      if (e.key === 'Tab' && !isEditable()) {
        e.preventDefault();
        setView((v) => v === 'chat' ? 'instrument' : 'chat');
      }
      // Space for play/stop — only when not in editable
      if (e.key === ' ' && !e.repeat && !isEditable()) {
        e.preventDefault();
        handleTogglePlay();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleTogglePlay]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="h-screen">
        {view === 'chat' ? (
          <ChatView
            session={session}
            activeVoice={activeVoice}
            view={view}
            onViewChange={setView}
            apiConfigured={apiConfigured}
            onApiKey={handleApiKey}
            onSelectVoice={handleSelectVoice}
            onToggleMute={handleToggleMute}
            onToggleSolo={handleToggleSolo}
            onUndo={handleUndo}
            onSend={handleSend}
            onTogglePlay={handleTogglePlay}
            playing={session.transport.playing}
            bpm={session.transport.bpm}
            isThinking={isThinking}
            isListening={isListening}
          />
        ) : (
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
            onSelectVoice={handleSelectVoice}
            onToggleMute={handleToggleMute}
            onToggleSolo={handleToggleSolo}
            onParamChange={handleParamChange}
            onInteractionStart={() => arbRef.current.humanInteractionStart()}
            onInteractionEnd={() => arbRef.current.humanInteractionEnd()}
            onModelChange={handleModelChange}
            onAgencyChange={handleAgencyChange}
            onNoteChange={handleNoteChange}
            onHarmonicsChange={handleHarmonicsChange}
            stepPage={stepPage}
            onStepToggle={handleStepToggle}
            onStepAccent={handleStepAccent}
            onStepHold={setHeldStep}
            onStepRelease={() => setHeldStep(null)}
            onPatternLength={handlePatternLength}
            onPageChange={setStepPage}
            onClearPattern={handleClearPattern}
            onUndo={handleUndo}
            onSend={handleSend}
            isThinking={isThinking}
            isListening={isListening}
            analyser={audioRef.current.getAnalyser()}
          />
        )}
      </div>
    </div>
  );
}
