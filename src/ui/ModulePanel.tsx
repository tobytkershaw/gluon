// src/ui/ModulePanel.tsx
// Eurorack-style vertical module panel for the Rack view grid layout.
// Displays large knobs for primary controls, small knobs for secondary,
// toggles for booleans, and a mode selector for multi-engine modules.
import { useState, useRef, useEffect } from 'react';
import type { ControlDef } from './module-controls';
import { Knob } from './Knob';
import type { KnobModulationInfo } from './Knob';

// --- Accent color mapping ---

const ACCENT = {
  amber: {
    header: 'text-amber-300',
    headerBg: 'bg-amber-400/5',
    border: 'border-amber-400/20',
    highlight: 'border-amber-400/40',
    modeBg: 'bg-amber-400/10 text-amber-300',
    toggleOn: 'bg-amber-400/80 text-zinc-900',
    toggleOff: 'bg-zinc-700/50 text-zinc-400',
    selectorActive: 'bg-amber-400/15 text-amber-300 border-amber-400/30',
    selectorInactive: 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800',
    dot: 'bg-amber-400',
  },
  sky: {
    header: 'text-sky-300',
    headerBg: 'bg-sky-400/5',
    border: 'border-sky-400/20',
    highlight: 'border-sky-400/40',
    modeBg: 'bg-sky-400/10 text-sky-300',
    toggleOn: 'bg-sky-400/80 text-zinc-900',
    toggleOff: 'bg-zinc-700/50 text-zinc-400',
    selectorActive: 'bg-sky-400/15 text-sky-300 border-sky-400/30',
    selectorInactive: 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800',
    dot: 'bg-sky-400',
  },
  violet: {
    header: 'text-violet-300',
    headerBg: 'bg-violet-400/5',
    border: 'border-violet-400/20',
    highlight: 'border-violet-400/40',
    modeBg: 'bg-violet-400/10 text-violet-300',
    toggleOn: 'bg-violet-400/80 text-zinc-900',
    toggleOff: 'bg-zinc-700/50 text-zinc-400',
    selectorActive: 'bg-violet-400/15 text-violet-300 border-violet-400/30',
    selectorInactive: 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800',
    dot: 'bg-violet-400',
  },
};

type AccentColor = keyof typeof ACCENT;

// --- Uniform module height ---
// All modules use the same 2U height for a consistent row baseline.
const MODULE_HEIGHT = 572;

// --- Large knob size for primary controls ---
const LARGE_KNOB_SIZE = 52;
// Small knob size for secondary controls
const SMALL_KNOB_SIZE = 32;

// --- Sub-components ---

/** Toggle switch for boolean controls */
function ToggleControl({ control, accentColor, onChange }: {
  control: ControlDef;
  accentColor: AccentColor;
  onChange: (controlId: string, value: number) => void;
}) {
  const accent = ACCENT[accentColor];
  const isOn = control.value > 0.5;

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[8px] text-zinc-500 text-center leading-tight truncate w-full">
        {control.name}
      </span>
      <button
        type="button"
        onClick={() => onChange(control.id, isOn ? 0 : 1)}
        className={`px-2.5 py-1 rounded text-[9px] font-medium transition-colors ${
          isOn ? accent.toggleOn : accent.toggleOff
        }`}
      >
        {isOn ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

/** Discrete selector for discrete controls (e.g. polyphony 1-4) */
function DiscreteSelector({ control, accentColor, onChange }: {
  control: ControlDef;
  accentColor: AccentColor;
  onChange: (controlId: string, value: number) => void;
}) {
  const accent = ACCENT[accentColor];
  const min = control.range?.min ?? 0;
  const max = control.range?.max ?? 1;
  const steps = [];
  for (let i = min; i <= max; i++) steps.push(i);

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[8px] text-zinc-500 text-center leading-tight truncate w-full">
        {control.name}
      </span>
      <div className="flex gap-0.5">
        {steps.map((step) => (
          <button
            key={step}
            type="button"
            onClick={() => onChange(control.id, (step - min) / (max - min))}
            className={`w-5 h-5 rounded text-[9px] font-mono transition-colors border ${
              Math.round(control.value * (max - min) + min) === step
                ? accent.selectorActive
                : `border-transparent ${accent.selectorInactive}`
            }`}
          >
            {step}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Mode selector dropdown for multi-engine modules */
function ModeSelector({ engines, currentModel, onChange, accentColor }: {
  engines: { index: number; label: string }[];
  currentModel: number;
  onChange: (model: number) => void;
  accentColor: AccentColor;
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
    <div ref={ref} className="relative w-full">
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
        <div className="absolute top-full left-0 mt-1 w-full bg-zinc-900 border border-zinc-700 rounded p-1 z-50 shadow-xl max-h-48 overflow-y-auto">
          {engines.map((engine) => (
            <button
              key={engine.index}
              onClick={() => { onChange(engine.index); setOpen(false); }}
              className={`block w-full text-left px-2 py-1 rounded text-[10px] transition-colors ${
                engine.index === currentModel
                  ? accent.modeBg
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

// --- Main component ---

interface ModulePanelProps {
  label: string;
  accentColor: AccentColor;
  controls: ControlDef[];
  onParamChange: (controlId: string, value: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  isHighlighted?: boolean;
  // Mode selector (optional -- for multi-engine modules)
  engines?: { index: number; label: string }[];
  currentModel?: number;
  onModelChange?: (model: number) => void;
  // Remove button (processors/modulators only)
  onRemove?: () => void;
  // Bypass toggle (processors only)
  enabled?: boolean;
  onToggleEnabled?: () => void;
  // Modulation indicators per control ID (read-only display)
  modulationMap?: Map<string, KnobModulationInfo[]>;
  onModulationClick?: () => void;
  // Extra bottom content (e.g. routing UI for modulators)
  children?: React.ReactNode;
}

export function ModulePanel({
  label, accentColor, controls,
  onParamChange, onInteractionStart, onInteractionEnd,
  isHighlighted, engines, currentModel, onModelChange, onRemove,
  enabled, onToggleEnabled,
  modulationMap, onModulationClick,
  children,
}: ModulePanelProps) {
  const accent = ACCENT[accentColor];
  const isBypassed = enabled === false;

  // Partition controls by size and kind
  const largeKnobs = controls.filter(c => c.size === 'large' && c.kind === 'continuous');
  const smallKnobs = controls.filter(c => c.size === 'small' && c.kind === 'continuous');
  const booleanControls = controls.filter(c => c.kind === 'boolean' || c.kind === 'trigger');
  const discreteControls = controls.filter(c => c.kind === 'discrete' || c.kind === 'enum');

  // Count how many primary knobs to determine panel width
  // Base: 2 columns of large knobs. If > 4 primary, use 3 columns.
  const largeCols = largeKnobs.length > 4 ? 3 : 2;

  return (
    <div
      className={`bg-zinc-900/60 border rounded-lg flex flex-col overflow-hidden shrink-0 ${
        isHighlighted ? accent.highlight : 'border-zinc-800/60'
      } ${isBypassed ? 'opacity-50' : ''}`}
      style={{ width: largeCols === 3 ? 220 : 168, height: MODULE_HEIGHT }}
    >
      {/* Header bar */}
      <div className={`flex items-center justify-between gap-1 px-3 py-1.5 ${accent.headerBg} border-b border-zinc-800/40`}>
        <div className="flex items-center gap-1.5 min-w-0">
          {onToggleEnabled ? (
            <button
              type="button"
              onClick={onToggleEnabled}
              className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                isBypassed ? 'bg-zinc-600' : accent.dot
              }`}
              title={isBypassed ? 'Enable' : 'Bypass'}
            />
          ) : (
            <div className={`w-1.5 h-1.5 rounded-full ${accent.dot} shrink-0`} />
          )}
          <span className={`text-[10px] font-medium truncate ${isBypassed ? 'text-zinc-500 line-through' : accent.header}`}>{label}</span>
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-[8px] text-zinc-600 hover:text-red-400 uppercase tracking-widest transition-colors shrink-0"
          >
            x
          </button>
        )}
      </div>

      {/* Body — scrollable when content overflows fixed height */}
      <div className="flex flex-col gap-2.5 p-2.5 flex-1 min-h-0 overflow-y-auto">
        {/* Mode selector */}
        {engines && engines.length > 1 && onModelChange && currentModel !== undefined && (
          <ModeSelector
            engines={engines}
            currentModel={currentModel}
            onChange={onModelChange}
            accentColor={accentColor}
          />
        )}

        {/* Empty-engine placeholder */}
        {controls.length === 0 && (
          <div className="flex items-center justify-center py-6 text-zinc-500 text-[10px] font-mono uppercase tracking-wider">
            Select an engine
          </div>
        )}

        {/* Primary knobs (large) */}
        {largeKnobs.length > 0 && (
          <div
            className="grid justify-items-center gap-y-2 gap-x-1"
            style={{ gridTemplateColumns: `repeat(${largeCols}, 1fr)` }}
          >
            {largeKnobs.map((control) => (
              <Knob
                key={control.id}
                label={control.name}
                value={control.value}
                accentColor={accentColor}
                onChange={(value) => onParamChange(control.id, value)}
                onPointerDown={onInteractionStart}
                onPointerUp={onInteractionEnd}
                size={LARGE_KNOB_SIZE}
                modulations={modulationMap?.get(control.id)}
                onModulationClick={onModulationClick}
              />
            ))}
          </div>
        )}

        {/* Secondary knobs (small) */}
        {smallKnobs.length > 0 && (
          <>
            <div className="border-t border-zinc-800/40" />
            <div className="flex flex-wrap justify-center gap-2">
              {smallKnobs.map((control) => (
                <Knob
                  key={control.id}
                  label={control.name}
                  value={control.value}
                  accentColor={accentColor}
                  onChange={(value) => onParamChange(control.id, value)}
                  onPointerDown={onInteractionStart}
                  onPointerUp={onInteractionEnd}
                  size={SMALL_KNOB_SIZE}
                  modulations={modulationMap?.get(control.id)}
                  onModulationClick={onModulationClick}
                />
              ))}
            </div>
          </>
        )}

        {/* Boolean toggles + discrete selectors */}
        {(booleanControls.length > 0 || discreteControls.length > 0) && (
          <>
            <div className="border-t border-zinc-800/40" />
            <div className="flex flex-wrap justify-center gap-2">
              {booleanControls.map((control) => (
                <ToggleControl
                  key={control.id}
                  control={control}
                  accentColor={accentColor}
                  onChange={onParamChange}
                />
              ))}
              {discreteControls.map((control) => (
                <DiscreteSelector
                  key={control.id}
                  control={control}
                  accentColor={accentColor}
                  onChange={onParamChange}
                />
              ))}
            </div>
          </>
        )}

        {/* Extra children (routing UI, etc.) */}
        {children}
      </div>
    </div>
  );
}
