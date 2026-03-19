import { useRef, useEffect, useState } from 'react';
import type { ModuleRendererProps } from './ModuleRendererProps';
import { getActivePattern } from '../../engine/types';
import type { NoteEvent } from '../../engine/canonical-types';
import { getAccentRgba } from './visual-utils';

/**
 * PianoRollModule — compact pitch x time note display for the Surface view.
 *
 * Read-only curated projection: renders NoteEvent items from the active pattern
 * as horizontal bars on a pitch (Y) vs time (X) grid. Velocity maps to color
 * intensity (amber tones). Auto-zooms to the pitch range present in the data.
 */
export function PianoRollModule({ module, track, visualContext }: ModuleRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);

  // Resize observer for responsive canvas
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setTick(n => n + 1));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Resolve pattern from region binding, falling back to active pattern
  const regionBinding = module.bindings.find(b => b.role === 'region');
  const boundPattern = regionBinding
    ? track.patterns.find(p => p.id === regionBinding.target) ?? null
    : null;
  const pattern = boundPattern ?? (track.patterns.length > 0 ? getActivePattern(track) : null);
  const notes: NoteEvent[] = pattern
    ? (pattern.events.filter(e => e.kind === 'note') as NoteEvent[])
    : [];
  const duration = pattern?.duration ?? 4;

  // Compute pitch range — zoom to notes present, with 2-semitone padding
  let pitchMin = 60;
  let pitchMax = 72;
  if (notes.length > 0) {
    pitchMin = Math.min(...notes.map(n => n.pitch));
    pitchMax = Math.max(...notes.map(n => n.pitch));
    // Ensure at least 12 semitones visible
    if (pitchMax - pitchMin < 12) {
      const mid = (pitchMin + pitchMax) / 2;
      pitchMin = Math.floor(mid - 6);
      pitchMax = Math.ceil(mid + 6);
    }
    // Add padding
    pitchMin = Math.max(0, pitchMin - 2);
    pitchMax = Math.min(127, pitchMax + 2);
  }
  const pitchRange = pitchMax - pitchMin + 1;

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
    ctx.fillStyle = '#18181b'; // zinc-900
    ctx.fillRect(0, 0, w, h);

    const rowHeight = h / pitchRange;
    const beatWidth = w / duration;

    // Horizontal pitch row lines
    ctx.strokeStyle = 'rgba(39,39,42,0.8)'; // zinc-800
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= pitchRange; i++) {
      const y = i * rowHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Vertical beat markers
    ctx.strokeStyle = 'rgba(63,63,70,0.5)'; // zinc-700 subtle
    ctx.lineWidth = 0.5;
    for (let beat = 1; beat < duration; beat++) {
      const x = beat * beatWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Draw notes
    for (const note of notes) {
      const x = (note.at / duration) * w;
      const noteW = (note.duration / duration) * w;
      // Higher pitch = higher on screen (lower y)
      const y = ((pitchMax - note.pitch) / pitchRange) * h;
      const noteH = Math.max(rowHeight - 1, 2);

      // Velocity maps to opacity/brightness: 0.3 at vel=0, 1.0 at vel=1
      const alpha = 0.3 + note.velocity * 0.7;

      // Note bar fill — track accent colour
      ctx.fillStyle = getAccentRgba(visualContext, alpha);
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, Math.max(noteW - 1, 2), noteH, 2);
      ctx.fill();

      // Subtle border for definition
      ctx.strokeStyle = getAccentRgba(visualContext, alpha * 0.4);
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Label: "Piano Roll" in top-left
    ctx.font = '500 9px "DM Mono", monospace';
    ctx.fillStyle = 'rgba(161,161,170,0.3)';
    ctx.textAlign = 'left';
    ctx.fillText('PIANO ROLL', 6, 12);

    // Pitch range label in bottom-left
    ctx.fillText(`${pitchMin}–${pitchMax}`, 6, h - 6);

    // Duration label in bottom-right
    ctx.textAlign = 'right';
    ctx.fillText(`${duration} beats`, w - 6, h - 6);
  }, [notes, duration, pitchMin, pitchMax, pitchRange, visualContext]);

  return (
    <div ref={containerRef} className="h-full flex flex-col p-1">
      <canvas
        ref={canvasRef}
        className="flex-1 w-full rounded-lg"
        style={{ outline: '1px solid rgba(63,63,70,0.25)', outlineOffset: '-1px' }}
      />
    </div>
  );
}
