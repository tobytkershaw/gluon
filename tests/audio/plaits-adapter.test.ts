import { describe, it, expect } from 'vitest';
import { createPlaitsAdapter } from '../../src/audio/plaits-adapter';
import { controlIdToRuntimeParam, runtimeParamToControlId } from '../../src/audio/instrument-registry';

describe('plaits-adapter', () => {
  const adapter = createPlaitsAdapter();

  it('maps timbre controlId to params.timbre', () => {
    const binding = adapter.mapControl('timbre');
    expect(binding.path).toBe('params.timbre');
  });

  it('maps harmonics controlId to params.harmonics', () => {
    const binding = adapter.mapControl('harmonics');
    expect(binding.path).toBe('params.harmonics');
  });

  it('maps morph controlId to params.morph', () => {
    const binding = adapter.mapControl('morph');
    expect(binding.path).toBe('params.morph');
  });

  it('maps frequency controlId to params.note', () => {
    const binding = adapter.mapControl('frequency');
    expect(binding.path).toBe('params.note');
  });

  it('maps runtime param note back to frequency', () => {
    expect(adapter.mapRuntimeParamKey('note')).toBe('frequency');
  });

  it('maps identity runtime params back to themselves', () => {
    expect(adapter.mapRuntimeParamKey('timbre')).toBe('timbre');
    expect(adapter.mapRuntimeParamKey('harmonics')).toBe('harmonics');
    expect(adapter.mapRuntimeParamKey('morph')).toBe('morph');
  });

  it('returns null for unknown runtime param', () => {
    expect(adapter.mapRuntimeParamKey('foo')).toBeNull();
  });

  it('converts MIDI 60 to normalised ~0.47', () => {
    const normalised = adapter.midiToNormalisedPitch(60);
    expect(normalised).toBeCloseTo(60 / 127, 2);
  });

  it('converts normalised 0.47 back to MIDI ~60', () => {
    const midi = adapter.normalisedPitchToMidi(60 / 127);
    expect(midi).toBe(60);
  });

  it('pitched round-trip through adapter converters', () => {
    const original = 0.47;
    const midi = adapter.normalisedPitchToMidi(original);
    const roundTripped = adapter.midiToNormalisedPitch(midi);
    expect(roundTripped).toBeCloseTo(original, 1);
  });

  it('validates known canonical controlId', () => {
    const result = adapter.validateOperation({
      type: 'move', trackId: 'v0', controlId: 'timbre',
      target: { absolute: 0.5 },
    });
    expect(result.valid).toBe(true);
  });

  it('validates move with param field (legacy shape)', () => {
    const result = adapter.validateOperation({
      type: 'move', trackId: 'v0', controlId: 'timbre',
      target: { absolute: 0.5 },
      // Simulate what executor passes: raw AIAction with param instead of controlId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing legacy AIAction shape
    } as any);
    expect(result.valid).toBe(true);

    // Also test with runtime param name via param field
    const result2 = adapter.validateOperation({
      type: 'move', trackId: 'v0', param: 'timbre',
      target: { absolute: 0.5 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing legacy AIAction shape
    } as any);
    expect(result2.valid).toBe(true);
  });

  it('rejects unknown controlId', () => {
    const result = adapter.validateOperation({
      type: 'move', trackId: 'v0', controlId: 'unknown_param',
      target: { absolute: 0.5 },
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Unknown control');
  });

  it('rejects out-of-range absolute values', () => {
    const result = adapter.validateOperation({
      type: 'move', trackId: 'v0', controlId: 'timbre',
      target: { absolute: 1.5 },
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('out of range');
  });

  it('passes through non-move operations', () => {
    const result = adapter.validateOperation({
      type: 'say', text: 'hello',
    });
    expect(result.valid).toBe(true);
  });

  // --- Extended control IDs ---

  it('validates extended control IDs', () => {
    for (const id of ['fm-amount', 'timbre-mod-amount', 'morph-mod-amount', 'decay', 'lpg-colour']) {
      const result = adapter.validateOperation({
        type: 'move', trackId: 'v0', controlId: id,
        target: { absolute: 0.5 },
      });
      expect(result.valid, `${id} should be valid`).toBe(true);
    }
  });

  it('maps extended control IDs to runtime params', () => {
    expect(adapter.mapControl('fm-amount').path).toBe('params.fm_amount');
    expect(adapter.mapControl('lpg-colour').path).toBe('params.lpg_colour');
    expect(adapter.mapControl('decay').path).toBe('params.decay');
  });

  // --- Portamento control IDs ---

  it('validates portamento control IDs', () => {
    for (const id of ['portamento-time', 'portamento-mode']) {
      const result = adapter.validateOperation({
        type: 'move', trackId: 'v0', controlId: id,
        target: { absolute: 0.5 },
      });
      expect(result.valid, `${id} should be valid`).toBe(true);
    }
  });

  it('maps portamento control IDs to runtime params', () => {
    expect(adapter.mapControl('portamento-time').path).toBe('params.portamentoTime');
    expect(adapter.mapControl('portamento-mode').path).toBe('params.portamentoMode');
  });

  it('maps portamento runtime params back to control IDs', () => {
    expect(adapter.mapRuntimeParamKey('portamentoTime')).toBe('portamento-time');
    expect(adapter.mapRuntimeParamKey('portamentoMode')).toBe('portamento-mode');
  });

  it('maps extended runtime params back to control IDs', () => {
    expect(adapter.mapRuntimeParamKey('fm_amount')).toBe('fm-amount');
    expect(adapter.mapRuntimeParamKey('timbre_mod_amount')).toBe('timbre-mod-amount');
    expect(adapter.mapRuntimeParamKey('morph_mod_amount')).toBe('morph-mod-amount');
    expect(adapter.mapRuntimeParamKey('lpg_colour')).toBe('lpg-colour');
    // decay is identity-mapped (known control ID)
    expect(adapter.mapRuntimeParamKey('decay')).toBe('decay');
  });
});

describe('control ID roundtrip mapping', () => {
  it('all non-identity mappings roundtrip correctly', () => {
    for (const [controlId, runtimeParam] of Object.entries(controlIdToRuntimeParam)) {
      const backToControlId = runtimeParamToControlId[runtimeParam];
      expect(backToControlId, `${controlId} → ${runtimeParam} should map back`).toBe(controlId);
    }
  });

  it('all reverse mappings roundtrip correctly', () => {
    for (const [runtimeParam, controlId] of Object.entries(runtimeParamToControlId)) {
      const backToRuntime = controlIdToRuntimeParam[controlId];
      expect(backToRuntime, `${runtimeParam} → ${controlId} should map back`).toBe(runtimeParam);
    }
  });
});
