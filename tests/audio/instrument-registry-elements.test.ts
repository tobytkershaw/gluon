import { describe, it, expect } from 'vitest';
import {
  elementsInstrument,
  getElementsEngineById,
  getElementsEngineByIndex,
  getElementsModelList,
} from '../../src/audio/instrument-registry-elements';

describe('instrument-registry-elements', () => {
  it('has 2 engines (modal, string)', () => {
    expect(elementsInstrument.engines).toHaveLength(2);
    expect(elementsInstrument.engines[0].id).toBe('modal');
    expect(elementsInstrument.engines[1].id).toBe('string');
  });

  it('each engine has 13 controls', () => {
    for (const engine of elementsInstrument.engines) {
      expect(engine.controls).toHaveLength(13);
    }
  });

  it('control IDs match expected Elements parameters', () => {
    const ids = elementsInstrument.engines[0].controls.map(c => c.id);
    expect(ids).toEqual([
      'bow_level', 'bow_timbre',
      'blow_level', 'blow_timbre',
      'strike_level', 'strike_timbre',
      'coarse', 'fine',
      'geometry', 'brightness',
      'damping', 'position',
      'space',
    ]);
  });

  it('getElementsEngineById returns correct engines', () => {
    expect(getElementsEngineById('modal')?.label).toBe('Modal Resonator');
    expect(getElementsEngineById('string')?.label).toBe('String Resonator');
    expect(getElementsEngineById('nonexistent')).toBeUndefined();
  });

  it('getElementsEngineByIndex returns correct engines', () => {
    expect(getElementsEngineByIndex(0)?.id).toBe('modal');
    expect(getElementsEngineByIndex(1)?.id).toBe('string');
    expect(getElementsEngineByIndex(2)).toBeUndefined();
  });

  it('getElementsModelList returns index, name, description for each engine', () => {
    const list = getElementsModelList();
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      index: 0,
      name: 'Modal Resonator',
      description: 'Modal resonator bank — struck, bowed, and blown metallic and wooden tones',
    });
    expect(list[1]).toEqual({
      index: 1,
      name: 'String Resonator',
      description: 'String resonator — sympathetic resonance, plucked and bowed behavior',
    });
  });

  it('instrument definition has correct metadata', () => {
    expect(elementsInstrument.type).toBe('effect');
    expect(elementsInstrument.label).toBe('Mutable Instruments Elements');
    expect(elementsInstrument.adapterId).toBe('elements');
  });

  it('all controls are readable and writable', () => {
    for (const engine of elementsInstrument.engines) {
      for (const control of engine.controls) {
        expect(control.readable).toBe(true);
        expect(control.writable).toBe(true);
      }
    }
  });

  it('all controls have range 0-1', () => {
    for (const engine of elementsInstrument.engines) {
      for (const control of engine.controls) {
        expect(control.range?.min).toBe(0);
        expect(control.range?.max).toBe(1);
      }
    }
  });
});
