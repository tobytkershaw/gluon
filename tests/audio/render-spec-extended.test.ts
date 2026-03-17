// tests/audio/render-spec-extended.test.ts
//
// Tests that extended Plaits params (FM, LPG, etc.) are correctly routed
// as 'set-extended' events in the offline render spec.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const RENDER_SPEC_SRC = readFileSync(
  resolve(__dirname, '../../src/audio/render-spec.ts'),
  'utf-8',
);

const RENDER_WORKER_SRC = readFileSync(
  resolve(__dirname, '../../src/audio/render-worker.ts'),
  'utf-8',
);

describe('render-spec — extended param routing', () => {
  it('RenderEvent type union includes set-extended', () => {
    expect(RENDER_SPEC_SRC).toContain("'set-extended'");
  });

  it('RenderEvent has extended field', () => {
    expect(RENDER_SPEC_SRC).toContain('extended?: Partial<RenderPlaitsExtended>');
  });

  it('EXTENDED_RUNTIME_KEYS set contains all 5 extended keys', () => {
    for (const key of ['fm_amount', 'timbre_mod_amount', 'morph_mod_amount', 'decay', 'lpg_colour']) {
      expect(RENDER_SPEC_SRC).toContain(`'${key}'`);
    }
  });

  it('parameter events route extended keys to set-extended type', () => {
    // The pushMusicalEvent function should check EXTENDED_RUNTIME_KEYS
    // and emit set-extended instead of set-patch for those keys
    expect(RENDER_SPEC_SRC).toContain('EXTENDED_RUNTIME_KEYS.has(runtimeParam)');
    // Should emit set-extended
    const extendedEmit = RENDER_SPEC_SRC.match(/type:\s*'set-extended'/g);
    expect(extendedEmit).not.toBeNull();
    expect(extendedEmit!.length).toBeGreaterThanOrEqual(2); // in both pushMusicalEvent and pushInterpolatedEvents
  });
});

describe('render-worker — extended param handling', () => {
  it('imports RenderPlaitsExtended type', () => {
    expect(RENDER_WORKER_SRC).toContain('RenderPlaitsExtended');
  });

  it('tracks currentExtended state', () => {
    expect(RENDER_WORKER_SRC).toContain('currentExtended');
  });

  it('handles set-extended events in the render loop', () => {
    expect(RENDER_WORKER_SRC).toContain("ev.type === 'set-extended'");
  });

  it('sends _plaits_set_extended when dirty', () => {
    expect(RENDER_WORKER_SRC).toContain('extendedDirty');
    // Should call _plaits_set_extended conditionally on dirty flag
    const conditionalCall = RENDER_WORKER_SRC.match(/if\s*\(extendedDirty\)\s*\{[\s\S]*?_plaits_set_extended/);
    expect(conditionalCall).not.toBeNull();
  });
});
