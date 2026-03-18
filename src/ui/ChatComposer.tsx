import { useState, useRef, useCallback } from 'react';

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
  variant?: 'sidebar' | 'footer';
}

const MAX_HEIGHT = 150;

export function ChatComposer({ onSend, disabled = false, variant = 'footer' }: Props) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resetHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-grow on next frame after React updates the value
    requestAnimationFrame(resetHeight);
  }, [resetHeight]);

  const submit = useCallback(() => {
    if (disabled) return;
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
    // Reset height after clearing
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) ta.style.height = 'auto';
    });
  }, [disabled, input, onSend]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }, [submit]);

  const textareaProps = {
    ref: textareaRef,
    value: input,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    placeholder: 'Describe what you want...',
    autoComplete: 'off' as const,
    rows: 1,
    style: { maxHeight: MAX_HEIGHT, resize: 'none' as const },
  };

  if (variant === 'sidebar') {
    return (
      <form onSubmit={handleSubmit} className="px-3 pb-3 pt-2">
        <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2">
          <textarea
            {...textareaProps}
            className="flex-1 bg-transparent text-zinc-900 placeholder:text-zinc-400 outline-none font-mono min-w-0 text-sm overflow-y-auto"
          />
          <button
            type="submit"
            disabled={disabled || !input.trim()}
            className="shrink-0 rounded-full flex items-center justify-center transition-colors w-6 h-6 text-zinc-900 disabled:text-zinc-300 hover:text-zinc-600"
          >
            <svg viewBox="0 0 16 16" className="fill-current w-3 h-3">
              <path d="M2 2l12 6-12 6V9.5l7-.5-7-.5V2z" />
            </svg>
          </button>
        </div>
      </form>
    );
  }

  // Footer variant: prominent but compact
  return (
    <form
      onSubmit={handleSubmit}
      className="flex-1 flex items-end gap-1.5 px-2"
    >
      <div className="flex-1 flex items-end gap-1.5 bg-zinc-800/50 border border-zinc-700/50 rounded-md px-2.5 py-1.5">
        <textarea
          {...textareaProps}
          className="flex-1 bg-transparent text-zinc-200 placeholder:text-zinc-500 outline-none font-mono min-w-0 text-sm overflow-y-auto"
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
