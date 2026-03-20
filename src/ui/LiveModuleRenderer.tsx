// src/ui/LiveModuleRenderer.tsx
// Lightweight card wrapper for a single live control module in the Live Controls panel.
// Renders knobs using simple range-based controls (not full Surface module renderers).
import { useCallback, useRef } from 'react';
import type { LiveControlModule, Track } from '../engine/types';
import { computeThumbprintColor } from './thumbprint';

interface LiveModuleRendererProps {
  liveModule: LiveControlModule;
  track: Track | undefined;
  onTouch: (moduleId: string) => void;
  onAddToSurface: (liveModule: LiveControlModule) => void;
}

// ── Knob arc helpers (matches MiniKnob conventions) ─────────────────────────

const KNOB_SIZE = 36;
const KNOB_STROKE = 2.5;
const KNOB_R = (KNOB_SIZE - KNOB_STROKE * 2) / 2;
const KNOB_CX = KNOB_SIZE / 2;
const KNOB_CY = KNOB_SIZE / 2;
const ARC_START = 0.75 * Math.PI;
const ARC_SWEEP = 1.5 * Math.PI;

function describeArc(fraction: number): string {
  const startAngle = ARC_START;
  const endAngle = startAngle + ARC_SWEEP * fraction;
  const x1 = KNOB_CX + KNOB_R * Math.cos(startAngle);
  const y1 = KNOB_CY + KNOB_R * Math.sin(startAngle);
  const x2 = KNOB_CX + KNOB_R * Math.cos(endAngle);
  const y2 = KNOB_CY + KNOB_R * Math.sin(endAngle);
  const large = ARC_SWEEP * fraction > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${KNOB_R} ${KNOB_R} 0 ${large} 1 ${x2} ${y2}`;
}

// ── Inline knob (drag to change value) ──────────────────────────────────────

interface LiveKnobProps {
  label: string;
  value: number;
  accentColor: string;
  onChange: (value: number) => void;
}

function LiveKnob({ label, value, accentColor, onChange }: LiveKnobProps) {
  const dragging = useRef(false);
  const startY = useRef(0);
  const startValue = useRef(0);

  const norm = Math.max(0, Math.min(1, value));

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
    startY.current = e.clientY;
    startValue.current = norm;
  }, [norm]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = (startY.current - e.clientY) / 150;
    const newVal = Math.max(0, Math.min(1, startValue.current + delta));
    onChange(newVal);
  }, [onChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wide select-none">{label}</span>
      <svg
        width={KNOB_SIZE}
        height={KNOB_SIZE}
        className="touch-none cursor-pointer"
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Math.round(norm * 100) / 100}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Background arc */}
        <path
          d={describeArc(1)}
          fill="none"
          stroke="rgb(63 63 70)"
          strokeWidth={KNOB_STROKE}
          strokeLinecap="round"
        />
        {/* Value arc */}
        {norm > 0.01 && (
          <path
            d={describeArc(norm)}
            fill="none"
            stroke={accentColor}
            strokeWidth={KNOB_STROKE}
            strokeLinecap="round"
          />
        )}
      </svg>
      <span className="text-[9px] font-mono text-zinc-500 tabular-nums select-none">{norm.toFixed(2)}</span>
    </div>
  );
}

// ── Module card ─────────────────────────────────────────────────────────────

export function LiveModuleRenderer({ liveModule, track, onTouch, onAddToSurface }: LiveModuleRendererProps) {
  const mod = liveModule.module;
  const trackName = track?.name ?? liveModule.trackId;
  const accentColor = track ? computeThumbprintColor(track) : 'rgb(167 139 250)';

  const handleKnobChange = useCallback((_value: number) => {
    // Mark the module as touched on any interaction.
    // Actual param changes are not wired yet (AI population comes later).
    onTouch(liveModule.id);
  }, [liveModule.id, onTouch]);

  const handleAddToSurface = useCallback(() => {
    onAddToSurface(liveModule);
  }, [liveModule, onAddToSurface]);

  // Extract knob values from bindings or config
  const knobs = mod.bindings
    .filter(b => b.role === 'control')
    .map(b => ({
      label: b.target,
      value: (mod.config[b.target] as number) ?? 0.5,
    }));

  // Fallback: if no bindings with role 'control', check config for knob-group style
  const knobEntries = knobs.length > 0
    ? knobs
    : Object.entries(mod.config)
        .filter(([, v]) => typeof v === 'number')
        .map(([key, v]) => ({ label: key, value: v as number }));

  return (
    <div
      className="bg-zinc-900/50 border border-zinc-700/30 rounded-lg overflow-hidden"
      data-testid="live-module-card"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-violet-500/5 border-b border-violet-500/10">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-zinc-200 truncate">{mod.label}</span>
          <span
            className="text-[8px] font-mono uppercase tracking-widest px-1.5 py-px rounded bg-violet-500/10 text-violet-400 shrink-0"
          >
            Live
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {/* Track badge */}
          <span
            className="text-[8px] font-mono uppercase tracking-wide px-1.5 py-px rounded"
            style={{
              color: accentColor,
              background: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${accentColor} 25%, transparent)`,
            }}
          >
            {trackName}
          </span>
          <button
            onClick={handleAddToSurface}
            className="text-[9px] font-mono px-2 py-0.5 rounded border border-amber-400/30 bg-zinc-800/80 text-amber-400 hover:bg-zinc-700/80 transition-colors cursor-pointer"
          >
            Add to Surface
          </button>
        </div>
      </div>

      {/* Body: knobs */}
      {knobEntries.length > 0 && (
        <div className="px-3 py-3">
          <div className="flex gap-4 justify-center">
            {knobEntries.map((k) => (
              <LiveKnob
                key={k.label}
                label={k.label}
                value={k.value}
                accentColor={accentColor}
                onChange={handleKnobChange}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty body fallback */}
      {knobEntries.length === 0 && (
        <div className="px-3 py-3 text-center text-[10px] text-zinc-600 font-mono">
          {mod.type}
        </div>
      )}
    </div>
  );
}
