import { useState } from 'react';

interface Props {
  onSend: (message: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ChatComposer({ onSend, placeholder = 'Make it darker...', disabled = false }: Props) {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
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
        placeholder={disabled ? 'Thinking...' : placeholder}
        disabled={disabled}
        className="flex-1 bg-transparent text-[11px] text-zinc-200 placeholder:text-zinc-700 outline-none font-mono px-2 py-1.5 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || !input.trim()}
        className="text-[9px] font-mono uppercase tracking-wider px-3 py-1.5 text-amber-400 disabled:text-zinc-700 hover:bg-amber-400/10 rounded transition-colors"
      >
        Send
      </button>
    </form>
  );
}
