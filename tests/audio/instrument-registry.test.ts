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
const VALID_BINDINGS = [
  'params.timbre', 'params.harmonics', 'params.morph', 'params.note',
  'params.fm_amount', 'params.timbre_mod_amount', 'params.morph_mod_amount',
  'params.decay', 'params.lpg_colour',
  'track.portamentoTime', 'track.portamentoMode',
];

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
    expect(schemas).toHaveLength(11);
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
    expect(list[0].name).toBe('Virtual Analog');
    expect(list[15].name).toBe('Analog Hi-Hat');
    // All entries have index, name, description
    for (const entry of list) {
      expect(entry.index).toBeGreaterThanOrEqual(0);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it('PLAITS_MODELS is derived from registry and matches shape', () => {
    expect(PLAITS_MODELS).toHaveLength(16);
    expect(PLAITS_MODELS[0].name).toBe('Virtual Analog');
    expect(PLAITS_MODELS[15].name).toBe('Analog Hi-Hat');
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

  describe('per-engine default parameter overrides', () => {
    function getDefault(engineIndex: number, controlId: string): number | undefined {
      const engine = getEngineByIndex(engineIndex);
      const control = engine?.controls.find(c => c.id === controlId);
      return control?.range?.default;
    }

    it('analog-bass-drum (13) has percussion-appropriate defaults', () => {
      expect(getDefault(13, 'frequency')).toBeCloseTo(0.25);
      expect(getDefault(13, 'harmonics')).toBeCloseTo(0.12);
      expect(getDefault(13, 'timbre')).toBeCloseTo(0.2);
      expect(getDefault(13, 'morph')).toBeCloseTo(0.4);
    });

    it('analog-snare (14) has snare-appropriate defaults', () => {
      expect(getDefault(14, 'frequency')).toBeCloseTo(0.38);
      expect(getDefault(14, 'harmonics')).toBeCloseTo(0.4);
      expect(getDefault(14, 'timbre')).toBeCloseTo(0.35);
      expect(getDefault(14, 'morph')).toBeCloseTo(0.3);
    });

    it('analog-hi-hat (15) has hi-hat-appropriate defaults', () => {
      expect(getDefault(15, 'frequency')).toBeCloseTo(0.65);
      expect(getDefault(15, 'harmonics')).toBeCloseTo(0.4);
      expect(getDefault(15, 'timbre')).toBeCloseTo(0.5);
      expect(getDefault(15, 'morph')).toBeCloseTo(0.15);
    });

    it('virtual-analog (0) retains standard 0.5 defaults', () => {
      expect(getDefault(0, 'frequency')).toBe(0.5);
      expect(getDefault(0, 'harmonics')).toBe(0.5);
      expect(getDefault(0, 'timbre')).toBe(0.5);
      expect(getDefault(0, 'morph')).toBe(0.5);
    });

    it('fm (2) has warmer timbre default', () => {
      expect(getDefault(2, 'timbre')).toBeCloseTo(0.3);
      // other params remain at 0.5
      expect(getDefault(2, 'frequency')).toBe(0.5);
      expect(getDefault(2, 'harmonics')).toBe(0.5);
      expect(getDefault(2, 'morph')).toBe(0.5);
    });

    it('chords (6) has minor triad and warm morph defaults', () => {
      expect(getDefault(6, 'harmonics')).toBeCloseTo(0.25);
      expect(getDefault(6, 'morph')).toBeCloseTo(0.2);
      // frequency and timbre remain at 0.5
      expect(getDefault(6, 'frequency')).toBe(0.5);
      expect(getDefault(6, 'timbre')).toBe(0.5);
    });

    it('non-overridden params keep standard defaults (decay=0.5, mod amounts=0.0)', () => {
      // Percussion engines should still have standard decay/mod defaults
      expect(getDefault(13, 'decay')).toBe(0.5);
      expect(getDefault(13, 'timbre-mod-amount')).toBe(0.0);
      expect(getDefault(13, 'fm-amount')).toBe(0.0);
    });
  });
});
