import { useState, useRef } from 'react';

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatComposer({ onSend, disabled = false }: Props) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex-1 flex items-center gap-1.5 px-2"
    >
      <div className="flex-1 flex items-center gap-1.5 bg-zinc-900/80 border border-zinc-800/60 rounded px-2 py-1">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ? 'Thinking...' : 'Describe what you want...'}
          disabled={disabled}
          autoComplete="off"
          className="flex-1 bg-transparent text-zinc-200 placeholder:text-zinc-600 outline-none font-mono min-w-0 text-[11px]"
        />
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="shrink-0 rounded-full flex items-center justify-center transition-colors w-5 h-5 text-amber-400/70 disabled:text-zinc-700 hover:text-amber-300"
        >
          <svg viewBox="0 0 16 16" className="fill-current w-3 h-3">
            <path d="M2 2l12 6-12 6V9.5l7-.5-7-.5V2z" />
          </svg>
        </button>
      </div>
    </form>
  );
}
