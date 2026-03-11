import { describe, it, expect } from 'vitest';
import { GLUON_SYSTEM_PROMPT } from '../../src/ai/system-prompt';

describe('system prompt generation', () => {
  it('includes all 16 model names', () => {
    const models = [
      'Virtual Analog', 'Waveshaping', 'FM', 'Grain/Formant', 'Harmonic',
      'Wavetable', 'Chords', 'Vowel/Speech', 'Swarm', 'Filtered Noise',
      'Particle/Dust', 'Inharmonic String', 'Modal Resonator',
      'Analog Bass Drum', 'Analog Snare', 'Analog Hi-Hat',
    ];
    for (const name of models) {
      expect(GLUON_SYSTEM_PROMPT).toContain(name);
    }
  });

  it('includes semantic parameter names', () => {
    expect(GLUON_SYSTEM_PROMPT).toContain('brightness');
    expect(GLUON_SYSTEM_PROMPT).toContain('richness');
    expect(GLUON_SYSTEM_PROMPT).toContain('texture');
    expect(GLUON_SYSTEM_PROMPT).toContain('pitch');
  });

  it('includes parameter ranges', () => {
    expect(GLUON_SYSTEM_PROMPT).toMatch(/0[\.\s]*[-–]\s*1/);
  });

  it('still contains action syntax with param (not controlId)', () => {
    expect(GLUON_SYSTEM_PROMPT).toContain('"param"');
  });

  it('still contains sketch syntax with pattern.steps', () => {
    expect(GLUON_SYSTEM_PROMPT).toContain('pattern');
    expect(GLUON_SYSTEM_PROMPT).toContain('steps');
  });

  it('contains behaviour rules', () => {
    expect(GLUON_SYSTEM_PROMPT).toContain('agency');
    expect(GLUON_SYSTEM_PROMPT).toContain('undo');
  });

  it('mentions per-step pitch via note', () => {
    expect(GLUON_SYSTEM_PROMPT).toContain('note');
  });
});
