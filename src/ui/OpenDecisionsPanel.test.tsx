import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OpenDecisionsPanel } from './OpenDecisionsPanel';

describe('OpenDecisionsPanel', () => {
  it('renders decisions and forwards the selected option', async () => {
    const onRespond = vi.fn();

    render(
      <OpenDecisionsPanel
        decisions={[
          {
            id: 'agency-approval-1',
            question: 'Allow the AI to modify the master bus?',
            context: 'Action: set_master',
            options: ['Allow', 'Deny'],
            raisedAt: Date.now(),
            trackIds: ['master-bus'],
          },
        ]}
        onRespond={onRespond}
      />,
    );

    expect(screen.getByText('Decision Needed')).toBeTruthy();
    expect(screen.getByText('Allow the AI to modify the master bus?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));

    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond.mock.calls[0][0].id).toBe('agency-approval-1');
    expect(onRespond.mock.calls[0][1]).toBe('Allow');
  });
});
