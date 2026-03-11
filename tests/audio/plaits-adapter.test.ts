import { describe, it, expect } from 'vitest';
import { createPlaitsAdapter } from '../../src/audio/plaits-adapter';

describe('plaits-adapter', () => {
  const adapter = createPlaitsAdapter();

  it('maps brightness controlId to params.timbre', () => {
    const binding = adapter.mapControl('brightness');
    expect(binding.path).toBe('params.timbre');
  });

  it('maps richness controlId to params.harmonics', () => {
    const binding = adapter.mapControl('richness');
    expect(binding.path).toBe('params.harmonics');
  });

  it('maps texture controlId to params.morph', () => {
    const binding = adapter.mapControl('texture');
    expect(binding.path).toBe('params.morph');
  });

  it('maps pitch controlId to params.note', () => {
    const binding = adapter.mapControl('pitch');
    expect(binding.path).toBe('params.note');
  });

  it('maps runtime param timbre back to brightness', () => {
    expect(adapter.mapRuntimeParamKey('timbre')).toBe('brightness');
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
      type: 'move', voiceId: 'v0', controlId: 'brightness',
      target: { absolute: 0.5 },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects unknown controlId', () => {
    const result = adapter.validateOperation({
      type: 'move', voiceId: 'v0', controlId: 'unknown_param',
      target: { absolute: 0.5 },
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Unknown control');
  });

  it('rejects out-of-range absolute values', () => {
    const result = adapter.validateOperation({
      type: 'move', voiceId: 'v0', controlId: 'brightness',
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
