// src/engine/project-store.ts
// IndexedDB-backed multi-project storage.
import type { Session } from './types';
import { createSession } from './session';
import { loadSession as loadLegacySession, stripForPersistence, isValidSession, CURRENT_VERSION, migrateTrack } from './persistence';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedProject {
  id: string;
  version: number;
  meta: ProjectMeta;
  session: Session;
}

const DB_NAME = 'gluon';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

// --- IndexedDB helpers ---

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'meta.updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// --- Public API ---

export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await openDB();
  const all = await req<PersistedProject[]>(tx(db, 'readonly').getAll());
  db.close();
  return all
    .map(p => p.meta)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<PersistedProject | null> {
  const db = await openDB();
  const result = await req<PersistedProject | undefined>(tx(db, 'readonly').get(id));
  db.close();
  if (!result) return null;
  // Reject future versions we don't know how to read
  if (result.version > CURRENT_VERSION) return null;
  // Validate session shape
  if (!isValidSession(result.session)) return null;
  return result;
}

export async function saveProject(id: string, name: string, session: Session): Promise<void> {
  const db = await openDB();
  const existing = await req<PersistedProject | undefined>(tx(db, 'readonly').get(id));
  const now = Date.now();
  const project: PersistedProject = {
    id,
    version: CURRENT_VERSION,
    meta: {
      id,
      name,
      createdAt: existing?.meta.createdAt ?? now,
      updatedAt: now,
    },
    session: stripForPersistence(session),
  };
  await req(tx(db, 'readwrite').put(project));
  db.close();
}

export async function createProject(name?: string): Promise<{ id: string; session: Session }> {
  const id = crypto.randomUUID();
  const session = createSession();
  const projectName = name ?? 'Untitled';
  await saveProject(id, projectName, session);
  return { id, session };
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDB();
  await req(tx(db, 'readwrite').delete(id));
  db.close();
}

export async function renameProject(id: string, name: string): Promise<void> {
  const db = await openDB();
  const store = tx(db, 'readwrite');
  const existing = await req<PersistedProject | undefined>(store.get(id));
  if (existing) {
    existing.meta.name = name;
    existing.meta.updatedAt = Date.now();
    await req(store.put(existing));
  }
  db.close();
}

export async function duplicateProject(id: string, newName?: string): Promise<string> {
  const db = await openDB();
  const existing = await req<PersistedProject | undefined>(tx(db, 'readonly').get(id));
  db.close();
  if (!existing) throw new Error(`Project ${id} not found`);
  const newId = crypto.randomUUID();
  const name = newName ?? `${existing.meta.name} (copy)`;
  await saveProject(newId, name, existing.session);
  return newId;
}

export async function exportProject(id: string): Promise<string> {
  const db = await openDB();
  const project = await req<PersistedProject | undefined>(tx(db, 'readonly').get(id));
  db.close();
  if (!project) throw new Error(`Project ${id} not found`);
  return JSON.stringify({
    format: 'gluon-project',
    version: CURRENT_VERSION,
    name: project.meta.name,
    exportedAt: Date.now(),
    session: project.session,
  }, null, 2);
}

export async function importProject(json: string): Promise<{ id: string; name: string }> {
  let parsed: { format?: string; version?: number; name?: string; session?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON file');
  }
  if (parsed.format !== 'gluon-project') {
    throw new Error('Not a Gluon project file');
  }
  if (!parsed.session || typeof parsed.session !== 'object') {
    throw new Error('Project file has no session data');
  }
  if (typeof parsed.version === 'number' && parsed.version > CURRENT_VERSION) {
    throw new Error(`Project was saved with a newer version (v${parsed.version}). Update Gluon to open it.`);
  }
  if (!isValidSession(parsed.session)) {
    throw new Error('Project file contains invalid session data');
  }

  const id = crypto.randomUUID();
  // Check for name collision and suffix if needed
  const projects = await listProjects();
  let name = parsed.name ?? 'Imported';
  if (projects.some(p => p.name === name)) {
    name = `${name} (imported)`;
  }
  const migratedSession: Session = {
    ...(parsed.session as Session),
    tracks: (parsed.session as Session).tracks.map(migrateTrack),
  };
  await saveProject(id, name, migratedSession);
  return { id, name };
}

/**
 * One-time migration: if IndexedDB is empty and localStorage has a session,
 * migrate it as "Recovered Session". Deletes localStorage key on success.
 */
export async function migrateLegacySession(): Promise<{ id: string; session: Session } | null> {
  const projects = await listProjects();
  if (projects.length > 0) return null;

  const legacy = loadLegacySession();
  if (!legacy) return null;

  const id = crypto.randomUUID();
  await saveProject(id, 'Recovered Session', legacy);

  // Mark migration complete by removing the old key
  try { localStorage.removeItem('gluon-session'); } catch { /* ignore */ }

  return { id, session: legacy };
}
