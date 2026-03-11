// src/ui/App.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioEngine } from '../audio/audio-engine';
import { AudioExporter } from '../audio/audio-exporter';
import type { Session, AIAction, ActionGroupSnapshot, ActionLogEntry } from '../engine/types';
import { getActiveVoice, getVoice } from '../engine/types';
import { VOICE_LABELS } from '../engine/voice-labels';
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
import { ChatView } from './ChatView';
import { InstrumentView } from './InstrumentView';
import type { ViewMode } from './view-types';

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
      let next = s;
      const undoBaseline = s.undoStack.length;
      const moveGroups = new Map<string, { param: string; target: { absolute: number } | { relative: number } }[]>();
      const logEntries: ActionLogEntry[] = [];
      const sayTexts: string[] = [];

      // Snapshot phase: record before values for non-over moves
      const beforeValues = new Map<string, Record<string, number>>();
      for (const action of actions) {
        if (action.type === 'move') {
          const vid = action.voiceId ?? s.activeVoiceId;
          if (!beforeValues.has(vid)) {
            const voice = getVoice(next, vid);
            beforeValues.set(vid, { ...voice.params });
          }
        }
      }

      // Apply phase
      for (const action of actions) {
        switch (action.type) {
          case 'move': {
            const vid = action.voiceId ?? s.activeVoiceId;
            const voice = getVoice(next, vid);
            const vLabel = VOICE_LABELS[vid]?.toUpperCase() ?? vid;
            if (voice.agency === 'ON' && arbRef.current.canAIAct(vid, action.param)) {
              if (action.over) {
                const currentVal = voice.params[action.param] ?? 0;
                const rawTarget = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
                const targetVal = Math.max(0, Math.min(1, rawTarget));
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
                logEntries.push({
                  voiceId: vid,
                  voiceLabel: vLabel,
                  description: `${action.param} ${currentVal.toFixed(2)} → ${targetVal.toFixed(2)} (drift ${action.over}ms)`,
                });
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
              const vLabel = VOICE_LABELS[action.voiceId]?.toUpperCase() ?? action.voiceId;
              logEntries.push({
                voiceId: action.voiceId,
                voiceLabel: vLabel,
                description: `pattern: ${action.description}`,
              });
            }
            break;
          }
          case 'say':
            sayTexts.push(action.text);
            break;
        }
      }

      // Apply batched move groups
      for (const [vid, moves] of moveGroups) {
        const before = beforeValues.get(vid) ?? {};
        next = moves.length === 1
          ? applyMove(next, vid, moves[0].param, moves[0].target)
          : applyMoveGroup(next, vid, moves);
        const after = getVoice(next, vid).params;
        const vLabel = VOICE_LABELS[vid]?.toUpperCase() ?? vid;
        for (const move of moves) {
          const oldVal = before[move.param] ?? 0;
          const newVal = after[move.param] ?? 0;
          logEntries.push({
            voiceId: vid,
            voiceLabel: vLabel,
            description: `${move.param} ${oldVal.toFixed(2)} → ${newVal.toFixed(2)}`,
          });
        }
      }

      // Collapse multiple snapshots from this response into a single undo group
      const newSnapshots = next.undoStack.slice(undoBaseline);
      if (newSnapshots.length > 1) {
        const sayText = sayTexts.join(' ');
        const voiceCount = new Set(logEntries.map(e => e.voiceId)).size;
        const undoDesc = sayText || `AI: ${logEntries.length} changes across ${voiceCount} voice${voiceCount !== 1 ? 's' : ''}`;
        const group: ActionGroupSnapshot = {
          kind: 'group',
          snapshots: newSnapshots.filter((e): e is Exclude<typeof e, ActionGroupSnapshot> => e.kind !== 'group'),
          timestamp: Date.now(),
          description: undoDesc,
        };
        next = { ...next, undoStack: [...next.undoStack.slice(0, undoBaseline), group] };
      }

      // Message synthesis: one ChatMessage per AI response
      const combinedSay = sayTexts.join(' ');
      if (combinedSay || logEntries.length > 0) {
        next = {
          ...next,
          messages: [...next.messages, {
            role: 'ai' as const,
            text: combinedSay,
            timestamp: Date.now(),
            ...(logEntries.length > 0 ? { actions: logEntries } : {}),
          }],
        };
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
            analyser={audioRef.current.getAnalyser()}
          />
        )}
      </div>
    </div>
  );
}
