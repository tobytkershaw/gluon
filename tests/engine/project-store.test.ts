import { beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../../src/engine/session';
import { loadSession, restoreSession, saveSession } from '../../src/engine/persistence';
import {
  exportProject,
  importProject,
  listProjects,
  loadProject,
  renameProject,
  saveProject,
} from '../../src/engine/project-store';
import { MASTER_BUS_ID } from '../../src/engine/types';

type StoredProject = {
  id: string;
  version: number;
  meta: { id: string; name: string; createdAt: number; updatedAt: number };
  session: ReturnType<typeof createSession>;
};

const dbState = new Map<string, StoredProject>();

function makeRequest<T>(executor: (request: {
  result?: T;
  error?: unknown;
  onsuccess: null | (() => void);
  onerror: null | (() => void);
}) => void) {
  const request = {
    result: undefined as T | undefined,
    error: undefined as unknown,
    onsuccess: null as null | (() => void),
    onerror: null as null | (() => void),
  };
  queueMicrotask(() => executor(request));
  return request;
}

function installFakeIndexedDb() {
  const indexedDB = {
    open: () => {
      const request = {
        result: {
          objectStoreNames: {
            contains: () => true,
          },
          createObjectStore: () => ({
            createIndex: () => undefined,
          }),
          transaction: () => ({
            objectStore: () => ({
              getAll: () => makeRequest<StoredProject[]>((req) => {
                req.result = Array.from(dbState.values());
                req.onsuccess?.();
              }),
              get: (id: string) => makeRequest<StoredProject | undefined>((req) => {
                req.result = dbState.get(id);
                req.onsuccess?.();
              }),
              put: (value: StoredProject) => makeRequest<StoredProject>((req) => {
                dbState.set(value.id, structuredClone(value));
                req.result = value;
                req.onsuccess?.();
              }),
              delete: (id: string) => makeRequest<undefined>((req) => {
                dbState.delete(id);
                req.result = undefined;
                req.onsuccess?.();
              }),
            }),
          }),
          close: () => undefined,
        },
        error: undefined as unknown,
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
        onupgradeneeded: null as null | (() => void),
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };

  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: indexedDB,
  });
}

const localStorageState = new Map<string, string>();

describe('project-store', () => {
  beforeEach(() => {
    dbState.clear();
    localStorageState.clear();
    installFakeIndexedDb();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => localStorageState.get(key) ?? null,
        setItem: (key: string, value: string) => localStorageState.set(key, value),
        removeItem: (key: string) => localStorageState.delete(key),
        clear: () => localStorageState.clear(),
      },
    });
  });

  it('round-trips a saved project through list/load and matches the legacy restore path', async () => {
    const session = createSession();
    const modified = {
      ...session,
      messages: [{ role: 'human' as const, text: 'persist me', timestamp: 1 }],
      transport: { ...session.transport, bpm: 132 },
    };

    await saveProject('p1', 'Project One', modified);

    const projects = await listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe('Project One');

    const project = await loadProject('p1');
    expect(project).not.toBeNull();

    saveSession(modified);
    const legacyLoaded = loadSession();
    const projectLoaded = restoreSession(project!.session, project!.version);

    expect(projectLoaded).toEqual(legacyLoaded);
  });

  it('exports and re-imports a project with a name collision and preserves normalized session state', async () => {
    const session = createSession();
    const modified = {
      ...session,
      messages: [{ role: 'human' as const, text: 'export me', timestamp: 1 }],
    };

    await saveProject('p1', 'Project One', modified);
    const exported = await exportProject('p1');
    const imported = await importProject(exported);

    expect(imported.name).toBe('Project One (imported)');

    const importedProject = await loadProject(imported.id);
    expect(importedProject).not.toBeNull();
    expect(importedProject!.session.tracks.some(track => track.id === MASTER_BUS_ID)).toBe(true);

    const restoredImported = restoreSession(importedProject!.session, importedProject!.version);
    const restoredOriginal = restoreSession((await loadProject('p1'))!.session, (await loadProject('p1'))!.version);
    expect(restoredImported).toEqual(restoredOriginal);
  });

  it('imports an older project file and preserves restore invariants across the stored project path', async () => {
    const session = createSession();
    const legacyJson = JSON.stringify({
      format: 'gluon-project',
      version: 5,
      name: 'Legacy',
      session: {
        ...session,
        tracks: session.tracks.filter(track => track.id !== MASTER_BUS_ID),
        transport: {
          ...session.transport,
          status: undefined,
          metronome: undefined,
          timeSignature: undefined,
          mode: undefined,
        },
        undoStack: [{
          kind: 'param',
          trackId: 'v0',
          prevValues: { timbre: 0.1 },
          aiTargetValues: { timbre: 0.9 },
          timestamp: 1,
          description: 'legacy',
        }],
        redoStack: [{
          kind: 'param',
          trackId: 'v0',
          prevValues: { morph: 0.2 },
          aiTargetValues: { morph: 0.8 },
          timestamp: 2,
          description: 'legacy-redo',
        }],
        reactionHistory: undefined,
        openDecisions: undefined,
      },
    });

    const imported = await importProject(legacyJson);
    const loaded = await loadProject(imported.id);
    expect(loaded).not.toBeNull();

    const restored = restoreSession(loaded!.session, loaded!.version);
    expect(restored.tracks.some(track => track.id === MASTER_BUS_ID)).toBe(true);
    expect(restored.undoStack).toEqual([]);
    expect(restored.redoStack).toEqual([]);
    expect(restored.reactionHistory).toEqual([]);
    expect(restored.openDecisions).toEqual([]);
    expect(restored.transport.status).toBe('stopped');
    expect(restored.transport.metronome).toEqual({ enabled: false, volume: 0.5 });
    expect(restored.transport.timeSignature).toEqual({ numerator: 4, denominator: 4 });
    expect(restored.transport.mode).toBe('pattern');
  });

  it('keeps listProjects sorted by updatedAt after rename', async () => {
    const session = createSession();
    const modified = {
      ...session,
      messages: [{ role: 'human' as const, text: 'sort me', timestamp: 1 }],
    };

    await saveProject('p1', 'One', modified);
    await saveProject('p2', 'Two', modified);
    await renameProject('p1', 'One renamed');

    const projects = await listProjects();
    expect(projects).toHaveLength(2);
    expect(projects[0]?.id).toBe('p1');
    expect(projects[0]?.name).toBe('One renamed');
    expect(projects[1]?.id).toBe('p2');
  });
});
