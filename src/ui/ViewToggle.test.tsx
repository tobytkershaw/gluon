import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewToggle } from './ViewToggle';

describe('ViewToggle', () => {
  it('renders chat as the first-class view tab', () => {
    const onViewChange = vi.fn();

    render(<ViewToggle view="chat" onViewChange={onViewChange} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((btn) => btn.textContent)).toEqual([
      'Chat',
      'Surface',
      'Rack',
      'Patch',
      'Tracker',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Surface' }));
    expect(onViewChange).toHaveBeenCalledWith('surface');
  });
});
