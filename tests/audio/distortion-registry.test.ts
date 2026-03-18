import { describe, it, expect } from 'vitest';
import {
  distortionInstrument,
  getDistortionEngineById,
  getDistortionEngineByIndex,
  getDistortionModelList,
} from '../../src/audio/instrument-registry';
import type { SemanticRole } from '../../src/engine/canonical-types';

const VALID_SEMANTIC_ROLES: SemanticRole[] = [
  'pitch', 'brightness', 'richness', 'texture', 'decay', 'attack',
  'body', 'noise', 'resonance', 'movement_rate', 'mod_depth', 'space',
  'drive', 'stability', 'density', 'level', 'pan',
];

describe('Distortion instrument registry', () => {
  it('has exactly 4 engines', () => {
    expect(distortionInstrument.engines).toHaveLength(4);
  });

  it('is typed as effect', () => {
    expect(distortionInstrument.type).toBe('effect');
  });

  it('has adapterId distortion', () => {
    expect(distortionInstrument.adapterId).toBe('distortion');
  });

  it('every engine has 5 controls: drive, tone, mix, bits, downsample', () => {
    const expected = ['drive', 'tone', 'mix', 'bits', 'downsample'];
    for (const engine of distortionInstrument.engines) {
      const controlIds = engine.controls.map(c => c.id);
      expect(controlIds, `engine ${engine.id}`).toEqual(expected);
    }
  });

  it('all control bindings reference distortion adapter', () => {
    for (const engine of distortionInstrument.engines) {
      for (const control of engine.controls) {
        expect(control.binding.adapterId).toBe('distortion');
        expect(control.binding.path).toBe(`params.${control.id}`);
      }
    }
  });

  it('all semantic roles are from the SemanticRole union', () => {
    for (const engine of distortionInstrument.engines) {
      for (const control of engine.controls) {
        if (control.semanticRole !== null) {
          expect(VALID_SEMANTIC_ROLES).toContain(control.semanticRole);
        }
      }
    }
  });

  it('no duplicate engine IDs', () => {
    const ids = distortionInstrument.engines.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('drive has default of 0.5', () => {
    const engine = distortionInstrument.engines[0];
    const drive = engine.controls.find(c => c.id === 'drive');
    expect(drive?.range.default).toBe(0.5);
  });

  it('tone has default of 0.7', () => {
    const engine = distortionInstrument.engines[0];
    const tone = engine.controls.find(c => c.id === 'tone');
    expect(tone?.range.default).toBe(0.7);
  });

  it('mix has default of 1.0', () => {
    const engine = distortionInstrument.engines[0];
    const mix = engine.controls.find(c => c.id === 'mix');
    expect(mix?.range.default).toBe(1.0);
  });

  it('getDistortionEngineById finds engines by string ID', () => {
    expect(getDistortionEngineById('tape')?.label).toBe('Tape');
    expect(getDistortionEngineById('overdrive')?.label).toBe('Overdrive');
    expect(getDistortionEngineById('fuzz')?.label).toBe('Fuzz');
    expect(getDistortionEngineById('bitcrush')?.label).toBe('Bitcrush');
    expect(getDistortionEngineById('nonexistent')).toBeUndefined();
  });

  it('getDistortionEngineByIndex returns correct engine for each index 0-3', () => {
    for (let i = 0; i < 4; i++) {
      const engine = getDistortionEngineByIndex(i);
      expect(engine).toBeDefined();
      expect(engine!.id).toBe(distortionInstrument.engines[i].id);
    }
    expect(getDistortionEngineByIndex(4)).toBeUndefined();
  });

  it('getDistortionModelList returns 4 entries matching engine order', () => {
    const list = getDistortionModelList();
    expect(list).toHaveLength(4);
    expect(list[0]).toEqual({
      index: 0,
      name: 'Tape',
      description: 'Warm asymmetric saturation — subtle tape character',
    });
    expect(list[3]).toEqual({
      index: 3,
      name: 'Bitcrush',
      description: 'Digital destruction — bit depth and sample rate reduction',
    });
  });
});
