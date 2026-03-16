// src/ui/thumbprint.ts
// Pure function to compute a thumbprint color from track state.
import type { Track } from '../engine/types';

export function computeThumbprintColor(track: Track): string {
  const timbre = track.params.timbre ?? 0.5;
  const morph = track.params.morph ?? 0.5;
  const harmonics = track.params.harmonics ?? 0.5;
  const hasProcessors = (track.processors ?? []).length > 0;

  // Hue: low timbre + low morph → purple (270), high timbre → amber (35)
  // Processor tint shifts toward cyan (180)
  let hue = 270 - timbre * 235; // 270 → 35
  if (hasProcessors) {
    hue = hue * 0.6 + 180 * 0.4; // tint toward cyan
  }

  // Saturation drops with high morph
  const saturation = 60 - morph * 30; // 60% → 30%

  // Lightness: 45-60% based on harmonics
  const lightness = 45 + harmonics * 15;

  return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
}
