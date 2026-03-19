// src/ui/ModulePanel.tsx
// Eurorack-style vertical module panel for the Rack view grid layout.
// Displays large knobs for primary controls, small knobs for secondary,
// toggles for booleans, and a mode selector for multi-engine modules.
import { useState, useRef, useEffect, useCallback } from 'react';
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

// --- Knob sizes by tier ---
const LARGE_KNOB_SIZE = 52;
const MEDIUM_KNOB_SIZE = 42;
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
      <span className="text-[10px] text-zinc-500 text-center leading-tight truncate w-full">
        {control.name}
      </span>
      <button
        type="button"
        onClick={() => onChange(control.id, isOn ? 0 : 1)}
        className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
          isOn ? accent.toggleOn : accent.toggleOff
        }`}
      >
        {isOn ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

/** Discrete selector for discrete and enum controls (e.g. polyphony 1-4, portamento mode) */
function DiscreteSelector({ control, accentColor, onChange }: {
  control: ControlDef;
  accentColor: AccentColor;
  onChange: (controlId: string, value: number) => void;
}) {
  const accent = ACCENT[accentColor];

  // Enum controls: render string labels as cycle buttons
  if (control.enumValues && control.enumValues.length > 0) {
    const currentIndex = Math.round(control.value);
    return (
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] text-zinc-500 text-center leading-tight truncate w-full">
          {control.name}
        </span>
        <div className="flex gap-0.5">
          {control.enumValues.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => onChange(control.id, i)}
              className={`px-1.5 h-5 rounded text-[10px] font-mono transition-colors border ${
                currentIndex === i
                  ? accent.selectorActive
                  : `border-transparent ${accent.selectorInactive}`
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Discrete numeric controls
  const min = control.range?.min ?? 0;
  const max = control.range?.max ?? 1;
  const steps = [];
  for (let i = min; i <= max; i++) steps.push(i);

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] text-zinc-500 text-center leading-tight truncate w-full">
        {control.name}
      </span>
      <div className="flex gap-0.5">
        {steps.map((step) => (
          <button
            key={step}
            type="button"
            onClick={() => onChange(control.id, (step - min) / (max - min))}
            className={`w-5 h-5 rounded text-[11px] font-mono transition-colors border ${
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
        className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/50 border border-zinc-700/50 rounded text-[11px] hover:border-zinc-600 transition-colors w-full"
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
              className={`block w-full text-left px-2 py-1 rounded text-[11px] transition-colors ${
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

/** Small pin icon button that appears on hover over knobs */
function PinButton({ isPinned, onClick }: { isPinned: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center transition-all z-10 ${
        isPinned
          ? 'bg-amber-500/90 text-zinc-900 opacity-100'
          : 'bg-zinc-700/80 text-zinc-400 opacity-0 group-hover/knob:opacity-100 hover:bg-zinc-600'
      }`}
      title={isPinned ? 'Unpin from Surface' : 'Pin to Surface'}
    >
      <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 2L14 6.5L10.5 10L11 13.5L7.5 10L3 14.5M3 14.5L6.5 7.5L2.5 6L9.5 2" />
      </svg>
    </button>
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
  // Replace/swap button (processors only)
  onReplace?: () => void;
  // Bypass toggle (processors only)
  enabled?: boolean;
  onToggleEnabled?: () => void;
  // Modulation indicators per control ID
  modulationMap?: Map<string, KnobModulationInfo[]>;
  onModulationClick?: () => void;
  // Modulation depth editing (inline on knobs)
  onModulationDepthChange?: (routeId: string, depth: number) => void;
  onModulationDepthCommit?: (routeId: string, depth: number) => void;
  // Ramp request (Shift+Click on knobs)
  onRampRequest?: (controlId: string, targetValue: number, durationMs: number) => void;
  // Pin-to-Surface (Rack view only)
  onPinControl?: (controlId: string) => void;
  pinnedControlIds?: Set<string>;
  // Extra bottom content (e.g. routing UI for modulators)
  children?: React.ReactNode;
}

export function ModulePanel({
  label, accentColor, controls,
  onParamChange, onInteractionStart, onInteractionEnd,
  isHighlighted, engines, currentModel, onModelChange, onRemove, onReplace,
  enabled, onToggleEnabled,
  modulationMap, onModulationClick,
  onModulationDepthChange, onModulationDepthCommit,
  onRampRequest,
  onPinControl,
  pinnedControlIds,
  children,
}: ModulePanelProps) {
  const accent = ACCENT[accentColor];
  const isBypassed = enabled === false;
  const [isSelected, setIsSelected] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Click to select (for Delete key removal)
  const handlePanelClick = useCallback((e: React.MouseEvent) => {
    // Don't select if clicking on interactive children (knobs, buttons, selectors)
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('select')) return;
    if (onRemove) {
      setIsSelected(prev => !prev);
    }
  }, [onRemove]);

  // Deselect when clicking outside
  useEffect(() => {
    if (!isSelected) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsSelected(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isSelected]);

  // Delete/Backspace key removes selected module
  useEffect(() => {
    if (!isSelected || !onRemove) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't intercept if an input/textarea is focused
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
        e.preventDefault();
        onRemove();
        setIsSelected(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSelected, onRemove]);

  // Partition controls by size and kind
  const largeKnobs = controls.filter(c => c.size === 'large' && c.kind === 'continuous');
  const mediumKnobs = controls.filter(c => c.size === 'medium' && c.kind === 'continuous');
  const smallKnobs = controls.filter(c => c.size === 'small' && c.kind === 'continuous');
  const booleanControls = controls.filter(c => c.kind === 'boolean' || c.kind === 'trigger');
  const discreteControls = controls.filter(c => c.kind === 'discrete' || c.kind === 'enum');

  // Columns per tier and max-width to force wrapping (flex-wrap + justify-center)
  const largeCols = largeKnobs.length > 4 ? 3 : largeKnobs.length === 3 ? 3 : 2;
  const mediumCols = mediumKnobs.length > 4 ? 4 : mediumKnobs.length > 2 ? 3 : 2;
  const smallCols = smallKnobs.length > 6 ? 4 : smallKnobs.length > 2 ? 3 : 2;
  // knob container widths: large=64, medium=54, small=48 (from Knob.tsx)
  const largeMaxW = 64 * largeCols + 16 * (largeCols - 1);
  const mediumMaxW = 54 * mediumCols + 12 * (mediumCols - 1);
  const smallMaxW = 48 * smallCols + 8 * (smallCols - 1);


  return (
    <div
      ref={panelRef}
      className={`bg-zinc-900/60 border rounded-lg flex flex-col overflow-hidden ${
        isSelected ? 'border-red-500/50 ring-1 ring-red-500/30' : isHighlighted ? accent.highlight : 'border-zinc-800/60'
      } ${isBypassed ? 'opacity-50' : ''} ${onRemove ? 'cursor-pointer' : ''}`}
      style={{ minWidth: 148, height: MODULE_HEIGHT }}
      onClick={handlePanelClick}
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
          <span className={`text-[11px] font-medium truncate ${isBypassed ? 'text-zinc-500 line-through' : accent.header}`}>{label}</span>
        </div>
        {/* Swap button (processors only) */}
        {onReplace && (
          <button
            type="button"
            onClick={onReplace}
            className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
            title="Swap processor"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 5h14M11 1l4 4-4 4M15 11H1M5 15l-4-4 4-4" />
            </svg>
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2.5 p-2.5 flex-1 min-h-0">
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
          <div className="flex items-center justify-center py-6 text-zinc-500 text-[11px] font-mono uppercase tracking-wider">
            Select an engine
          </div>
        )}

        {/* Primary knobs (large) */}
        {largeKnobs.length > 0 && (
          <div
            className="flex flex-wrap justify-center gap-y-2 gap-x-4 mx-auto"
            style={{ maxWidth: largeMaxW }}
          >
            {largeKnobs.map((control) => (
              <div key={control.id} className="relative group/knob">
                {onPinControl && (
                  <PinButton
                    isPinned={pinnedControlIds?.has(control.id) ?? false}
                    onClick={() => onPinControl(control.id)}
                  />
                )}
                <Knob
                  label={control.name}
                  value={control.value}
                  accentColor={accentColor}
                  onChange={(value) => onParamChange(control.id, value)}
                  onPointerDown={onInteractionStart}
                  onPointerUp={onInteractionEnd}
                  size={LARGE_KNOB_SIZE}
                  modulations={modulationMap?.get(control.id)}
                  onModulationClick={onModulationClick}
                  displayMapping={control.displayMapping}
                  onModulationDepthChange={onModulationDepthChange}
                  onModulationDepthCommit={onModulationDepthCommit}
                  onRampRequest={onRampRequest ? (target, dur) => onRampRequest(control.id, target, dur) : undefined}
                />
              </div>
            ))}
          </div>
        )}

        {/* Medium knobs (tone/character) */}
        {mediumKnobs.length > 0 && (
          <>
            <div className="border-t border-zinc-800/40" />
            <div
              className="flex flex-wrap justify-center gap-y-2 gap-x-3 mx-auto"
              style={{ maxWidth: mediumMaxW }}
            >
              {mediumKnobs.map((control) => (
                <div key={control.id} className="relative group/knob">
                  {onPinControl && (
                    <PinButton
                      isPinned={pinnedControlIds?.has(control.id) ?? false}
                      onClick={() => onPinControl(control.id)}
                    />
                  )}
                  <Knob
                    label={control.name}
                    value={control.value}
                    accentColor={accentColor}
                    onChange={(value) => onParamChange(control.id, value)}
                    onPointerDown={onInteractionStart}
                    onPointerUp={onInteractionEnd}
                    size={MEDIUM_KNOB_SIZE}
                    modulations={modulationMap?.get(control.id)}
                    onModulationClick={onModulationClick}
                    onRampRequest={onRampRequest ? (target, dur) => onRampRequest(control.id, target, dur) : undefined}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* Small knobs (attenuverters / extended params) */}
        {smallKnobs.length > 0 && (
          <>
            <div className="border-t border-zinc-800/40" />
            <div
              className="flex flex-wrap justify-center gap-y-2 gap-x-2 mx-auto"
              style={{ maxWidth: smallMaxW }}
            >
              {smallKnobs.map((control) => (
                <div key={control.id} className="relative group/knob">
                  {onPinControl && (
                    <PinButton
                      isPinned={pinnedControlIds?.has(control.id) ?? false}
                      onClick={() => onPinControl(control.id)}
                    />
                  )}
                  <Knob
                    label={control.name}
                    value={control.value}
                    accentColor={accentColor}
                    onChange={(value) => onParamChange(control.id, value)}
                    onPointerDown={onInteractionStart}
                    onPointerUp={onInteractionEnd}
                    size={SMALL_KNOB_SIZE}
                    modulations={modulationMap?.get(control.id)}
                    onModulationClick={onModulationClick}
                    onRampRequest={onRampRequest ? (target, dur) => onRampRequest(control.id, target, dur) : undefined}
                  />
                </div>
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
