// src/engine/visual-identity.ts
import type { Track, TrackVisualIdentity, ModuleVisualContext } from './types';

/**
 * Golden angle in degrees — produces maximally-spaced hue distribution
 * regardless of how many tracks exist.
 */
const GOLDEN_ANGLE = 137.508;

/**
 * Generate a sensible default visual identity for a track at the given index.
 * Hues are distributed using the golden angle for maximum visual separation.
 */
export function getDefaultVisualIdentity(trackIndex: number): TrackVisualIdentity {
  const hue = (trackIndex * GOLDEN_ANGLE) % 360;
  return {
    colour: { hue: Math.round(hue * 100) / 100, saturation: 0.6, brightness: 0.7 },
    weight: 0.5,
    edgeStyle: 'crisp',
    prominence: 0.5,
  };
}

/**
 * Clamp a number to a range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Derive the visual context that Surface modules consume from a track.
 * Falls back to index-based defaults when no visual identity is set.
 *
 * @param track - The track to derive context from
 * @param trackIndex - The track's index in the session (used for default hue distribution)
 */
export function deriveModuleVisualContext(track: Track, trackIndex: number = 0): ModuleVisualContext {
  const identity = track.visualIdentity ?? getDefaultVisualIdentity(trackIndex);

  return {
    trackColour: {
      hue: clamp(identity.colour.hue, 0, 360),
      saturation: clamp(identity.colour.saturation, 0, 1),
      brightness: clamp(identity.colour.brightness, 0, 1),
    },
    weight: clamp(identity.weight, 0, 1),
    edgeStyle: identity.edgeStyle,
    prominence: clamp(identity.prominence, 0, 1),
  };
}
