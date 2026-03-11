// src/ui/App.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioEngine } from '../audio/audio-engine';
import { AudioExporter } from '../audio/audio-exporter';
import type { Session, AIAction, ActionGroupSnapshot } from '../engine/types';
import { getActiveVoice, getVoice } from '../engine/types';
import {
  createSession, setAgency, updateVoiceParams, setModel,
  setActiveVoice, toggleMute, toggleSolo, setTransportBpm, setTransportSwing, togglePlaying,
} from '../engine/session';
import {
  applyMove, applyMoveGroup, applyParamDirect, applySketch, applyUndo,
} from '../engine/primitives';
import { toggleStepGate, toggleStepAccent, setStepParamLock, clearPattern, setPatternLength } from '../engine/pattern-primitives';
import { GluonAI } from '../ai/api';
import { Arbitrator } from '../engine/arbitration';
import { AutomationEngine } from '../ai/automation';
import { Scheduler } from '../engine/scheduler';
import { ParameterSpace } from './ParameterSpace';
import { ModelSelector } from './ModelSelector';
import { AgencyToggle } from './AgencyToggle';
import { ChatPanel } from './ChatPanel';
import { Visualiser } from './Visualiser';
import { PitchControl } from './PitchControl';
import { UndoButton } from './UndoButton';
import { ApiKeyInput } from './ApiKeyInput';
import { TransportBar } from './TransportBar';
import { VoiceSelector } from './VoiceSelector';
import { StepGrid } from './StepGrid';
import { PatternControls } from './PatternControls';

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
      let next = s;
      const undoBaseline = s.undoStack.length;
      const moveGroups = new Map<string, { param: string; target: { absolute: number } | { relative: number } }[]>();

      for (const action of actions) {
        switch (action.type) {
          case 'move': {
            const vid = action.voiceId ?? s.activeVoiceId;
            const voice = getVoice(next, vid);
            if (voice.agency === 'ON' && arbRef.current.canAIAct(vid, action.param)) {
              if (action.over) {
                const currentVal = voice.params[action.param] ?? 0;
                const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
                const targetVal = Math.max(0, Math.min(1, rawTarget));
                // Push undo snapshot before drift begins
                next = {
                  ...next,
                  undoStack: [...next.undoStack, {
                    kind: 'param' as const,
                    voiceId: vid,
                    prevValues: { [action.param]: currentVal },
                    aiTargetValues: { [action.param]: targetVal },
                    timestamp: Date.now(),
                    description: `AI drift: ${action.param} ${currentVal.toFixed(2)} -> ${targetVal.toFixed(2)} over ${action.over}ms`,
                  }],
                };
                autoRef.current.start(action.param, currentVal, targetVal, action.over, (param, value) => {
                  setSession((s2) => applyParamDirect(s2, vid, param, value));
                });
                autoRef.current.startLoop();
              } else {
                const group = moveGroups.get(vid) ?? [];
                group.push({ param: action.param, target: action.target });
                moveGroups.set(vid, group);
              }
            }
            break;
          }
          case 'sketch': {
            const targetVoice = next.voices.find(v => v.id === action.voiceId);
            if (targetVoice && targetVoice.agency === 'ON') {
              next = applySketch(next, action.voiceId, action.description, action.pattern);
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

      for (const [vid, moves] of moveGroups) {
        next = moves.length === 1
          ? applyMove(next, vid, moves[0].param, moves[0].target)
          : applyMoveGroup(next, vid, moves);
      }

      // Collapse multiple snapshots from this response into a single undo group
      const newSnapshots = next.undoStack.slice(undoBaseline);
      if (newSnapshots.length > 1) {
        const group: ActionGroupSnapshot = {
          kind: 'group',
          snapshots: newSnapshots.filter((e): e is Exclude<typeof e, ActionGroupSnapshot> => e.kind !== 'group'),
          timestamp: Date.now(),
          description: `AI response (${newSnapshots.length} actions)`,
        };
        next = { ...next, undoStack: [...next.undoStack.slice(0, undoBaseline), group] };
      }

      return next;
    });
  }, []);

  const handleParamChange = useCallback((timbre: number, morph: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeVoiceId;
    arbRef.current.humanTouched(vid, 'timbre', timbre);
    arbRef.current.humanTouched(vid, 'morph', morph);
    setSession((s) => {
      let next = updateVoiceParams(s, vid, { timbre, morph }, true);

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
    setSession((s) => updateVoiceParams(s, vid, { note }, true));
  }, [ensureAudio]);

  const handleHarmonicsChange = useCallback((harmonics: number) => {
    ensureAudio();
    const vid = sessionRef.current.activeVoiceId;
    arbRef.current.humanTouched(vid, 'harmonics', harmonics);
    setSession((s) => updateVoiceParams(s, vid, { harmonics }, true));
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
    setSession((s) => applyUndo(s));
  }, [ensureAudio]);

  const handleSend = useCallback(async (message: string) => {
    await ensureAudio();
    setSession((s) => ({
      ...s,
      messages: [...s.messages, { role: 'human' as const, text: message, timestamp: Date.now() }],
    }));
    const actions = await aiRef.current.ask(sessionRef.current, message);
    dispatchAIActions(actions);
  }, [ensureAudio, dispatchAIActions]);

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

  const currentStep = Math.floor(globalStep % activeVoice.pattern.length);
  const totalPages = Math.ceil(activeVoice.pattern.length / 16);

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
            onBpmChange={(bpm) => { ensureAudio(); setSession(s => setTransportBpm(s, bpm)); }}
            onSwingChange={(swing) => { ensureAudio(); setSession(s => setTransportSwing(s, swing)); }}
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
          </div>

          <div className="flex items-center gap-3">
            <StepGrid
              pattern={activeVoice.pattern}
              currentStep={currentStep}
              playing={session.transport.playing}
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
          <AgencyToggle value={activeVoice.agency} onChange={handleAgencyChange} />
          <ChatPanel messages={session.messages} onSend={handleSend} />
        </div>
      </div>
    </div>
  );
}
