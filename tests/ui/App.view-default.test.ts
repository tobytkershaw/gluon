import { describe, expect, it } from 'vitest';
import {
  getExplicitViewPreference,
  inferDefaultView,
  reconcileAutoManagedView,
} from '../../src/ui/App';
import { createSession, addTrack } from '../../src/engine/session';

describe('App default view helpers', () => {
  it('reads explicit stored view preferences before legacy chat focus fallback', () => {
    const storage = {
      getItem: (key: string) => {
        if (key === 'gluon-view') return 'tracker';
        if (key === 'gluon-chat-focused') return 'false';
        return null;
      },
    };

    expect(getExplicitViewPreference(storage)).toBe('tracker');
  });

  it('falls back to legacy chat focus preference when no explicit view is stored', () => {
    const storage = {
      getItem: (key: string) => {
        if (key === 'gluon-chat-focused') return 'false';
        return null;
      },
    };

    expect(getExplicitViewPreference(storage)).toBe('surface');
  });

  it('infers chat for a fresh session and surface for a project with musical content', () => {
    const freshSession = createSession();
    expect(inferDefaultView(freshSession)).toBe('chat');

    const contentSession = addTrack(freshSession, 'audio') ?? freshSession;

    expect(inferDefaultView(contentSession)).toBe('surface');
  });

  it('recomputes the default view when the current view is still auto-managed', () => {
    const freshSession = createSession();
    const contentSession = addTrack(freshSession, 'audio') ?? freshSession;

    expect(reconcileAutoManagedView('chat', 'chat', contentSession)).toEqual({
      nextView: 'surface',
      nextAutoManagedView: 'surface',
    });
  });

  it('preserves a manually changed view when the active project loads', () => {
    const contentSession = createSession();

    expect(reconcileAutoManagedView('tracker', 'chat', contentSession)).toEqual({
      nextView: 'tracker',
      nextAutoManagedView: null,
    });
  });
});
