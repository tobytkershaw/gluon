// tests/audio/warps-registry.test.ts
// Tests for Warps instrument registry entries

import { describe, it, expect } from 'vitest';
import {
  warpsInstrument,
  getWarpsEngineById,
  getWarpsEngineByIndex,
  getWarpsModelList,
  getProcessorInstrument,
  getProcessorControlIds,
  getRegisteredProcessorTypes,
  getProcessorEngineByName,
  getProcessorEngineName,
} from '../../src/audio/instrument-registry';
import type { SemanticRole } from '../../src/engine/canonical-types';

const VALID_SEMANTIC_ROLES: SemanticRole[] = [
  'pitch', 'brightness', 'richness', 'texture', 'decay', 'attack',
  'body', 'noise', 'resonance', 'movement_rate', 'mod_depth', 'space',
  'drive', 'stability', 'density', 'level', 'pan',
];

describe('Warps instrument definition', () => {
  it('is registered as an effect processor', () => {
    expect(warpsInstrument.type).toBe('effect');
    expect(warpsInstrument.adapterId).toBe('warps');
  });

  it('has label Mutable Instruments Warps', () => {
    expect(warpsInstrument.label).toBe('Mutable Instruments Warps');
  });

  it('has 4 engines (modes)', () => {
    expect(warpsInstrument.engines).toHaveLength(4);
  });

  it('engine IDs match expected set', () => {
    const ids = warpsInstrument.engines.map(e => e.id);
    expect(ids).toEqual(['crossfade', 'fold', 'ring', 'frequency_shift']);
  });

  it('each engine has 3 controls: algorithm, timbre, level', () => {
    for (const engine of warpsInstrument.engines) {
      expect(engine.controls).toHaveLength(3);
      const controlIds = engine.controls.map(c => c.id);
      expect(controlIds).toEqual(['algorithm', 'timbre', 'level']);
    }
  });

  it('all controls are continuous with range 0-1', () => {
    for (const control of warpsInstrument.engines[0].controls) {
      expect(control.kind).toBe('continuous');
      expect(control.range.min).toBe(0);
      expect(control.range.max).toBe(1);
    }
  });

  it('all controls default to 0.5', () => {
    for (const control of warpsInstrument.engines[0].controls) {
      expect(control.range.default, `${control.id} should default to 0.5`).toBe(0.5);
    }
  });

  it('all control bindings reference warps adapter', () => {
    for (const engine of warpsInstrument.engines) {
      for (const control of engine.controls) {
        expect(control.binding.adapterId).toBe('warps');
        expect(control.binding.path).toBe(`params.${control.id}`);
      }
    }
  });

  it('all semantic roles are from the SemanticRole union', () => {
    for (const engine of warpsInstrument.engines) {
      for (const control of engine.controls) {
        if (control.semanticRole !== null) {
          expect(VALID_SEMANTIC_ROLES).toContain(control.semanticRole);
        }
      }
    }
  });

  it('no duplicate engine IDs', () => {
    const ids = warpsInstrument.engines.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Warps engine lookup helpers', () => {
  it('getWarpsEngineById finds crossfade', () => {
    const engine = getWarpsEngineById('crossfade');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('Crossfade');
  });

  it('getWarpsEngineById finds ring', () => {
    const engine = getWarpsEngineById('ring');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('Ring Mod');
  });

  it('getWarpsEngineById returns undefined for invalid', () => {
    expect(getWarpsEngineById('nonexistent')).toBeUndefined();
  });

  it('getWarpsEngineByIndex returns correct engine', () => {
    expect(getWarpsEngineByIndex(0)!.id).toBe('crossfade');
    expect(getWarpsEngineByIndex(1)!.id).toBe('fold');
    expect(getWarpsEngineByIndex(2)!.id).toBe('ring');
    expect(getWarpsEngineByIndex(3)!.id).toBe('frequency_shift');
  });

  it('getWarpsEngineByIndex returns undefined for out of bounds', () => {
    expect(getWarpsEngineByIndex(4)).toBeUndefined();
  });

  it('getWarpsModelList returns all 4 modes', () => {
    const list = getWarpsModelList();
    expect(list).toHaveLength(4);
    expect(list[0].name).toBe('Crossfade');
    expect(list[3].name).toBe('Frequency Shift (Gluon)');
  });
});

describe('Processor registry includes Warps', () => {
  it('getRegisteredProcessorTypes includes warps', () => {
    expect(getRegisteredProcessorTypes()).toContain('warps');
  });

  it('getProcessorInstrument returns Warps', () => {
    const inst = getProcessorInstrument('warps');
    expect(inst).toBeDefined();
    expect(inst!.label).toBe('Mutable Instruments Warps');
  });

  it('getProcessorControlIds returns Warps controls', () => {
    const ids = getProcessorControlIds('warps');
    expect(ids).toEqual(['algorithm', 'timbre', 'level']);
  });

  it('getProcessorEngineByName finds Warps modes', () => {
    const result = getProcessorEngineByName('warps', 'fold');
    expect(result).toBeDefined();
    expect(result!.index).toBe(1);
  });

  it('getProcessorEngineName returns Warps mode name', () => {
    expect(getProcessorEngineName('warps', 0)).toBe('crossfade');
    expect(getProcessorEngineName('warps', 3)).toBe('frequency_shift');
  });
});

describe('Chain validation accepts Warps', () => {
  it('Warps is a valid processor type for chain mutation', async () => {
    const { validateChainMutation } = await import('../../src/engine/chain-validation');
    const track = {
      id: 'v0', engine: 'virtual-analog', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON' as const, stepGrid: { steps: [], length: 16 },
      patterns: [], muted: false, solo: false,
    };
    const result = validateChainMutation(track, { kind: 'add', type: 'warps' });
    expect(result.valid).toBe(true);
  });

  it('Warps controls pass processor target validation', async () => {
    const { validateProcessorTarget } = await import('../../src/engine/chain-validation');
    const track = {
      id: 'v0', engine: 'virtual-analog', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON' as const, stepGrid: { steps: [], length: 16 },
      patterns: [], muted: false, solo: false,
      processors: [{ id: 'warps-1', type: 'warps', model: 0, params: { algorithm: 0.5, timbre: 0.5, level: 0.5 } }],
    };
    expect(validateProcessorTarget(track, 'warps-1', { param: 'algorithm' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'warps-1', { param: 'timbre' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'warps-1', { param: 'level' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'warps-1', { model: 'fold' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'warps-1', { param: 'invalid' }).valid).toBe(false);
  });
});
