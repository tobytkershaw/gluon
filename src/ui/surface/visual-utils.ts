// src/ui/surface/visual-utils.ts
// Shared visual utilities for Surface module rendering with track visual context.

import type { ModuleVisualContext } from '../../engine/types';
import type React from 'react';

/**
 * Convert HSB (hue 0-360, saturation 0-1, brightness 0-1) to a CSS HSL string.
 */
export function hsbToHsl(hue: number, sat: number, bright: number): string {
  const l = bright * (1 - sat / 2);
  const s = l === 0 || l === 1 ? 0 : (bright - l) / Math.min(l, 1 - l);
  return `hsl(${Math.round(hue)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

/**
 * Convert HSB to an RGB string suitable for canvas drawing or CSS.
 */
export function hsbToRgb(hue: number, sat: number, bright: number): string {
  // HSB → RGB conversion
  const h = ((hue % 360) + 360) % 360;
  const s = sat;
  const v = bright;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return `rgb(${Math.round((r + m) * 255)} ${Math.round((g + m) * 255)} ${Math.round((b + m) * 255)})`;
}

/**
 * Get the accent colour as a CSS HSL string from visual context.
 * Falls back to amber (#fbbf24 equivalent) when no context is provided.
 */
export function getAccentColor(ctx?: ModuleVisualContext): string {
  if (!ctx) return 'hsl(43, 96%, 56%)'; // amber-400 equivalent
  return hsbToHsl(ctx.trackColour.hue, ctx.trackColour.saturation, ctx.trackColour.brightness);
}

/**
 * Get the accent colour as an RGB string for canvas operations.
 * Falls back to amber when no context is provided.
 */
export function getAccentRgb(ctx?: ModuleVisualContext): string {
  if (!ctx) return 'rgb(251 191 36)'; // amber-400
  return hsbToRgb(ctx.trackColour.hue, ctx.trackColour.saturation, ctx.trackColour.brightness);
}

/**
 * Get an RGBA string for canvas operations with a given alpha.
 * Falls back to amber when no context is provided.
 */
export function getAccentRgba(ctx: ModuleVisualContext | undefined, alpha: number): string {
  if (!ctx) return `rgba(251,191,36,${alpha})`;
  const { hue, saturation, brightness } = ctx.trackColour;
  const h = ((hue % 360) + 360) % 360;
  const s = saturation;
  const v = brightness;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return `rgba(${Math.round((r + m) * 255)},${Math.round((g + m) * 255)},${Math.round((b + m) * 255)},${alpha})`;
}

/**
 * Generate container styles for a module based on its visual context.
 * Returns an empty object when no context is provided (graceful fallback).
 */
export function getModuleContainerStyle(ctx?: ModuleVisualContext): React.CSSProperties {
  if (!ctx) return {};
  const accentColor = getAccentColor(ctx);
  const borderWidth = 1 + ctx.weight; // 1-2px
  const opacity = 0.7 + ctx.prominence * 0.3; // 0.7-1.0

  const base: React.CSSProperties = {
    borderColor: accentColor,
    borderWidth,
    opacity,
  };

  switch (ctx.edgeStyle) {
    case 'soft':
      return { ...base, borderRadius: '0.75rem', borderStyle: 'solid' };
    case 'glow':
      return { ...base, boxShadow: `0 0 ${4 + ctx.weight * 4}px ${accentColor}` };
    case 'crisp':
    default:
      return base;
  }
}
