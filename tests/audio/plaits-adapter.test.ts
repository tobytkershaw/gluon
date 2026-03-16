import { describe, it, expect } from 'vitest';
import { createPlaitsAdapter } from '../../src/audio/plaits-adapter';

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
});
