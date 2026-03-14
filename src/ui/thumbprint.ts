// src/ui/thumbprint.ts
// Pure function to compute a thumbprint color from track state.
import type { Track } from '../engine/types';

export function computeThumbprintColor(track: Track): string {
  const brightness = track.params.timbre ?? 0.5;
  const texture = track.params.morph ?? 0.5;
  const richness = track.params.harmonics ?? 0.5;
  const hasProcessors = (track.processors ?? []).length > 0;

  // Hue: low brightness + low texture → purple (270), high brightness → amber (35)
  // Processor tint shifts toward cyan (180)
  let hue = 270 - brightness * 235; // 270 → 35
  if (hasProcessors) {
    hue = hue * 0.6 + 180 * 0.4; // tint toward cyan
  }

  // Saturation drops with high texture
  const saturation = 60 - texture * 30; // 60% → 30%

  // Lightness: 45-60% based on richness
  const lightness = 45 + richness * 15;

  return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
}
