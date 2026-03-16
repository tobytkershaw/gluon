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

  it('includes hardware parameter names', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('timbre');
    expect(prompt).toContain('harmonics');
    expect(prompt).toContain('morph');
    expect(prompt).toContain('frequency');
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

  it('contains track setup', () => {
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

describe('dynamic track setup', () => {
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

  it('shows correct model name for each track', () => {
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

  it('includes restraint guidance section', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('Restraint:');
  });

  it('includes moderate restraint by default (no reactions)', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('Restraint: Moderate');
  });

  it('includes conservative restraint when reactions are mostly rejections', () => {
    const session = createSession();
    session.reactionHistory = [
      { actionGroupIndex: 0, verdict: 'rejected', timestamp: Date.now() },
      { actionGroupIndex: 1, verdict: 'rejected', timestamp: Date.now() },
      { actionGroupIndex: 2, verdict: 'rejected', timestamp: Date.now() },
    ];
    const prompt = buildSystemPrompt(session);
    expect(prompt).toContain('Restraint: Conservative');
  });

  it('includes adventurous restraint when reactions are mostly approvals', () => {
    const session = createSession();
    session.reactionHistory = [
      { actionGroupIndex: 0, verdict: 'approved', timestamp: Date.now() },
      { actionGroupIndex: 1, verdict: 'approved', timestamp: Date.now() },
      { actionGroupIndex: 2, verdict: 'approved', timestamp: Date.now() },
    ];
    const prompt = buildSystemPrompt(session);
    expect(prompt).toContain('Restraint: Adventurous');
  });

  it('mentions observed_patterns and restraint_level in reaction history section', () => {
    const prompt = defaultPrompt();
    expect(prompt).toContain('observed_patterns');
    expect(prompt).toContain('restraint_level');
  });
});
