import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, GLUON_SYSTEM_PROMPT } from '../../src/ai/system-prompt';
import { createSession, setAgency } from '../../src/engine/session';

function defaultPrompt(): string {
  return buildSystemPrompt(createSession());
}

describe('system prompt generation', () => {
  it('includes all 16 model names', () => {
    const prompt = defaultPrompt();
    const models = [
      'Virtual Analog', 'Waveshaping', 'FM', 'Grain/Formant', 'Harmonic',
      'Wavetable', 'Chords', 'Vowel/Speech', 'Swarm', 'Filtered Noise',
      'Particle/Dust', 'Inharmonic String', 'Modal Resonator',
      'Analog Bass Drum', 'Analog Snare', 'Analog Hi-Hat',
    ];
    for (const name of models) {
      expect(prompt).toContain(name);
    }
  });

  it('includes semantic parameter names', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('brightness');
    expect(prompt).toContain('richness');
    expect(prompt).toContain('texture');
    expect(prompt).toContain('pitch');
  });

  it('includes parameter ranges', () => {
    const prompt = defaultPrompt();
    expect(prompt).toMatch(/0[.\s]*[-–]\s*1/);
  });

  it('mentions tool-based workflow', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('tools');
    expect(prompt).toContain('tool call');
  });

  it('contains voice setup', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('v0');
    expect(prompt).toContain('v1');
    expect(prompt).toContain('trigger');
    expect(prompt).toContain('note events');
  });

  it('contains behaviour rules', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('agency');
    expect(prompt).toContain('undo');
  });

  it('does not contain old JSON action syntax', () => {
    const prompt = defaultPrompt();
    expect(prompt).not.toContain('"type": "move"');
    expect(prompt).not.toContain('Respond with valid JSON');
    expect(prompt).not.toContain('Transport controls (BPM, swing, play/stop) are human-only');
  });

  it('backwards-compatible GLUON_SYSTEM_PROMPT export works', () => {
    expect(GLUON_SYSTEM_PROMPT).toContain('v0');
    expect(GLUON_SYSTEM_PROMPT).toContain('Behaviour Rules');
  });
});

describe('dynamic voice setup', () => {
  it('shows percussion classification for drum engines', () => {
    const session = createSession();
    const prompt = buildSystemPrompt(session);
    // v0 is model 13 (analog-bass-drum) → percussion
    expect(prompt).toContain('Analog Bass Drum (percussion)');
  });

  it('shows melodic classification for melodic engines', () => {
    const session = createSession();
    const prompt = buildSystemPrompt(session);
    // v1 is model 0 (virtual-analog) → melodic
    expect(prompt).toContain('Virtual Analog (melodic)');
  });

  it('reflects agency OFF in prompt', () => {
    let session = createSession();
    session = setAgency(session, 'v1', 'OFF');
    const prompt = buildSystemPrompt(session);
    expect(prompt).toContain('v1 (VA): Virtual Analog (melodic) — agency OFF');
  });

  it('reflects agency ON in prompt', () => {
    const session = createSession();
    const prompt = buildSystemPrompt(session);
    expect(prompt).toContain('v0 (Kick): Analog Bass Drum (percussion) — agency ON');
  });

  it('shows correct model name for each voice', () => {
    const session = createSession();
    const prompt = buildSystemPrompt(session);
    expect(prompt).toContain('v0 (Kick): Analog Bass Drum');
    expect(prompt).toContain('v1 (VA): Virtual Analog');
    expect(prompt).toContain('v2 (FM): FM');
    expect(prompt).toContain('v3 (Harmonic): Harmonic');
  });

  it('mentions transform tool', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('transform tool');
  });
});
