import { describe, it, expect } from 'vitest';
import {
  buildListenPrompt,
  buildListenPromptWithLens,
  buildComparePrompt,
  GLUON_LISTEN_PROMPT,
} from '../../src/ai/listen-prompt';
import type { ListenLens } from '../../src/ai/listen-prompt';

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

describe('buildListenPromptWithLens', () => {
  it('without lens matches buildListenPrompt', () => {
    expect(buildListenPromptWithLens()).toBe(buildListenPrompt());
    expect(buildListenPromptWithLens('Is the bass muddy?')).toBe(
      buildListenPrompt('Is the bass muddy?'),
    );
  });

  it('adds lens section for low-end', () => {
    const prompt = buildListenPromptWithLens(undefined, 'low-end');
    expect(prompt).toContain('## Lens: low-end');
    expect(prompt).toContain('frequencies below 250Hz');
    expect(prompt).toContain('Describe what you hear');
  });

  it('adds lens section for rhythm', () => {
    const prompt = buildListenPromptWithLens(undefined, 'rhythm');
    expect(prompt).toContain('## Lens: rhythm');
    expect(prompt).toContain('timing, groove, and rhythmic coherence');
  });

  it('adds lens section for harmony', () => {
    const prompt = buildListenPromptWithLens(undefined, 'harmony');
    expect(prompt).toContain('## Lens: harmony');
    expect(prompt).toContain('pitch relationships');
  });

  it('adds lens section for texture', () => {
    const prompt = buildListenPromptWithLens(undefined, 'texture');
    expect(prompt).toContain('## Lens: texture');
    expect(prompt).toContain('timbral character');
  });

  it('adds lens section for dynamics', () => {
    const prompt = buildListenPromptWithLens(undefined, 'dynamics');
    expect(prompt).toContain('## Lens: dynamics');
    expect(prompt).toContain('loudness variation and punch');
  });

  it('adds lens section for full-mix', () => {
    const prompt = buildListenPromptWithLens(undefined, 'full-mix');
    expect(prompt).toContain('## Lens: full-mix');
    expect(prompt).toContain('overall mix');
  });

  it('combines question and lens', () => {
    const prompt = buildListenPromptWithLens('Is the kick punchy enough?', 'low-end');
    expect(prompt).toContain('## Focus');
    expect(prompt).toContain('Is the kick punchy enough?');
    expect(prompt).toContain('## Lens: low-end');
    expect(prompt).toContain('frequencies below 250Hz');
    // Lens appears after focus guidelines, before footer
    expect(prompt).toContain('Respond with critique text ONLY');
  });

  it('lens section appears before the footer', () => {
    const prompt = buildListenPromptWithLens(undefined, 'rhythm');
    const lensIdx = prompt.indexOf('## Lens: rhythm');
    const footerIdx = prompt.indexOf('## Important');
    expect(lensIdx).toBeGreaterThan(-1);
    expect(footerIdx).toBeGreaterThan(lensIdx);
  });

  it('all valid lenses produce non-empty instructions', () => {
    const lenses: ListenLens[] = ['full-mix', 'low-end', 'rhythm', 'harmony', 'texture', 'dynamics'];
    for (const lens of lenses) {
      const prompt = buildListenPromptWithLens(undefined, lens);
      expect(prompt).toContain(`## Lens: ${lens}`);
    }
  });
});

describe('buildComparePrompt', () => {
  it('includes comparative base prompt', () => {
    const prompt = buildComparePrompt();
    expect(prompt).toContain('current rendered output');
    expect(prompt).toContain('post-edit state');
  });

  it('includes comparative guidelines', () => {
    const prompt = buildComparePrompt();
    expect(prompt).toContain('Evaluate the current audio in light of the comparative question');
    expect(prompt).toContain('achieves the goal implied by the question');
  });

  it('includes footer', () => {
    const prompt = buildComparePrompt();
    expect(prompt).toContain('Respond with critique text ONLY');
    expect(prompt).toContain('Do NOT produce JSON actions');
  });

  it('adds focus section for specific question', () => {
    const prompt = buildComparePrompt('Did the bass get warmer?');
    expect(prompt).toContain('## Focus');
    expect(prompt).toContain('Did the bass get warmer?');
  });

  it('does not add focus section for generic question', () => {
    const prompt = buildComparePrompt('How does it sound?');
    expect(prompt).not.toContain('## Focus');
  });

  it('does not add focus section when no question is given', () => {
    const prompt = buildComparePrompt();
    expect(prompt).not.toContain('## Focus');
  });

  it('combines question and lens', () => {
    const prompt = buildComparePrompt('Did the bass get warmer?', 'low-end');
    expect(prompt).toContain('## Focus');
    expect(prompt).toContain('Did the bass get warmer?');
    expect(prompt).toContain('## Lens: low-end');
    expect(prompt).toContain('frequencies below 250Hz');
  });

  it('adds lens without question', () => {
    const prompt = buildComparePrompt(undefined, 'rhythm');
    expect(prompt).toContain('## Lens: rhythm');
    expect(prompt).not.toContain('## Focus');
  });

  it('lens appears before footer in compare prompt', () => {
    const prompt = buildComparePrompt(undefined, 'dynamics');
    const lensIdx = prompt.indexOf('## Lens: dynamics');
    const footerIdx = prompt.indexOf('## Important');
    expect(lensIdx).toBeGreaterThan(-1);
    expect(footerIdx).toBeGreaterThan(lensIdx);
  });
});
