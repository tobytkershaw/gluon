import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewToggle } from './ViewToggle';

describe('ViewToggle', () => {
  it('renders chat as the first-class view tab', () => {
    const onViewChange = vi.fn();

    render(<ViewToggle view="chat" onViewChange={onViewChange} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Chat',
      'Surface',
      'Rack',
      'Patch',
      'Tracker',
    ]);

    fireEvent.click(screen.getByRole('tab', { name: 'Surface' }));
    expect(onViewChange).toHaveBeenCalledWith('surface');
  });
});
