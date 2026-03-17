import { useState } from 'react';

interface Props {
  onSubmit: (openaiKey: string, geminiKey: string) => void;
  isConfigured: boolean;
  currentOpenaiKey?: string;
  currentGeminiKey?: string;
}

export function ApiKeyInput({ onSubmit, isConfigured, currentOpenaiKey = '', currentGeminiKey = '' }: Props) {
  const [openaiKey, setOpenaiKey] = useState(currentOpenaiKey);
  const [geminiKey, setGeminiKey] = useState(currentGeminiKey);
  const [expanded, setExpanded] = useState(!isConfigured);

  if (isConfigured && !expanded) {
    return (
      <button
        onClick={() => {
          setOpenaiKey(currentOpenaiKey);
          setGeminiKey(currentGeminiKey);
          setExpanded(true);
        }}
        className="flex items-center gap-2 px-3 py-2 bg-zinc-900/50 border border-zinc-800/50 rounded-lg text-[11px] font-mono text-zinc-500 hover:border-zinc-700 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
        API Connected
      </button>
    );
  }

  const canSubmit = openaiKey.trim() && geminiKey.trim();

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) {
            onSubmit(openaiKey.trim(), geminiKey.trim());
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
            placeholder="sk-..."
            className="w-full bg-zinc-800 text-[11px] font-mono text-zinc-300 placeholder:text-zinc-700 rounded px-2 py-1.5 outline-none border border-zinc-700/50 focus:border-zinc-500 transition-colors"
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
            placeholder="AIza..."
            className="w-full bg-zinc-800 text-[11px] font-mono text-zinc-300 placeholder:text-zinc-700 rounded px-2 py-1.5 outline-none border border-zinc-700/50 focus:border-zinc-500 transition-colors"
          />
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:text-zinc-700 disabled:hover:bg-zinc-800 rounded transition-colors self-end"
        >
          {isConfigured ? 'Update' : 'Connect'}
        </button>
      </form>
    </div>
  );
}
