import { useState } from 'react';

interface Props {
  onSend: (message: string) => void;
  placeholder?: string;
}

export function ChatComposer({ onSend, placeholder = 'Make it darker...' }: Props) {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-zinc-800/40 p-2 flex gap-2">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-[11px] text-zinc-200 placeholder:text-zinc-700 outline-none font-mono px-2 py-1.5"
      />
      <button
        type="submit"
        disabled={!input.trim()}
        className="text-[9px] font-mono uppercase tracking-wider px-3 py-1.5 text-amber-400 disabled:text-zinc-700 hover:bg-amber-400/10 rounded transition-colors"
      >
        Send
      </button>
    </form>
  );
}
