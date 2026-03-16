// src/ui/MasterStrip.tsx
// Compact master channel strip: volume knob, pan knob, peak meter.
// Lives in the footer bar's content-column zone.
import { useRef, useEffect, useCallback } from 'react';
import { Knob } from './Knob';

interface Props {
  volume: number;    // 0.0–1.0
  pan: number;       // -1.0 to 1.0
  analyser: AnalyserNode | null;
  stereoAnalysers: [AnalyserNode, AnalyserNode] | null;
  onVolumeChange: (v: number) => void;
  onPanChange: (p: number) => void;
}

const METER_WIDTH = 20;   // total width: two bars + gap
const METER_HEIGHT = 28;  // match knob height
const BAR_WIDTH = 4;
const BAR_GAP = 2;
const PEAK_HOLD_MS = 1500;
const PEAK_DECAY_RATE = 0.005; // per frame after hold expires

/** Color for a given level (0–1). */
function levelColor(level: number): string {
  if (level > 0.9) return '#ef4444'; // red-500
  if (level > 0.6) return '#f59e0b'; // amber-500
  return '#22c55e'; // green-500
}

/** Stereo peak meter — vertical L/R bars with peak-hold indicators. */
function PeakMeter({ stereoAnalysers }: { stereoAnalysers: [AnalyserNode, AnalyserNode] | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const bufLRef = useRef<Float32Array | null>(null);
  const bufRRef = useRef<Float32Array | null>(null);
  const peakHoldL = useRef({ value: 0, time: 0 });
  const peakHoldR = useRef({ value: 0, time: 0 });

  useEffect(() => {
    if (!stereoAnalysers || !canvasRef.current) return;
    const [analyserL, analyserR] = stereoAnalysers;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!bufLRef.current || bufLRef.current.length !== analyserL.fftSize) {
      bufLRef.current = new Float32Array(analyserL.fftSize);
    }
    if (!bufRRef.current || bufRRef.current.length !== analyserR.fftSize) {
      bufRRef.current = new Float32Array(analyserR.fftSize);
    }

    const getPeak = (analyser: AnalyserNode, buf: Float32Array): number => {
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const abs = Math.abs(buf[i]);
        if (abs > peak) peak = abs;
      }
      return Math.min(1, peak);
    };

    const updatePeakHold = (hold: { value: number; time: number }, current: number, now: number) => {
      if (current >= hold.value) {
        hold.value = current;
        hold.time = now;
      } else if (now - hold.time > PEAK_HOLD_MS) {
        hold.value = Math.max(0, hold.value - PEAK_DECAY_RATE);
      }
    };

    const drawBar = (x: number, level: number, holdValue: number) => {
      const barHeight = level * METER_HEIGHT;
      const y = METER_HEIGHT - barHeight;

      // Level fill
      ctx.fillStyle = levelColor(level);
      ctx.fillRect(x, y, BAR_WIDTH, barHeight);

      // Peak-hold tick
      if (holdValue > 0.01) {
        const holdY = METER_HEIGHT - holdValue * METER_HEIGHT;
        ctx.fillStyle = levelColor(holdValue);
        ctx.fillRect(x, holdY, BAR_WIDTH, 1);
      }
    };

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const now = performance.now();

      const peakL = getPeak(analyserL, bufLRef.current!);
      const peakR = getPeak(analyserR, bufRRef.current!);

      updatePeakHold(peakHoldL.current, peakL, now);
      updatePeakHold(peakHoldR.current, peakR, now);

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = '#27272a'; // zinc-800
      ctx.fillRect(0, 0, w, h);

      // L bar
      const lx = (w - BAR_WIDTH * 2 - BAR_GAP) / 2;
      drawBar(lx, peakL, peakHoldL.current.value);

      // R bar
      const rx = lx + BAR_WIDTH + BAR_GAP;
      drawBar(rx, peakR, peakHoldR.current.value);
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [stereoAnalysers]);

  return (
    <canvas
      ref={canvasRef}
      width={METER_WIDTH}
      height={METER_HEIGHT}
      className="rounded-sm"
      style={{ imageRendering: 'pixelated' }}
      title="Master peak meter (L/R)"
    />
  );
}

export function MasterStrip({ volume, pan, analyser: _analyser, stereoAnalysers, onVolumeChange, onPanChange }: Props) {
  // Pan is -1..1, Knob expects 0..1. Map 0.5 = center.
  const panKnobValue = (pan + 1) / 2;

  const handlePanKnobChange = useCallback((v: number) => {
    onPanChange(v * 2 - 1);
  }, [onPanChange]);

  const handlePanDoubleClick = useCallback(() => {
    onPanChange(0);
  }, [onPanChange]);

  const volumePercent = Math.round(volume * 100);
  const panLabel = pan === 0 ? 'C' : pan < 0 ? `L${Math.round(Math.abs(pan) * 100)}` : `R${Math.round(pan * 100)}`;

  return (
    <div className="flex items-center gap-2 px-2 select-none">
      {/* Volume */}
      <div className="flex items-center gap-1" title={`Master volume: ${volumePercent}%`} aria-label="Master volume">
        <span className="text-[10px] text-zinc-500 w-6 text-right font-mono">{volumePercent}</span>
        <Knob
          value={volume}
          label="Vol"
          accentColor="zinc"
          onChange={onVolumeChange}
          size={28}
        />
      </div>

      {/* Pan */}
      <div
        className="flex items-center gap-1"
        title={`Master pan: ${panLabel}`}
        aria-label="Master pan"
        onDoubleClick={handlePanDoubleClick}
      >
        <span className="text-[10px] text-zinc-500 w-5 text-right font-mono">{panLabel}</span>
        <Knob
          value={panKnobValue}
          label="Pan"
          accentColor="zinc"
          onChange={handlePanKnobChange}
          size={28}
        />
      </div>

      {/* Peak meter */}
      <PeakMeter stereoAnalysers={stereoAnalysers} />
    </div>
  );
}
