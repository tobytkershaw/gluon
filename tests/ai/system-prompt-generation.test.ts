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

  it('mentions tool-based workflow', () => {
    expect(GLUON_SYSTEM_PROMPT).toContain('tools');
    expect(GLUON_SYSTEM_PROMPT).toContain('tool call');
  });

  it('contains voice setup', () => {
    expect(GLUON_SYSTEM_PROMPT).toContain('v0');
    expect(GLUON_SYSTEM_PROMPT).toContain('v1');
    expect(GLUON_SYSTEM_PROMPT).toContain('trigger');
    expect(GLUON_SYSTEM_PROMPT).toContain('note events');
  });

  it('contains behaviour rules', () => {
    expect(GLUON_SYSTEM_PROMPT).toContain('agency');
    expect(GLUON_SYSTEM_PROMPT).toContain('undo');
  });

  it('does not contain old JSON action syntax', () => {
    expect(GLUON_SYSTEM_PROMPT).not.toContain('"type": "move"');
    expect(GLUON_SYSTEM_PROMPT).not.toContain('Respond with valid JSON');
    expect(GLUON_SYSTEM_PROMPT).not.toContain('Transport controls (BPM, swing, play/stop) are human-only');
  });
});
