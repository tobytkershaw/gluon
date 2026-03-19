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
    // Level is gated by level_active, not by gate_open (which caused
    // double-trigger) nor unconditionally (which killed the LPG envelope).
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

  it('level_active exists and is used in render', () => {
    expect(PLAITS_SRC).toContain('bool level_active');

    // Must be used in the render loop
    const renderFn = PLAITS_SRC.match(
      /int plaits_render\(.*?\{([\s\S]*?)\n\}/,
    );
    expect(renderFn).not.toBeNull();
    const body = renderFn![1];
    expect(body).toContain('level_active');
  });

  it('trigger fires immediately — no external pre-charge delay', () => {
    // Plaits internally delays trigger by kTriggerDelay=5 blocks (voice.cc
    // trigger_delay_). We must NOT add our own delay on top — that would
    // stack to 10 blocks total. The trigger should fire immediately
    // (trigger_blocks_remaining = 1 in plaits_trigger).
    const triggerFn = PLAITS_SRC.match(
      /void plaits_trigger\(.*?\{([\s\S]*?)\n\}/,
    );
    expect(triggerFn).not.toBeNull();
    const body = triggerFn![1];
    // Must set trigger_blocks_remaining = 1 directly
    expect(body).toContain('trigger_blocks_remaining = 1');
    // Must NOT have level_precharge_remaining (removed — stacked delay)
    expect(body).not.toContain('level_precharge_remaining');
    // Must set level_active = true so LPG pre-charges during Plaits' internal delay
    expect(body).toContain('level_active = true');
  });

  it('no level_precharge_remaining field exists — single delay via Plaits internal', () => {
    // The external pre-charge state machine was removed because it stacked
    // on top of Plaits' internal kTriggerDelay, doubling the onset latency.
    expect(PLAITS_SRC).not.toContain('level_precharge_remaining');
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

  it('release condition checks gate_open and trigger_blocks_remaining', () => {
    const renderFn = PLAITS_SRC.match(
      /int plaits_render\(.*?\{([\s\S]*?)\n\}/,
    );
    expect(renderFn).not.toBeNull();
    const body = renderFn![1];
    expect(body).toContain('!state->gate_open');
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

describe('PlaitsSynth.scheduleNote — independent base/extended override detection', () => {
  const SYNTH_SRC = readFileSync(
    resolve(__dirname, '../../src/audio/plaits-synth.ts'),
    'utf-8',
  );

  it('detects base and extended overrides independently', () => {
    // Extended-only step locks must NOT trigger a timed set-patch (which
    // would clobber live human edits to harmonics/timbre/morph/note).
    // The override detection must be split: BASE_KEYS for set-patch,
    // EXTENDED_KEYS for set-extended.
    expect(SYNTH_SRC).toContain('BASE_KEYS');
    expect(SYNTH_SRC).toContain('hasBaseOverrides');
    expect(SYNTH_SRC).toContain('hasExtendedOverrides');

    // hasBaseOverrides must only check base keys, not all keys
    const scheduleMethod = SYNTH_SRC.match(
      /scheduleNote\(.*?\{([\s\S]*?)\n  \}/,
    );
    expect(scheduleMethod).not.toBeNull();
    const body = scheduleMethod![1];
    // set-patch should be gated on hasBaseOverrides, not a combined hasOverrides
    expect(body).not.toContain('hasOverrides');
    expect(body).toMatch(/hasBaseOverrides[\s\S]*?set-patch/);
    expect(body).toMatch(/hasExtendedOverrides[\s\S]*?set-extended/);
  });

  it('primes the patch once per transport fence before the first note', () => {
    expect(SYNTH_SRC).toContain('lastPrimedFence');
    expect(SYNTH_SRC).toContain('shouldPrimePatch');
    expect(SYNTH_SRC).toMatch(/shouldPrimePatch[\s\S]*?set-patch/);
    expect(SYNTH_SRC).toMatch(/shouldPrimePatch[\s\S]*?set-extended/);
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
