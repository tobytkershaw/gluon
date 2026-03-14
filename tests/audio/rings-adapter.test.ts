import { describe, it, expect } from 'vitest';
import { createRingsAdapter } from '../../src/audio/rings-adapter';

describe('rings-adapter', () => {
  const adapter = createRingsAdapter();

  it('maps structure controlId to params.structure', () => {
    expect(adapter.mapControl('structure').path).toBe('params.structure');
  });

  it('maps brightness controlId to params.brightness', () => {
    expect(adapter.mapControl('brightness').path).toBe('params.brightness');
  });

  it('maps damping controlId to params.damping', () => {
    expect(adapter.mapControl('damping').path).toBe('params.damping');
  });

  it('maps position controlId to params.position', () => {
    expect(adapter.mapControl('position').path).toBe('params.position');
  });

  it('maps known runtime param back to itself (no canonical/runtime split)', () => {
    expect(adapter.mapRuntimeParamKey('structure')).toBe('structure');
    expect(adapter.mapRuntimeParamKey('brightness')).toBe('brightness');
    expect(adapter.mapRuntimeParamKey('damping')).toBe('damping');
    expect(adapter.mapRuntimeParamKey('position')).toBe('position');
  });

  it('returns null for unknown runtime param', () => {
    expect(adapter.mapRuntimeParamKey('foo')).toBeNull();
  });

  it('converts MIDI 60 to normalised pitch', () => {
    const normalised = adapter.midiToNormalisedPitch(60);
    expect(normalised).toBeCloseTo(60 / 127, 2);
  });

  it('converts normalised pitch back to MIDI', () => {
    const midi = adapter.normalisedPitchToMidi(60 / 127);
    expect(midi).toBe(60);
  });

  it('validates known controlId', () => {
    const result = adapter.validateOperation({
      type: 'move', trackId: 'v0', controlId: 'structure',
      target: { absolute: 0.5 },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects unknown controlId', () => {
    const result = adapter.validateOperation({
      type: 'move', trackId: 'v0', controlId: 'timbre',
      target: { absolute: 0.5 },
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Unknown Rings control');
  });

  it('rejects out-of-range absolute values', () => {
    const result = adapter.validateOperation({
      type: 'move', trackId: 'v0', controlId: 'brightness',
      target: { absolute: -0.1 },
    });
    expect(result.valid).toBe(false);
  });

  it('passes through non-move operations', () => {
    const result = adapter.validateOperation({
      type: 'say', text: 'hello',
    });
    expect(result.valid).toBe(true);
  });

  it('getControlSchemas returns 4 controls for modal engine', () => {
    const schemas = adapter.getControlSchemas('modal');
    expect(schemas).toHaveLength(4);
    expect(schemas.map(s => s.id)).toEqual(['structure', 'brightness', 'damping', 'position']);
  });

  it('getControlSchemas returns empty for unknown engine', () => {
    const schemas = adapter.getControlSchemas('nonexistent');
    expect(schemas).toHaveLength(0);
  });
});
