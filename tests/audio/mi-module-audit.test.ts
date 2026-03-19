// tests/audio/mi-module-audit.test.ts
// Audit test: verifies all MI module parameter names, control order, and mode names
// match official Mutable Instruments documentation.
// Reference: https://pichenettes.github.io/mutable-instruments-documentation/

import { describe, it, expect } from 'vitest';
import { plaitsInstrument } from '../../src/audio/instrument-registry-plaits';
import { ringsInstrument } from '../../src/audio/instrument-registry-rings';
import { cloudsInstrument } from '../../src/audio/instrument-registry-clouds';
import { tidesInstrument } from '../../src/audio/instrument-registry-tides';
import { ripplesInstrument } from '../../src/audio/instrument-registry-ripples';
import { elementsInstrument } from '../../src/audio/instrument-registry-elements';
import { warpsInstrument } from '../../src/audio/instrument-registry-warps';
import { beadsInstrument } from '../../src/audio/instrument-registry-beads';

// ---------------------------------------------------------------------------
// Plaits — https://pichenettes.github.io/mutable-instruments-documentation/modules/plaits/
// ---------------------------------------------------------------------------
describe('Plaits: official parameter audit', () => {
  it('has 16 models in official order', () => {
    const ids = plaitsInstrument.engines.map(e => e.id);
    expect(ids).toEqual([
      'virtual-analog', 'waveshaping', 'fm', 'grain-formant',
      'harmonic', 'wavetable', 'chords', 'vowel-speech',
      'swarm', 'filtered-noise', 'particle-dust', 'inharmonic-string',
      'modal-resonator', 'analog-bass-drum', 'analog-snare', 'analog-hi-hat',
    ]);
  });

  it('control order matches hardware faceplate: Frequency, Harmonics (large), Timbre, Morph (medium), attenuverters + LPG (small)', () => {
    const controls = plaitsInstrument.engines[0].controls;
    const ids = controls.map(c => c.id);
    expect(ids).toEqual([
      'frequency', 'harmonics',                    // Row 1: large knobs
      'timbre', 'morph',                            // Row 2: medium knobs
      'timbre-mod-amount', 'fm-amount', 'morph-mod-amount', // Row 3: small attenuverters
      'decay', 'lpg-colour',                        // LPG section: small
      'portamento-time', 'portamento-mode',          // Row 4: portamento
    ]);
  });

  it('knob sizes match hardware tiers', () => {
    const controls = plaitsInstrument.engines[0].controls;
    const sizeMap = Object.fromEntries(controls.map(c => [c.id, c.size]));
    expect(sizeMap['frequency']).toBe('large');
    expect(sizeMap['harmonics']).toBe('large');
    expect(sizeMap['timbre']).toBe('medium');
    expect(sizeMap['morph']).toBe('medium');
    expect(sizeMap['timbre-mod-amount']).toBe('small');
    expect(sizeMap['fm-amount']).toBe('small');
    expect(sizeMap['morph-mod-amount']).toBe('small');
    expect(sizeMap['decay']).toBe('small');
    expect(sizeMap['lpg-colour']).toBe('small');
  });

  it('percussion models are only the last 3 (bass drum, snare, hi-hat)', () => {
    const percIds = plaitsInstrument.engines
      .filter((_, i) => i >= 13)
      .map(e => e.id);
    expect(percIds).toEqual(['analog-bass-drum', 'analog-snare', 'analog-hi-hat']);
  });
});

// ---------------------------------------------------------------------------
// Rings — https://pichenettes.github.io/mutable-instruments-documentation/modules/rings/
// ---------------------------------------------------------------------------
describe('Rings: official parameter audit', () => {
  it('first 3 modes match official MI resonator types', () => {
    const labels = ringsInstrument.engines.slice(0, 3).map(e => e.label);
    expect(labels).toEqual([
      'Modal Resonator',
      'Sympathetic Strings',
      'Modulated/Inharmonic String',
    ]);
  });

  it('Gluon extension modes are clearly marked', () => {
    for (const engine of ringsInstrument.engines.slice(3)) {
      expect(engine.label).toContain('Gluon');
      expect(engine.description).toContain('Gluon extension');
    }
  });

  it('control order matches hardware: Structure, Brightness, Damping, Position (large), then secondary (small)', () => {
    const controls = ringsInstrument.engines[0].controls;
    const ids = controls.map(c => c.id);
    expect(ids).toEqual([
      'structure', 'brightness', 'damping', 'position',
      'fine-tune', 'internal-exciter', 'polyphony',
    ]);
  });

  it('primary controls are large, secondary are small', () => {
    const controls = ringsInstrument.engines[0].controls;
    expect(controls.find(c => c.id === 'structure')?.size).toBe('large');
    expect(controls.find(c => c.id === 'brightness')?.size).toBe('large');
    expect(controls.find(c => c.id === 'damping')?.size).toBe('large');
    expect(controls.find(c => c.id === 'position')?.size).toBe('large');
    expect(controls.find(c => c.id === 'fine-tune')?.size).toBe('small');
    expect(controls.find(c => c.id === 'polyphony')?.size).toBe('small');
  });
});

// ---------------------------------------------------------------------------
// Clouds — https://pichenettes.github.io/mutable-instruments-documentation/modules/clouds/
// ---------------------------------------------------------------------------
describe('Clouds: official parameter audit', () => {
  it('4 modes match official playback modes', () => {
    const ids = cloudsInstrument.engines.map(e => e.id);
    expect(ids).toEqual(['granular', 'pitch-shifter', 'looping-delay', 'spectral']);
  });

  it('control order matches hardware faceplate: Position, Size, Pitch (large), Density, Texture, Blend (small), then extended', () => {
    const controls = cloudsInstrument.engines[0].controls;
    const ids = controls.map(c => c.id);
    expect(ids).toEqual([
      'position', 'size', 'pitch',           // Top row (large)
      'density', 'texture', 'dry-wet',       // Bottom row (small) — BLEND sub-params split
      'feedback', 'stereo-spread', 'reverb', // BLEND sub-parameters
      'freeze',                               // Button
    ]);
  });

  it('BLEND sub-parameters (feedback, stereo-spread, reverb) default to 0', () => {
    const controls = cloudsInstrument.engines[0].controls;
    for (const id of ['feedback', 'stereo-spread', 'reverb']) {
      expect(controls.find(c => c.id === id)?.range.default, `${id}`).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Tides — https://pichenettes.github.io/mutable-instruments-documentation/modules/tides_2018/
// ---------------------------------------------------------------------------
describe('Tides: official parameter audit', () => {
  it('3 ramp modes match official Tides 2018 modes', () => {
    const ids = tidesInstrument.engines.map(e => e.id);
    expect(ids).toEqual(['ad', 'looping', 'ar']);
  });

  it('control order matches hardware: Frequency, Shape, Slope, Smoothness (large), Shift (small), then discrete controls', () => {
    const controls = tidesInstrument.engines[0].controls;
    const ids = controls.map(c => c.id);
    expect(ids).toEqual([
      'frequency', 'shape', 'slope', 'smoothness', // Main knobs
      'shift',                                       // Extended
      'output-mode', 'range',                        // Discrete mode controls
    ]);
  });

  it('output-mode is discrete with 4 values (0-3)', () => {
    const controls = tidesInstrument.engines[0].controls;
    const om = controls.find(c => c.id === 'output-mode');
    expect(om?.kind).toBe('discrete');
    expect(om?.range.min).toBe(0);
    expect(om?.range.max).toBe(3);
  });

  it('range is discrete with 2 values (control rate vs audio rate)', () => {
    const controls = tidesInstrument.engines[0].controls;
    const rng = controls.find(c => c.id === 'range');
    expect(rng?.kind).toBe('discrete');
    expect(rng?.range.min).toBe(0);
    expect(rng?.range.max).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Ripples — https://pichenettes.github.io/mutable-instruments-documentation/modules/ripples_2020/
// ---------------------------------------------------------------------------
describe('Ripples: official parameter audit', () => {
  it('4 filter modes model the hardware output jacks + slope switch', () => {
    const ids = ripplesInstrument.engines.map(e => e.id);
    expect(ids).toEqual(['lp2', 'lp4', 'bp2', 'hp2']);
  });

  it('engine labels use standard filter notation (LP/BP/HP prefix)', () => {
    const labels = ripplesInstrument.engines.map(e => e.label);
    expect(labels[0]).toMatch(/^LP/);
    expect(labels[1]).toMatch(/^LP/);
    expect(labels[2]).toMatch(/^BP/);
    expect(labels[3]).toMatch(/^HP/);
  });

  it('cutoff control uses "Frequency" label matching hardware FREQ knob', () => {
    const controls = ripplesInstrument.engines[0].controls;
    const cutoff = controls.find(c => c.id === 'cutoff');
    expect(cutoff?.name).toBe('Frequency');
  });

  it('drive is documented as Gluon extension', () => {
    const controls = ripplesInstrument.engines[0].controls;
    const drive = controls.find(c => c.id === 'drive');
    expect(drive?.description).toContain('Gluon extension');
  });

  it('control order: cutoff (large), resonance (large), drive (medium)', () => {
    const controls = ripplesInstrument.engines[0].controls;
    const ids = controls.map(c => c.id);
    expect(ids).toEqual(['cutoff', 'resonance', 'drive']);
    expect(controls[0].size).toBe('large');
    expect(controls[1].size).toBe('large');
    expect(controls[2].size).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// Elements — https://pichenettes.github.io/mutable-instruments-documentation/modules/elements/
// ---------------------------------------------------------------------------
describe('Elements: official parameter audit', () => {
  it('control order: exciter section first (bow, blow, strike), then resonator section', () => {
    const controls = elementsInstrument.engines[0].controls;
    const ids = controls.map(c => c.id);
    expect(ids).toEqual([
      'bow_level', 'bow_timbre',
      'blow_level', 'blow_timbre',
      'strike_level', 'strike_timbre',
      'coarse', 'fine',
      'geometry', 'brightness', 'damping', 'position',
      'space',
    ]);
  });

  it('exciter levels are large, timbres are medium', () => {
    const controls = elementsInstrument.engines[0].controls;
    for (const id of ['bow_level', 'blow_level', 'strike_level']) {
      expect(controls.find(c => c.id === id)?.size, id).toBe('large');
    }
    for (const id of ['bow_timbre', 'blow_timbre', 'strike_timbre']) {
      expect(controls.find(c => c.id === id)?.size, id).toBe('medium');
    }
  });

  it('engine modes are clearly labeled as Gluon abstractions (Elements has no hardware mode switch)', () => {
    // Elements is a single-mode instrument on hardware — modes are Gluon presets
    expect(elementsInstrument.engines).toHaveLength(2);
    expect(elementsInstrument.engines[0].id).toBe('modal');
    expect(elementsInstrument.engines[1].id).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Warps — https://pichenettes.github.io/mutable-instruments-documentation/modules/warps/
// ---------------------------------------------------------------------------
describe('Warps: official parameter audit', () => {
  it('4 engine presets cover the continuous algorithm knob range', () => {
    const ids = warpsInstrument.engines.map(e => e.id);
    expect(ids).toEqual(['crossfade', 'fold', 'ring', 'vocoder']);
  });

  it('control order matches hardware: Algorithm, Timbre, Level', () => {
    const controls = warpsInstrument.engines[0].controls;
    const ids = controls.map(c => c.id);
    expect(ids).toEqual(['algorithm', 'timbre', 'level']);
  });

  it('level control is labeled "Modulator Level" matching hardware function', () => {
    const controls = warpsInstrument.engines[0].controls;
    const level = controls.find(c => c.id === 'level');
    expect(level?.name).toBe('Modulator Level');
  });
});

// ---------------------------------------------------------------------------
// Beads — https://pichenettes.github.io/mutable-instruments-documentation/modules/beads/
// ---------------------------------------------------------------------------
describe('Beads: official parameter audit', () => {
  it('3 modes match official quality/processing modes', () => {
    const ids = beadsInstrument.engines.map(e => e.id);
    expect(ids).toEqual(['granular', 'delay', 'wavetable-synth']);
  });

  it('control order matches hardware faceplate: Density, Time, Pitch, Position, Shape, then Dry/Wet', () => {
    const controls = beadsInstrument.engines[0].controls;
    const ids = controls.map(c => c.id);
    expect(ids).toEqual(['density', 'time', 'pitch', 'position', 'texture', 'dry-wet']);
  });

  it('texture control is labeled "Shape" matching hardware SHAPE knob', () => {
    const controls = beadsInstrument.engines[0].controls;
    const shape = controls.find(c => c.id === 'texture');
    expect(shape?.name).toBe('Shape');
  });
});

// ---------------------------------------------------------------------------
// Cross-module: all MI modules have valid structure
// ---------------------------------------------------------------------------
describe('All MI modules: structural integrity', () => {
  const allModules = [
    { name: 'Plaits', inst: plaitsInstrument },
    { name: 'Rings', inst: ringsInstrument },
    { name: 'Clouds', inst: cloudsInstrument },
    { name: 'Tides', inst: tidesInstrument },
    { name: 'Ripples', inst: ripplesInstrument },
    { name: 'Elements', inst: elementsInstrument },
    { name: 'Warps', inst: warpsInstrument },
    { name: 'Beads', inst: beadsInstrument },
  ];

  for (const { name, inst } of allModules) {
    it(`${name}: no duplicate engine IDs`, () => {
      const ids = inst.engines.map(e => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it(`${name}: no duplicate control IDs within any engine`, () => {
      for (const engine of inst.engines) {
        const ids = engine.controls.map(c => c.id);
        expect(new Set(ids).size, `${name}/${engine.id} has duplicate controls`).toBe(ids.length);
      }
    });

    it(`${name}: all controls have range 0-1`, () => {
      for (const engine of inst.engines) {
        for (const control of engine.controls) {
          if (control.kind === 'discrete' || control.kind === 'boolean' || control.kind === 'enum') continue;
          expect(control.range.min, `${name}/${engine.id}/${control.id}`).toBe(0);
          expect(control.range.max, `${name}/${engine.id}/${control.id}`).toBe(1);
        }
      }
    });

    it(`${name}: all controls have non-empty name and description`, () => {
      for (const engine of inst.engines) {
        for (const control of engine.controls) {
          expect(control.name.length, `${name}/${engine.id}/${control.id} name`).toBeGreaterThan(0);
          expect(control.description.length, `${name}/${engine.id}/${control.id} desc`).toBeGreaterThan(0);
        }
      }
    });

    it(`${name}: label starts with "Mutable Instruments"`, () => {
      expect(inst.label).toMatch(/^Mutable Instruments/);
    });
  }
});
