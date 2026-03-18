import { describe, it, expect } from 'vitest';
import {
  getTimbralVector,
  getProcessorTimbralVector,
  getTimbralDirections,
  resolveTimbralMove,
} from '../../src/engine/timbral-vocabulary';
import type { TimbralDirection } from '../../src/engine/timbral-vocabulary';

describe('getTimbralVector', () => {
  it('returns a vector for virtual-analog darker', () => {
    const v = getTimbralVector('virtual-analog', 'darker');
    expect(v).toBeDefined();
    expect(v!.params.timbre).toBeLessThan(0);
  });

  it('returns a vector for fm metallic', () => {
    const v = getTimbralVector('fm', 'metallic');
    expect(v).toBeDefined();
    expect(v!.params.timbre).toBeGreaterThan(0);
    expect(v!.params.harmonics).toBeGreaterThan(0);
  });

  it('returns a vector for analog-bass-drum aggressive', () => {
    const v = getTimbralVector('analog-bass-drum', 'aggressive');
    expect(v).toBeDefined();
    expect(v!.params.timbre).toBeGreaterThan(0);
  });

  it('returns undefined for unknown engine', () => {
    expect(getTimbralVector('nonexistent-engine', 'darker')).toBeUndefined();
  });

  it('returns undefined for unmapped direction on a known engine', () => {
    // virtual-analog has no 'metallic' mapping
    expect(getTimbralVector('virtual-analog', 'metallic')).toBeUndefined();
  });

  it('covers all 16 Plaits engines', () => {
    const engineIds = [
      'virtual-analog', 'waveshaping', 'fm', 'grain-formant',
      'harmonic', 'wavetable', 'chords', 'vowel-speech',
      'swarm', 'filtered-noise', 'particle-dust', 'inharmonic-string',
      'modal-resonator', 'analog-bass-drum', 'analog-snare', 'analog-hi-hat',
    ];
    for (const id of engineIds) {
      // Each engine should have at least 'darker' mapped
      const v = getTimbralVector(id, 'darker');
      expect(v, `${id} should have a 'darker' vector`).toBeDefined();
    }
  });
});

describe('getProcessorTimbralVector', () => {
  it('returns a vector for ripples darker', () => {
    const v = getProcessorTimbralVector('ripples', 'darker');
    expect(v).toBeDefined();
    expect(v!.params.cutoff).toBeLessThan(0);
  });

  it('returns a vector for eq brighter', () => {
    const v = getProcessorTimbralVector('eq', 'brighter');
    expect(v).toBeDefined();
    expect(v!.params.high_gain).toBeGreaterThan(0);
  });

  it('returns a vector for clouds wet', () => {
    const v = getProcessorTimbralVector('clouds', 'wet');
    expect(v).toBeDefined();
    expect(v!.params.mix).toBeGreaterThan(0);
  });

  it('returns undefined for unknown processor type', () => {
    expect(getProcessorTimbralVector('unknown', 'darker')).toBeUndefined();
  });

  it('returns undefined for unmapped direction', () => {
    expect(getProcessorTimbralVector('compressor', 'darker')).toBeUndefined();
  });
});

describe('getTimbralDirections', () => {
  it('returns all 16 directions', () => {
    const dirs = getTimbralDirections();
    expect(dirs).toHaveLength(16);
    expect(dirs).toContain('darker');
    expect(dirs).toContain('brighter');
    expect(dirs).toContain('metallic');
    expect(dirs).toContain('organic');
    expect(dirs).toContain('hollow');
    expect(dirs).toContain('full');
  });

  it('returns a new array each call (no shared mutation)', () => {
    const a = getTimbralDirections();
    const b = getTimbralDirections();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('resolveTimbralMove', () => {
  it('returns scaled deltas for a known engine/direction', () => {
    const deltas = resolveTimbralMove('virtual-analog', 'darker', 0.5);
    expect(deltas.length).toBeGreaterThan(0);
    // The base delta for timbre in virtual-analog darker is -0.2
    const timbreDelta = deltas.find(d => d.param === 'timbre');
    expect(timbreDelta).toBeDefined();
    expect(timbreDelta!.delta).toBeCloseTo(-0.2 * 0.5);
  });

  it('scales to 1.0 (full strength)', () => {
    const deltas = resolveTimbralMove('fm', 'metallic', 1.0);
    const timbreDelta = deltas.find(d => d.param === 'timbre');
    expect(timbreDelta).toBeDefined();
    // Base is 0.2, scale 1.0 => 0.2
    expect(timbreDelta!.delta).toBeCloseTo(0.2);
  });

  it('returns empty array for unknown engine', () => {
    const deltas = resolveTimbralMove('nonexistent', 'darker', 0.5);
    expect(deltas).toEqual([]);
  });

  it('returns empty array for unmapped direction', () => {
    const deltas = resolveTimbralMove('virtual-analog', 'metallic', 0.5);
    expect(deltas).toEqual([]);
  });

  it('returns multiple param deltas when vector has multiple params', () => {
    // FM aggressive has timbre and morph
    const deltas = resolveTimbralMove('fm', 'aggressive', 0.3);
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    const params = deltas.map(d => d.param);
    expect(params).toContain('timbre');
    expect(params).toContain('morph');
  });
});
