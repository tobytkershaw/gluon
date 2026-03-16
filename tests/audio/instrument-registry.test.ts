import { describe, it, expect } from 'vitest';
import {
  plaitsInstrument,
  getEngineById,
  getEngineByIndex,
  getModelName,
  getEngineControlSchemas,
  getControlBinding,
  controlIdToRuntimeParam,
  runtimeParamToControlId,
  getModelList,
  isPercussion,
  isPercussionByIndex,
} from '../../src/audio/instrument-registry';
import { PLAITS_MODELS } from '../../src/audio/synth-interface';
import type { SemanticRole } from '../../src/engine/canonical-types';

const VALID_SEMANTIC_ROLES: SemanticRole[] = [
  'pitch', 'brightness', 'richness', 'texture', 'decay', 'attack',
  'body', 'noise', 'resonance', 'movement_rate', 'mod_depth', 'space',
  'drive', 'stability', 'density', 'level', 'pan',
];

const REQUIRED_CONTROLS = ['timbre', 'harmonics', 'morph', 'frequency'];
const VALID_BINDINGS = ['params.timbre', 'params.harmonics', 'params.morph', 'params.note'];

describe('Plaits instrument registry', () => {
  it('has exactly 16 engines', () => {
    expect(plaitsInstrument.engines).toHaveLength(16);
  });

  it('every engine has all 4 required controls', () => {
    for (const engine of plaitsInstrument.engines) {
      const controlIds = engine.controls.map(c => c.id);
      for (const required of REQUIRED_CONTROLS) {
        expect(controlIds, `engine ${engine.id} missing ${required}`).toContain(required);
      }
    }
  });

  it('all control bindings reference valid Plaits param paths', () => {
    for (const engine of plaitsInstrument.engines) {
      for (const control of engine.controls) {
        expect(VALID_BINDINGS, `${engine.id}.${control.id} has invalid binding ${control.binding.path}`)
          .toContain(control.binding.path);
      }
    }
  });

  it('all semantic roles are from the SemanticRole union', () => {
    for (const engine of plaitsInstrument.engines) {
      for (const control of engine.controls) {
        if (control.semanticRole !== null) {
          expect(VALID_SEMANTIC_ROLES).toContain(control.semanticRole);
        }
      }
    }
  });

  it('no duplicate engine IDs', () => {
    const ids = plaitsInstrument.engines.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('controlIdToRuntimeParam is bijective with runtimeParamToControlId', () => {
    for (const [controlId, runtimeParam] of Object.entries(controlIdToRuntimeParam)) {
      expect(runtimeParamToControlId[runtimeParam]).toBe(controlId);
    }
    for (const [runtimeParam, controlId] of Object.entries(runtimeParamToControlId)) {
      expect(controlIdToRuntimeParam[controlId]).toBe(runtimeParam);
    }
    expect(Object.keys(controlIdToRuntimeParam).length)
      .toBe(Object.keys(runtimeParamToControlId).length);
  });

  it('getEngineByIndex returns correct engine for each index 0-15', () => {
    for (let i = 0; i < 16; i++) {
      const engine = getEngineByIndex(i);
      expect(engine).toBeDefined();
      expect(engine!.id).toBe(plaitsInstrument.engines[i].id);
    }
    expect(getEngineByIndex(16)).toBeUndefined();
  });

  it('getModelName returns non-empty string for each index 0-15', () => {
    for (let i = 0; i < 16; i++) {
      const name = getModelName(i);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('getEngineById finds engines by string ID', () => {
    expect(getEngineById('fm')?.label).toBe('FM');
    expect(getEngineById('nonexistent')).toBeUndefined();
  });

  it('getEngineControlSchemas returns controls for valid engine', () => {
    const schemas = getEngineControlSchemas('virtual-analog');
    expect(schemas).toHaveLength(4);
  });

  it('getControlBinding returns binding for valid engine+control', () => {
    const binding = getControlBinding('fm', 'timbre');
    expect(binding).toBeDefined();
    expect(binding!.path).toBe('params.timbre');
    expect(getControlBinding('fm', 'nonexistent')).toBeUndefined();
    expect(getControlBinding('nonexistent', 'timbre')).toBeUndefined();
  });

  it('getModelList returns 16 entries matching engine order', () => {
    const list = getModelList();
    expect(list).toHaveLength(16);
    expect(list[0]).toEqual({ index: 0, name: 'Virtual Analog', description: 'VA oscillator with variable waveshape' });
    expect(list[15]).toEqual({ index: 15, name: 'Analog Hi-Hat', description: 'Analog hi-hat' });
  });

  it('PLAITS_MODELS is derived from registry and matches shape', () => {
    expect(PLAITS_MODELS).toHaveLength(16);
    expect(PLAITS_MODELS[0]).toEqual({ index: 0, name: 'Virtual Analog', description: 'VA oscillator with variable waveshape' });
    expect(PLAITS_MODELS[15]).toEqual({ index: 15, name: 'Analog Hi-Hat', description: 'Analog hi-hat' });
    // Verify shape matches getModelList
    const registryList = getModelList();
    expect(PLAITS_MODELS).toEqual(registryList);
  });

  it('isPercussion returns true only for drum engines (indices 13-15)', () => {
    expect(isPercussion('analog-bass-drum')).toBe(true);
    expect(isPercussion('analog-snare')).toBe(true);
    expect(isPercussion('analog-hi-hat')).toBe(true);
    expect(isPercussion('virtual-analog')).toBe(false);
    expect(isPercussion('fm')).toBe(false);
    expect(isPercussion('nonexistent')).toBe(false);
  });

  it('isPercussionByIndex returns true only for indices 13-15', () => {
    for (let i = 0; i < 13; i++) {
      expect(isPercussionByIndex(i), `index ${i} should not be percussion`).toBe(false);
    }
    expect(isPercussionByIndex(13)).toBe(true);
    expect(isPercussionByIndex(14)).toBe(true);
    expect(isPercussionByIndex(15)).toBe(true);
    expect(isPercussionByIndex(16)).toBe(false);
  });
});
