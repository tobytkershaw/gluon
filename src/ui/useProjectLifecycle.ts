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
import { restoreSession } from '../engine/persistence';

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
  /** Granular save status */
  saveStatus: SaveStatus;
  /** Last user-visible project lifecycle error */
  projectActionError: string | null;
  /** Create a new project and switch to it */
  createProject: (name?: string) => Promise<boolean>;
  /** Switch to a different project */
  switchProject: (id: string) => Promise<boolean>;
  /** Rename the active project */
  renameActiveProject: (name: string) => Promise<boolean>;
  /** Duplicate the active project */
  duplicateActiveProject: () => Promise<boolean>;
  /** Delete the active project */
  deleteActiveProject: () => Promise<boolean>;
  /** Export the active project as a .gluon JSON file */
  exportActiveProject: () => Promise<boolean>;
  /** Import a .gluon JSON file */
  importProject: (file: File) => Promise<boolean>;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useProjectLifecycle(
  session: Session,
  setSession: (s: Session | ((prev: Session) => Session)) => void,
): ProjectLifecycle {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Untitled');
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [projectActionError, setProjectActionError] = useState<string | null>(null);

  // Guard: suppress auto-save during load/switch
  const loadingRef = useRef(true);
  const loadRequestRef = useRef(0);
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

  const setActionError = useCallback((fallback: string, err?: unknown) => {
    if (err instanceof Error && err.message) {
      setProjectActionError(err.message);
      return;
    }
    setProjectActionError(fallback);
  }, []);

  const persistCurrentProjectIfNeeded = useCallback(async () => {
    if (!projectIdRef.current) return true;
    try {
      await saveProject(projectIdRef.current, projectNameRef.current, sessionRef.current);
      return true;
    } catch {
      setActionError('Failed to save the current project before continuing.');
      return false;
    }
  }, [setActionError]);

  const loadProjectById = useCallback(async (id: string) => {
    const requestId = ++loadRequestRef.current;
    loadingRef.current = true;
    try {
      const project = await loadProject(id);
      if (requestId !== loadRequestRef.current) return false;
      if (!project) {
        setActionError(`Project ${id} could not be loaded.`);
        return false;
      }
      setProjectId(project.id);
      setProjectName(project.meta.name);
      setSession(restoreSession(project.session, project.version));
      localStorage.setItem(ACTIVE_KEY, project.id);
      setProjectActionError(null);
      await refreshProjects();
      return true;
    } catch (err) {
      if (requestId === loadRequestRef.current) {
        setActionError(`Failed to load project ${id}.`, err);
      }
      return false;
    } finally {
      if (requestId === loadRequestRef.current) {
        loadingRef.current = false;
      }
    }
  }, [refreshProjects, setSession, setActionError]);

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
            setSession(restoreSession(project.session, project.version));
            localStorage.setItem(ACTIVE_KEY, project.id);
            setProjectActionError(null);
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
          setProjectActionError(null);
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
          setProjectActionError(null);
          await refreshProjects();
          loadingRef.current = false;
        }
      } catch {
        // IndexedDB unavailable — work in memory
        if (!cancelled) {
          setSaveStatus('error');
          setProjectActionError(null);
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
      setSaveStatus('saving');
      try {
        await saveProject(projectId, projectNameRef.current, session);
        failureCountRef.current = 0;
        setSaveStatus('saved');
      } catch {
        failureCountRef.current++;
        if (failureCountRef.current >= MAX_SAVE_FAILURES) {
          setSaveStatus('error');
        } else {
          // Revert to previous non-error state on transient failure
          setSaveStatus('saved');
        }
      }
    }, AUTOSAVE_DELAY);

    return () => clearTimeout(timer);
  }, [session, projectId]);

  // --- Actions ---

  const createProjectAction = useCallback(async (name?: string) => {
    if (!(await persistCurrentProjectIfNeeded())) return false;

    loadingRef.current = true;
    const requestId = ++loadRequestRef.current;
    try {
      const { id, session: newSession } = await createProjectInDB(name);
      if (requestId !== loadRequestRef.current) return false;
      setProjectId(id);
      setProjectName(name ?? 'Untitled');
      setSession(restoreSession(newSession));
      localStorage.setItem(ACTIVE_KEY, id);
      setProjectActionError(null);
      await refreshProjects();
      return true;
    } catch (err) {
      if (requestId === loadRequestRef.current) setActionError('Failed to create a project.', err);
      return false;
    } finally {
      if (requestId === loadRequestRef.current) loadingRef.current = false;
    }
  }, [persistCurrentProjectIfNeeded, setActionError, refreshProjects, setSession]);

  const switchProjectAction = useCallback(async (id: string) => {
    if (!(await persistCurrentProjectIfNeeded())) return false;
    return loadProjectById(id);
  }, [loadProjectById, persistCurrentProjectIfNeeded]);

  const renameActiveProjectAction = useCallback(async (name: string) => {
    if (!projectIdRef.current) return false;
    try {
      setProjectName(name);
      await renameProjectInDB(projectIdRef.current, name);
      setProjectActionError(null);
      await refreshProjects();
      return true;
    } catch (err) {
      setActionError('Failed to rename the project.', err);
      return false;
    }
  }, [refreshProjects, setActionError]);

  const duplicateActiveProjectAction = useCallback(async () => {
    if (!projectIdRef.current) return false;
    if (!(await persistCurrentProjectIfNeeded())) return false;
    try {
      const newId = await duplicateProjectInDB(projectIdRef.current);
      return loadProjectById(newId);
    } catch (err) {
      setActionError('Failed to duplicate the project.', err);
      return false;
    }
  }, [loadProjectById, persistCurrentProjectIfNeeded]);

  const deleteActiveProjectAction = useCallback(async () => {
    if (!projectIdRef.current) return false;
    const idToDelete = projectIdRef.current;
    try {
      await deleteProjectInDB(idToDelete);
    } catch (err) {
      setActionError('Failed to delete the project.', err);
      return false;
    }

    // Deletion is terminal. Clear save-path refs before loading a replacement
    // so the just-deleted project cannot be recreated by a save-before-switch.
    projectIdRef.current = null;
    setProjectId(null);
    localStorage.removeItem(ACTIVE_KEY);

    // Switch to most recent remaining, or create new
    const remaining = await listProjects();
    if (remaining.length > 0) {
      return loadProjectById(remaining[0].id);
    } else {
      loadingRef.current = true;
      const requestId = ++loadRequestRef.current;
      try {
        const { id, session: newSession } = await createProjectInDB('Untitled');
        if (requestId !== loadRequestRef.current) return false;
        setProjectId(id);
        setProjectName('Untitled');
        setSession(restoreSession(newSession));
        localStorage.setItem(ACTIVE_KEY, id);
        setProjectActionError(null);
        await refreshProjects();
        return true;
      } catch (err) {
        if (requestId === loadRequestRef.current) {
          setActionError('Failed to create a replacement project.', err);
        }
        return false;
      } finally {
        if (requestId === loadRequestRef.current) loadingRef.current = false;
      }
    }
  }, [setActionError, setSession, loadProjectById, refreshProjects]);

  const exportActiveProjectAction = useCallback(async () => {
    if (!projectIdRef.current) return false;
    if (!(await persistCurrentProjectIfNeeded())) return false;
    try {
      const json = await exportProjectInDB(projectIdRef.current);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectNameRef.current.replace(/[^a-zA-Z0-9_-]/g, '_')}.gluon`;
      a.click();
      URL.revokeObjectURL(url);
      setProjectActionError(null);
      return true;
    } catch (err) {
      setActionError('Failed to export the project.', err);
      return false;
    }
  }, [persistCurrentProjectIfNeeded, setActionError]);

  const importProjectAction = useCallback(async (file: File) => {
    try {
      const json = await file.text();
      const { id } = await importProjectInDB(json);
      return switchProjectAction(id);
    } catch (err) {
      // Surface error without crashing — current project is unaffected
      setActionError('Failed to import the project.', err);
      console.error('[project] Import failed:', err);
      return false;
    }
  }, [setActionError, switchProjectAction]);

  return {
    projectId,
    projectName,
    projects,
    saveError: saveStatus === 'error',
    saveStatus,
    projectActionError,
    createProject: createProjectAction,
    switchProject: switchProjectAction,
    renameActiveProject: renameActiveProjectAction,
    duplicateActiveProject: duplicateActiveProjectAction,
    deleteActiveProject: deleteActiveProjectAction,
    exportActiveProject: exportActiveProjectAction,
    importProject: importProjectAction,
  };
}
