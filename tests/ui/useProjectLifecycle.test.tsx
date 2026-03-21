import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../../src/engine/session';
import { useProjectLifecycle } from '../../src/ui/useProjectLifecycle';
import { CURRENT_VERSION, loadSession, stripForPersistence } from '../../src/engine/persistence';

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
  importProject,
  migrateLegacySession,
} = storeMocks;

vi.mock('../../src/engine/project-store', () => ({ ...storeMocks }));

describe('useProjectLifecycle', () => {
  const session = createSession();
  const altSession = createSession();
  let storage: Record<string, string>;

  function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

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

  it('ignores stale project loads when switching projects quickly', async () => {
    localStorage.setItem('gluon-active-project', 'p1');
    const p1 = { id: 'p1', meta: { id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }, session };
    const p2 = { id: 'p2', meta: { id: 'p2', name: 'Two', createdAt: 3, updatedAt: 4 }, session: altSession };
    const p3Session = { ...createSession(), bpm: 137 };
    const p3 = { id: 'p3', meta: { id: 'p3', name: 'Three', createdAt: 5, updatedAt: 6 }, session: p3Session };
    const loadP2 = deferred<typeof p2 | null>();
    const loadP3 = deferred<typeof p3 | null>();

    loadProject.mockImplementation(async (id: string) => {
      if (id === 'p1') return p1;
      if (id === 'p2') return loadP2.promise;
      if (id === 'p3') return loadP3.promise;
      return null;
    });
    listProjects.mockResolvedValue([{ id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }]);

    const setSession = vi.fn();
    const { result } = renderHook(() => useProjectLifecycle(session, setSession));
    await waitFor(() => expect(result.current.projectId).toBe('p1'));

    await act(async () => {
      void result.current.switchProject('p2');
      void result.current.switchProject('p3');
    });

    await act(async () => {
      loadP3.resolve(p3);
      await loadP3.promise;
    });
    await waitFor(() => expect(result.current.projectId).toBe('p3'));

    await act(async () => {
      loadP2.resolve(p2);
      await loadP2.promise;
    });

    expect(result.current.projectId).toBe('p3');
    expect(setSession).toHaveBeenCalledTimes(2);
    expect(setSession.mock.calls[1]?.[0].bpm).toBe(137);
  });

  it('recovers with a fresh project when listProjects fails after deletion (#1199)', async () => {
    localStorage.setItem('gluon-active-project', 'p1');
    loadProject.mockResolvedValue({ id: 'p1', meta: { id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }, session });
    listProjects
      .mockResolvedValueOnce([{ id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }])
      // After deletion, listProjects throws — simulates IndexedDB failure
      .mockRejectedValueOnce(new Error('IndexedDB read failed'))
      .mockResolvedValueOnce([{ id: 'recovery', name: 'Untitled', createdAt: 7, updatedAt: 8 }]);
    createProject.mockResolvedValue({ id: 'recovery', session: altSession });

    const setSession = vi.fn();
    const { result } = renderHook(() => useProjectLifecycle(session, setSession));
    await waitFor(() => expect(result.current.projectId).toBe('p1'));

    await act(async () => {
      await result.current.deleteActiveProject();
    });

    // Key invariant: projectId must be non-null after deleteActiveProject returns
    expect(result.current.projectId).toBe('recovery');
    expect(result.current.projectName).toBe('Untitled');
    expect(createProject).toHaveBeenCalledWith('Untitled');
    expect(localStorage.getItem('gluon-active-project')).toBe('recovery');
  });

  it('surfaces project load failures without switching away from the current project', async () => {
    localStorage.setItem('gluon-active-project', 'p1');
    loadProject.mockImplementation(async (id: string) => {
      if (id === 'p1') return { id: 'p1', meta: { id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }, session };
      return null;
    });
    listProjects.mockResolvedValue([{ id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }]);

    const setSession = vi.fn();
    const { result } = renderHook(() => useProjectLifecycle(session, setSession));
    await waitFor(() => expect(result.current.projectId).toBe('p1'));

    await act(async () => {
      await result.current.switchProject('missing');
    });

    expect(result.current.projectId).toBe('p1');
    expect(result.current.projectActionError).toBe('Project missing could not be loaded.');
  });

  it('exports the in-memory session even when persistence is degraded', async () => {
    const originalCreateElement = document.createElement.bind(document);
    const anchor = {
      click: vi.fn(),
      href: '',
      download: '',
    } as unknown as HTMLAnchorElement;
    const createObjectURL = vi.fn(() => 'blob:gluon');
    const revokeObjectURL = vi.fn();
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'a') return anchor;
      return originalCreateElement(tagName);
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    listProjects.mockRejectedValue(new Error('IndexedDB down'));
    createProject.mockRejectedValue(new Error('IndexedDB down'));
    migrateLegacySession.mockRejectedValue(new Error('IndexedDB down'));

    const setSession = vi.fn();
    const { result } = renderHook(() => useProjectLifecycle(session, setSession));
    await waitFor(() => expect(result.current.saveError).toBe(true));

    await act(async () => {
      await result.current.exportActiveProject();
    });

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const json = await blob.text();
    expect(JSON.parse(json)).toEqual({
      format: 'gluon-project',
      version: CURRENT_VERSION,
      name: 'Untitled',
      exportedAt: expect.any(Number),
      session: stripForPersistence(session),
    });
    expect(anchor.click).toHaveBeenCalledOnce();

    createElementSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('falls back to legacy localStorage autosave when IndexedDB is unavailable', async () => {
    vi.useFakeTimers();

    listProjects.mockRejectedValue(new Error('IndexedDB down'));
    createProject.mockRejectedValue(new Error('IndexedDB down'));
    migrateLegacySession.mockRejectedValue(new Error('IndexedDB down'));

    const setSession = vi.fn();
    const initialSession = createSession();
    const degradedSession = {
      ...initialSession,
      transport: {
        ...initialSession.transport,
        bpm: 133,
      },
      messages: [{ role: 'human' as const, text: 'persist me', timestamp: 1 }],
    };

    const { result, rerender } = renderHook(
      ({ session }) => useProjectLifecycle(session, setSession),
      { initialProps: { session: initialSession } },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.saveError).toBe(true);

    rerender({ session: degradedSession });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.transport.bpm).toBe(133);
    expect(loaded!.messages).toEqual([{ role: 'human', text: 'persist me', timestamp: 1 }]);

    vi.useRealTimers();
  });

  it('imports a project and switches to it', async () => {
    localStorage.setItem('gluon-active-project', 'p1');
    loadProject.mockImplementation(async (id: string) => {
      if (id === 'p1') return { id: 'p1', meta: { id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }, session };
      if (id === 'imported') return { id: 'imported', meta: { id: 'imported', name: 'Imported', createdAt: 3, updatedAt: 4 }, session: altSession };
      return null;
    });
    listProjects.mockResolvedValue([{ id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }]);

    const file = new File([JSON.stringify({ ok: true })], 'import.gluon', { type: 'application/json' });
    const setSession = vi.fn();
    const { result } = renderHook(() => useProjectLifecycle(session, setSession));
    await waitFor(() => expect(result.current.projectId).toBe('p1'));

    await act(async () => {
      await result.current.importProject(file);
    });

    expect(importProject).toHaveBeenCalledWith(JSON.stringify({ ok: true }));
    expect(result.current.projectId).toBe('imported');
    expect(result.current.projectName).toBe('Imported');
  });

  it('surfaces import failures without changing the active project', async () => {
    localStorage.setItem('gluon-active-project', 'p1');
    loadProject.mockResolvedValue({ id: 'p1', meta: { id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }, session });
    listProjects.mockResolvedValue([{ id: 'p1', name: 'One', createdAt: 1, updatedAt: 2 }]);
    importProject.mockRejectedValue(new Error('Bad project file'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const file = new File(['bad'], 'broken.gluon', { type: 'application/json' });
    const setSession = vi.fn();
    const { result } = renderHook(() => useProjectLifecycle(session, setSession));
    await waitFor(() => expect(result.current.projectId).toBe('p1'));

    await act(async () => {
      await result.current.importProject(file);
    });

    expect(result.current.projectId).toBe('p1');
    expect(result.current.projectActionError).toBe('Bad project file');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
