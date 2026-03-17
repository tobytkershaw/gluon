// src/ui/useTrackLevel.ts
// Hook: polls an AnalyserNode and returns current peak level (0–1).
import { useState, useEffect, useRef } from 'react';

/** Poll an AnalyserNode at ~30 fps and return peak level 0–1. */
export function useTrackLevel(analyser: AnalyserNode | null): number {
  const [level, setLevel] = useState(0);
  const bufRef = useRef<Float32Array | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!analyser) {
      setLevel(0);
      return;
    }

    if (!bufRef.current || bufRef.current.length !== analyser.fftSize) {
      bufRef.current = new Float32Array(analyser.fftSize);
    }

    let frameCount = 0;
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      // Throttle to ~30 fps (every other frame at 60 fps)
      frameCount++;
      if (frameCount % 2 !== 0) return;

      analyser.getFloatTimeDomainData(bufRef.current!);
      let peak = 0;
      const buf = bufRef.current!;
      for (let i = 0; i < buf.length; i++) {
        const abs = Math.abs(buf[i]);
        if (abs > peak) peak = abs;
      }
      setLevel(Math.min(1, peak));
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser]);

  return level;
}
