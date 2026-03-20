// src/ui/MiniKnob.tsx
// Compact SVG rotary knob for tight layouts (e.g. track sidebar).
// 18px diameter, no label, no readout — just the arc and indicator.
import { useRef, useCallback } from 'react';

interface MiniKnobProps {
  /** Value in the range [min, max]. */
  value: number;
  min?: number;
  max?: number;
  accentColor: string;  // raw CSS color string, e.g. "rgb(251 191 36)"
  title?: string;
  onChange: (value: number) => void;
}

const SIZE = 18;
const STROKE = 2;
const R = (SIZE - STROKE * 2) / 2;
const CX = SIZE / 2;
const CY = SIZE / 2;
const ARC_START = 0.75 * Math.PI;
const ARC_SWEEP = 1.5 * Math.PI;

function arc(fraction: number): string {
  const startAngle = ARC_START;
  const endAngle = startAngle + ARC_SWEEP * fraction;
  const x1 = CX + R * Math.cos(startAngle);
  const y1 = CY + R * Math.sin(startAngle);
  const x2 = CX + R * Math.cos(endAngle);
  const y2 = CY + R * Math.sin(endAngle);
  const large = ARC_SWEEP * fraction > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`;
}

function indicatorPos(fraction: number) {
  const angle = ARC_START + ARC_SWEEP * fraction;
  return { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) };
}

export function MiniKnob({ value, min = 0, max = 1, accentColor, title, onChange }: MiniKnobProps) {
  const dragging = useRef(false);
  const startY = useRef(0);
  const startNorm = useRef(0);

  const norm = (value - min) / (max - min);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const range = max - min;
    const step = e.shiftKey ? range * 0.1 : range * 0.01;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation();
      onChange(Math.min(max, value + step));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation();
      onChange(Math.max(min, value - step));
    }
  }, [onChange, value, min, max]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
    startY.current = e.clientY;
    startNorm.current = (value - min) / (max - min);
  }, [value, min, max]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = (startY.current - e.clientY) / 150;
    const newNorm = Math.max(0, Math.min(1, startNorm.current + delta));
    onChange(min + newNorm * (max - min));
  }, [onChange, min, max]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  // Pointer cancel — treat same as pointer up
  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const ind = indicatorPos(norm);
  const indAngle = ARC_START + ARC_SWEEP * norm;
  const indInner = { x: CX + R * 0.45 * Math.cos(indAngle), y: CY + R * 0.45 * Math.sin(indAngle) };

  return (
    <svg
      width={SIZE}
      height={SIZE}
      className="touch-none cursor-pointer shrink-0 outline-none focus:ring-1 focus:ring-amber-400/50 rounded-full"
      tabIndex={0}
      role="slider"
      aria-label={title ?? 'Knob'}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value * 100) / 100}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
    >
      <title>{title}</title>
      {/* Background arc */}
      <path
        d={arc(1)}
        fill="none"
        stroke="rgb(63 63 70)"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      {/* Value arc */}
      {norm > 0.01 && (
        <path
          d={arc(norm)}
          fill="none"
          stroke={accentColor}
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
      )}
      {/* Indicator line */}
      <line
        x1={indInner.x}
        y1={indInner.y}
        x2={ind.x}
        y2={ind.y}
        stroke="rgb(161 161 170)"
        strokeWidth={1}
        strokeLinecap="round"
      />
    </svg>
  );
}
