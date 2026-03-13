// src/ui/ControlSection.tsx
// Grouped control section for one module (source or processor).
import { useState, useRef, useEffect } from 'react';

interface ControlDef {
  id: string;
  name: string;
  value: number;
}

interface ControlSectionProps {
  label: string;
  accentColor: 'amber' | 'sky';
  controls: ControlDef[];
  onParamChange: (controlId: string, value: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  isHighlighted?: boolean;
  // Mode selector (optional — for multi-engine modules)
  engines?: { index: number; label: string }[];
  currentModel?: number;
  onModelChange?: (model: number) => void;
  // Remove button (processors only)
  onRemove?: () => void;
}

const ACCENT = {
  amber: {
    header: 'text-amber-300',
    slider: 'accent-amber-400',
    border: 'border-amber-400/20',
    highlight: 'border-amber-400/40',
    modeBg: 'bg-amber-400/10 text-amber-300',
  },
  sky: {
    header: 'text-sky-300',
    slider: 'accent-sky-400',
    border: 'border-sky-400/20',
    highlight: 'border-sky-400/40',
    modeBg: 'bg-sky-400/10 text-sky-300',
  },
};

export function ControlSection({
  label, accentColor, controls,
  onParamChange, onInteractionStart, onInteractionEnd,
  isHighlighted, engines, currentModel, onModelChange, onRemove,
}: ControlSectionProps) {
  const accent = ACCENT[accentColor];

  return (
    <div className={`bg-zinc-900/50 border rounded-lg p-3 space-y-3 ${
      isHighlighted ? accent.highlight : 'border-zinc-800/50'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] font-medium ${accent.header}`}>{label}</span>
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-[9px] text-zinc-600 hover:text-red-400 uppercase tracking-widest transition-colors"
          >
            Remove
          </button>
        )}
      </div>

      {/* Mode selector */}
      {engines && engines.length > 1 && onModelChange && currentModel !== undefined && (
        <ModeSelector
          engines={engines}
          currentModel={currentModel}
          onChange={onModelChange}
          accentColor={accentColor}
        />
      )}

      {/* Control sliders */}
      <div className="space-y-2">
        {controls.map((control) => (
          <ControlSlider
            key={control.id}
            label={control.name}
            value={control.value}
            accentClass={accent.slider}
            onChange={(value) => onParamChange(control.id, value)}
            onPointerDown={onInteractionStart}
            onPointerUp={onInteractionEnd}
          />
        ))}
      </div>
    </div>
  );
}

function ModeSelector({ engines, currentModel, onChange, accentColor }: {
  engines: { index: number; label: string }[];
  currentModel: number;
  onChange: (model: number) => void;
  accentColor: 'amber' | 'sky';
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

  const accent = ACCENT[accentColor];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/50 border border-zinc-700/50 rounded text-[10px] hover:border-zinc-600 transition-colors w-full"
      >
        <span className="text-zinc-400 flex-1 text-left truncate">
          {engines.find(e => e.index === currentModel)?.label ?? 'Unknown'}
        </span>
        <svg className={`w-2.5 h-2.5 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 12 12">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-full bg-zinc-900 border border-zinc-700 rounded p-1 z-50 shadow-xl">
          {engines.map((engine) => (
            <button
              key={engine.index}
              onClick={() => { onChange(engine.index); setOpen(false); }}
              className={`block w-full text-left px-2 py-1 rounded text-[10px] transition-colors ${
                engine.index === currentModel
                  ? `${accent.modeBg}`
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

function ControlSlider({ label, value, accentClass, onChange, onPointerDown, onPointerUp }: {
  label: string;
  value: number;
  accentClass: string;
  onChange: (value: number) => void;
  onPointerDown: () => void;
  onPointerUp: () => void;
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
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        className={`flex-1 h-1 ${accentClass} cursor-pointer`}
      />
      <span className="text-[9px] text-zinc-500 w-8 text-right font-mono">{value.toFixed(2)}</span>
    </div>
  );
}
