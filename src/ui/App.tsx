// src/ui/App.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioEngine } from '../audio/audio-engine';
import { Session, AIAction } from '../engine/types';
import { createSession, setLeash, setAgency, updateVoiceParams, setModel } from '../engine/session';
import { applyMove, applyMoveGroup, applyParamDirect, applySuggest, applyAudition, cancelAuditionParam, applyUndo, commitPending, dismissPending } from '../engine/primitives';
import { GluonAI } from '../ai/api';
import { Arbitrator } from '../engine/arbitration';
import { AutomationEngine } from '../ai/automation';
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

export default function App() {
  const [session, setSession] = useState<Session>(createSession);
  const [audioStarted, setAudioStarted] = useState(false);
  const [apiConfigured, setApiConfigured] = useState(false);
  const audioRef = useRef(new AudioEngine());
  const aiRef = useRef(new GluonAI());
  const arbRef = useRef(new Arbitrator());
  const autoRef = useRef(new AutomationEngine());
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const startAudio = useCallback(async () => {
    await audioRef.current.start();
    setAudioStarted(true);
  }, []);

  useEffect(() => {
    if (!audioStarted) return;
    audioRef.current.setParams(session.voice.params);
    audioRef.current.setModel(session.voice.model);
  }, [session.voice.params, session.voice.model, audioStarted]);

  const dispatchAIActions = useCallback((actions: AIAction[]) => {
    setSession((s) => {
      let next = s;
      const moveActions: { param: string; target: { absolute: number } | { relative: number } }[] = [];

      for (const action of actions) {
        switch (action.type) {
          case 'move':
            if (arbRef.current.canAIAct(action.param)) {
              if (action.over) {
                const currentVal = next.voice.params[action.param] ?? 0;
                const targetVal = 'absolute' in action.target ? action.target.absolute : currentVal + action.target.relative;
                next = {
                  ...next,
                  undoStack: [...next.undoStack, {
                    prevValues: { [action.param]: currentVal },
                    aiTargetValues: { [action.param]: targetVal },
                    timestamp: Date.now(),
                    description: `AI drift: ${action.param} ${currentVal.toFixed(2)} -> ${targetVal.toFixed(2)} over ${action.over}ms`,
                  }],
                };
                autoRef.current.start(action.param, currentVal, targetVal, action.over, (param, value) => {
                  setSession((s2) => applyParamDirect(s2, param, value));
                });
                autoRef.current.startLoop();
              } else {
                moveActions.push({ param: action.param, target: action.target });
              }
            }
            break;
          case 'suggest':
            if (next.voice.agency !== 'OFF') {
              next = applySuggest(next, action.changes, action.reason);
            }
            break;
          case 'audition':
            if (next.voice.agency === 'PLAY') {
              next = applyAudition(next, action.changes, action.duration);
            }
            break;
          case 'say':
            next = {
              ...next,
              messages: [...next.messages, { role: 'ai' as const, text: action.text, timestamp: Date.now() }],
            };
            break;
          case 'sketch':
            next = {
              ...next,
              messages: [...next.messages, {
                role: 'ai' as const,
                text: `[Sketch: ${action.description}] (sketches not yet supported in Phase 1)`,
                timestamp: Date.now(),
              }],
            };
            break;
        }
      }

      if (moveActions.length > 0) {
        next = moveActions.length === 1
          ? applyMove(next, moveActions[0].param, moveActions[0].target)
          : applyMoveGroup(next, moveActions);
      }

      return next;
    });
  }, []);

  const handleParamChange = useCallback((timbre: number, morph: number) => {
    arbRef.current.humanTouched('timbre');
    arbRef.current.humanTouched('morph');
    setSession((s) => {
      let next = cancelAuditionParam(s, 'timbre');
      next = cancelAuditionParam(next, 'morph');
      return updateVoiceParams(next, { timbre, morph }, true);
    });
  }, []);

  const handleNoteChange = useCallback((note: number) => {
    arbRef.current.humanTouched('note');
    setSession((s) => {
      const next = cancelAuditionParam(s, 'note');
      return updateVoiceParams(next, { note }, true);
    });
  }, []);

  const handleHarmonicsChange = useCallback((harmonics: number) => {
    arbRef.current.humanTouched('harmonics');
    setSession((s) => {
      const next = cancelAuditionParam(s, 'harmonics');
      return updateVoiceParams(next, { harmonics }, true);
    });
  }, []);

  const handleModelChange = useCallback((model: number) => {
    setSession((s) => setModel(s, model));
  }, []);

  const handleLeashChange = useCallback((value: number) => {
    setSession((s) => setLeash(s, value));
  }, []);

  const handleAgencyChange = useCallback((agency: 'OFF' | 'SUGGEST' | 'PLAY') => {
    setSession((s) => setAgency(s, agency));
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo]);

  useEffect(() => {
    if (!audioStarted) return;
    const interval = setInterval(async () => {
      const s = sessionRef.current;
      if (!aiRef.current.isConfigured()) return;
      if (s.voice.agency === 'OFF') return;
      if (s.leash < 0.3) return;
      const actions = await aiRef.current.react(s);
      if (actions.length > 0) dispatchAIActions(actions);
    }, 3000);
    return () => clearInterval(interval);
  }, [audioStarted, dispatchAIActions]);

  useEffect(() => {
    if (session.pending.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setSession((s) => {
        const expired = s.pending.filter((p) => p.type === 'audition' && p.expiresAt < now);
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
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-light tracking-wider text-zinc-400">GLUON</h1>
            <div className="flex items-center gap-4">
              <ModelSelector model={session.voice.model} onChange={handleModelChange} />
              <UndoButton onClick={handleUndo} disabled={session.undoStack.length === 0} />
            </div>
          </div>
          <div className="relative flex-1 min-h-0">
            <ParameterSpace
              timbre={session.voice.params.timbre}
              morph={session.voice.params.morph}
              onChange={handleParamChange}
              onInteractionStart={() => arbRef.current.humanInteractionStart()}
              onInteractionEnd={() => arbRef.current.humanInteractionEnd()}
            />
            <PendingOverlay pending={session.pending} onCommit={handleCommit} onDismiss={handleDismiss} />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <Visualiser analyser={audioRef.current.getAnalyser()} />
            </div>
            <PitchControl
              note={session.voice.params.note}
              harmonics={session.voice.params.harmonics}
              onNoteChange={handleNoteChange}
              onHarmonicsChange={handleHarmonicsChange}
            />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <ApiKeyInput onSubmit={handleApiKey} isConfigured={apiConfigured} />
          <LeashSlider value={session.leash} onChange={handleLeashChange} />
          <AgencyToggle value={session.voice.agency} onChange={handleAgencyChange} />
          <ChatPanel messages={session.messages} onSend={handleSend} />
        </div>
      </div>
    </div>
  );
}
