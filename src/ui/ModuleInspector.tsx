// src/ui/ModuleInspector.tsx
// Inspector panel for a selected processor: sliders, mode selector, remove button.
import { useState, useRef, useEffect } from 'react';
import type { ProcessorConfig } from '../engine/types';
import { getProcessorInstrument } from '../audio/instrument-registry';

interface Props {
  processor: ProcessorConfig;
  onParamChange: (processorId: string, param: string, value: number) => void;
  onModelChange: (processorId: string, model: number) => void;
  onRemove: (processorId: string) => void;
}

export function ModuleInspector({ processor, onParamChange, onModelChange, onRemove }: Props) {
  const inst = getProcessorInstrument(processor.type);
  if (!inst) return null;

  const engine = inst.engines[processor.model] ?? inst.engines[0];
  const controls = engine?.controls ?? [];

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-sky-300">{inst.label}</span>
        <button
          onClick={() => onRemove(processor.id)}
          className="text-[9px] text-zinc-600 hover:text-red-400 uppercase tracking-widest transition-colors"
        >
          Remove
        </button>
      </div>

      {/* Mode selector */}
      {inst.engines.length > 1 && (
        <ModeSelector
          engines={inst.engines}
          currentModel={processor.model}
          onChange={(model) => onModelChange(processor.id, model)}
        />
      )}

      {/* Control sliders */}
      <div className="space-y-2">
        {controls.map((control) => (
          <ControlSlider
            key={control.id}
            label={control.name}
            value={processor.params[control.id] ?? control.range.default}
            onChange={(value) => onParamChange(processor.id, control.id, value)}
          />
        ))}
      </div>
    </div>
  );
}

function ModeSelector({ engines, currentModel, onChange }: {
  engines: { id: string; label: string }[];
  currentModel: number;
  onChange: (model: number) => void;
}) {
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
        className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/50 border border-zinc-700/50 rounded text-[10px] hover:border-zinc-600 transition-colors w-full"
      >
        <span className="text-zinc-400 flex-1 text-left truncate">{engines[currentModel]?.label ?? 'Unknown'}</span>
        <svg className={`w-2.5 h-2.5 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 12 12">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-full bg-zinc-900 border border-zinc-700 rounded p-1 z-50 shadow-xl">
          {engines.map((engine, i) => (
            <button
              key={engine.id}
              onClick={() => { onChange(i); setOpen(false); }}
              className={`block w-full text-left px-2 py-1 rounded text-[10px] transition-colors ${
                i === currentModel
                  ? 'bg-sky-400/10 text-sky-300'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
            >
              {engine.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ControlSlider({ label, value, onChange }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-zinc-500 w-16 truncate">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 accent-sky-400 cursor-pointer"
      />
      <span className="text-[9px] text-zinc-500 w-8 text-right font-mono">{value.toFixed(2)}</span>
    </div>
  );
}
