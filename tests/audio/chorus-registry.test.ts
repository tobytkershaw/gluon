// tests/audio/chorus-registry.test.ts
// Tests for Chorus instrument registry entries

import { describe, it, expect } from 'vitest';
import {
  chorusInstrument,
  getChorusEngineById,
  getChorusEngineByIndex,
  getChorusModelList,
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

describe('Chorus instrument definition', () => {
  it('is registered as an effect processor', () => {
    expect(chorusInstrument.type).toBe('effect');
    expect(chorusInstrument.adapterId).toBe('chorus');
  });

  it('has 3 engines (modes)', () => {
    expect(chorusInstrument.engines).toHaveLength(3);
  });

  it('engine IDs match expected set', () => {
    const ids = chorusInstrument.engines.map(e => e.id);
    expect(ids).toEqual(['chorus', 'flanger', 'phaser']);
  });

  it('each engine has 5 controls', () => {
    for (const engine of chorusInstrument.engines) {
      expect(engine.controls).toHaveLength(5);
    }
  });

  it('control IDs are rate, depth, feedback, mix, stereo', () => {
    const controlIds = chorusInstrument.engines[0].controls.map(c => c.id);
    expect(controlIds).toEqual(['rate', 'depth', 'feedback', 'mix', 'stereo']);
  });

  it('all controls are continuous and normalized 0-1', () => {
    for (const control of chorusInstrument.engines[0].controls) {
      expect(control.kind).toBe('continuous');
      expect(control.range!.min).toBe(0);
      expect(control.range!.max).toBe(1);
    }
  });

  it('rate defaults to 0.3, depth to 0.5, feedback to 0, mix to 0.5, stereo to 0.5', () => {
    const controls = chorusInstrument.engines[0].controls;
    const rate = controls.find(c => c.id === 'rate');
    const depth = controls.find(c => c.id === 'depth');
    const feedback = controls.find(c => c.id === 'feedback');
    const mix = controls.find(c => c.id === 'mix');
    const stereo = controls.find(c => c.id === 'stereo');
    expect(rate?.range.default).toBe(0.3);
    expect(depth?.range.default).toBe(0.5);
    expect(feedback?.range.default).toBe(0);
    expect(mix?.range.default).toBe(0.5);
    expect(stereo?.range.default).toBe(0.5);
  });

  it('rate has log display mapping for Hz', () => {
    const rate = chorusInstrument.engines[0].controls.find(c => c.id === 'rate');
    expect(rate?.displayMapping?.type).toBe('log');
    expect(rate?.displayMapping?.unit).toBe('Hz');
  });

  it('depth has percent display mapping', () => {
    const depth = chorusInstrument.engines[0].controls.find(c => c.id === 'depth');
    expect(depth?.displayMapping?.type).toBe('percent');
    expect(depth?.displayMapping?.unit).toBe('%');
  });

  it('all semantic roles are from the SemanticRole union', () => {
    for (const engine of chorusInstrument.engines) {
      for (const control of engine.controls) {
        if (control.semanticRole !== null) {
          expect(VALID_SEMANTIC_ROLES).toContain(control.semanticRole);
        }
      }
    }
  });

  it('all control bindings reference chorus adapter', () => {
    for (const engine of chorusInstrument.engines) {
      for (const control of engine.controls) {
        expect(control.binding.adapterId).toBe('chorus');
        expect(control.binding.path).toBe(`params.${control.id}`);
      }
    }
  });

  it('no duplicate engine IDs', () => {
    const ids = chorusInstrument.engines.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rate is large, depth is large, feedback is medium, mix is small, stereo is small', () => {
    const controls = chorusInstrument.engines[0].controls;
    expect(controls.find(c => c.id === 'rate')?.size).toBe('large');
    expect(controls.find(c => c.id === 'depth')?.size).toBe('large');
    expect(controls.find(c => c.id === 'feedback')?.size).toBe('medium');
    expect(controls.find(c => c.id === 'mix')?.size).toBe('small');
    expect(controls.find(c => c.id === 'stereo')?.size).toBe('small');
  });
});

describe('Chorus engine lookup helpers', () => {
  it('getChorusEngineById finds chorus', () => {
    const engine = getChorusEngineById('chorus');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('Chorus');
  });

  it('getChorusEngineById finds flanger', () => {
    const engine = getChorusEngineById('flanger');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('Flanger');
  });

  it('getChorusEngineById finds phaser', () => {
    const engine = getChorusEngineById('phaser');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('Phaser');
  });

  it('getChorusEngineById returns undefined for invalid', () => {
    expect(getChorusEngineById('nonexistent')).toBeUndefined();
  });

  it('getChorusEngineByIndex returns correct engine', () => {
    expect(getChorusEngineByIndex(0)!.id).toBe('chorus');
    expect(getChorusEngineByIndex(1)!.id).toBe('flanger');
    expect(getChorusEngineByIndex(2)!.id).toBe('phaser');
  });

  it('getChorusEngineByIndex returns undefined for out-of-bounds', () => {
    expect(getChorusEngineByIndex(3)).toBeUndefined();
  });

  it('getChorusModelList returns all 3 modes', () => {
    const list = getChorusModelList();
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({ index: 0, name: 'Chorus', description: expect.any(String) });
    expect(list[1]).toEqual({ index: 1, name: 'Flanger', description: expect.any(String) });
    expect(list[2]).toEqual({ index: 2, name: 'Phaser', description: expect.any(String) });
  });
});

describe('Processor registry includes Chorus', () => {
  it('getRegisteredProcessorTypes includes chorus', () => {
    expect(getRegisteredProcessorTypes()).toContain('chorus');
  });

  it('getProcessorInstrument returns Chorus', () => {
    const inst = getProcessorInstrument('chorus');
    expect(inst).toBeDefined();
    expect(inst!.label).toBe('Chorus');
  });

  it('getProcessorControlIds returns Chorus controls', () => {
    const ids = getProcessorControlIds('chorus');
    expect(ids).toEqual(['rate', 'depth', 'feedback', 'mix', 'stereo']);
  });

  it('getProcessorEngineByName finds Chorus modes', () => {
    const result = getProcessorEngineByName('chorus', 'flanger');
    expect(result).toBeDefined();
    expect(result!.index).toBe(1);
  });

  it('getProcessorEngineName returns Chorus mode name', () => {
    expect(getProcessorEngineName('chorus', 0)).toBe('chorus');
    expect(getProcessorEngineName('chorus', 2)).toBe('phaser');
  });
});

describe('Chain validation accepts Chorus', () => {
  it('Chorus is a valid processor type for chain mutation', async () => {
    const { validateChainMutation } = await import('../../src/engine/chain-validation');
    const track = {
      id: 'v0', engine: 'virtual-analog', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON' as const, stepGrid: { steps: [], length: 16 },
      patterns: [], muted: false, solo: false,
    };
    const result = validateChainMutation(track, { kind: 'add', type: 'chorus' });
    expect(result.valid).toBe(true);
  });

  it('Chorus controls pass processor target validation', async () => {
    const { validateProcessorTarget } = await import('../../src/engine/chain-validation');
    const track = {
      id: 'v0', engine: 'virtual-analog', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON' as const, stepGrid: { steps: [], length: 16 },
      patterns: [], muted: false, solo: false,
      processors: [{ id: 'chorus-1', type: 'chorus', model: 0, params: { rate: 0.3, depth: 0.5, feedback: 0, mix: 0.5, stereo: 0.5 } }],
    };
    expect(validateProcessorTarget(track, 'chorus-1', { param: 'rate' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'chorus-1', { param: 'depth' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'chorus-1', { param: 'feedback' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'chorus-1', { param: 'mix' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'chorus-1', { param: 'stereo' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'chorus-1', { model: 'flanger' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'chorus-1', { param: 'invalid' }).valid).toBe(false);
  });
});
