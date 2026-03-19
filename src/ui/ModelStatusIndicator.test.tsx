import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ModelStatusIndicator } from './ModelStatusIndicator';

describe('ModelStatusIndicator', () => {
  it('shows "AI Connected" when both are available', () => {
    render(<ModelStatusIndicator plannerConfigured={true} listenerConfigured={true} />);
    expect(screen.getByTestId('model-status-label').textContent).toBe('AI Connected');
  });

  it('shows "Manual mode" when planner is unavailable', () => {
    render(<ModelStatusIndicator plannerConfigured={false} listenerConfigured={true} />);
    expect(screen.getByTestId('model-status-label').textContent).toBe('Manual mode');
  });

  it('shows "AI Connected (no audio eval)" when listener is unavailable', () => {
    render(<ModelStatusIndicator plannerConfigured={true} listenerConfigured={false} />);
    expect(screen.getByTestId('model-status-label').textContent).toBe('AI Connected (no audio eval)');
  });

  it('shows "No AI" when both are unavailable', () => {
    render(<ModelStatusIndicator plannerConfigured={false} listenerConfigured={false} />);
    expect(screen.getByTestId('model-status-label').textContent).toBe('No AI');
  });

  it('uses teal dot when both available', () => {
    render(<ModelStatusIndicator plannerConfigured={true} listenerConfigured={true} />);
    const dot = screen.getByTestId('model-status-dot');
    expect(dot.className).toContain('bg-teal-500');
    expect(dot.className).not.toContain('bg-amber');
    expect(dot.className).not.toContain('bg-zinc');
  });

  it('uses amber dot when planner unavailable', () => {
    render(<ModelStatusIndicator plannerConfigured={false} listenerConfigured={true} />);
    const dot = screen.getByTestId('model-status-dot');
    expect(dot.className).toContain('bg-amber-500');
  });

  it('uses gray dot when both unavailable', () => {
    render(<ModelStatusIndicator plannerConfigured={false} listenerConfigured={false} />);
    const dot = screen.getByTestId('model-status-dot');
    expect(dot.className).toContain('bg-zinc-600');
  });

  it('uses teal dot with amber accent when only listener unavailable', () => {
    render(<ModelStatusIndicator plannerConfigured={true} listenerConfigured={false} />);
    const dot = screen.getByTestId('model-status-dot');
    expect(dot.className).toContain('bg-teal-500');
    expect(dot.className).toContain('ring-amber');
  });
});
