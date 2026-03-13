import { useState, useRef } from 'react';

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
  /** Render as a floating standalone box rather than an inline sidebar element */
  floating?: boolean;
}

export function ChatComposer({ onSend, disabled = false, floating = false }: Props) {
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
      className={`flex items-center gap-2 ${
        floating
          ? 'bg-zinc-800/90 border border-zinc-700/50 rounded-xl px-4 py-3 shadow-lg shadow-black/30 backdrop-blur-sm'
          : 'bg-zinc-800/60 border border-zinc-700/40 rounded-lg mx-3 mb-3 px-3 py-2'
      }`}
    >
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={disabled ? 'Thinking...' : 'Describe what you want...'}
        disabled={disabled}
        autoComplete="off"
        className={`flex-1 bg-transparent text-zinc-200 placeholder:text-zinc-600 outline-none font-mono min-w-0 ${
          floating ? 'text-[12px] py-0.5' : 'text-[11px]'
        }`}
      />
      <button
        type="submit"
        disabled={disabled || !input.trim()}
        className={`shrink-0 rounded-full flex items-center justify-center transition-colors ${
          floating
            ? 'w-7 h-7 bg-amber-400/15 text-amber-400/80 disabled:bg-zinc-800 disabled:text-zinc-700 hover:bg-amber-400/25 hover:text-amber-300'
            : 'w-6 h-6 text-amber-400/70 disabled:text-zinc-800 hover:text-amber-300'
        }`}
      >
        <svg viewBox="0 0 16 16" className={`fill-current ${floating ? 'w-3.5 h-3.5' : 'w-3 h-3'}`}>
          <path d="M2 2l12 6-12 6V9.5l7-.5-7-.5V2z" />
        </svg>
      </button>
    </form>
  );
}
