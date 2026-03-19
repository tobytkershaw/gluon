// src/ui/SemanticKnob.tsx
// Rotary knob for a single semantic control. Drag vertically to change value.
import { useRef, useCallback } from 'react';

interface SemanticKnobProps {
  name: string;
  /** Current computed value 0-1 (weighted average of raw params). */
  value: number;
  /** Called with the new absolute knob value on each drag frame. */
  onChange: (value: number) => void;
  onPointerDown: () => void;
  onPointerUp: () => void;
  onClick: () => void;
}

const KNOB_RADIUS = 18;
const STROKE_WIDTH = 3;
const ARC_START = 0.75 * Math.PI; // 135°
const ARC_SWEEP = 1.5 * Math.PI; // 270° total sweep

function describeArc(fraction: number): string {
  const r = KNOB_RADIUS;
  const cx = r + STROKE_WIDTH;
  const cy = r + STROKE_WIDTH;
  const startAngle = ARC_START;
  const endAngle = startAngle + ARC_SWEEP * fraction;
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = ARC_SWEEP * fraction > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

function describeFullArc(): string {
  return describeArc(1);
}

export function SemanticKnob({
  name, value, onChange, onPointerDown, onPointerUp, onClick,
}: SemanticKnobProps) {
  const dragging = useRef(false);
  const startY = useRef(0);
  const startValue = useRef(0);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
    startY.current = e.clientY;
    startValue.current = value;
    onPointerDown();
  }, [value, onPointerDown]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    // 150px of vertical drag = full range (0→1)
    const delta = (startY.current - e.clientY) / 150;
    const newValue = Math.max(0, Math.min(1, startValue.current + delta));
    onChange(newValue);
  }, [onChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    onPointerUp();
  }, [onPointerUp]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Only open inspector on click without drag
    if (Math.abs(startY.current - e.clientY) < 3) {
      onClick();
    }
  }, [onClick]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(Math.min(1, value + step));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(Math.max(0, value - step));
    }
  }, [onChange, value]);

  const size = (KNOB_RADIUS + STROKE_WIDTH) * 2;

  return (
    <div className="flex flex-col items-center gap-1 select-none cursor-pointer" style={{ width: 56 }}>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <svg
        width={size}
        height={size}
        className="touch-none outline-none focus:ring-1 focus:ring-emerald-400/50 rounded-full"
        tabIndex={0}
        role="slider"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Math.round(value * 100) / 100}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {/* Track arc (background) */}
        <path
          d={describeFullArc()}
          fill="none"
          stroke="rgb(63 63 70)" /* zinc-700 */
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
        />
        {/* Value arc */}
        {value > 0.005 && (
          <path
            d={describeArc(value)}
            fill="none"
            stroke="rgb(52 211 153)" /* emerald-400 */
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
          />
        )}
      </svg>
      <span className="text-[11px] text-zinc-400 text-center truncate w-full">{name}</span>
      <span className="text-[10px] text-zinc-500 font-mono">{value.toFixed(2)}</span>
    </div>
  );
}
