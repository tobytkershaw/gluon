import { describe, expect, it } from 'vitest';
import {
  controlIdToRuntimeParam,
  getModulatorControlIds,
  getModulatorDefaultParams,
  getModulatorEngineByName,
  getModulatorEngineName,
  getModulatorInstrument,
  getProcessorControlIds,
  getProcessorControlSchema,
  getProcessorDefaultParams,
  getProcessorEngineByName,
  getProcessorEngineName,
  getProcessorInstrument,
  getRegisteredModulatorTypes,
  getRegisteredProcessorTypes,
  plaitsInstrument,
  runtimeParamToControlId,
} from '../../src/audio/instrument-registry';

const EXPECTED_PROCESSOR_TYPES = [
  'beads',
  'chorus',
  'clouds',
  'compressor',
  'distortion',
  'elements',
  'eq',
  'frames',
  'ripples',
  'rings',
  'stereo',
  'warps',
];

const EXPECTED_MODULATOR_TYPES = [
  'marbles',
  'tides',
];

function expectedDefaultsForEngine(type: 'processor' | 'modulator', instrumentType: string, modelIndex: number) {
  const instrument = type === 'processor'
    ? getProcessorInstrument(instrumentType)
    : getModulatorInstrument(instrumentType);
  const engine = instrument?.engines[modelIndex];
  return Object.fromEntries(
    (engine?.controls ?? []).map(control => [control.id, control.range?.default ?? 0.5]),
  );
}

describe('instrument registry mapping contracts', () => {
  it('registers the expected processor types', () => {
    expect(getRegisteredProcessorTypes().sort()).toEqual([...EXPECTED_PROCESSOR_TYPES].sort());
  });

  it('registers the expected modulator types', () => {
    expect(getRegisteredModulatorTypes().sort()).toEqual([...EXPECTED_MODULATOR_TYPES].sort());
  });

  describe.each(EXPECTED_PROCESSOR_TYPES)('%s processor registry', (type) => {
    it('keeps control IDs and bindings consistent across all engines', () => {
      const instrument = getProcessorInstrument(type);
      expect(instrument, `${type} should be registered`).toBeDefined();
      expect(instrument?.adapterId).toBe(type);

      const referenceControlIds = instrument!.engines[0].controls.map(control => control.id);
      expect(getProcessorControlIds(type)).toEqual(referenceControlIds);

      for (const engine of instrument!.engines) {
        expect(engine.controls.map(control => control.id), `${type}.${engine.id} control order drifted`).toEqual(referenceControlIds);

        for (const control of engine.controls) {
          expect(control.binding.adapterId).toBe(type);
          expect(control.binding.path).toBe(`params.${control.id}`);
        }
      }
    });

    it('round-trips engine name/index lookups and exposes first-engine schemas', () => {
      const instrument = getProcessorInstrument(type)!;

      instrument.engines.forEach((engine, index) => {
        expect(getProcessorEngineByName(type, engine.id)).toEqual({ index, engine });
        expect(getProcessorEngineName(type, index)).toBe(engine.id);
      });

      for (const control of instrument.engines[0].controls) {
        expect(getProcessorControlSchema(type, control.id)).toEqual(control);
      }

      expect(getProcessorEngineByName(type, 'missing-engine')).toBeUndefined();
      expect(getProcessorEngineName(type, instrument.engines.length)).toBeUndefined();
      expect(getProcessorControlSchema(type, 'missing-control')).toBeUndefined();
    });

    it('returns default params that match each engine schema', () => {
      const instrument = getProcessorInstrument(type)!;

      instrument.engines.forEach((_engine, index) => {
        expect(getProcessorDefaultParams(type, index)).toEqual(
          expectedDefaultsForEngine('processor', type, index),
        );
      });

      expect(getProcessorDefaultParams(type, instrument.engines.length)).toEqual({});
    });
  });

  describe.each(EXPECTED_MODULATOR_TYPES)('%s modulator registry', (type) => {
    it('keeps control IDs and bindings consistent across all engines', () => {
      const instrument = getModulatorInstrument(type);
      expect(instrument, `${type} should be registered`).toBeDefined();
      expect(instrument?.adapterId).toBe(type);

      const referenceControlIds = instrument!.engines[0].controls.map(control => control.id);
      expect(getModulatorControlIds(type)).toEqual(referenceControlIds);

      for (const engine of instrument!.engines) {
        expect(engine.controls.map(control => control.id), `${type}.${engine.id} control order drifted`).toEqual(referenceControlIds);

        for (const control of engine.controls) {
          expect(control.binding.adapterId).toBe(type);
          expect(control.binding.path).toBe(`params.${control.id}`);
        }
      }
    });

    it('round-trips engine name/index lookups and default params', () => {
      const instrument = getModulatorInstrument(type)!;

      instrument.engines.forEach((engine, index) => {
        expect(getModulatorEngineByName(type, engine.id)).toEqual({ index, engine });
        expect(getModulatorEngineName(type, index)).toBe(engine.id);
        expect(getModulatorDefaultParams(type, index)).toEqual(
          expectedDefaultsForEngine('modulator', type, index),
        );
      });

      expect(getModulatorEngineByName(type, 'missing-engine')).toBeUndefined();
      expect(getModulatorEngineName(type, instrument.engines.length)).toBeUndefined();
      expect(getModulatorDefaultParams(type, instrument.engines.length)).toEqual({});
    });
  });

  it('keeps Plaits control bindings aligned with runtime param mappings', () => {
    for (const engine of plaitsInstrument.engines) {
      for (const control of engine.controls) {
        if (!control.binding.path.startsWith('params.')) continue;

        const runtimeParam = control.binding.path.slice('params.'.length);
        const mappedRuntimeParam = controlIdToRuntimeParam[control.id] ?? control.id;
        const mappedControlId = runtimeParamToControlId[runtimeParam] ?? runtimeParam;

        expect(runtimeParam, `${engine.id}.${control.id} runtime param drifted`).toBe(mappedRuntimeParam);
        expect(mappedControlId, `${engine.id}.${control.id} reverse mapping drifted`).toBe(control.id);
      }
    }
  });
});
