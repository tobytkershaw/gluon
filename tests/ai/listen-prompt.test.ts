import { describe, it, expect } from 'vitest';
import { buildListenPrompt, GLUON_LISTEN_PROMPT } from '../../src/ai/listen-prompt';

describe('buildListenPrompt', () => {
  it('returns a generic prompt when no question is provided', () => {
    const prompt = buildListenPrompt();
    expect(prompt).toContain('Describe what you hear');
    expect(prompt).not.toContain('## Focus');
  });

  it('returns a generic prompt for undefined question', () => {
    const prompt = buildListenPrompt(undefined);
    expect(prompt).toContain('Describe what you hear');
    expect(prompt).not.toContain('## Focus');
  });

  it('returns a generic prompt for default question "How does it sound?"', () => {
    const prompt = buildListenPrompt('How does it sound?');
    expect(prompt).toContain('Describe what you hear');
    expect(prompt).not.toContain('## Focus');
  });

  it('returns a generic prompt for other generic phrases', () => {
    for (const q of ['What do you think?', 'Evaluate this', 'Listen to this', 'Give me feedback']) {
      const prompt = buildListenPrompt(q);
      expect(prompt).toContain('Describe what you hear');
      expect(prompt).not.toContain('## Focus');
    }
  });

  it('returns a question-focused prompt for a specific question', () => {
    const prompt = buildListenPrompt('Is the bass too muddy?');
    expect(prompt).toContain('## Focus');
    expect(prompt).toContain('Is the bass too muddy?');
    expect(prompt).toContain('Answer the question directly');
    expect(prompt).not.toContain('Describe what you hear');
  });

  it('returns a question-focused prompt for detailed questions', () => {
    const prompt = buildListenPrompt('Does the groove feel tight or is the timing sloppy?');
    expect(prompt).toContain('## Focus');
    expect(prompt).toContain('Does the groove feel tight or is the timing sloppy?');
  });

  it('always includes the base prompt and footer', () => {
    const generic = buildListenPrompt();
    const specific = buildListenPrompt('Is the mix balanced?');

    for (const prompt of [generic, specific]) {
      expect(prompt).toContain('audio critic evaluating a musical instrument');
      expect(prompt).toContain('Respond with critique text ONLY');
      expect(prompt).toContain('Do NOT produce JSON actions');
    }
  });

  it('deprecated GLUON_LISTEN_PROMPT matches generic buildListenPrompt()', () => {
    expect(GLUON_LISTEN_PROMPT).toBe(buildListenPrompt());
  });
});
