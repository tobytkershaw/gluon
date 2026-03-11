// src/ui/ListenerSpike.tsx
// Spike UI: Gemini Live API audio listener experiment

import { useState, useRef, useCallback } from 'react';
import { AudioListener, SPIKE_QUESTIONS } from '../ai/listener';
import type { ListenerResult, ListenerStatus } from '../ai/listener';

interface Props {
  getMediaStream: () => MediaStream | null;
}

export function ListenerSpike({ getMediaStream }: Props) {
  const [status, setStatus] = useState<ListenerStatus>('idle');
  const [results, setResults] = useState<ListenerResult[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const listenerRef = useRef<AudioListener | null>(null);

  const handleConnect = useCallback(async () => {
    const stream = getMediaStream();
    if (!stream) return;

    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    if (!apiKey) return;

    const listener = new AudioListener({
      onStatus: setStatus,
      onResult: (r) => setResults((prev) => [...prev, r]),
    });

    listenerRef.current = listener;
    await listener.connect(apiKey, stream);
  }, [getMediaStream]);

  const handleDisconnect = useCallback(() => {
    listenerRef.current?.disconnect();
    listenerRef.current = null;
  }, []);

  const handleAsk = useCallback((question: string) => {
    listenerRef.current?.ask(question);
  }, []);

  const handleRunAll = useCallback(() => {
    if (!listenerRef.current) return;
    let i = 0;
    const next = () => {
      if (i >= SPIKE_QUESTIONS.length) return;
      listenerRef.current?.ask(SPIKE_QUESTIONS[i]);
      setCurrentQ(i);
      i++;
      setTimeout(next, 8000); // 8s between questions to let audio accumulate
    };
    next();
  }, []);

  const statusColor: Record<ListenerStatus, string> = {
    idle: 'text-zinc-600',
    connecting: 'text-amber-400 animate-pulse',
    listening: 'text-teal-400',
    error: 'text-red-400',
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-zinc-500">
          Listener Spike
        </div>
        <div className={`text-[9px] font-mono ${statusColor[status]}`}>
          {status}
        </div>
      </div>

      <div className="flex gap-1.5">
        {status === 'idle' || status === 'error' ? (
          <button
            onClick={handleConnect}
            className="flex-1 text-[9px] font-mono uppercase tracking-wider py-1.5 bg-teal-400/15 text-teal-300 hover:bg-teal-400/25 rounded transition-colors"
          >
            Connect
          </button>
        ) : (
          <button
            onClick={handleDisconnect}
            className="flex-1 text-[9px] font-mono uppercase tracking-wider py-1.5 bg-red-400/15 text-red-300 hover:bg-red-400/25 rounded transition-colors"
          >
            Disconnect
          </button>
        )}
        {status === 'listening' && (
          <button
            onClick={handleRunAll}
            className="flex-1 text-[9px] font-mono uppercase tracking-wider py-1.5 bg-violet-400/15 text-violet-300 hover:bg-violet-400/25 rounded transition-colors"
          >
            Run All Questions
          </button>
        )}
      </div>

      {status === 'listening' && (
        <div className="flex flex-col gap-1">
          <div className="text-[8px] font-mono text-zinc-600 uppercase">Quick ask:</div>
          {SPIKE_QUESTIONS.slice(0, 4).map((q, i) => (
            <button
              key={i}
              onClick={() => handleAsk(q)}
              className="text-left text-[9px] font-mono text-zinc-400 hover:text-zinc-200 py-0.5 px-1.5 rounded hover:bg-zinc-800/50 transition-colors truncate"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
          <div className="text-[8px] font-mono text-zinc-600 uppercase">Results ({results.length})</div>
          {results.map((r, i) => (
            <div key={i} className="bg-zinc-800/50 rounded p-2">
              <div className="text-[8px] font-mono text-violet-400 mb-1">{r.question}</div>
              <div className="text-[10px] text-zinc-300 leading-relaxed">{r.answer}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
