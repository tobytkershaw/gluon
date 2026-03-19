// tests/audio/instrument-registry-marbles.test.ts
// Tests for Marbles modulator instrument registry entries

import { describe, it, expect } from 'vitest';
import {
  marblesInstrument,
  getMarblesEngineById,
  getMarblesEngineByIndex,
  getMarblesModelList,
  getModulatorInstrument,
  getModulatorControlIds,
  getRegisteredModulatorTypes,
  getModulatorEngineByName,
  getModulatorEngineName,
  getModulatorDefaultParams,
} from '../../src/audio/instrument-registry';
import type { SemanticRole } from '../../src/engine/canonical-types';

const VALID_SEMANTIC_ROLES: SemanticRole[] = [
  'pitch', 'brightness', 'richness', 'texture', 'decay', 'attack',
  'body', 'noise', 'resonance', 'movement_rate', 'mod_depth', 'space',
  'drive', 'stability', 'density', 'level', 'pan',
];

describe('Marbles instrument definition', () => {
  it('is registered as a modulator', () => {
    expect(marblesInstrument.type).toBe('modulator');
    expect(marblesInstrument.adapterId).toBe('marbles');
  });

  it('has label "Mutable Instruments Marbles"', () => {
    expect(marblesInstrument.label).toBe('Mutable Instruments Marbles');
  });

  it('has 3 engines (modes)', () => {
    expect(marblesInstrument.engines).toHaveLength(3);
  });

  it('engine IDs match expected set', () => {
    const ids = marblesInstrument.engines.map(e => e.id);
    expect(ids).toEqual(['voltage', 'gate', 'both']);
  });

  it('each engine has 6 controls', () => {
    for (const engine of marblesInstrument.engines) {
      expect(engine.controls).toHaveLength(6);
    }
  });

  it('control IDs are rate, spread, bias, steps, deja_vu, length', () => {
    const controlIds = marblesInstrument.engines[0].controls.map(c => c.id);
    expect(controlIds).toEqual(['rate', 'spread', 'bias', 'steps', 'deja_vu', 'length']);
  });

  it('all controls are continuous and normalized 0-1', () => {
    for (const control of marblesInstrument.engines[0].controls) {
      expect(control.kind).toBe('continuous');
      expect(control.range!.min).toBe(0);
      expect(control.range!.max).toBe(1);
    }
  });

  it('controls have expected defaults', () => {
    const controls = marblesInstrument.engines[0].controls;
    expect(controls.find(c => c.id === 'rate')?.range.default).toBe(0.5);
    expect(controls.find(c => c.id === 'spread')?.range.default).toBe(0.5);
    expect(controls.find(c => c.id === 'bias')?.range.default).toBe(0.5);
    expect(controls.find(c => c.id === 'steps')?.range.default).toBe(0.0);
    expect(controls.find(c => c.id === 'deja_vu')?.range.default).toBe(0.0);
    expect(controls.find(c => c.id === 'length')?.range.default).toBe(0.25);
  });

  it('rate has log display mapping for Hz', () => {
    const rate = marblesInstrument.engines[0].controls.find(c => c.id === 'rate');
    expect(rate?.displayMapping?.type).toBe('log');
    expect(rate?.displayMapping?.unit).toBe('Hz');
  });

  it('spread has percent display mapping', () => {
    const spread = marblesInstrument.engines[0].controls.find(c => c.id === 'spread');
    expect(spread?.displayMapping?.type).toBe('percent');
    expect(spread?.displayMapping?.unit).toBe('%');
  });

  it('length has linear display mapping for steps', () => {
    const length = marblesInstrument.engines[0].controls.find(c => c.id === 'length');
    expect(length?.displayMapping?.type).toBe('linear');
    expect(length?.displayMapping?.unit).toBe('steps');
  });

  it('all semantic roles are from the SemanticRole union', () => {
    for (const engine of marblesInstrument.engines) {
      for (const control of engine.controls) {
        if (control.semanticRole !== null) {
          expect(VALID_SEMANTIC_ROLES).toContain(control.semanticRole);
        }
      }
    }
  });

  it('all control bindings reference marbles adapter', () => {
    for (const engine of marblesInstrument.engines) {
      for (const control of engine.controls) {
        expect(control.binding.adapterId).toBe('marbles');
        expect(control.binding.path).toBe(`params.${control.id}`);
      }
    }
  });

  it('no duplicate engine IDs', () => {
    const ids = marblesInstrument.engines.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rate, spread, bias, deja_vu are large; steps, length are medium', () => {
    const controls = marblesInstrument.engines[0].controls;
    expect(controls.find(c => c.id === 'rate')?.size).toBe('large');
    expect(controls.find(c => c.id === 'spread')?.size).toBe('large');
    expect(controls.find(c => c.id === 'bias')?.size).toBe('large');
    expect(controls.find(c => c.id === 'deja_vu')?.size).toBe('large');
    expect(controls.find(c => c.id === 'steps')?.size).toBe('medium');
    expect(controls.find(c => c.id === 'length')?.size).toBe('medium');
  });

  it('semantic roles match expected assignments', () => {
    const controls = marblesInstrument.engines[0].controls;
    expect(controls.find(c => c.id === 'rate')?.semanticRole).toBe('movement_rate');
    expect(controls.find(c => c.id === 'spread')?.semanticRole).toBe('richness');
    expect(controls.find(c => c.id === 'bias')?.semanticRole).toBe('body');
    expect(controls.find(c => c.id === 'steps')?.semanticRole).toBe('texture');
    expect(controls.find(c => c.id === 'deja_vu')?.semanticRole).toBe('stability');
    expect(controls.find(c => c.id === 'length')?.semanticRole).toBe('density');
  });
});

describe('Marbles engine lookup helpers', () => {
  it('getMarblesEngineById finds voltage', () => {
    const engine = getMarblesEngineById('voltage');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('Voltage');
  });

  it('getMarblesEngineById finds gate', () => {
    const engine = getMarblesEngineById('gate');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('Gate');
  });

  it('getMarblesEngineById finds both', () => {
    const engine = getMarblesEngineById('both');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('Both');
  });

  it('getMarblesEngineById returns undefined for invalid', () => {
    expect(getMarblesEngineById('nonexistent')).toBeUndefined();
  });

  it('getMarblesEngineByIndex returns correct engine', () => {
    expect(getMarblesEngineByIndex(0)!.id).toBe('voltage');
    expect(getMarblesEngineByIndex(1)!.id).toBe('gate');
    expect(getMarblesEngineByIndex(2)!.id).toBe('both');
  });

  it('getMarblesEngineByIndex returns undefined for out-of-bounds', () => {
    expect(getMarblesEngineByIndex(3)).toBeUndefined();
  });

  it('getMarblesModelList returns all 3 modes', () => {
    const list = getMarblesModelList();
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({ index: 0, name: 'Voltage', description: expect.any(String) });
    expect(list[1]).toEqual({ index: 1, name: 'Gate', description: expect.any(String) });
    expect(list[2]).toEqual({ index: 2, name: 'Both', description: expect.any(String) });
  });
});

describe('Modulator registry includes Marbles', () => {
  it('getRegisteredModulatorTypes includes marbles', () => {
    expect(getRegisteredModulatorTypes()).toContain('marbles');
  });

  it('getModulatorInstrument returns Marbles', () => {
    const inst = getModulatorInstrument('marbles');
    expect(inst).toBeDefined();
    expect(inst!.label).toBe('Mutable Instruments Marbles');
  });

  it('getModulatorControlIds returns Marbles controls', () => {
    const ids = getModulatorControlIds('marbles');
    expect(ids).toEqual(['rate', 'spread', 'bias', 'steps', 'deja_vu', 'length']);
  });

  it('getModulatorEngineByName finds Marbles modes', () => {
    const result = getModulatorEngineByName('marbles', 'gate');
    expect(result).toBeDefined();
    expect(result!.index).toBe(1);
  });

  it('getModulatorEngineName returns Marbles mode name', () => {
    expect(getModulatorEngineName('marbles', 0)).toBe('voltage');
    expect(getModulatorEngineName('marbles', 2)).toBe('both');
  });

  it('getModulatorDefaultParams returns correct defaults', () => {
    const defaults = getModulatorDefaultParams('marbles', 0);
    expect(defaults.rate).toBe(0.5);
    expect(defaults.spread).toBe(0.5);
    expect(defaults.bias).toBe(0.5);
    expect(defaults.steps).toBe(0.0);
    expect(defaults.deja_vu).toBe(0.0);
    expect(defaults.length).toBe(0.25);
  });
});
