// src/ui/DraggableNumber.tsx
// Pointer-capture drag number input with click-to-edit fallback.
import { useRef, useState, useCallback } from 'react';

interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  suffix?: string;
  className?: string;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
}

export function DraggableNumber({
  value, min, max, step = 1, decimals = 0, suffix = '', className = '',
  onChange, onCommit,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const dragRef = useRef<{ startY: number; startValue: number; moved: boolean } | null>(null);
  const elRef = useRef<HTMLSpanElement>(null);

  const clamp = useCallback((v: number) => Math.max(min, Math.min(max, v)), [min, max]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (editing) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startValue: value, moved: false };
  }, [value, editing]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dy = drag.startY - e.clientY;
    if (Math.abs(dy) > 2) drag.moved = true;
    if (!drag.moved) return;
    const delta = dy * step;
    const newValue = clamp(drag.startValue + delta);
    onChange(Number(newValue.toFixed(decimals)));
  }, [step, decimals, clamp, onChange]);

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (!drag.moved) {
      // Click — open edit mode
      setInputValue(value.toFixed(decimals));
      setEditing(true);
    } else {
      onCommit?.(value);
    }
  }, [value, decimals, onCommit]);

  const submitInput = useCallback(() => {
    const parsed = parseFloat(inputValue);
    if (!isNaN(parsed)) {
      const clamped = clamp(parsed);
      onChange(Number(clamped.toFixed(decimals)));
      onCommit?.(Number(clamped.toFixed(decimals)));
    }
    setEditing(false);
  }, [inputValue, clamp, decimals, onChange, onCommit]);

  if (editing) {
    return (
      <input
        type="number"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={submitInput}
        onKeyDown={(e) => { if (e.key === 'Enter') submitInput(); if (e.key === 'Escape') setEditing(false); }}
        className="w-12 bg-zinc-800 text-zinc-100 text-[11px] font-mono px-1 py-0.5 rounded border border-zinc-600 outline-none tabular-nums"
        autoFocus
        onFocus={(e) => e.target.select()}
        min={min}
        max={max}
        step={step}
      />
    );
  }

  return (
    <span
      ref={elRef}
      className={`text-[11px] font-mono tabular-nums cursor-ns-resize select-none ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {value.toFixed(decimals)}{suffix}
    </span>
  );
}
