// src/ui/App.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioEngine } from '../audio/audio-engine';
import { AudioExporter } from '../audio/audio-exporter';
import type { Session, AIAction } from '../engine/types';
import { getActiveVoice } from '../engine/types';
import {
  createSession, setLeash, setAgency, updateVoiceParams, setModel,
  setActiveVoice, toggleMute, toggleSolo, setTransportBpm, setTransportSwing, togglePlaying,
} from '../engine/session';
import {
  applyMove, applyMoveGroup, applyParamDirect, applySuggest,
  applyAudition, cancelAuditionParam, applyUndo, commitPending,
  dismissPending, applySketchPending,
} from '../engine/primitives';
import { toggleStepGate, toggleStepAccent, setStepParamLock, clearPattern, setPatternLength } from '../engine/pattern-primitives';
import { GluonAI } from '../ai/api';
import { Arbitrator } from '../engine/arbitration';
import { AutomationEngine } from '../ai/automation';
import { Scheduler } from '../engine/scheduler';
import { ParameterSpace } from './ParameterSpace';
import { ModelSelector } from './ModelSelector';
import { LeashSlider } from './LeashSlider';
import { AgencyToggle } from './AgencyToggle';
import { ChatPanel } from './ChatPanel';
import { Visualiser } from './Visualiser';
import { PendingOverlay } from './PendingOverlay';
import { PitchControl } from './PitchControl';
import { UndoButton } from './UndoButton';
import { ApiKeyInput } from './ApiKeyInput';
import { TransportBar } from './TransportBar';
import { VoiceSelector } from './VoiceSelector';
import { StepGrid } from './StepGrid';
import { PatternControls } from './PatternControls';
import type { SketchPendingAction } from '../engine/types';

export default function App() {
  const [session, setSession] = useState<Session>(createSession);
  const [audioStarted, setAudioStarted] = useState(false);
  const [apiConfigured, setApiConfigured] = useState(false);
  const [globalStep, setGlobalStep] = useState(0);
  const [recording, setRecording] = useState(false);
  const [heldStep, setHeldStep] = useState<number | null>(null);
  const [stepPage, setStepPage] = useState(0);

  const audioRef = useRef(new AudioEngine());
  const exporterRef = useRef(new AudioExporter());
  const aiRef = useRef(new GluonAI());
  const arbRef = useRef(new Arbitrator());
  const autoRef = useRef(new AutomationEngine());
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const schedulerRef = useRef<Scheduler | null>(null);

  const startAudio = useCallback(async () => {
    const s = sessionRef.current;
    await audioRef.current.start(s.voices.map(v => v.id));
    // Set initial models
    for (const voice of s.voices) {
      audioRef.current.setVoiceModel(voice.id, voice.model);
      audioRef.current.setVoiceParams(voice.id, voice.params);
    }
    setAudioStarted(true);
  }, []);

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

  // Sync audio params when session changes
  useEffect(() => {
    if (!audioStarted) return;
    const activeVoice = getActiveVoice(session);
    audioRef.current.setVoiceParams(activeVoice.id, activeVoice.params);
    audioRef.current.setVoiceModel(activeVoice.id, activeVoice.model);
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
      let next = s;
      const moveActions: { param: string; target: { absolute: number } | { relative: number } }[] = [];
      const activeVid = s.activeVoiceId;

      for (const action of actions) {
        switch (action.type) {
          case 'move':
            if (getActiveVoice(next).agency !== 'OFF' && arbRef.current.canAIAct(action.param)) {
              if (action.over) {
                const voice = getActiveVoice(next);
                const currentVal = voice.params[action.param] ?? 0;
                const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
                const targetVal = Math.max(0, Math.min(1, rawTarget));
                autoRef.current.start(action.param, currentVal, targetVal, action.over, (param, value) => {
                  setSession((s2) => applyParamDirect(s2, activeVid, param, value));
                });
                autoRef.current.startLoop();
              } else {
                moveActions.push({ param: action.param, target: action.target });
              }
            }
            break;
          case 'suggest':
            if (getActiveVoice(next).agency !== 'OFF') {
              next = applySuggest(next, activeVid, action.changes, action.reason);
            }
            break;
          case 'audition':
            if (getActiveVoice(next).agency === 'PLAY') {
              next = applyAudition(next, activeVid, action.changes, action.duration);
            }
            break;
          case 'sketch': {
            const targetVoice = next.voices.find(v => v.id === action.voiceId);
            if (targetVoice && targetVoice.agency !== 'OFF') {
              next = applySketchPending(next, action.voiceId, action.description, action.pattern);
            }
            break;
          }
          case 'say':
            next = {
              ...next,
              messages: [...next.messages, { role: 'ai' as const, text: action.text, timestamp: Date.now() }],
            };
            break;
        }
      }

      if (moveActions.length > 0) {
        next = moveActions.length === 1
          ? applyMove(next, activeVid, moveActions[0].param, moveActions[0].target)
          : applyMoveGroup(next, activeVid, moveActions);
      }

      return next;
    });
  }, []);

  const handleParamChange = useCallback((timbre: number, morph: number) => {
    const vid = sessionRef.current.activeVoiceId;
    arbRef.current.humanTouched(vid, 'timbre', timbre);
    arbRef.current.humanTouched(vid, 'morph', morph);
    setSession((s) => {
      let next = cancelAuditionParam(s, vid, 'timbre');
      next = cancelAuditionParam(next, vid, 'morph');
      next = updateVoiceParams(next, vid, { timbre, morph }, true);

      // If a step is held, apply param lock
      if (heldStep !== null) {
        next = setStepParamLock(next, vid, heldStep, { timbre, morph });
      }

      return next;
    });
  }, [heldStep]);

  const handleNoteChange = useCallback((note: number) => {
    const vid = sessionRef.current.activeVoiceId;
    arbRef.current.humanTouched(vid, 'note', note);
    setSession((s) => {
      let next = cancelAuditionParam(s, vid, 'note');
      return updateVoiceParams(next, vid, { note }, true);
    });
  }, []);

  const handleHarmonicsChange = useCallback((harmonics: number) => {
    const vid = sessionRef.current.activeVoiceId;
    arbRef.current.humanTouched(vid, 'harmonics', harmonics);
    setSession((s) => {
      let next = cancelAuditionParam(s, vid, 'harmonics');
      return updateVoiceParams(next, vid, { harmonics }, true);
    });
  }, []);

  const handleModelChange = useCallback((model: number) => {
    setSession((s) => setModel(s, s.activeVoiceId, model));
  }, []);

  const handleLeashChange = useCallback((value: number) => {
    setSession((s) => setLeash(s, value));
  }, []);

  const handleAgencyChange = useCallback((agency: 'OFF' | 'SUGGEST' | 'PLAY') => {
    setSession((s) => setAgency(s, s.activeVoiceId, agency));
  }, []);

  const handleUndo = useCallback(() => {
    setSession((s) => applyUndo(s));
  }, []);

  const handleSend = useCallback(async (message: string) => {
    setSession((s) => ({
      ...s,
      messages: [...s.messages, { role: 'human' as const, text: message, timestamp: Date.now() }],
    }));
    const actions = await aiRef.current.ask(sessionRef.current, message);
    dispatchAIActions(actions);
  }, [dispatchAIActions]);

  const handleCommit = useCallback((pendingId: string) => {
    setSession((s) => commitPending(s, pendingId));
  }, []);

  const handleDismiss = useCallback((pendingId: string) => {
    setSession((s) => dismissPending(s, pendingId));
  }, []);

  const handleApiKey = useCallback((key: string) => {
    aiRef.current.setApiKey(key);
    setApiConfigured(true);
  }, []);

  const handleTogglePlay = useCallback(() => {
    setSession((s) => togglePlaying(s));
  }, []);

  const handleToggleRecord = useCallback(async () => {
    if (recording) {
      const blob = await exporterRef.current.stop();
      setRecording(false);
      // Download the file
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
    setSession((s) => toggleMute(s, voiceId));
  }, []);

  const handleToggleSolo = useCallback((voiceId: string) => {
    setSession((s) => toggleSolo(s, voiceId));
  }, []);

  const handleStepToggle = useCallback((stepIndex: number) => {
    setSession((s) => toggleStepGate(s, s.activeVoiceId, stepIndex));
  }, []);

  const handleStepAccent = useCallback((stepIndex: number) => {
    setSession((s) => toggleStepAccent(s, s.activeVoiceId, stepIndex));
  }, []);

  const handlePatternLength = useCallback((length: number) => {
    setSession((s) => setPatternLength(s, s.activeVoiceId, length));
    setStepPage(0);
  }, []);

  const handleClearPattern = useCallback(() => {
    setSession((s) => clearPattern(s, s.activeVoiceId));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        handleTogglePlay();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleTogglePlay]);

  // AI reactive loop
  useEffect(() => {
    if (!audioStarted) return;
    const interval = setInterval(async () => {
      const s = sessionRef.current;
      if (!aiRef.current.isConfigured()) return;
      const anyActive = s.voices.some(v => v.agency !== 'OFF');
      if (!anyActive) return;
      if (s.leash < 0.3) return;
      const actions = await aiRef.current.react(s);
      if (actions.length > 0) dispatchAIActions(actions);
    }, 3000);
    return () => clearInterval(interval);
  }, [audioStarted, dispatchAIActions]);

  // Expire audition pending actions
  useEffect(() => {
    if (session.pending.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setSession((s) => {
        const expired = s.pending.filter(p => p.kind === 'audition' && p.expiresAt < now);
        if (expired.length === 0) return s;
        let next = s;
        for (const p of expired) {
          next = dismissPending(next, p.id);
        }
        return next;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [session.pending.length]);

  const currentStep = Math.floor(globalStep % activeVoice.pattern.length);
  const totalPages = Math.ceil(activeVoice.pattern.length / 16);

  // Find pending sketch for active voice
  const pendingSketch = session.pending.find(
    (p): p is SketchPendingAction => p.kind === 'sketch' && p.voiceId === activeVoice.id,
  );

  if (!audioStarted) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-center space-y-6">
          <h1 className="text-4xl font-light tracking-wider">GLUON</h1>
          <p className="text-zinc-400 text-sm">human-AI music collaboration</p>
          <button
            onClick={startAudio}
            className="px-8 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm tracking-wide transition-colors"
          >
            Start Audio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4">
      <div className="max-w-7xl mx-auto grid grid-cols-[1fr_320px] gap-4 h-[calc(100vh-2rem)]">
        <div className="flex flex-col gap-3">
          <TransportBar
            playing={session.transport.playing}
            bpm={session.transport.bpm}
            swing={session.transport.swing}
            recording={recording}
            globalStep={globalStep}
            patternLength={activeVoice.pattern.length}
            onTogglePlay={handleTogglePlay}
            onBpmChange={(bpm) => setSession(s => setTransportBpm(s, bpm))}
            onSwingChange={(swing) => setSession(s => setTransportSwing(s, swing))}
            onToggleRecord={handleToggleRecord}
          />

          <div className="flex items-center justify-between">
            <VoiceSelector
              voices={session.voices}
              activeVoiceId={session.activeVoiceId}
              onSelectVoice={handleSelectVoice}
              onToggleMute={handleToggleMute}
              onToggleSolo={handleToggleSolo}
            />
            <div className="flex items-center gap-4">
              <ModelSelector model={activeVoice.model} onChange={handleModelChange} />
              <UndoButton onClick={handleUndo} disabled={session.undoStack.length === 0} />
            </div>
          </div>

          <div className="relative flex-1 min-h-0">
            <ParameterSpace
              timbre={activeVoice.params.timbre}
              morph={activeVoice.params.morph}
              onChange={handleParamChange}
              onInteractionStart={() => arbRef.current.humanInteractionStart()}
              onInteractionEnd={() => arbRef.current.humanInteractionEnd()}
            />
            <PendingOverlay pending={session.pending} onCommit={handleCommit} onDismiss={handleDismiss} />
          </div>

          <div className="flex items-center gap-3">
            <StepGrid
              pattern={activeVoice.pattern}
              currentStep={currentStep}
              playing={session.transport.playing}
              pendingSketch={pendingSketch}
              page={stepPage}
              onToggleGate={handleStepToggle}
              onToggleAccent={handleStepAccent}
              onStepHold={setHeldStep}
              onStepRelease={() => setHeldStep(null)}
            />
            <PatternControls
              patternLength={activeVoice.pattern.length}
              totalPages={totalPages}
              currentPage={stepPage}
              onLengthChange={handlePatternLength}
              onPageChange={setStepPage}
              onClear={handleClearPattern}
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <Visualiser analyser={audioRef.current.getAnalyser()} />
            </div>
            <PitchControl
              note={activeVoice.params.note}
              harmonics={activeVoice.params.harmonics}
              onNoteChange={handleNoteChange}
              onHarmonicsChange={handleHarmonicsChange}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <ApiKeyInput onSubmit={handleApiKey} isConfigured={apiConfigured} />
          <LeashSlider value={session.leash} onChange={handleLeashChange} />
          <AgencyToggle value={activeVoice.agency} onChange={handleAgencyChange} />
          <ChatPanel messages={session.messages} onSend={handleSend} />
        </div>
      </div>
    </div>
  );
}
