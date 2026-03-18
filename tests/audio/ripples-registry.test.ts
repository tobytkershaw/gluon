// tests/audio/ripples-registry.test.ts
// Tests for Ripples instrument registry entries

import { describe, it, expect } from 'vitest';
import {
  ripplesInstrument,
  getRipplesEngineById,
  getRipplesEngineByIndex,
  getRipplesModelList,
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

describe('Ripples instrument definition', () => {
  it('is registered as an effect processor', () => {
    expect(ripplesInstrument.type).toBe('effect');
    expect(ripplesInstrument.adapterId).toBe('ripples');
  });

  it('has 4 engines (modes)', () => {
    expect(ripplesInstrument.engines).toHaveLength(4);
  });

  it('engine IDs match expected set', () => {
    const ids = ripplesInstrument.engines.map(e => e.id);
    expect(ids).toEqual(['lp2', 'lp4', 'bp2', 'hp2']);
  });

  it('each engine has 3 controls', () => {
    for (const engine of ripplesInstrument.engines) {
      expect(engine.controls).toHaveLength(3);
    }
  });

  it('control IDs are cutoff, resonance, drive', () => {
    const controlIds = ripplesInstrument.engines[0].controls.map(c => c.id);
    expect(controlIds).toEqual(['cutoff', 'resonance', 'drive']);
  });

  it('all controls are continuous and normalized 0-1', () => {
    for (const control of ripplesInstrument.engines[0].controls) {
      expect(control.kind).toBe('continuous');
      expect(control.range!.min).toBe(0);
      expect(control.range!.max).toBe(1);
    }
  });

  it('cutoff defaults to 0.5, resonance and drive default to 0', () => {
    const controls = ripplesInstrument.engines[0].controls;
    const cutoff = controls.find(c => c.id === 'cutoff');
    const resonance = controls.find(c => c.id === 'resonance');
    const drive = controls.find(c => c.id === 'drive');
    expect(cutoff?.range.default).toBe(0.5);
    expect(resonance?.range.default).toBe(0);
    expect(drive?.range.default).toBe(0);
  });

  it('cutoff has log display mapping for Hz', () => {
    const cutoff = ripplesInstrument.engines[0].controls.find(c => c.id === 'cutoff');
    expect(cutoff?.displayMapping?.type).toBe('log');
    expect(cutoff?.displayMapping?.unit).toBe('Hz');
  });

  it('drive has percent display mapping', () => {
    const drive = ripplesInstrument.engines[0].controls.find(c => c.id === 'drive');
    expect(drive?.displayMapping?.type).toBe('percent');
    expect(drive?.displayMapping?.unit).toBe('%');
  });

  it('all semantic roles are from the SemanticRole union', () => {
    for (const engine of ripplesInstrument.engines) {
      for (const control of engine.controls) {
        if (control.semanticRole !== null) {
          expect(VALID_SEMANTIC_ROLES).toContain(control.semanticRole);
        }
      }
    }
  });

  it('all control bindings reference ripples adapter', () => {
    for (const engine of ripplesInstrument.engines) {
      for (const control of engine.controls) {
        expect(control.binding.adapterId).toBe('ripples');
        expect(control.binding.path).toBe(`params.${control.id}`);
      }
    }
  });

  it('no duplicate engine IDs', () => {
    const ids = ripplesInstrument.engines.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cutoff is large, resonance is large, drive is medium', () => {
    const controls = ripplesInstrument.engines[0].controls;
    expect(controls.find(c => c.id === 'cutoff')?.size).toBe('large');
    expect(controls.find(c => c.id === 'resonance')?.size).toBe('large');
    expect(controls.find(c => c.id === 'drive')?.size).toBe('medium');
  });
});

describe('Ripples engine lookup helpers', () => {
  it('getRipplesEngineById finds lp2', () => {
    const engine = getRipplesEngineById('lp2');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('2-Pole Low-Pass');
  });

  it('getRipplesEngineById returns undefined for invalid', () => {
    expect(getRipplesEngineById('nonexistent')).toBeUndefined();
  });

  it('getRipplesEngineByIndex returns correct engine', () => {
    expect(getRipplesEngineByIndex(0)!.id).toBe('lp2');
    expect(getRipplesEngineByIndex(1)!.id).toBe('lp4');
    expect(getRipplesEngineByIndex(2)!.id).toBe('bp2');
    expect(getRipplesEngineByIndex(3)!.id).toBe('hp2');
  });

  it('getRipplesEngineByIndex returns undefined for out-of-bounds', () => {
    expect(getRipplesEngineByIndex(4)).toBeUndefined();
  });

  it('getRipplesModelList returns all 4 modes', () => {
    const list = getRipplesModelList();
    expect(list).toHaveLength(4);
    expect(list[0]).toEqual({ index: 0, name: '2-Pole Low-Pass', description: expect.any(String) });
  });
});

describe('Processor registry includes Ripples', () => {
  it('getRegisteredProcessorTypes includes ripples', () => {
    expect(getRegisteredProcessorTypes()).toContain('ripples');
  });

  it('getProcessorInstrument returns Ripples', () => {
    const inst = getProcessorInstrument('ripples');
    expect(inst).toBeDefined();
    expect(inst!.label).toBe('Mutable Instruments Ripples');
  });

  it('getProcessorControlIds returns Ripples controls', () => {
    const ids = getProcessorControlIds('ripples');
    expect(ids).toEqual(['cutoff', 'resonance', 'drive']);
  });

  it('getProcessorEngineByName finds Ripples modes', () => {
    const result = getProcessorEngineByName('ripples', 'lp4');
    expect(result).toBeDefined();
    expect(result!.index).toBe(1);
  });

  it('getProcessorEngineName returns Ripples mode name', () => {
    expect(getProcessorEngineName('ripples', 0)).toBe('lp2');
    expect(getProcessorEngineName('ripples', 3)).toBe('hp2');
  });
});

describe('Chain validation accepts Ripples', () => {
  it('Ripples is a valid processor type for chain mutation', async () => {
    const { validateChainMutation } = await import('../../src/engine/chain-validation');
    const track = {
      id: 'v0', engine: 'virtual-analog', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON' as const, stepGrid: { steps: [], length: 16 },
      patterns: [], muted: false, solo: false,
    };
    const result = validateChainMutation(track, { kind: 'add', type: 'ripples' });
    expect(result.valid).toBe(true);
  });

  it('Ripples controls pass processor target validation', async () => {
    const { validateProcessorTarget } = await import('../../src/engine/chain-validation');
    const track = {
      id: 'v0', engine: 'virtual-analog', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON' as const, stepGrid: { steps: [], length: 16 },
      patterns: [], muted: false, solo: false,
      processors: [{ id: 'ripples-1', type: 'ripples', model: 0, params: { cutoff: 0.5, resonance: 0, drive: 0 } }],
    };
    expect(validateProcessorTarget(track, 'ripples-1', { param: 'cutoff' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'ripples-1', { param: 'resonance' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'ripples-1', { param: 'drive' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'ripples-1', { model: 'lp4' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'ripples-1', { param: 'invalid' }).valid).toBe(false);
  });
});
