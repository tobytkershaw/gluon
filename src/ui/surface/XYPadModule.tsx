import { useRef, useEffect, useCallback, useState } from 'react';
import type { Track } from '../../engine/types';
import type { ModuleRendererProps } from './ModuleRendererProps';

/** Parse a binding target into moduleId + controlId */
function parseTarget(target: string): { moduleId: string; controlId: string } {
  const colonIdx = target.indexOf(':');
  if (colonIdx >= 0) {
    return { moduleId: target.slice(0, colonIdx), controlId: target.slice(colonIdx + 1) };
  }
  return { moduleId: 'source', controlId: target };
}

/** Resolve current value for a binding target */
function resolveValue(track: Track, target: string): number {
  const { moduleId, controlId } = parseTarget(target);
  if (moduleId === 'source') {
    return track.params[controlId] ?? 0.5;
  }
  const proc = (track.processors ?? []).find(p => p.id === moduleId);
  return proc?.params[controlId] ?? 0.5;
}

function dispatchChange(
  target: string,
  value: number,
  onParamChange?: (id: string, v: number) => void,
  onProcessorParamChange?: (procId: string, id: string, v: number) => void,
) {
  const { moduleId, controlId } = parseTarget(target);
  if (moduleId === 'source') {
    onParamChange?.(controlId, value);
  } else {
    onProcessorParamChange?.(moduleId, controlId, value);
  }
}

/** Format a controlId for display as a spaced-letter axis label */
function formatAxisLabel(controlId: string): string {
  return controlId.toUpperCase().split('').join(' ');
}

export function XYPadModule({
  module,
  track,
  onParamChange,
  onProcessorParamChange,
  onInteractionStart,
  onInteractionEnd,
}: ModuleRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [, setTick] = useState(0);

  const xBinding = module.bindings.find(b => b.role === 'x-axis');
  const yBinding = module.bindings.find(b => b.role === 'y-axis');
  const xTarget = xBinding?.target ?? 'timbre';
  const yTarget = yBinding?.target ?? 'morph';
  const xLabel = formatAxisLabel(parseTarget(xTarget).controlId);
  const yLabel = formatAxisLabel(parseTarget(yTarget).controlId);
  const xValue = resolveValue(track, xTarget);
  const yValue = resolveValue(track, yTarget);

  // Resize observer for responsive canvas
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setTick(n => n + 1));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Draw — matches ParameterSpace visual style
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, w, h);

    // Fine grid (10%)
    ctx.strokeStyle = 'rgba(63,63,70,0.12)';
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 10; i++) {
      ctx.beginPath(); ctx.moveTo((i / 10) * w, 0); ctx.lineTo((i / 10) * w, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i / 10) * h); ctx.lineTo(w, (i / 10) * h); ctx.stroke();
    }

    // Major grid (25%)
    ctx.strokeStyle = 'rgba(63,63,70,0.3)';
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo((i / 4) * w, 0); ctx.lineTo((i / 4) * w, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i / 4) * h); ctx.lineTo(w, (i / 4) * h); ctx.stroke();
    }

    // Cursor position (x=left-right, y inverted: bottom=0, top=1)
    const cx = xValue * w;
    const cy = (1 - yValue) * h;

    // Crosshair lines (dashed, subtle)
    ctx.strokeStyle = 'rgba(251,191,36,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
    ctx.setLineDash([]);

    // Glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
    glow.addColorStop(0, 'rgba(251,191,36,0.12)');
    glow.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 60, 0, Math.PI * 2);
    ctx.fill();

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(251,191,36,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Cursor dot
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();

    // Hot center
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#fef3c7';
    ctx.fill();

    // Axis labels (spaced letters for instrument feel)
    ctx.font = '500 9px "DM Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(161,161,170,0.3)';
    ctx.fillText(xLabel, w / 2, h - 10);
    ctx.save();
    ctx.translate(14, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    // Value readouts
    ctx.font = '400 10px "DM Mono", monospace';
    ctx.fillStyle = 'rgba(251,191,36,0.45)';
    ctx.textAlign = 'left';
    ctx.fillText(xValue.toFixed(2), 10, h - 26);
    ctx.textAlign = 'right';
    ctx.fillText(yValue.toFixed(2), w - 10, 30);
  }, [xValue, yValue, xLabel, yLabel]);

  const posFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      dragging.current = true;
      onInteractionStart?.();
      canvasRef.current!.setPointerCapture(e.pointerId);
      const { x, y } = posFromPointer(e);
      dispatchChange(xTarget, x, onParamChange, onProcessorParamChange);
      dispatchChange(yTarget, y, onParamChange, onProcessorParamChange);
    },
    [xTarget, yTarget, onParamChange, onProcessorParamChange, onInteractionStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragging.current) return;
      const { x, y } = posFromPointer(e);
      dispatchChange(xTarget, x, onParamChange, onProcessorParamChange);
      dispatchChange(yTarget, y, onParamChange, onProcessorParamChange);
    },
    [xTarget, yTarget, onParamChange, onProcessorParamChange],
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
    onInteractionEnd?.();
  }, [onInteractionEnd]);

  return (
    <div ref={containerRef} className="h-full flex flex-col p-1">
      <canvas
        ref={canvasRef}
        className="flex-1 w-full cursor-crosshair rounded-lg touch-none"
        style={{ outline: '1px solid rgba(63,63,70,0.25)', outlineOffset: '-1px' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  );
}
