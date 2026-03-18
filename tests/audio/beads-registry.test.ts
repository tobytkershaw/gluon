// tests/audio/beads-registry.test.ts
// Tests for Beads instrument registry entries

import { describe, it, expect } from 'vitest';
import {
  beadsInstrument,
  getBeadsEngineById,
  getBeadsEngineByIndex,
  getBeadsModelList,
  getProcessorInstrument,
  getProcessorControlIds,
  getRegisteredProcessorTypes,
  getProcessorEngineByName,
  getProcessorEngineName,
} from '../../src/audio/instrument-registry';

describe('Beads instrument definition', () => {
  it('is registered as an effect processor', () => {
    expect(beadsInstrument.type).toBe('effect');
    expect(beadsInstrument.adapterId).toBe('beads');
  });

  it('has 3 engines (modes)', () => {
    expect(beadsInstrument.engines).toHaveLength(3);
  });

  it('engine IDs match expected set', () => {
    const ids = beadsInstrument.engines.map(e => e.id);
    expect(ids).toEqual(['granular', 'delay', 'reverb']);
  });

  it('each engine has 6 controls', () => {
    for (const engine of beadsInstrument.engines) {
      expect(engine.controls).toHaveLength(6);
    }
  });

  it('control IDs are time, density, texture, position, pitch, dry-wet', () => {
    const controlIds = beadsInstrument.engines[0].controls.map(c => c.id);
    expect(controlIds).toEqual(['time', 'density', 'texture', 'position', 'pitch', 'dry-wet']);
  });

  it('all continuous controls are normalized 0-1', () => {
    for (const control of beadsInstrument.engines[0].controls) {
      expect(control.range!.min).toBe(0);
      expect(control.range!.max).toBe(1);
    }
  });

  it('all controls default to 0.5', () => {
    const controls = beadsInstrument.engines[0].controls;
    for (const c of controls) {
      expect(c.range.default, `${c.id} should default to 0.5`).toBe(0.5);
    }
  });

  it('dry-wet has percent display mapping', () => {
    const controls = beadsInstrument.engines[0].controls;
    const dryWet = controls.find(c => c.id === 'dry-wet');
    expect(dryWet?.displayMapping?.type).toBe('percent');
  });
});

describe('Beads engine lookup helpers', () => {
  it('getBeadsEngineById finds granular', () => {
    const engine = getBeadsEngineById('granular');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('Granular');
  });

  it('getBeadsEngineById finds delay', () => {
    const engine = getBeadsEngineById('delay');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('Delay');
  });

  it('getBeadsEngineById finds reverb', () => {
    const engine = getBeadsEngineById('reverb');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('Reverb');
  });

  it('getBeadsEngineById returns undefined for invalid', () => {
    expect(getBeadsEngineById('nonexistent')).toBeUndefined();
  });

  it('getBeadsEngineByIndex returns correct engine', () => {
    expect(getBeadsEngineByIndex(0)!.id).toBe('granular');
    expect(getBeadsEngineByIndex(1)!.id).toBe('delay');
    expect(getBeadsEngineByIndex(2)!.id).toBe('reverb');
  });

  it('getBeadsModelList returns all 3 modes', () => {
    const list = getBeadsModelList();
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({ index: 0, name: 'Granular', description: expect.any(String) });
  });
});

describe('Processor registry includes Beads', () => {
  it('getRegisteredProcessorTypes includes beads', () => {
    expect(getRegisteredProcessorTypes()).toContain('beads');
  });

  it('getProcessorInstrument returns Beads', () => {
    const inst = getProcessorInstrument('beads');
    expect(inst).toBeDefined();
    expect(inst!.label).toBe('Mutable Instruments Beads');
  });

  it('getProcessorControlIds returns Beads controls', () => {
    const ids = getProcessorControlIds('beads');
    expect(ids).toEqual(['time', 'density', 'texture', 'position', 'pitch', 'dry-wet']);
  });

  it('getProcessorEngineByName finds Beads modes', () => {
    const result = getProcessorEngineByName('beads', 'reverb');
    expect(result).toBeDefined();
    expect(result!.index).toBe(2);
  });

  it('getProcessorEngineName returns Beads mode name', () => {
    expect(getProcessorEngineName('beads', 0)).toBe('granular');
    expect(getProcessorEngineName('beads', 2)).toBe('reverb');
  });
});

describe('Chain validation accepts Beads', () => {
  it('Beads is a valid processor type for chain mutation', async () => {
    const { validateChainMutation } = await import('../../src/engine/chain-validation');
    const track = {
      id: 'v0', engine: 'virtual-analog', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON' as const, stepGrid: { steps: [], length: 16 },
      patterns: [], muted: false, solo: false,
    };
    const result = validateChainMutation(track, { kind: 'add', type: 'beads' });
    expect(result.valid).toBe(true);
  });

  it('Beads controls pass processor target validation', async () => {
    const { validateProcessorTarget } = await import('../../src/engine/chain-validation');
    const track = {
      id: 'v0', engine: 'virtual-analog', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON' as const, stepGrid: { steps: [], length: 16 },
      patterns: [], muted: false, solo: false,
      processors: [{ id: 'beads-1', type: 'beads', model: 0, params: { time: 0.5, density: 0.5, texture: 0.5, position: 0.5, pitch: 0.5, 'dry-wet': 0.5 } }],
    };
    expect(validateProcessorTarget(track, 'beads-1', { param: 'time' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'beads-1', { param: 'density' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'beads-1', { model: 'reverb' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'beads-1', { param: 'invalid' }).valid).toBe(false);
  });
});
