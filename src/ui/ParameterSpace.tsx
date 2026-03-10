import { useRef, useEffect, useCallback, useState } from 'react';

interface Props {
  timbre: number;
  morph: number;
  onChange: (timbre: number, morph: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
}

export function ParameterSpace({ timbre, morph, onChange, onInteractionStart, onInteractionEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const [, setTick] = useState(0);

  // Redraw on window resize
  useEffect(() => {
    const h = () => setTick(n => n + 1);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  // Draw
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

    // Cursor position (timbre=x, morph=y inverted: bottom=0, top=1)
    const cx = timbre * w;
    const cy = (1 - morph) * h;

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
    ctx.fillText('T I M B R E', w / 2, h - 10);
    ctx.save();
    ctx.translate(14, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('M O R P H', 0, 0);
    ctx.restore();

    // Value readouts
    ctx.font = '400 10px "DM Mono", monospace';
    ctx.fillStyle = 'rgba(251,191,36,0.45)';
    ctx.textAlign = 'left';
    ctx.fillText(timbre.toFixed(2), 10, h - 26);
    ctx.textAlign = 'right';
    ctx.fillText(morph.toFixed(2), w - 10, 30);
  }, [timbre, morph]);

  const posFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = true;
    onInteractionStart();
    canvasRef.current!.setPointerCapture(e.pointerId);
    const { x, y } = posFromPointer(e);
    onChange(x, y);
  }, [onChange, onInteractionStart]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    onChange(x, y);
  }, [onChange]);

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
    onInteractionEnd();
  }, [onInteractionEnd]);

  return (
    <canvas
      ref={canvasRef}
      className="block w-full h-full rounded-lg cursor-crosshair touch-none"
      style={{ outline: '1px solid rgba(63,63,70,0.25)', outlineOffset: '-1px' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
}
