import { useRef, useEffect } from 'react';

interface Props {
  analyser: AnalyserNode | null;
}

export function Visualiser({ analyser }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let prevW = 0;
    let prevH = 0;

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      const tw = Math.round(w * dpr);
      const th = Math.round(h * dpr);

      if (tw !== prevW || th !== prevH) {
        canvas.width = tw;
        canvas.height = th;
        prevW = tw;
        prevH = th;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Background
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, w, h);

      // Center line
      ctx.strokeStyle = 'rgba(63,63,70,0.2)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Quarter lines
      ctx.strokeStyle = 'rgba(63,63,70,0.1)';
      ctx.beginPath(); ctx.moveTo(0, h * 0.25); ctx.lineTo(w, h * 0.25); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, h * 0.75); ctx.lineTo(w, h * 0.75); ctx.stroke();

      if (!analyser) {
        // Flat line when no audio
        ctx.strokeStyle = 'rgba(251,191,36,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
      } else {
        const bufLen = analyser.frequencyBinCount;
        const data = new Uint8Array(bufLen);
        analyser.getByteTimeDomainData(data);

        // Glow trace (wide, faint)
        ctx.strokeStyle = 'rgba(251,191,36,0.08)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        for (let i = 0; i < bufLen; i++) {
          const x = (i / bufLen) * w;
          const y = (data[i] / 255) * h;
          if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        }
        ctx.stroke();

        // Main trace
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < bufLen; i++) {
          const x = (i / bufLen) * w;
          const y = (data[i] / 255) * h;
          if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        }
        ctx.stroke();
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      className="block w-full h-16 rounded-lg"
      style={{ outline: '1px solid rgba(63,63,70,0.2)', outlineOffset: '-1px' }}
    />
  );
}
