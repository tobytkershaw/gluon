import { useState } from 'react';
import type { ListenerMode } from '../ai/api';

interface Props {
  onSubmit: (openaiKey: string, geminiKey: string, listenerMode?: ListenerMode) => void;
  isConfigured: boolean;
  currentOpenaiKey?: string;
  currentGeminiKey?: string;
  listenerMode?: ListenerMode;
  plannerStatus?: 'available' | 'disabled';
  listenerStatus?: 'available' | 'disabled';
  /** When true, the form is disabled (e.g. during an active AI turn). */
  disabled?: boolean;
}

const LISTENER_OPTIONS: { value: ListenerMode; label: string }[] = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'both', label: 'Both (side by side)' },
];

export function ApiKeyInput({ onSubmit, isConfigured, currentOpenaiKey = '', currentGeminiKey = '', listenerMode: currentListenerMode = 'gemini', plannerStatus, listenerStatus, disabled = false }: Props) {
  const [openaiKey, setOpenaiKey] = useState(currentOpenaiKey);
  const [geminiKey, setGeminiKey] = useState(currentGeminiKey);
  const [listener, setListener] = useState<ListenerMode>(currentListenerMode);
  const [expanded, setExpanded] = useState(!isConfigured);

  if (isConfigured && !expanded) {
    return (
      <button
        onClick={() => {
          setOpenaiKey(currentOpenaiKey);
          setGeminiKey(currentGeminiKey);
          setListener(currentListenerMode);
          setExpanded(true);
        }}
        className="flex items-center gap-2 px-3 py-2 bg-zinc-900/50 border border-zinc-800/50 rounded-lg text-[11px] font-mono text-zinc-500 hover:border-zinc-700 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
        API Connected
      </button>
    );
  }

  const canSubmit = openaiKey.trim() || geminiKey.trim();

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !disabled) {
            onSubmit(openaiKey.trim(), geminiKey.trim(), listener);
            setExpanded(false);
          }
        }}
        className="flex flex-col gap-2"
      >
        <div>
          <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-500 mb-1">
            OpenAI API Key
          </div>
          <input
            type="password"
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            disabled={disabled}
            placeholder="sk-..."
            className="w-full bg-zinc-800 text-[11px] font-mono text-zinc-300 placeholder:text-zinc-700 rounded px-2 py-1.5 outline-none border border-zinc-700/50 focus:border-zinc-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
        <div>
          <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-500 mb-1">
            Google API Key
          </div>
          <input
            type="password"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            disabled={disabled}
            placeholder="AIza..."
            className="w-full bg-zinc-800 text-[11px] font-mono text-zinc-300 placeholder:text-zinc-700 rounded px-2 py-1.5 outline-none border border-zinc-700/50 focus:border-zinc-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
        <div>
          <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-500 mb-1">
            Listener Provider
          </div>
          <select
            value={listener}
            onChange={(e) => setListener(e.target.value as ListenerMode)}
            disabled={disabled}
            className="w-full bg-zinc-800 text-[11px] font-mono text-zinc-300 rounded px-2 py-1.5 outline-none border border-zinc-700/50 focus:border-zinc-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {LISTENER_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {disabled && (
          <div className="text-[10px] text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1" data-testid="api-key-turn-warning">
            AI turn in progress — changing settings will cancel it.
          </div>
        )}
        {(plannerStatus || listenerStatus) && (
          <div className="flex gap-3 text-[10px] text-zinc-500" data-testid="per-model-status">
            <span className="flex items-center gap-1">
              <span className={`w-1 h-1 rounded-full ${plannerStatus === 'available' ? 'bg-teal-500' : 'bg-zinc-600'}`} />
              Planner: {plannerStatus === 'available' ? 'connected' : 'off'}
            </span>
            <span className="flex items-center gap-1">
              <span className={`w-1 h-1 rounded-full ${listenerStatus === 'available' ? 'bg-teal-500' : 'bg-zinc-600'}`} />
              Listener: {listenerStatus === 'available' ? 'connected' : 'off'}
            </span>
          </div>
        )}
        <button
          type="submit"
          disabled={!canSubmit || disabled}
          className="text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:text-zinc-700 disabled:hover:bg-zinc-800 rounded transition-colors self-end"
        >
          {isConfigured ? 'Update' : 'Connect'}
        </button>
      </form>
    </div>
  );
}
