// tests/audio/port-registry.test.ts
import { describe, it, expect } from 'vitest';
import {
  getModulePortDef,
  getModuleOutputs,
  getModuleInputs,
  getSourceModTargets,
  getRegisteredPortAdapterIds,
} from '../../src/audio/port-registry';
import type { PortDef } from '../../src/audio/port-registry';

describe('port-registry', () => {
  describe('getRegisteredPortAdapterIds', () => {
    it('returns all four MI module types', () => {
      const ids = getRegisteredPortAdapterIds();
      expect(ids).toContain('plaits');
      expect(ids).toContain('rings');
      expect(ids).toContain('clouds');
      expect(ids).toContain('tides');
      expect(ids).toHaveLength(4);
    });
  });

  describe('Plaits ports', () => {
    it('has 8 inputs and 2 outputs', () => {
      const def = getModulePortDef('plaits');
      expect(def).toBeDefined();
      expect(def!.inputs).toHaveLength(8);
      expect(def!.outputs).toHaveLength(2);
    });

    it('outputs are OUT and AUX', () => {
      const outputs = getModuleOutputs('plaits');
      expect(outputs.map(p => p.id)).toEqual(['out', 'aux']);
      expect(outputs.every(p => p.signal === 'audio')).toBe(true);
    });

    it('includes V/OCT, TRIGGER, and CV inputs', () => {
      const inputs = getModuleInputs('plaits');
      const ids = inputs.map(p => p.id);
      expect(ids).toContain('v-oct');
      expect(ids).toContain('trigger');
      expect(ids).toContain('timbre-cv');
      expect(ids).toContain('harmonics-cv');
      expect(ids).toContain('morph-cv');
    });

    it('classifies signal types correctly', () => {
      const inputs = getModuleInputs('plaits');
      const byId = new Map<string, PortDef>(inputs.map(p => [p.id, p]));
      expect(byId.get('v-oct')!.signal).toBe('cv');
      expect(byId.get('trigger')!.signal).toBe('gate');
      expect(byId.get('timbre-cv')!.signal).toBe('cv');
    });
  });

  describe('Rings ports', () => {
    it('has 8 inputs and 2 outputs (ODD + EVEN)', () => {
      const def = getModulePortDef('rings');
      expect(def).toBeDefined();
      expect(def!.inputs).toHaveLength(8);
      expect(def!.outputs).toHaveLength(2);
    });

    it('outputs are ODD and EVEN', () => {
      const outputs = getModuleOutputs('rings');
      expect(outputs.map(p => p.id)).toEqual(['odd', 'even']);
      expect(outputs.every(p => p.signal === 'audio')).toBe(true);
    });

    it('has audio input', () => {
      const inputs = getModuleInputs('rings');
      const audioIn = inputs.find(p => p.id === 'audio-in');
      expect(audioIn).toBeDefined();
      expect(audioIn!.signal).toBe('audio');
    });
  });

  describe('Clouds ports', () => {
    it('has 9 inputs and 1 output', () => {
      const def = getModulePortDef('clouds');
      expect(def).toBeDefined();
      expect(def!.inputs).toHaveLength(9);
      expect(def!.outputs).toHaveLength(1);
    });

    it('output is stereo audio out', () => {
      const outputs = getModuleOutputs('clouds');
      expect(outputs).toHaveLength(1);
      expect(outputs[0].signal).toBe('audio');
    });

    it('has freeze gate input', () => {
      const inputs = getModuleInputs('clouds');
      const freeze = inputs.find(p => p.id === 'freeze');
      expect(freeze).toBeDefined();
      expect(freeze!.signal).toBe('gate');
    });
  });

  describe('Tides ports', () => {
    it('has 7 inputs and 4 outputs', () => {
      const def = getModulePortDef('tides');
      expect(def).toBeDefined();
      expect(def!.inputs).toHaveLength(7);
      expect(def!.outputs).toHaveLength(4);
    });

    it('outputs are 4 waveshape outputs (CV type)', () => {
      const outputs = getModuleOutputs('tides');
      expect(outputs).toHaveLength(4);
      expect(outputs.every(p => p.signal === 'cv')).toBe(true);
      expect(outputs.map(p => p.id)).toEqual(['out-1', 'out-2', 'out-3', 'out-4']);
    });

    it('has trigger/gate input', () => {
      const inputs = getModuleInputs('tides');
      const trig = inputs.find(p => p.id === 'trig-gate');
      expect(trig).toBeDefined();
      expect(trig!.signal).toBe('gate');
    });
  });

  describe('getSourceModTargets', () => {
    it('returns timbre, harmonics, morph, frequency', () => {
      const targets = getSourceModTargets();
      expect(targets).toEqual(['timbre', 'harmonics', 'morph', 'frequency']);
    });
  });

  describe('unknown module type', () => {
    it('returns undefined for unregistered adapter', () => {
      expect(getModulePortDef('unknown')).toBeUndefined();
      expect(getModuleOutputs('unknown')).toEqual([]);
      expect(getModuleInputs('unknown')).toEqual([]);
    });
  });

  describe('port name uniqueness', () => {
    it('all port IDs are unique within each module', () => {
      for (const adapterId of getRegisteredPortAdapterIds()) {
        const def = getModulePortDef(adapterId)!;
        const allIds = [...def.inputs.map(p => p.id), ...def.outputs.map(p => p.id)];
        const uniqueIds = new Set(allIds);
        expect(uniqueIds.size).toBe(allIds.length);
      }
    });
  });
});
