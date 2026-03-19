// src/ui/RampPopover.tsx
// Popover for human-initiated timed parameter transitions (Shift+Click on knobs).
// Shows current value, target value picker, duration presets, and Start button.
import { useRef, useEffect, useCallback, useState } from 'react';
import { DraggableNumber } from './DraggableNumber';

const DURATION_PRESETS = [
  { label: '0.5s', ms: 500 },
  { label: '1s', ms: 1000 },
  { label: '2s', ms: 2000 },
  { label: '5s', ms: 5000 },
];

interface RampPopoverProps {
  currentValue: number;
  onStart: (target: number, durationMs: number) => void;
  onCancel: () => void;
}

export function RampPopover({ currentValue, onStart, onCancel }: RampPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState(currentValue);
  const [durationMs, setDurationMs] = useState(1000);

  // Click-outside dismissal
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
    };
  }, [onCancel]);

  // Escape key dismissal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const handleStart = useCallback(() => {
    onStart(target, durationMs);
  }, [target, durationMs, onStart]);

  return (
    <div
      ref={ref}
      className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-zinc-900 border border-zinc-700 rounded-lg p-2.5 shadow-xl"
      style={{ minWidth: 140 }}
      data-testid="ramp-popover"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Current value (read-only) */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Now</span>
        <span className="text-[11px] font-mono text-zinc-400">{currentValue.toFixed(2)}</span>
      </div>

      {/* Target value */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Target</span>
        <DraggableNumber
          value={target}
          min={0}
          max={1}
          step={0.01}
          decimals={2}
          className="text-zinc-200 hover:text-white"
          onChange={setTarget}
        />
      </div>

      {/* Duration presets */}
      <div className="flex gap-1 mb-2">
        {DURATION_PRESETS.map((preset) => (
          <button
            key={preset.ms}
            type="button"
            onClick={() => setDurationMs(preset.ms)}
            className={`flex-1 py-0.5 rounded text-[10px] font-mono transition-colors ${
              durationMs === preset.ms
                ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30'
                : 'bg-zinc-800 text-zinc-500 border border-transparent hover:text-zinc-300'
            }`}
            data-testid={`duration-${preset.ms}`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Start button */}
      <button
        type="button"
        onClick={handleStart}
        className="w-full py-1 rounded bg-amber-400/20 text-amber-300 text-[11px] font-medium hover:bg-amber-400/30 transition-colors"
        data-testid="ramp-start"
      >
        Start Ramp
      </button>
    </div>
  );
}
