import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiKeyInput } from '../../src/ui/ApiKeyInput';

describe('ApiKeyInput', () => {
  it('calls onSubmit when form is submitted and not disabled', () => {
    const onSubmit = vi.fn();
    render(
      <ApiKeyInput
        onSubmit={onSubmit}
        isConfigured={false}
        currentGeminiKey="AIza-test"
      />,
    );

    fireEvent.submit(screen.getByRole('button', { name: /connect/i }).closest('form')!);
    expect(onSubmit).toHaveBeenCalledWith('', 'AIza-test', 'gemini');
  });

  it('does not call onSubmit when disabled', () => {
    const onSubmit = vi.fn();
    render(
      <ApiKeyInput
        onSubmit={onSubmit}
        isConfigured={false}
        currentGeminiKey="AIza-test"
        disabled
      />,
    );

    fireEvent.submit(screen.getByRole('button', { name: /connect/i }).closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables inputs and submit button when disabled', () => {
    render(
      <ApiKeyInput
        onSubmit={vi.fn()}
        isConfigured={false}
        currentGeminiKey="AIza-test"
        disabled
      />,
    );

    const openaiInput = screen.getByPlaceholderText('sk-...');
    const geminiInput = screen.getByPlaceholderText('AIza...');
    const submitButton = screen.getByRole('button', { name: /connect/i });

    expect(openaiInput.hasAttribute('disabled')).toBe(true);
    expect(geminiInput.hasAttribute('disabled')).toBe(true);
    expect(submitButton.hasAttribute('disabled')).toBe(true);
  });

  it('shows a warning when disabled', () => {
    render(
      <ApiKeyInput
        onSubmit={vi.fn()}
        isConfigured={false}
        currentGeminiKey="AIza-test"
        disabled
      />,
    );

    expect(screen.getByTestId('api-key-turn-warning')).toBeTruthy();
    expect(screen.getByText(/AI turn in progress/)).toBeTruthy();
  });

  it('does not show a warning when not disabled', () => {
    render(
      <ApiKeyInput
        onSubmit={vi.fn()}
        isConfigured={false}
        currentGeminiKey="AIza-test"
      />,
    );

    expect(screen.queryByTestId('api-key-turn-warning')).toBeNull();
  });
});
