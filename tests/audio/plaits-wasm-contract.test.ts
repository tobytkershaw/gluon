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
  it('modulations.level uses level_active, not unconditional accent_level', () => {
    // Level is gated by level_active (the pre-charge state machine), not
    // by gate_open (which caused double-trigger) nor unconditionally (which
    // killed the LPG envelope).
    const levelAssignments = PLAITS_SRC
      .split('\n')
      .filter(line => line.includes('modulations.level') && line.includes('=') && !line.includes('//'));

    // Must use level_active to gate level
    const usesLevelActive = levelAssignments.some(line => line.includes('level_active'));
    expect(usesLevelActive).toBe(true);

    // Must NOT use gate_open to gate level (causes double-trigger)
    for (const line of levelAssignments) {
      expect(line).not.toMatch(/gate_open/);
    }
  });

  it('trigger_patched and level_patched are both true', () => {
    expect(PLAITS_SRC).toContain('trigger_patched = true');
    expect(PLAITS_SRC).toContain('level_patched = true');
  });

  it('level_precharge_remaining exists and is used in render', () => {
    // The pre-charge state machine must exist in PlaitsVoiceState
    expect(PLAITS_SRC).toContain('int level_precharge_remaining');
    expect(PLAITS_SRC).toContain('bool level_active');

    // Must be used in the render loop
    const renderFn = PLAITS_SRC.match(
      /int plaits_render\(.*?\{([\s\S]*?)\n\}/,
    );
    expect(renderFn).not.toBeNull();
    const body = renderFn![1];
    expect(body).toContain('level_precharge_remaining');
    expect(body).toContain('level_active');
  });

  it('trigger fires AFTER precharge, not simultaneously', () => {
    // plaits_trigger must NOT set trigger_blocks_remaining directly.
    // Instead it sets level_precharge_remaining, and the render loop
    // sets trigger_blocks_remaining = 1 only when precharge reaches 0.
    const triggerFn = PLAITS_SRC.match(
      /void plaits_trigger\(.*?\{([\s\S]*?)\n\}/,
    );
    expect(triggerFn).not.toBeNull();
    const body = triggerFn![1];
    // Must set precharge, not trigger directly
    expect(body).toContain('level_precharge_remaining');
    expect(body).not.toContain('trigger_blocks_remaining');
  });

  it('level_active is false at init — silence before first trigger', () => {
    const constructorMatch = PLAITS_SRC.match(
      /PlaitsVoiceState\(\)\s*:([^{]+)\{/,
    );
    expect(constructorMatch).not.toBeNull();
    const initList = constructorMatch![1];
    expect(initList).toMatch(/level_active\s*\(\s*false\s*\)/);
    expect(initList).toMatch(/accent_level\s*\(\s*0\.0f\s*\)/);
  });

  it('modulations.level initializes to 0 in init_state', () => {
    const initStateBody = PLAITS_SRC.match(
      /void init_state\(.*?\{([\s\S]*?)\n\}/,
    );
    expect(initStateBody).not.toBeNull();
    const body = initStateBody![1];
    expect(body).toMatch(/modulations\.level\s*=\s*0\.0f/);
  });

  it('short-gate edge case: level_active release requires precharge and trigger complete', () => {
    // If gate-off arrives during precharge, level_active must NOT go false
    // until precharge AND trigger are both complete. This ensures very short
    // notes still produce sound.
    const renderFn = PLAITS_SRC.match(
      /int plaits_render\(.*?\{([\s\S]*?)\n\}/,
    );
    expect(renderFn).not.toBeNull();
    const body = renderFn![1];
    // The release condition must check all three: !gate_open, precharge==0, trigger==0
    expect(body).toContain('!state->gate_open');
    expect(body).toContain('level_precharge_remaining == 0');
    expect(body).toContain('trigger_blocks_remaining == 0');
  });

  it('plaits_trigger snaps note pitch to target', () => {
    const triggerFn = PLAITS_SRC.match(
      /void plaits_trigger\(.*?\{([\s\S]*?)\n\}/,
    );
    expect(triggerFn).not.toBeNull();
    const body = triggerFn![1];
    expect(body).toMatch(/smooth_note\.reset/);
  });
});

describe('gluon_plaits.cpp — worklet dirty-check', () => {
  const WORKLET_SRC = readFileSync(
    resolve(__dirname, '../../src/audio/plaits-worklet.ts'),
    'utf-8',
  );

  it('applyPatchWithModulation has value-based dirty-check', () => {
    const method = WORKLET_SRC.match(
      /private applyPatchWithModulation[\s\S]*?\n  \}/,
    );
    expect(method).not.toBeNull();
    const body = method![0];
    // Must compare values and return early when unchanged
    expect(body).toContain('this.lastH');
    expect(body).toContain('return');
    // Must use _plaits_set_patch (not removed _plaits_set_modulation)
    expect(body).toContain('_plaits_set_patch');
    expect(body).not.toContain('_plaits_set_modulation');
  });
});
