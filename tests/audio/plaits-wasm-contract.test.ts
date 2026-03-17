// tests/audio/plaits-wasm-contract.test.ts
//
// Contract tests for the Plaits WASM bridge (gluon_plaits.cpp).
// These verify invariants in the C++ source that can't be tested at runtime
// in Node (WASM requires Emscripten/browser). Source-reading tests catch
// regressions when the C++ is modified.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PLAITS_SRC = readFileSync(
  resolve(__dirname, '../../wasm/gluon_plaits.cpp'),
  'utf-8',
);

describe('gluon_plaits.cpp contracts', () => {
  it('modulations.level must not depend on gate_open — prevents double trigger', () => {
    // Bug: when modulations.level tracked gate_open (e.g. `gate_open ? accent_level : 0`),
    // Plaits internally detected the rising edge of level as a second trigger,
    // producing a "du-dum" double-hit on every note. The fix sets level to
    // accent_level unconditionally; the Web Audio accent gain node handles gating.
    //
    // This test ensures the pattern `gate_open ? ... : ...` is never used
    // to set modulations.level.
    const levelAssignments = PLAITS_SRC
      .split('\n')
      .filter(line => line.includes('modulations.level') && line.includes('='));

    for (const line of levelAssignments) {
      expect(line).not.toMatch(/gate_open/);
    }

    // Positive check: level should be set to accent_level directly
    const hasDirectAssignment = levelAssignments.some(
      line => line.includes('accent_level') && !line.includes('gate_open'),
    );
    expect(hasDirectAssignment).toBe(true);
  });

  it('trigger_patched and level_patched are both true', () => {
    // Plaits requires both trigger and level inputs to be patched for correct
    // behavior. If either is false, the engine falls back to internal defaults.
    expect(PLAITS_SRC).toContain('trigger_patched = true');
    expect(PLAITS_SRC).toContain('level_patched = true');
  });
});
