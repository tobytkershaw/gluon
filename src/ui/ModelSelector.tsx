import { useState, useRef, useEffect } from 'react';
import { getModelList } from '../audio/instrument-registry';

const PLAITS_MODELS = getModelList();

interface Props {
  model: number;
  onChange: (model: number) => void;
}

export function ModelSelector({ model, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs hover:border-zinc-600 transition-colors"
      >
        <span className="font-mono text-amber-400 text-[10px]">
          {String(model).padStart(2, '0')}
        </span>
        <span className="text-zinc-300 text-[11px] font-medium">
          {PLAITS_MODELS[model].name}
        </span>
        <svg className={`w-3 h-3 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 12 12">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-lg p-2 grid grid-cols-4 gap-1 z-50 shadow-2xl shadow-black/50"
          style={{ width: '380px', animation: 'fade-up 0.12s ease-out' }}
        >
          {PLAITS_MODELS.map((m) => (
            <button
              key={m.index}
              onClick={() => { onChange(m.index); setOpen(false); }}
              className={`text-left px-2 py-2 rounded transition-colors ${
                m.index === model
                  ? 'bg-amber-400/10 border border-amber-400/25 text-amber-200'
                  : 'border border-transparent text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
              }`}
            >
              <div className="font-mono text-[8px] leading-none opacity-40 mb-1">
                {String(m.index).padStart(2, '0')}
              </div>
              <div className="text-[10px] font-medium leading-tight">
                {m.name}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
