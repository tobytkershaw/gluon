// src/ui/format-display-value.ts
// Maps a normalized 0-1 value through a DisplayMapping to produce a human-readable string.
// Purely cosmetic — does not affect the underlying parameter system.
import type { DisplayMapping } from '../engine/canonical-types';

/**
 * Format a normalized 0-1 value using a DisplayMapping.
 * Returns a string like "440 Hz", "-6.0 dB", "50%", "120 ms".
 *
 * If no mapping is provided, returns the raw percentage (e.g. "50").
 */
export function formatDisplayValue(normalized: number, mapping?: DisplayMapping): string {
  if (!mapping) {
    return String(Math.round(normalized * 100));
  }

  const decimals = mapping.decimals ?? 0;
  let displayValue: number;

  switch (mapping.type) {
    case 'linear':
      displayValue = mapping.min + normalized * (mapping.max - mapping.min);
      break;

    case 'log':
      // Logarithmic mapping: equal knob rotation = equal ratio change.
      // Useful for frequency (Hz) where perception is logarithmic.
      // At normalized=0 → min, normalized=1 → max, with log distribution.
      displayValue = mapping.min * Math.pow(mapping.max / mapping.min, normalized);
      break;

    case 'dB':
      // Decibel mapping: linear 0-1 → dB range.
      // 0 maps to min dB (e.g. -60), 1 maps to max dB (e.g. 0).
      displayValue = mapping.min + normalized * (mapping.max - mapping.min);
      break;

    case 'percent':
      displayValue = mapping.min + normalized * (mapping.max - mapping.min);
      break;

    default:
      displayValue = normalized * 100;
  }

  const formatted = displayValue.toFixed(decimals);
  return `${formatted} ${mapping.unit}`;
}
