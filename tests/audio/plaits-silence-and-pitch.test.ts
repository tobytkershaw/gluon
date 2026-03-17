// tests/audio/plaits-silence-and-pitch.test.ts
//
// Contract tests for Plaits WASM bridge: silence at init, pitch snap, and
// level pre-charge state machine.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PLAITS_SRC = readFileSync(
  resolve(__dirname, '../../wasm/gluon_plaits.cpp'),
  'utf-8',
);

describe('gluon_plaits.cpp — silence at init', () => {
  it('accent_level must initialize to 0 so no sound before first trigger', () => {
    const constructorMatch = PLAITS_SRC.match(
      /PlaitsVoiceState\(\)\s*:([^{]+)\{/,
    );
    expect(constructorMatch).not.toBeNull();
    const initList = constructorMatch![1];
    expect(initList).toMatch(/accent_level\s*\(\s*0\.0f\s*\)/);
  });

  it('modulations.level must initialize to 0 in init_state', () => {
    const initStateBody = PLAITS_SRC.match(
      /void init_state\(.*?\{([\s\S]*?)\n\}/,
    );
    expect(initStateBody).not.toBeNull();
    const body = initStateBody![1];
    expect(body).toMatch(/modulations\.level\s*=\s*0\.0f/);
  });
});

describe('gluon_plaits.cpp — pitch snap on trigger', () => {
  it('plaits_trigger must snap smooth_note to target so pitch is correct at trigger', () => {
    const triggerFn = PLAITS_SRC.match(
      /void plaits_trigger\(.*?\{([\s\S]*?)\n\}/,
    );
    expect(triggerFn).not.toBeNull();
    const body = triggerFn![1];
    expect(body).toMatch(/smooth_note/);
  });
});

describe('gluon_plaits.cpp — worklet uses dirty-check instead of modulation-only function', () => {
  const WORKLET_SRC = readFileSync(
    resolve(__dirname, '../../src/audio/plaits-worklet.ts'),
    'utf-8',
  );

  it('applyPatchWithModulation uses _plaits_set_patch with dirty-check, not _plaits_set_modulation', () => {
    const method = WORKLET_SRC.match(
      /private applyPatchWithModulation[\s\S]*?\n  \}/,
    );
    expect(method).not.toBeNull();
    const body = method![0];
    // Uses _plaits_set_patch (the standard function)
    expect(body).toContain('_plaits_set_patch');
    // Does NOT use the removed _plaits_set_modulation
    expect(body).not.toContain('_plaits_set_modulation');
    // Has value-based dirty-check to avoid overriding per-step note pitches
    expect(body).toContain('this.lastH');
  });

  it('_plaits_set_modulation is not in the WASM interface', () => {
    expect(WORKLET_SRC).not.toContain('_plaits_set_modulation');
  });

  it('_plaits_set_modulation is not exported in build.sh', () => {
    const buildSh = readFileSync(
      resolve(__dirname, '../../wasm/build.sh'),
      'utf-8',
    );
    expect(buildSh).not.toContain('_plaits_set_modulation');
  });
});
