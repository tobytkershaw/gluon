// tests/audio/clouds-registry.test.ts
// Tests for Clouds instrument registry entries

import { describe, it, expect } from 'vitest';
import {
  cloudsInstrument,
  getCloudsEngineById,
  getCloudsEngineByIndex,
  getCloudsModelList,
  getProcessorInstrument,
  getProcessorControlIds,
  getRegisteredProcessorTypes,
  getProcessorEngineByName,
  getProcessorEngineName,
} from '../../src/audio/instrument-registry';

describe('Clouds instrument definition', () => {
  it('is registered as an effect processor', () => {
    expect(cloudsInstrument.type).toBe('effect');
    expect(cloudsInstrument.adapterId).toBe('clouds');
  });

  it('has 4 engines (modes)', () => {
    expect(cloudsInstrument.engines).toHaveLength(4);
  });

  it('engine IDs match expected set', () => {
    const ids = cloudsInstrument.engines.map(e => e.id);
    expect(ids).toEqual(['granular', 'pitch-shifter', 'looping-delay', 'spectral']);
  });

  it('each engine has 5 controls (4 continuous + freeze toggle)', () => {
    for (const engine of cloudsInstrument.engines) {
      expect(engine.controls).toHaveLength(5);
    }
  });

  it('control IDs are position, size, density, feedback, freeze', () => {
    const controlIds = cloudsInstrument.engines[0].controls.map(c => c.id);
    expect(controlIds).toEqual(['position', 'size', 'density', 'feedback', 'freeze']);
  });

  it('all continuous controls are normalized 0-1', () => {
    for (const control of cloudsInstrument.engines[0].controls) {
      if (control.kind === 'boolean') continue;
      expect(control.range!.min).toBe(0);
      expect(control.range!.max).toBe(1);
    }
  });

  it('feedback defaults to 0, continuous others to 0.5', () => {
    const controls = cloudsInstrument.engines[0].controls;
    const fb = controls.find(c => c.id === 'feedback')!;
    expect(fb.range.default).toBe(0);
    for (const c of controls.filter(c => c.id !== 'feedback' && c.kind === 'continuous')) {
      expect(c.range.default).toBe(0.5);
    }
  });

  it('freeze is boolean with small size', () => {
    const controls = cloudsInstrument.engines[0].controls;
    const freeze = controls.find(c => c.id === 'freeze');
    expect(freeze?.kind).toBe('boolean');
    expect(freeze?.size).toBe('small');
  });
});

describe('Clouds engine lookup helpers', () => {
  it('getCloudsEngineById finds granular', () => {
    const engine = getCloudsEngineById('granular');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('Granular');
  });

  it('getCloudsEngineById returns undefined for invalid', () => {
    expect(getCloudsEngineById('nonexistent')).toBeUndefined();
  });

  it('getCloudsEngineByIndex returns correct engine', () => {
    expect(getCloudsEngineByIndex(0)!.id).toBe('granular');
    expect(getCloudsEngineByIndex(3)!.id).toBe('spectral');
  });

  it('getCloudsModelList returns all 4 modes', () => {
    const list = getCloudsModelList();
    expect(list).toHaveLength(4);
    expect(list[0]).toEqual({ index: 0, name: 'Granular', description: expect.any(String) });
  });
});

describe('Processor registry includes Clouds', () => {
  it('getRegisteredProcessorTypes includes clouds', () => {
    expect(getRegisteredProcessorTypes()).toContain('clouds');
  });

  it('getProcessorInstrument returns Clouds', () => {
    const inst = getProcessorInstrument('clouds');
    expect(inst).toBeDefined();
    expect(inst!.label).toBe('Mutable Instruments Clouds');
  });

  it('getProcessorControlIds returns Clouds controls', () => {
    const ids = getProcessorControlIds('clouds');
    expect(ids).toEqual(['position', 'size', 'density', 'feedback', 'freeze']);
  });

  it('getProcessorEngineByName finds Clouds modes', () => {
    const result = getProcessorEngineByName('clouds', 'spectral');
    expect(result).toBeDefined();
    expect(result!.index).toBe(3);
  });

  it('getProcessorEngineName returns Clouds mode name', () => {
    expect(getProcessorEngineName('clouds', 0)).toBe('granular');
    expect(getProcessorEngineName('clouds', 3)).toBe('spectral');
  });
});

describe('Chain validation accepts Clouds', () => {
  // These test that the registry-driven chain validation automatically works for Clouds
  it('Clouds is a valid processor type for chain mutation', async () => {
    const { validateChainMutation } = await import('../../src/engine/chain-validation');
    const track = {
      id: 'v0', engine: 'virtual-analog', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON' as const, pattern: { steps: [], length: 16 },
      regions: [], muted: false, solo: false,
    };
    const result = validateChainMutation(track, { kind: 'add', type: 'clouds' });
    expect(result.valid).toBe(true);
  });

  it('Clouds controls pass processor target validation', async () => {
    const { validateProcessorTarget } = await import('../../src/engine/chain-validation');
    const track = {
      id: 'v0', engine: 'virtual-analog', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON' as const, pattern: { steps: [], length: 16 },
      regions: [], muted: false, solo: false,
      processors: [{ id: 'clouds-1', type: 'clouds', model: 0, params: { position: 0.5, size: 0.5, density: 0.5, feedback: 0 } }],
    };
    expect(validateProcessorTarget(track, 'clouds-1', { param: 'position' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'clouds-1', { param: 'density' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'clouds-1', { model: 'spectral' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'clouds-1', { param: 'invalid' }).valid).toBe(false);
  });
});
