// tests/engine/human-add-defaults-undo.test.ts
// Tests for #1137 and #1140: human-added processors/modulators get registry
// default params, and modulator gesture-end undo detects changes via key union.

import { describe, it, expect } from 'vitest';
import {
  getProcessorDefaultParams,
  getModulatorDefaultParams,
  getRegisteredProcessorTypes,
  getRegisteredModulatorTypes,
} from '../../src/audio/instrument-registry';

describe('#1137 — human add processor/modulator uses registry defaults', () => {
  it('getProcessorDefaultParams returns non-empty params for all registered types', () => {
    const types = getRegisteredProcessorTypes();
    expect(types.length).toBeGreaterThan(0);
    for (const type of types) {
      const params = getProcessorDefaultParams(type, 0);
      expect(Object.keys(params).length, `${type} model 0 should have default params`).toBeGreaterThan(0);
    }
  });

  it('getModulatorDefaultParams returns non-empty params for all registered types', () => {
    const types = getRegisteredModulatorTypes();
    expect(types.length).toBeGreaterThan(0);
    for (const type of types) {
      // Model 1 is the default for modulators (Looping mode)
      const params = getModulatorDefaultParams(type, 1);
      expect(Object.keys(params).length, `${type} model 1 should have default params`).toBeGreaterThan(0);
    }
  });

  it('getProcessorDefaultParams returns specific known params for rings', () => {
    const params = getProcessorDefaultParams('rings', 0);
    expect(params).toHaveProperty('structure');
    expect(params).toHaveProperty('brightness');
    expect(typeof params.structure).toBe('number');
    expect(typeof params.brightness).toBe('number');
  });

  it('getModulatorDefaultParams returns specific known params for tides', () => {
    const params = getModulatorDefaultParams('tides', 1);
    expect(params).toHaveProperty('frequency');
    expect(params).toHaveProperty('shape');
    expect(typeof params.frequency).toBe('number');
    expect(typeof params.shape).toBe('number');
  });
});

describe('#1140 — modulator gesture-end uses key union for change detection', () => {
  // This tests the logic pattern used in handleModulatorInteractionEnd.
  // When prevParams is empty (freshly added modulator), but current params
  // has values, the union-of-keys approach detects the change.

  function detectChange(
    prevParams: Record<string, number>,
    currentParams: Record<string, number>,
  ): boolean {
    const allKeys = new Set([...Object.keys(prevParams), ...Object.keys(currentParams)]);
    return [...allKeys].some(
      k => Math.abs((currentParams[k] ?? 0) - (prevParams[k] ?? 0)) > 0.001,
    );
  }

  it('detects change when prevParams is empty but current has values', () => {
    const prev: Record<string, number> = {};
    const current = { frequency: 0.5, shape: 0.3 };
    expect(detectChange(prev, current)).toBe(true);
  });

  it('detects no change when both are empty', () => {
    expect(detectChange({}, {})).toBe(false);
  });

  it('detects no change when params are identical', () => {
    const params = { frequency: 0.5, shape: 0.3 };
    expect(detectChange(params, { ...params })).toBe(false);
  });

  it('detects change when a new key appears in current', () => {
    const prev = { frequency: 0.5 };
    const current = { frequency: 0.5, shape: 0.3 };
    expect(detectChange(prev, current)).toBe(true);
  });

  it('detects change when a key is removed in current', () => {
    const prev = { frequency: 0.5, shape: 0.3 };
    const current = { frequency: 0.5 };
    expect(detectChange(prev, current)).toBe(true);
  });

  it('old approach (prev keys only) misses changes from empty prevParams', () => {
    // This is the OLD buggy behavior — only iterating prevParams keys
    function oldDetectChange(
      prevParams: Record<string, number>,
      currentParams: Record<string, number>,
    ): boolean {
      return Object.keys(prevParams).some(
        k => Math.abs((currentParams[k] ?? 0) - prevParams[k]) > 0.001,
      );
    }

    const prev: Record<string, number> = {};
    const current = { frequency: 0.5, shape: 0.3 };
    // Old approach returns false (bug) — no keys to iterate
    expect(oldDetectChange(prev, current)).toBe(false);
    // New approach correctly returns true
    expect(detectChange(prev, current)).toBe(true);
  });
});
