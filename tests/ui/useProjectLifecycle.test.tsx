import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../../src/engine/session';
import { useProjectLifecycle } from '../../src/ui/useProjectLifecycle';

const storeMocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  loadProject: vi.fn(),
  saveProject: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  renameProject: vi.fn(),
  duplicateProject: vi.fn(),
  exportProject: vi.fn(),
  importProject: vi.fn(),
  migrateLegacySession: vi.fn(),
}));

const {
  listProjects,
  loadProject,
  saveProject,
  createProject,
  deleteProject,
  renameProject,
  duplicateProject,
  exportProject,
  importProject,
  migrateLegacySession,
} = storeMocks;

vi.mock('../../src/engine/project-store', () => ({ ...storeMocks }));

describe('useProjectLifecycle', () => {
  const session = createSession();
  const altSession = createSession();
  let storage: Record<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = {};
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage[key] ?? null,
        setItem: (key: string, value: string) => { storage[key] = value; },
        removeItem: (key: string) => { delete storage[key]; },
        clear: () => { storage = {}; },
      },
    });
    localStorage.clear();
    migrateLegacySession.mockResolvedValue(null);
    listProjects.mockResolvedValue([]);
    saveProject.mockResolvedValue(undefined);
    renameProject.mockResolvedValue(undefined);
    exportProject.mockResolvedValue('{}');
    importProject.mockResolvedValue({ id: 'imported', name: 'Imported' });
  });

  it('deleting the active project loads a remaining project without recreating the deleted one', async () => {
    localStorage.setItem('gluon-active-project', 'p1');
    loadProject.mockImplementation(async (id: string) => {
      if (id === 'p1') return { id: 'p1', meta: { id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }, session };
      if (id === 'p2') return { id: 'p2', meta: { id: 'p2', name: 'Two', createdAt: 3, updatedAt: 4 }, session: altSession };
      return null;
    });
    listProjects
      .mockResolvedValueOnce([{ id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }])
      .mockResolvedValueOnce([{ id: 'p2', name: 'Two', createdAt: 3, updatedAt: 4 }])
      .mockResolvedValueOnce([{ id: 'p2', name: 'Two', createdAt: 3, updatedAt: 4 }]);

    const setSession = vi.fn();
    const { result } = renderHook(() => useProjectLifecycle(session, setSession));

    await waitFor(() => expect(result.current.projectId).toBe('p1'));

    await act(async () => {
      await result.current.deleteActiveProject();
    });

    expect(deleteProject).toHaveBeenCalledWith('p1');
    expect(saveProject).not.toHaveBeenCalledWith('p1', expect.anything(), expect.anything());
    expect(result.current.projectId).toBe('p2');
    expect(localStorage.getItem('gluon-active-project')).toBe('p2');
  });

  it('deleting the last project creates a fresh untitled project', async () => {
    localStorage.setItem('gluon-active-project', 'p1');
    loadProject.mockResolvedValue({ id: 'p1', meta: { id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }, session });
    listProjects
      .mockResolvedValueOnce([{ id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'new', name: 'Untitled', createdAt: 5, updatedAt: 6 }]);
    createProject.mockResolvedValue({ id: 'new', session: altSession });

    const setSession = vi.fn();
    const { result } = renderHook(() => useProjectLifecycle(session, setSession));
    await waitFor(() => expect(result.current.projectId).toBe('p1'));

    await act(async () => {
      await result.current.deleteActiveProject();
    });

    expect(createProject).toHaveBeenCalledWith('Untitled');
    expect(result.current.projectId).toBe('new');
    expect(result.current.projectName).toBe('Untitled');
  });

  it('switching projects persists the current project exactly once', async () => {
    localStorage.setItem('gluon-active-project', 'p1');
    loadProject.mockImplementation(async (id: string) => {
      if (id === 'p1') return { id: 'p1', meta: { id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }, session };
      if (id === 'p2') return { id: 'p2', meta: { id: 'p2', name: 'Two', createdAt: 3, updatedAt: 4 }, session: altSession };
      return null;
    });
    listProjects.mockResolvedValue([{ id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }]);

    const setSession = vi.fn();
    const { result } = renderHook(() => useProjectLifecycle(session, setSession));
    await waitFor(() => expect(result.current.projectId).toBe('p1'));

    await act(async () => {
      await result.current.switchProject('p2');
    });

    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveProject).toHaveBeenCalledWith('p1', 'One', session);
    expect(result.current.projectId).toBe('p2');
  });

  it('duplicating then switching does not save the source project twice', async () => {
    localStorage.setItem('gluon-active-project', 'p1');
    loadProject.mockImplementation(async (id: string) => {
      if (id === 'p1') return { id: 'p1', meta: { id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }, session };
      if (id === 'p2') return { id: 'p2', meta: { id: 'p2', name: 'One (copy)', createdAt: 3, updatedAt: 4 }, session: altSession };
      return null;
    });
    listProjects.mockResolvedValue([{ id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }]);
    duplicateProject.mockResolvedValue('p2');

    const setSession = vi.fn();
    const { result } = renderHook(() => useProjectLifecycle(session, setSession));
    await waitFor(() => expect(result.current.projectId).toBe('p1'));

    await act(async () => {
      await result.current.duplicateActiveProject();
    });

    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveProject).toHaveBeenCalledWith('p1', 'One', session);
    expect(result.current.projectId).toBe('p2');
  });

  it('restores IndexedDB-loaded older projects using the persisted project version', async () => {
    localStorage.setItem('gluon-active-project', 'p1');
    const legacySession = {
      ...session,
      undoStack: [{
        kind: 'param' as const,
        trackId: 'v0',
        prevValues: { timbre: 0.2 },
        aiTargetValues: { timbre: 0.8 },
        timestamp: 1,
        description: 'legacy',
      }],
      redoStack: [{
        kind: 'param' as const,
        trackId: 'v0',
        prevValues: { morph: 0.1 },
        aiTargetValues: { morph: 0.9 },
        timestamp: 2,
        description: 'legacy-redo',
      }],
    };
    loadProject.mockResolvedValue({
      id: 'p1',
      version: 5,
      meta: { id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 },
      session: legacySession,
    });
    listProjects.mockResolvedValue([{ id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }]);

    const setSession = vi.fn();
    renderHook(() => useProjectLifecycle(session, setSession));

    await waitFor(() => expect(setSession).toHaveBeenCalled());

    const restoredSession = setSession.mock.calls[0]?.[0];
    expect(restoredSession.undoStack).toEqual([]);
    expect(restoredSession.redoStack).toEqual([]);
  });
});
