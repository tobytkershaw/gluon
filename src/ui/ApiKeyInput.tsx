import { useState } from 'react';

interface Props {
  onSubmit: (key: string) => void;
  isConfigured: boolean;
}

export function ApiKeyInput({ onSubmit, isConfigured }: Props) {
  const [key, setKey] = useState('');
  const [expanded, setExpanded] = useState(!isConfigured);

  if (isConfigured && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-2 px-3 py-2 bg-zinc-900/50 border border-zinc-800/50 rounded-lg text-[10px] font-mono text-zinc-500 hover:border-zinc-700 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
        API Connected
      </button>
    );
  }

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3">
      <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-zinc-500 mb-2">
        Anthropic API Key
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) {
            onSubmit(key.trim());
            setExpanded(false);
          }
        }}
        className="flex gap-2"
      >
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-..."
          className="flex-1 bg-zinc-800 text-[11px] font-mono text-zinc-300 placeholder:text-zinc-700 rounded px-2 py-1.5 outline-none border border-zinc-700/50 focus:border-zinc-500 transition-colors min-w-0"
        />
        <button
          type="submit"
          disabled={!key.trim()}
          className="text-[9px] font-mono uppercase tracking-wider px-3 py-1.5 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:text-zinc-700 disabled:hover:bg-zinc-800 rounded transition-colors shrink-0"
        >
          {isConfigured ? 'Update' : 'Connect'}
        </button>
      </form>
    </div>
  );
}
