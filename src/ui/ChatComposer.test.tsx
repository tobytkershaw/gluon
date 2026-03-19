import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './ChatComposer';

describe('ChatComposer keyboard workflow', () => {
  it('recalls the last human message with ArrowUp on an empty composer', async () => {
    render(<ChatComposer onSend={vi.fn()} lastUserMessage="Make it darker" />);

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('Make it darker');
    });
  });

  it('selects follow-up chips with number keys when the composer is empty', () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        onSend={onSend}
        followUpChips={[
          { label: 'more bright', prompt: 'Make it brighter' },
          { label: 'more weight', prompt: 'Give it more weight' },
        ]}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: '2' });

    expect(onSend).toHaveBeenCalledWith('Give it more weight');
  });
});
