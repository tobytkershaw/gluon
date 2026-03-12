// src/engine/persistence.ts
import type { Session } from './types';
import { createSession } from './session';

const STORAGE_KEY = 'gluon-session';
const VERSION = 1;

interface PersistedSession {
  version: number;
  session: Session;
  savedAt: number;
}

/** Strip undo stack (contains closures) and recentHumanActions before saving. */
function stripForPersistence(session: Session): Session {
  return {
    ...session,
    undoStack: [],
    recentHumanActions: [],
    // Always persist transport as stopped to avoid auto-playing on reload
    transport: { ...session.transport, playing: false },
  };
}

/** Check whether a session differs from the default enough to be worth saving. */
function isNonDefault(session: Session): boolean {
  const defaults = createSession();
  // If there are messages, params have changed, or agency has been toggled — save.
  if (session.messages.length > 0) return true;
  if (session.transport.bpm !== defaults.transport.bpm) return true;
  if (session.transport.swing !== defaults.transport.swing) return true;
  for (let i = 0; i < session.voices.length; i++) {
    const v = session.voices[i];
    const d = defaults.voices[i];
    if (!v || !d) continue;
    if (v.agency !== d.agency) return true;
    if (v.model !== d.model) return true;
    if (v.muted !== d.muted || v.solo !== d.solo) return true;
    if (v.params.timbre !== d.params.timbre || v.params.morph !== d.params.morph) return true;
    if (v.params.harmonics !== d.params.harmonics || v.params.note !== d.params.note) return true;
  }
  return false;
}

/** Validate that a loaded object looks like a Session. */
function isValidSession(obj: unknown): obj is Session {
  if (typeof obj !== 'object' || obj === null) return false;
  const s = obj as Record<string, unknown>;
  return (
    Array.isArray(s.voices) &&
    s.voices.length > 0 &&
    typeof s.activeVoiceId === 'string' &&
    typeof s.transport === 'object' &&
    s.transport !== null &&
    Array.isArray(s.messages)
  );
}

export function saveSession(session: Session): void {
  if (!isNonDefault(session)) return;
  try {
    const data: PersistedSession = {
      version: VERSION,
      session: stripForPersistence(session),
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data: PersistedSession = JSON.parse(raw);
    if (data.version !== VERSION) return null;
    if (!isValidSession(data.session)) return null;
    // Ensure undo stack and human actions are clean on load
    return {
      ...data.session,
      undoStack: [],
      recentHumanActions: data.session.recentHumanActions ?? [],
    };
  } catch {
    return null;
  }
}

export function clearSavedSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
