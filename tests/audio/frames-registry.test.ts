// tests/audio/frames-registry.test.ts
// Tests for Frames instrument registry entries

import { describe, it, expect } from 'vitest';
import {
  framesInstrument,
  getFramesEngineById,
  getFramesEngineByIndex,
  getFramesModelList,
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

describe('Frames instrument definition', () => {
  it('is registered as an effect processor', () => {
    expect(framesInstrument.type).toBe('effect');
    expect(framesInstrument.adapterId).toBe('frames');
  });

  it('has 2 engines (modes)', () => {
    expect(framesInstrument.engines).toHaveLength(2);
  });

  it('engine IDs match expected set', () => {
    const ids = framesInstrument.engines.map(e => e.id);
    expect(ids).toEqual(['keyframe', 'sequencer']);
  });

  it('each engine has 6 controls', () => {
    for (const engine of framesInstrument.engines) {
      expect(engine.controls).toHaveLength(6);
    }
  });

  it('control IDs are frame, channel_1..4, modulation', () => {
    const controlIds = framesInstrument.engines[0].controls.map(c => c.id);
    expect(controlIds).toEqual(['frame', 'channel_1', 'channel_2', 'channel_3', 'channel_4', 'modulation']);
  });

  it('all controls are continuous and normalized 0-1', () => {
    for (const control of framesInstrument.engines[0].controls) {
      expect(control.kind).toBe('continuous');
      expect(control.range!.min).toBe(0);
      expect(control.range!.max).toBe(1);
    }
  });

  it('frame defaults to 0, channels default to 0, modulation defaults to 0.5', () => {
    const controls = framesInstrument.engines[0].controls;
    expect(controls.find(c => c.id === 'frame')?.range.default).toBe(0);
    expect(controls.find(c => c.id === 'channel_1')?.range.default).toBe(0);
    expect(controls.find(c => c.id === 'channel_2')?.range.default).toBe(0);
    expect(controls.find(c => c.id === 'channel_3')?.range.default).toBe(0);
    expect(controls.find(c => c.id === 'channel_4')?.range.default).toBe(0);
    expect(controls.find(c => c.id === 'modulation')?.range.default).toBe(0.5);
  });

  it('frame has percent display mapping', () => {
    const frame = framesInstrument.engines[0].controls.find(c => c.id === 'frame');
    expect(frame?.displayMapping?.type).toBe('percent');
    expect(frame?.displayMapping?.unit).toBe('%');
  });

  it('modulation has linear display mapping with bipolar range', () => {
    const mod = framesInstrument.engines[0].controls.find(c => c.id === 'modulation');
    expect(mod?.displayMapping?.type).toBe('linear');
    expect(mod?.displayMapping?.min).toBe(-100);
    expect(mod?.displayMapping?.max).toBe(100);
  });

  it('all semantic roles are from the SemanticRole union', () => {
    for (const engine of framesInstrument.engines) {
      for (const control of engine.controls) {
        if (control.semanticRole !== null) {
          expect(VALID_SEMANTIC_ROLES).toContain(control.semanticRole);
        }
      }
    }
  });

  it('all control bindings reference frames adapter', () => {
    for (const engine of framesInstrument.engines) {
      for (const control of engine.controls) {
        expect(control.binding.adapterId).toBe('frames');
        expect(control.binding.path).toBe(`params.${control.id}`);
      }
    }
  });

  it('no duplicate engine IDs', () => {
    const ids = framesInstrument.engines.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('frame is large, channels are medium, modulation is small', () => {
    const controls = framesInstrument.engines[0].controls;
    expect(controls.find(c => c.id === 'frame')?.size).toBe('large');
    expect(controls.find(c => c.id === 'channel_1')?.size).toBe('medium');
    expect(controls.find(c => c.id === 'channel_2')?.size).toBe('medium');
    expect(controls.find(c => c.id === 'channel_3')?.size).toBe('medium');
    expect(controls.find(c => c.id === 'channel_4')?.size).toBe('medium');
    expect(controls.find(c => c.id === 'modulation')?.size).toBe('small');
  });
});

describe('Frames engine lookup helpers', () => {
  it('getFramesEngineById finds keyframe', () => {
    const engine = getFramesEngineById('keyframe');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('Keyframe');
  });

  it('getFramesEngineById finds sequencer', () => {
    const engine = getFramesEngineById('sequencer');
    expect(engine).toBeDefined();
    expect(engine!.label).toBe('Sequencer');
  });

  it('getFramesEngineById returns undefined for invalid', () => {
    expect(getFramesEngineById('nonexistent')).toBeUndefined();
  });

  it('getFramesEngineByIndex returns correct engine', () => {
    expect(getFramesEngineByIndex(0)!.id).toBe('keyframe');
    expect(getFramesEngineByIndex(1)!.id).toBe('sequencer');
  });

  it('getFramesEngineByIndex returns undefined for out-of-bounds', () => {
    expect(getFramesEngineByIndex(2)).toBeUndefined();
  });

  it('getFramesModelList returns all 2 modes', () => {
    const list = getFramesModelList();
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ index: 0, name: 'Keyframe', description: expect.any(String) });
    expect(list[1]).toEqual({ index: 1, name: 'Sequencer', description: expect.any(String) });
  });
});

describe('Processor registry includes Frames', () => {
  it('getRegisteredProcessorTypes includes frames', () => {
    expect(getRegisteredProcessorTypes()).toContain('frames');
  });

  it('getProcessorInstrument returns Frames', () => {
    const inst = getProcessorInstrument('frames');
    expect(inst).toBeDefined();
    expect(inst!.label).toBe('Frames');
  });

  it('getProcessorControlIds returns Frames controls', () => {
    const ids = getProcessorControlIds('frames');
    expect(ids).toEqual(['frame', 'channel_1', 'channel_2', 'channel_3', 'channel_4', 'modulation']);
  });

  it('getProcessorEngineByName finds Frames modes', () => {
    const result = getProcessorEngineByName('frames', 'sequencer');
    expect(result).toBeDefined();
    expect(result!.index).toBe(1);
  });

  it('getProcessorEngineName returns Frames mode name', () => {
    expect(getProcessorEngineName('frames', 0)).toBe('keyframe');
    expect(getProcessorEngineName('frames', 1)).toBe('sequencer');
  });
});

describe('Chain validation accepts Frames', () => {
  it('Frames is a valid processor type for chain mutation', async () => {
    const { validateChainMutation } = await import('../../src/engine/chain-validation');
    const track = {
      id: 'v0', engine: 'virtual-analog', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON' as const, stepGrid: { steps: [], length: 16 },
      patterns: [], muted: false, solo: false,
    };
    const result = validateChainMutation(track, { kind: 'add', type: 'frames' });
    expect(result.valid).toBe(true);
  });

  it('Frames controls pass processor target validation', async () => {
    const { validateProcessorTarget } = await import('../../src/engine/chain-validation');
    const track = {
      id: 'v0', engine: 'virtual-analog', model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON' as const, stepGrid: { steps: [], length: 16 },
      patterns: [], muted: false, solo: false,
      processors: [{ id: 'frames-1', type: 'frames', model: 0, params: { frame: 0, channel_1: 0, channel_2: 0, channel_3: 0, channel_4: 0, modulation: 0.5 } }],
    };
    expect(validateProcessorTarget(track, 'frames-1', { param: 'frame' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'frames-1', { param: 'channel_1' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'frames-1', { param: 'channel_4' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'frames-1', { param: 'modulation' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'frames-1', { model: 'sequencer' }).valid).toBe(true);
    expect(validateProcessorTarget(track, 'frames-1', { param: 'invalid' }).valid).toBe(false);
  });
});
