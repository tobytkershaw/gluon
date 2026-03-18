import { describe, it, expect } from 'vitest';
import {
  ringsInstrument,
  getRingsEngineById,
  getRingsEngineByIndex,
  getRingsModelList,
} from '../../src/audio/instrument-registry';
import type { SemanticRole } from '../../src/engine/canonical-types';

const VALID_SEMANTIC_ROLES: SemanticRole[] = [
  'pitch', 'brightness', 'richness', 'texture', 'decay', 'attack',
  'body', 'noise', 'resonance', 'movement_rate', 'mod_depth', 'space',
  'drive', 'stability', 'density', 'level', 'pan',
];

describe('Rings instrument registry', () => {
  it('has exactly 6 engines', () => {
    expect(ringsInstrument.engines).toHaveLength(6);
  });

  it('is typed as effect', () => {
    expect(ringsInstrument.type).toBe('effect');
  });

  it('has adapterId rings', () => {
    expect(ringsInstrument.adapterId).toBe('rings');
  });

  it('every engine has 7 controls: structure, brightness, damping, position, polyphony, internal-exciter, fine-tune', () => {
    const expected = ['structure', 'brightness', 'damping', 'position', 'fine-tune', 'internal-exciter', 'polyphony'];
    for (const engine of ringsInstrument.engines) {
      const controlIds = engine.controls.map(c => c.id);
      expect(controlIds, `engine ${engine.id}`).toEqual(expected);
    }
  });

  it('all control bindings reference rings adapter', () => {
    for (const engine of ringsInstrument.engines) {
      for (const control of engine.controls) {
        expect(control.binding.adapterId).toBe('rings');
        // All bindings use params.{id} pattern
        expect(control.binding.path).toBe(`params.${control.id}`);
      }
    }
  });

  it('polyphony is discrete with range 1-4', () => {
    const engine = ringsInstrument.engines[0];
    const poly = engine.controls.find(c => c.id === 'polyphony');
    expect(poly?.kind).toBe('discrete');
    expect(poly?.range?.min).toBe(1);
    expect(poly?.range?.max).toBe(4);
    expect(poly?.size).toBe('small');
  });

  it('internal-exciter is boolean', () => {
    const engine = ringsInstrument.engines[0];
    const exciter = engine.controls.find(c => c.id === 'internal-exciter');
    expect(exciter?.kind).toBe('boolean');
    expect(exciter?.size).toBe('small');
  });

  it('all semantic roles are from the SemanticRole union', () => {
    for (const engine of ringsInstrument.engines) {
      for (const control of engine.controls) {
        if (control.semanticRole !== null) {
          expect(VALID_SEMANTIC_ROLES).toContain(control.semanticRole);
        }
      }
    }
  });

  it('no duplicate engine IDs', () => {
    const ids = ringsInstrument.engines.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('damping has non-standard default of 0.7', () => {
    const engine = ringsInstrument.engines[0];
    const damping = engine.controls.find(c => c.id === 'damping');
    expect(damping?.range.default).toBe(0.7);
  });

  it('getRingsEngineById finds engines by string ID', () => {
    expect(getRingsEngineById('modal')?.label).toBe('Modal Resonator');
    expect(getRingsEngineById('string')?.label).toBe('Modulated/Inharmonic String');
    expect(getRingsEngineById('nonexistent')).toBeUndefined();
  });

  it('first 3 modes match official MI Rings resonator types', () => {
    const list = getRingsModelList();
    expect(list[0].name).toBe('Modal Resonator');
    expect(list[1].name).toBe('Sympathetic Strings');
    expect(list[2].name).toBe('Modulated/Inharmonic String');
  });

  it('Gluon extension modes are clearly labeled', () => {
    const list = getRingsModelList();
    // Modes 3-5 are Gluon extensions
    for (let i = 3; i < list.length; i++) {
      expect(list[i].name).toContain('Gluon');
    }
  });

  it('getRingsEngineByIndex returns correct engine for each index 0-5', () => {
    for (let i = 0; i < 6; i++) {
      const engine = getRingsEngineByIndex(i);
      expect(engine).toBeDefined();
      expect(engine!.id).toBe(ringsInstrument.engines[i].id);
    }
    expect(getRingsEngineByIndex(6)).toBeUndefined();
  });

  it('getRingsModelList returns 6 entries matching engine order', () => {
    const list = getRingsModelList();
    expect(list).toHaveLength(6);
    expect(list[0].name).toBe('Modal Resonator');
    expect(list[5].name).toContain('String + Reverb');
  });
});
