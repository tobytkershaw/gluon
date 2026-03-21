import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectMenu } from '../../src/ui/ProjectMenu';

const noop = () => false;

describe('ProjectMenu', () => {
  it('disables project actions and shows the in-memory persistence banner when IndexedDB is unavailable', () => {
    render(
      <ProjectMenu
        projectName="Test Project"
        projects={[]}
        saveError
        saveStatus="error"
        onRename={noop}
        onNew={noop}
        onOpen={noop}
        onDuplicate={noop}
        onDelete={noop}
        onExport={noop}
        onImport={noop}
        onExportWav={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Test Project/ }));

    expect(screen.getByText(/working in memory/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /new project/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /delete project/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /export \.gluon/i }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: /export wav/i }).hasAttribute('disabled')).toBe(false);
  });

  it('surfaces project action errors inline', () => {
    render(
      <ProjectMenu
        projectName="Test Project"
        projects={[]}
        saveError={false}
        saveStatus="idle"
        projectActionError="Failed to load project missing."
        onRename={noop}
        onNew={noop}
        onOpen={noop}
        onDuplicate={noop}
        onDelete={noop}
        onExport={noop}
        onImport={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Test Project/ }));

    expect(screen.getByText('Failed to load project missing.')).toBeTruthy();
  });

  it('keeps export available in degraded mode', () => {
    const onExport = vi.fn(() => true);

    render(
      <ProjectMenu
        projectName="Test Project"
        projects={[]}
        saveError
        saveStatus="error"
        onRename={noop}
        onNew={noop}
        onOpen={noop}
        onDuplicate={noop}
        onDelete={noop}
        onExport={onExport}
        onImport={noop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Test Project/ }));
    fireEvent.click(screen.getByRole('button', { name: /export \.gluon/i }));

    expect(onExport).toHaveBeenCalledOnce();
  });

  it('shows the degraded indicator even when fallback persistence reports saved', () => {
    render(
      <ProjectMenu
        projectName="Test Project"
        projects={[]}
        saveError
        saveStatus="saved"
        onRename={noop}
        onNew={noop}
        onOpen={noop}
        onDuplicate={noop}
        onDelete={noop}
        onExport={noop}
        onImport={noop}
      />,
    );

    const trigger = screen.getByRole('button', { name: /Test Project/ });
    const indicator = trigger.querySelector('span[title]');
    expect(indicator?.getAttribute('title')).toBe('IndexedDB unavailable; working in memory');
  });
});
