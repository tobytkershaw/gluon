// src/ui/MasterStrip.tsx
// Compact master channel strip: volume slider, pan slider, peak meter.
// Lives in the footer bar's content-column zone.
import { useRef, useEffect, useCallback } from 'react';

interface Props {
  volume: number;    // 0.0–1.0
  pan: number;       // -1.0 to 1.0
  analyser: AnalyserNode | null;
  onVolumeChange: (v: number) => void;
  onPanChange: (p: number) => void;
}

/** Tiny peak meter — draws a horizontal bar from analyser data. */
function PeakMeter({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const bufRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    if (!analyser || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!bufRef.current || bufRef.current.length !== analyser.fftSize) {
      bufRef.current = new Float32Array(analyser.fftSize);
    }

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const buf = bufRef.current!;
      analyser.getFloatTimeDomainData(buf);

      // Peak detection
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const abs = Math.abs(buf[i]);
        if (abs > peak) peak = abs;
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = '#27272a'; // zinc-800
      ctx.fillRect(0, 0, w, h);

      // Level bar
      const level = Math.min(1, peak);
      const barW = level * w;
      if (level > 0.9) {
        ctx.fillStyle = '#ef4444'; // red-500
      } else if (level > 0.6) {
        ctx.fillStyle = '#f59e0b'; // amber-500
      } else {
        ctx.fillStyle = '#22c55e'; // green-500
      }
      ctx.fillRect(0, 0, barW, h);
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      width={60}
      height={6}
      className="rounded-sm"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

export function MasterStrip({ volume, pan, analyser, onVolumeChange, onPanChange }: Props) {
  const handleVolumeInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onVolumeChange(Number(e.target.value));
  }, [onVolumeChange]);

  const handlePanInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onPanChange(Number(e.target.value));
  }, [onPanChange]);

  const handlePanDoubleClick = useCallback(() => {
    onPanChange(0);
  }, [onPanChange]);

  const volumePercent = Math.round(volume * 100);
  const panLabel = pan === 0 ? 'C' : pan < 0 ? `L${Math.round(Math.abs(pan) * 100)}` : `R${Math.round(pan * 100)}`;

  return (
    <div className="flex items-center gap-2 px-2 select-none">
      {/* Volume */}
      <div className="flex items-center gap-1.5" title={`Master volume: ${volumePercent}%`}>
        <span className="text-[10px] text-zinc-500 w-6 text-right font-mono">{volumePercent}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={handleVolumeInput}
          className="w-16 h-1 accent-zinc-400 cursor-pointer"
          aria-label="Master volume"
        />
      </div>

      {/* Pan */}
      <div className="flex items-center gap-1" title={`Master pan: ${panLabel}`}>
        <span className="text-[10px] text-zinc-500 w-5 text-right font-mono">{panLabel}</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={pan}
          onChange={handlePanInput}
          onDoubleClick={handlePanDoubleClick}
          className="w-10 h-1 accent-zinc-400 cursor-pointer"
          aria-label="Master pan"
        />
      </div>

      {/* Peak meter */}
      <PeakMeter analyser={analyser} />
    </div>
  );
}
