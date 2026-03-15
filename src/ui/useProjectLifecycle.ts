// src/ui/useProjectLifecycle.ts
// Project lifecycle hook — load/save/switch/create/delete projects via IndexedDB.
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '../engine/types';
import { createSession } from '../engine/session';
import {
  listProjects, loadProject, saveProject, createProject as createProjectInDB,
  deleteProject as deleteProjectInDB, renameProject as renameProjectInDB,
  duplicateProject as duplicateProjectInDB, exportProject as exportProjectInDB,
  importProject as importProjectInDB, migrateLegacySession,
  type ProjectMeta,
} from '../engine/project-store';
import { migrateTrack } from '../engine/persistence';
import { DEFAULT_MASTER } from '../engine/types';

const ACTIVE_KEY = 'gluon-active-project';
const AUTOSAVE_DELAY = 500;
const MAX_SAVE_FAILURES = 3;

interface ProjectLifecycle {
  /** Current project ID (null during initial load) */
  projectId: string | null;
  /** Current project name */
  projectName: string;
  /** List of all projects (refreshed on changes) */
  projects: ProjectMeta[];
  /** Whether persistence is degraded (IndexedDB failures) */
  saveError: boolean;
  /** Create a new project and switch to it */
  createProject: (name?: string) => Promise<void>;
  /** Switch to a different project */
  switchProject: (id: string) => Promise<void>;
  /** Rename the active project */
  renameActiveProject: (name: string) => Promise<void>;
  /** Duplicate the active project */
  duplicateActiveProject: () => Promise<void>;
  /** Delete the active project */
  deleteActiveProject: () => Promise<void>;
  /** Export the active project as a .gluon JSON file */
  exportActiveProject: () => Promise<void>;
  /** Import a .gluon JSON file */
  importProject: (file: File) => Promise<void>;
}

export function useProjectLifecycle(
  session: Session,
  setSession: (s: Session | ((prev: Session) => Session)) => void,
): ProjectLifecycle {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Untitled');
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [saveError, setSaveError] = useState(false);

  // Guard: suppress auto-save during load/switch
  const loadingRef = useRef(true);
  const failureCountRef = useRef(0);
  const sessionRef = useRef(session);
  const projectIdRef = useRef(projectId);
  const projectNameRef = useRef(projectName);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);
  useEffect(() => {
    projectNameRef.current = projectName;
  }, [projectName]);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch { /* ignore */ }
  }, []);

  const persistCurrentProjectIfNeeded = useCallback(async () => {
    if (!projectIdRef.current) return;
    try {
      await saveProject(projectIdRef.current, projectNameRef.current, sessionRef.current);
    } catch {
      // Best effort only. Explicit lifecycle actions should still proceed.
    }
  }, []);

  const loadProjectById = useCallback(async (id: string) => {
    loadingRef.current = true;
    try {
      const project = await loadProject(id);
      if (!project) return;
      setProjectId(project.id);
      setProjectName(project.meta.name);
      setSession(restoreSession(project.session));
      localStorage.setItem(ACTIVE_KEY, project.id);
      await refreshProjects();
    } finally {
      loadingRef.current = false;
    }
  }, [refreshProjects, setSession]);

  // --- Initial load ---
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // 1. Try active project from localStorage
        const savedId = localStorage.getItem(ACTIVE_KEY);
        if (savedId) {
          const project = await loadProject(savedId);
          if (project && !cancelled) {
            setProjectId(project.id);
            setProjectName(project.meta.name);
            setSession(restoreSession(project.session));
            localStorage.setItem(ACTIVE_KEY, project.id);
            await refreshProjects();
            loadingRef.current = false;
            return;
          }
        }

        // 2. Try legacy localStorage migration
        const migrated = await migrateLegacySession();
        if (migrated && !cancelled) {
          setProjectId(migrated.id);
          setProjectName('Recovered Session');
          setSession(restoreSession(migrated.session));
          localStorage.setItem(ACTIVE_KEY, migrated.id);
          await refreshProjects();
          loadingRef.current = false;
          return;
        }

        // 3. Create new project
        if (!cancelled) {
          const { id, session: newSession } = await createProjectInDB('Untitled');
          setProjectId(id);
          setProjectName('Untitled');
          setSession(restoreSession(newSession));
          localStorage.setItem(ACTIVE_KEY, id);
          await refreshProjects();
          loadingRef.current = false;
        }
      } catch {
        // IndexedDB unavailable — work in memory
        if (!cancelled) {
          setSaveError(true);
          setSession(createSession());
          loadingRef.current = false;
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Auto-save (debounced) ---
  useEffect(() => {
    if (loadingRef.current || !projectId) return;

    const timer = setTimeout(async () => {
      try {
        await saveProject(projectId, projectNameRef.current, session);
        failureCountRef.current = 0;
        setSaveError(false);
      } catch {
        failureCountRef.current++;
        if (failureCountRef.current >= MAX_SAVE_FAILURES) {
          setSaveError(true);
        }
      }
    }, AUTOSAVE_DELAY);

    return () => clearTimeout(timer);
  }, [session, projectId]);

  // --- Actions ---

  const createProjectAction = useCallback(async (name?: string) => {
    await persistCurrentProjectIfNeeded();

    loadingRef.current = true;
    const { id, session: newSession } = await createProjectInDB(name);
    setProjectId(id);
    setProjectName(name ?? 'Untitled');
    setSession(restoreSession(newSession));
    localStorage.setItem(ACTIVE_KEY, id);
    await refreshProjects();
    loadingRef.current = false;
  }, [persistCurrentProjectIfNeeded, setSession, refreshProjects]);

  const switchProjectAction = useCallback(async (id: string) => {
    await persistCurrentProjectIfNeeded();
    await loadProjectById(id);
  }, [loadProjectById, persistCurrentProjectIfNeeded]);

  const renameActiveProjectAction = useCallback(async (name: string) => {
    if (!projectIdRef.current) return;
    setProjectName(name);
    await renameProjectInDB(projectIdRef.current, name);
    await refreshProjects();
  }, [refreshProjects]);

  const duplicateActiveProjectAction = useCallback(async () => {
    if (!projectIdRef.current) return;
    await persistCurrentProjectIfNeeded();
    const newId = await duplicateProjectInDB(projectIdRef.current);
    await loadProjectById(newId);
  }, [loadProjectById, persistCurrentProjectIfNeeded]);

  const deleteActiveProjectAction = useCallback(async () => {
    if (!projectIdRef.current) return;
    const idToDelete = projectIdRef.current;
    await deleteProjectInDB(idToDelete);

    // Deletion is terminal. Clear save-path refs before loading a replacement
    // so the just-deleted project cannot be recreated by a save-before-switch.
    projectIdRef.current = null;
    setProjectId(null);
    localStorage.removeItem(ACTIVE_KEY);

    // Switch to most recent remaining, or create new
    const remaining = await listProjects();
    if (remaining.length > 0) {
      await loadProjectById(remaining[0].id);
    } else {
      loadingRef.current = true;
      const { id, session: newSession } = await createProjectInDB('Untitled');
      setProjectId(id);
      setProjectName('Untitled');
      setSession(restoreSession(newSession));
      localStorage.setItem(ACTIVE_KEY, id);
      await refreshProjects();
      loadingRef.current = false;
    }
  }, [setSession, loadProjectById, refreshProjects]);

  const exportActiveProjectAction = useCallback(async () => {
    if (!projectIdRef.current) return;
    await persistCurrentProjectIfNeeded();
    const json = await exportProjectInDB(projectIdRef.current);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectNameRef.current.replace(/[^a-zA-Z0-9_-]/g, '_')}.gluon`;
    a.click();
    URL.revokeObjectURL(url);
  }, [persistCurrentProjectIfNeeded]);

  const importProjectAction = useCallback(async (file: File) => {
    try {
      const json = await file.text();
      const { id } = await importProjectInDB(json);
      await switchProjectAction(id);
    } catch (err) {
      // Surface error without crashing — current project is unaffected
      console.error('[project] Import failed:', err);
      throw err;
    }
  }, [switchProjectAction]);

  return {
    projectId,
    projectName,
    projects,
    saveError,
    createProject: createProjectAction,
    switchProject: switchProjectAction,
    renameActiveProject: renameActiveProjectAction,
    duplicateActiveProject: duplicateActiveProjectAction,
    deleteActiveProject: deleteActiveProjectAction,
    exportActiveProject: exportActiveProjectAction,
    importProject: importProjectAction,
  };
}

/** Restore transient fields and run track migration on load. */
function restoreSession(session: Session): Session {
  return {
    ...session,
    tracks: session.tracks.map(migrateTrack),
    master: session.master ?? { ...DEFAULT_MASTER },
    undoStack: session.undoStack ?? [],
    recentHumanActions: session.recentHumanActions ?? [],
  };
}
