import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderInlineMarkdown } from '../../src/ui/inlineMarkdown';

describe('renderInlineMarkdown', () => {
  it('renders plain text unchanged', () => {
    const { container } = render(<>{renderInlineMarkdown('hello world')}</>);
    expect(container.textContent).toBe('hello world');
    expect(container.querySelector('strong')).toBeNull();
  });

  it('renders **bold** as <strong>', () => {
    const { container } = render(<>{renderInlineMarkdown('play **C**')}</>);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('C');
    expect(container.textContent).toBe('play C');
  });

  it('renders *italic* as <em>', () => {
    const { container } = render(<>{renderInlineMarkdown('a *soft* touch')}</>);
    const em = container.querySelector('em');
    expect(em).not.toBeNull();
    expect(em!.textContent).toBe('soft');
  });

  it('renders `code` as <code>', () => {
    const { container } = render(<>{renderInlineMarkdown('set `frequency` to 440')}</>);
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('frequency');
  });

  it('renders multiple formats in one string', () => {
    const { container } = render(
      <>{renderInlineMarkdown('**bold** and *italic* and `code`')}</>,
    );
    expect(container.querySelector('strong')!.textContent).toBe('bold');
    expect(container.querySelector('em')!.textContent).toBe('italic');
    expect(container.querySelector('code')!.textContent).toBe('code');
  });

  it('renders links as <a>', () => {
    const { container } = render(
      <>{renderInlineMarkdown('see [docs](https://example.com)')}</>,
    );
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a!.textContent).toBe('docs');
    expect(a!.getAttribute('href')).toBe('https://example.com');
    expect(a!.getAttribute('target')).toBe('_blank');
  });

  it('returns original text content when no markdown is present', () => {
    const { container } = render(<>{renderInlineMarkdown('no formatting here')}</>);
    expect(container.textContent).toBe('no formatting here');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('em')).toBeNull();
    expect(container.querySelector('code')).toBeNull();
  });
});
