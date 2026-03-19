// src/ui/Knob.tsx
// General-purpose SVG rotary knob for the Rack view.
// Adapted from SemanticKnob but with configurable accent colors.
import { useRef, useState, useCallback } from 'react';
import type { DisplayMapping } from '../engine/canonical-types';
import { formatDisplayValue } from './format-display-value';
import { DraggableNumber } from './DraggableNumber';
import { RampPopover } from './RampPopover';

/** Modulation info for a single routing targeting this knob */
export interface KnobModulationInfo {
  routeId: string;
  modulatorLabel: string;
  depth: number;  // -1.0 to 1.0
  /** RGB color string for the modulation arc (e.g. "rgb(167 139 250)") */
  color?: string;
}

interface KnobProps {
  value: number;          // 0-1
  label: string;          // control name
  accentColor: string;    // tailwind color name: "amber", "sky", "violet"
  onChange: (value: number) => void;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
  size?: number;          // diameter in px, default 40
  /** Active modulation routings targeting this control */
  modulations?: KnobModulationInfo[];
  /** Called when user clicks on a modulation indicator */
  onModulationClick?: () => void;
  /** Optional display mapping for showing human-readable values with units */
  displayMapping?: DisplayMapping;
  /** Called while dragging a modulation depth value */
  onModulationDepthChange?: (routeId: string, depth: number) => void;
  /** Called when a modulation depth drag completes */
  onModulationDepthCommit?: (routeId: string, depth: number) => void;
  /** Called when user requests a timed ramp (Shift+Click) */
  onRampRequest?: (targetValue: number, durationMs: number) => void;
}

const DEFAULT_SIZE = 40;
const STROKE_WIDTH = 3;
const ARC_START = 0.75 * Math.PI; // 135 degrees
const ARC_SWEEP = 1.5 * Math.PI;  // 270 degree total sweep

const ACCENT_COLORS: Record<string, string> = {
  amber:  'rgb(251 191 36)',  // amber-400
  sky:    'rgb(56 189 248)',   // sky-400
  violet: 'rgb(167 139 250)', // violet-400
  zinc:   'rgb(161 161 170)', // zinc-400
};

function describeArc(cx: number, cy: number, r: number, fraction: number): string {
  const startAngle = ARC_START;
  const endAngle = startAngle + ARC_SWEEP * fraction;
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = ARC_SWEEP * fraction > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

/** Arc between two fractional positions (for modulation range display) */
function describeArcRange(cx: number, cy: number, r: number, from: number, to: number): string {
  const startAngle = ARC_START + ARC_SWEEP * from;
  const endAngle = ARC_START + ARC_SWEEP * to;
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = (endAngle - startAngle) > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

function indicatorPosition(cx: number, cy: number, r: number, fraction: number) {
  const angle = ARC_START + ARC_SWEEP * fraction;
  return {
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  };
}

export function Knob({
  value, label, accentColor, onChange,
  onPointerDown, onPointerUp, size = DEFAULT_SIZE,
  modulations, onModulationClick, displayMapping,
  onModulationDepthChange, onModulationDepthCommit,
  onRampRequest,
}: KnobProps) {
  const [hovered, setHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [rampPopoverOpen, setRampPopoverOpen] = useState(false);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startValue = useRef(0);

  const r = (size - STROKE_WIDTH * 2) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // Support both named accent colors ("amber", "sky") and raw CSS color strings ("rgb(...)", "hsl(...)")
  const accentRgb = ACCENT_COLORS[accentColor] ?? (accentColor.startsWith('rgb') || accentColor.startsWith('hsl') ? accentColor : ACCENT_COLORS.amber);

  const svgRef = useRef<SVGSVGElement>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    // Shift+Click opens ramp popover instead of starting drag
    if (e.shiftKey && onRampRequest) {
      setRampPopoverOpen(true);
      return;
    }
    // Capture on the SVG element itself so drag works even when pointer-down
    // hits a thin stroke or transparent area inside a small knob.
    svgRef.current?.setPointerCapture(e.pointerId);
    dragging.current = true;
    setIsDragging(true);
    startY.current = e.clientY;
    startValue.current = value;
    onPointerDown?.();
  }, [value, onPointerDown, onRampRequest]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    // 200px of vertical drag = full range (0 -> 1)
    const delta = (startY.current - e.clientY) / 200;
    const newValue = Math.max(0, Math.min(1, startValue.current + delta));
    onChange(newValue);
  }, [onChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    svgRef.current?.releasePointerCapture(e.pointerId);
    onPointerUp?.();
  }, [onPointerUp]);

  // Indicator line: short line segment from ~60% of radius to the arc edge
  const ind = indicatorPosition(cx, cy, r, value);
  const indInner = indicatorPosition(cx, cy, r * 0.55, value);

  // Container width adapts to knob size: knob + some padding for label
  const containerWidth = Math.max(size + 12, 48);
  const isSmall = size < 40;

  const handleRampStart = useCallback((target: number, durationMs: number) => {
    setRampPopoverOpen(false);
    onRampRequest?.(target, durationMs);
  }, [onRampRequest]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation();
      onChange(Math.min(1, value + step));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation();
      onChange(Math.max(0, value - step));
    }
  }, [onChange, value]);

  return (
    <div
      className="relative flex flex-col items-center gap-0.5 select-none"
      style={{ width: containerWidth }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Label */}
      <span className={`text-zinc-500 text-center truncate w-full leading-tight ${isSmall ? 'text-[9px]' : 'text-[11px]'}`}>
        {label}
      </span>

      {/* SVG knob */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <svg
        ref={svgRef}
        width={size}
        height={size}
        className="touch-none cursor-pointer outline-none focus:ring-1 focus:ring-amber-400/50 rounded-full"
        tabIndex={0}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Math.round(value * 100) / 100}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        {/* Invisible hit target — ensures pointer events register on the full knob area,
            not just the thin arc strokes. Critical for small (32px) knobs. */}
        <circle cx={cx} cy={cy} r={r} fill="transparent" />
        {/* Background track arc */}
        <path
          d={describeArc(cx, cy, r, 1)}
          fill="none"
          stroke="rgb(63 63 70)" /* zinc-700 */
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
        />
        {/* Value arc */}
        {value > 0.005 && (
          <path
            d={describeArc(cx, cy, r, value)}
            fill="none"
            stroke={accentRgb}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
          />
        )}
        {/* Indicator line */}
        <line
          x1={indInner.x}
          y1={indInner.y}
          x2={ind.x}
          y2={ind.y}
          stroke="rgb(161 161 170)" /* zinc-400 */
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        {/* Per-modulation depth ring arcs (Bitwig-style) */}
        {modulations && modulations.length > 0 && modulations.map((mod, i) => {
          const modStart = Math.max(0, Math.min(1, value));
          const modEnd = Math.max(0, Math.min(1, value + mod.depth));
          const arcFrom = Math.min(modStart, modEnd);
          const arcTo = Math.max(modStart, modEnd);
          if (Math.abs(arcTo - arcFrom) < 0.005) return null;
          // Stack arcs inward: first modulation on the main arc radius,
          // additional ones offset slightly inward
          const arcRadius = r - (i * 2.5);
          if (arcRadius < 4) return null;  // don't draw if too small
          const arcColor = mod.color ?? 'rgb(34 211 238)'; /* fallback: cyan-400 */
          return (
            <path
              key={`mod-${i}`}
              d={describeArcRange(cx, cy, arcRadius, arcFrom, arcTo)}
              fill="none"
              stroke={arcColor}
              strokeWidth={2}
              strokeLinecap="round"
              opacity={0.45}
            />
          );
        })}
      </svg>

      {/* Modulation depth controls or plain value readout */}
      {modulations && modulations.length > 0 ? (
        <div className="flex flex-col items-center gap-0 max-w-full">
          {modulations.map((mod) => (
            <div
              key={mod.routeId}
              className={`flex items-center gap-0.5 max-w-full ${isSmall ? 'text-[7px]' : 'text-[9px]'}`}
              title={`${mod.modulatorLabel} depth: ${mod.depth > 0 ? '+' : ''}${mod.depth.toFixed(2)}`}
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onModulationClick?.(); }}
                className="font-mono leading-tight truncate text-cyan-400/70 hover:text-cyan-300 transition-colors"
              >
                {mod.modulatorLabel}
              </button>
              {onModulationDepthChange ? (
                <DraggableNumber
                  value={mod.depth}
                  min={-1}
                  max={1}
                  step={0.01}
                  decimals={2}
                  className={`text-cyan-300/80 hover:text-cyan-200 ${isSmall ? '!text-[7px]' : '!text-[9px]'}`}
                  onChange={(depth) => onModulationDepthChange(mod.routeId, depth)}
                  onCommit={onModulationDepthCommit ? (depth) => onModulationDepthCommit(mod.routeId, depth) : undefined}
                />
              ) : (
                <span className="font-mono text-cyan-400/50">
                  {mod.depth > 0 ? '+' : ''}{mod.depth.toFixed(2)}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <span className={`text-zinc-500 font-mono leading-tight ${isSmall ? 'text-[8px]' : 'text-[10px]'}`}>
          {(hovered || isDragging) && displayMapping
            ? formatDisplayValue(value, displayMapping)
            : formatDisplayValue(value)}
        </span>
      )}

      {/* Ramp popover (Shift+Click) */}
      {rampPopoverOpen && (
        <RampPopover
          currentValue={value}
          onStart={handleRampStart}
          onCancel={() => setRampPopoverOpen(false)}
        />
      )}
    </div>
  );
}
