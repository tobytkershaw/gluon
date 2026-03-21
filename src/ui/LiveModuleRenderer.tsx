// src/ui/LiveModuleRenderer.tsx
// Lightweight card wrapper for a single live control module in the Live Controls panel.
// Renders knobs using simple range-based controls (not full Surface module renderers).
import { useCallback, useRef } from 'react';
import type { LiveControlModule, Track, BindingTarget } from '../engine/types';
import { resolveBinding, writeBinding } from '../engine/binding-resolver';
import { computeThumbprintColor } from './thumbprint';

interface LiveModuleRendererProps {
  liveModule: LiveControlModule;
  track: Track | undefined;
  onTouch: (moduleId: string) => void;
  onAddToSurface: (liveModule: LiveControlModule) => void;
  onParamChange?: (param: string, value: number) => void;
  onProcessorParamChange?: (processorId: string, param: string, value: number) => void;
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

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract a human-readable label from a binding target (string or typed). */
function bindingLabel(target: string | BindingTarget): string {
  if (typeof target === 'string') return target;
  switch (target.kind) {
    case 'source': return target.param;
    case 'processor': return `${target.processorId}:${target.param}`;
    case 'modulator': return `${target.modulatorId}:${target.param}`;
    case 'mix': return target.param;
    case 'drumPad': return `${target.padId}:${target.param}`;
    case 'generator': return `${target.generatorId}:${target.param}`;
    case 'paramShape': return `${target.shapeId}:${target.param}`;
    case 'region': return `region:${target.patternId}`;
    case 'chain': return 'chain';
    case 'kit': return 'kit';
    case 'weighted': return 'macro';
    default: return 'unknown';
  }
}

// ── Module card ─────────────────────────────────────────────────────────────

export function LiveModuleRenderer({ liveModule, track, onTouch, onAddToSurface, onParamChange, onProcessorParamChange }: LiveModuleRendererProps) {
  const mod = liveModule.module;
  const trackName = track?.name ?? liveModule.trackId;
  const accentColor = track ? computeThumbprintColor(track) : 'rgb(167 139 250)';

  const handleKnobChange = useCallback((target: BindingTarget, value: number) => {
    onTouch(liveModule.id);
    if (!track) return;
    const result = writeBinding(track, target, value);
    if (result.status === 'ok') {
      for (const m of result.mutations) {
        if (m.kind === 'sourceParam' && onParamChange) {
          onParamChange(m.param, m.value);
        } else if (m.kind === 'processorParam' && onProcessorParamChange) {
          onProcessorParamChange(m.processorId, m.param, m.value);
        }
      }
    }
  }, [liveModule.id, track, onTouch, onParamChange, onProcessorParamChange]);

  const handleAddToSurface = useCallback(() => {
    onAddToSurface(liveModule);
  }, [liveModule, onAddToSurface]);

  // Resolve knob values from binding contract
  const knobEntries = mod.bindings
    .filter(b => b.role === 'control')
    .map(b => {
      const target: BindingTarget = typeof b.target === 'string'
        ? { kind: 'source', param: b.target } as BindingTarget
        : b.target as BindingTarget;
      let value = 0.5;
      let disconnected = false;
      if (track) {
        const resolved = resolveBinding(track, target);
        if (resolved.status === 'ok' && 'value' in resolved) {
          value = resolved.value;
        } else {
          disconnected = true;
        }
      }
      return {
        label: bindingLabel(b.target),
        value,
        target,
        disconnected,
      };
    });

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
              <div key={k.label} className={k.disconnected ? 'opacity-40 pointer-events-none' : ''}>
                <LiveKnob
                  label={k.label}
                  value={k.value}
                  accentColor={accentColor}
                  onChange={v => handleKnobChange(k.target, v)}
                />
              </div>
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
