import { describe, it, expect } from 'vitest';
import {
  stereoInstrument,
  getStereoEngineById,
  getStereoEngineByIndex,
  getStereoModelList,
} from '../../src/audio/instrument-registry';
import type { SemanticRole } from '../../src/engine/canonical-types';

const VALID_SEMANTIC_ROLES: SemanticRole[] = [
  'pitch', 'brightness', 'richness', 'texture', 'decay', 'attack',
  'body', 'noise', 'resonance', 'movement_rate', 'mod_depth', 'space',
  'drive', 'stability', 'density', 'level', 'pan',
];

describe('Stereo instrument registry', () => {
  it('has exactly 2 engines', () => {
    expect(stereoInstrument.engines).toHaveLength(2);
  });

  it('is typed as effect', () => {
    expect(stereoInstrument.type).toBe('effect');
  });

  it('has adapterId stereo', () => {
    expect(stereoInstrument.adapterId).toBe('stereo');
  });

  it('every engine has 4 controls: width, mid_gain, side_gain, delay', () => {
    const expected = ['width', 'mid_gain', 'side_gain', 'delay'];
    for (const engine of stereoInstrument.engines) {
      const controlIds = engine.controls.map(c => c.id);
      expect(controlIds, `engine ${engine.id}`).toEqual(expected);
    }
  });

  it('all control bindings reference stereo adapter', () => {
    for (const engine of stereoInstrument.engines) {
      for (const control of engine.controls) {
        expect(control.binding.adapterId).toBe('stereo');
        expect(control.binding.path).toBe(`params.${control.id}`);
      }
    }
  });

  it('all semantic roles are from the SemanticRole union', () => {
    for (const engine of stereoInstrument.engines) {
      for (const control of engine.controls) {
        if (control.semanticRole !== null) {
          expect(VALID_SEMANTIC_ROLES).toContain(control.semanticRole);
        }
      }
    }
  });

  it('no duplicate engine IDs', () => {
    const ids = stereoInstrument.engines.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('width default is 0.5 (original stereo)', () => {
    const engine = stereoInstrument.engines[0];
    const width = engine.controls.find(c => c.id === 'width');
    expect(width?.range.default).toBe(0.5);
  });

  it('delay default is 0.0 (off)', () => {
    const engine = stereoInstrument.engines[0];
    const delay = engine.controls.find(c => c.id === 'delay');
    expect(delay?.range.default).toBe(0.0);
  });

  it('getStereoEngineById finds engines by string ID', () => {
    expect(getStereoEngineById('width')?.label).toBe('Width');
    expect(getStereoEngineById('pan_law')?.label).toBe('Pan Law');
    expect(getStereoEngineById('nonexistent')).toBeUndefined();
  });

  it('getStereoEngineByIndex returns correct engine for each index 0-1', () => {
    for (let i = 0; i < 2; i++) {
      const engine = getStereoEngineByIndex(i);
      expect(engine).toBeDefined();
      expect(engine!.id).toBe(stereoInstrument.engines[i].id);
    }
    expect(getStereoEngineByIndex(2)).toBeUndefined();
  });

  it('getStereoModelList returns 2 entries matching engine order', () => {
    const list = getStereoModelList();
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      index: 0,
      name: 'Width',
      description: 'M/S processing with Haas effect — stereo width and spatial control',
    });
    expect(list[1]).toEqual({
      index: 1,
      name: 'Pan Law',
      description: 'Frequency-dependent panning — maintains mono bass compatibility',
    });
  });
});
