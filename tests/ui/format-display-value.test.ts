import { describe, it, expect } from 'vitest';
import { formatDisplayValue } from '../../src/ui/format-display-value';
import type { DisplayMapping } from '../../src/engine/canonical-types';

describe('formatDisplayValue', () => {
  it('returns raw percentage when no mapping provided', () => {
    expect(formatDisplayValue(0.5)).toBe('50');
    expect(formatDisplayValue(0)).toBe('0');
    expect(formatDisplayValue(1)).toBe('100');
  });

  it('handles linear mapping', () => {
    const mapping: DisplayMapping = { type: 'linear', min: 0, max: 4000, unit: 'ms', decimals: 0 };
    expect(formatDisplayValue(0, mapping)).toBe('0 ms');
    expect(formatDisplayValue(0.5, mapping)).toBe('2000 ms');
    expect(formatDisplayValue(1, mapping)).toBe('4000 ms');
  });

  it('handles log mapping (frequency)', () => {
    const mapping: DisplayMapping = { type: 'log', min: 20, max: 16000, unit: 'Hz', decimals: 0 };
    expect(formatDisplayValue(0, mapping)).toBe('20 Hz');
    expect(formatDisplayValue(1, mapping)).toBe('16000 Hz');
    // Mid-point should be geometric mean: sqrt(20 * 16000) ≈ 566
    const mid = formatDisplayValue(0.5, mapping);
    const midValue = parseInt(mid);
    expect(midValue).toBeGreaterThan(500);
    expect(midValue).toBeLessThan(650);
  });

  it('handles dB mapping', () => {
    const mapping: DisplayMapping = { type: 'dB', min: -60, max: 0, unit: 'dB', decimals: 1 };
    expect(formatDisplayValue(0, mapping)).toBe('-60.0 dB');
    expect(formatDisplayValue(1, mapping)).toBe('0.0 dB');
    expect(formatDisplayValue(0.5, mapping)).toBe('-30.0 dB');
  });

  it('handles percent mapping', () => {
    const mapping: DisplayMapping = { type: 'percent', min: 0, max: 100, unit: '%', decimals: 0 };
    expect(formatDisplayValue(0, mapping)).toBe('0 %');
    expect(formatDisplayValue(0.5, mapping)).toBe('50 %');
    expect(formatDisplayValue(1, mapping)).toBe('100 %');
  });

  it('respects decimals option', () => {
    const mapping: DisplayMapping = { type: 'log', min: 0.05, max: 100, unit: 'Hz', decimals: 1 };
    const result = formatDisplayValue(0, mapping);
    expect(result).toBe('0.1 Hz'); // 0.05 rounded to 1 decimal
  });
});
