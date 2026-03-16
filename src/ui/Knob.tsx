// src/ui/Knob.tsx
// General-purpose SVG rotary knob for the Rack view.
// Adapted from SemanticKnob but with configurable accent colors.
import { useRef, useCallback } from 'react';

interface KnobProps {
  value: number;          // 0-1
  label: string;          // control name
  accentColor: string;    // tailwind color name: "amber", "sky", "violet"
  onChange: (value: number) => void;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
  size?: number;          // diameter in px, default 40
}

const DEFAULT_SIZE = 40;
const STROKE_WIDTH = 3;
const ARC_START = 0.75 * Math.PI; // 135 degrees
const ARC_SWEEP = 1.5 * Math.PI;  // 270 degree total sweep

const ACCENT_COLORS: Record<string, string> = {
  amber:  'rgb(251 191 36)',  // amber-400
  sky:    'rgb(56 189 248)',   // sky-400
  violet: 'rgb(167 139 250)', // violet-400
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
}: KnobProps) {
  const dragging = useRef(false);
  const startY = useRef(0);
  const startValue = useRef(0);

  const r = (size - STROKE_WIDTH * 2) / 2;
  const cx = size / 2;
  const cy = size / 2;

  const accentRgb = ACCENT_COLORS[accentColor] ?? ACCENT_COLORS.amber;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
    startY.current = e.clientY;
    startValue.current = value;
    onPointerDown?.();
  }, [value, onPointerDown]);

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
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    onPointerUp?.();
  }, [onPointerUp]);

  // Indicator line: short line segment from ~60% of radius to the arc edge
  const ind = indicatorPosition(cx, cy, r, value);
  const indInner = indicatorPosition(cx, cy, r * 0.55, value);

  return (
    <div className="flex flex-col items-center gap-0.5 select-none" style={{ width: 56 }}>
      {/* Label */}
      <span className="text-[9px] text-zinc-500 text-center truncate w-full leading-tight">
        {label}
      </span>

      {/* SVG knob */}
      <svg
        width={size}
        height={size}
        className="touch-none cursor-pointer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
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
      </svg>

      {/* Value readout */}
      <span className="text-[8px] text-zinc-500 font-mono leading-tight">
        {Math.round(value * 100)}
      </span>
    </div>
  );
}
