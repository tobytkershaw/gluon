// tests/engine/persistence.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { saveSession, loadSession, clearSavedSession } from '../../src/engine/persistence';
import { createSession } from '../../src/engine/session';
import { createDefaultPattern } from '../../src/engine/sequencer-helpers';

// Mock localStorage for Node/Vitest environment
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  },
  writable: true,
});

describe('persistence', () => {
  beforeEach(() => {
    store.clear();
  });

  it('round-trips a modified session through save and load', () => {
    const session = createSession();
    // Modify something so it's non-default and worth saving
    const modified = {
      ...session,
      messages: [{ role: 'human' as const, text: 'hello', timestamp: 1 }],
      transport: { ...session.transport, bpm: 140 },
    };
    saveSession(modified);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.transport.bpm).toBe(140);
    expect(loaded!.messages).toHaveLength(1);
    expect(loaded!.messages[0].text).toBe('hello');
    // Undo stack should be empty after load
    expect(loaded!.undoStack).toEqual([]);
    // Transport should be stopped
    expect(loaded!.transport.playing).toBe(false);
  });

  it('returns null when no saved session exists', () => {
    expect(loadSession()).toBeNull();
  });

  it('returns null for corrupt data', () => {
    store.set('gluon-session', 'not valid json{{{');
    expect(loadSession()).toBeNull();
  });

  it('returns null for wrong version', () => {
    store.set('gluon-session', JSON.stringify({ version: 999, session: {}, savedAt: 1 }));
    expect(loadSession()).toBeNull();
  });

  it('returns null for invalid session shape', () => {
    store.set('gluon-session', JSON.stringify({
      version: 1,
      session: { voices: 'not-an-array' },
      savedAt: 1,
    }));
    expect(loadSession()).toBeNull();
  });

  it('does not save a default (unmodified) session', () => {
    const session = createSession();
    saveSession(session);
    expect(loadSession()).toBeNull();
  });

  it('clearSavedSession removes the stored data', () => {
    const session = createSession();
    const modified = {
      ...session,
      messages: [{ role: 'human' as const, text: 'test', timestamp: 1 }],
    };
    saveSession(modified);
    expect(loadSession()).not.toBeNull();
    clearSavedSession();
    expect(loadSession()).toBeNull();
  });

  it('saves session when pattern has been edited (gate enabled)', () => {
    const session = createSession();
    const modified = {
      ...session,
      voices: session.voices.map((v, i) =>
        i === 0
          ? {
              ...v,
              pattern: {
                ...v.pattern,
                steps: v.pattern.steps.map((s, j) =>
                  j === 0 ? { ...s, gate: true } : s,
                ),
              },
            }
          : v,
      ),
    };
    saveSession(modified);
    expect(loadSession()).not.toBeNull();
  });

  it('saves session when pattern has been edited (accent enabled)', () => {
    const session = createSession();
    const modified = {
      ...session,
      voices: session.voices.map((v, i) =>
        i === 0
          ? {
              ...v,
              pattern: {
                ...v.pattern,
                steps: v.pattern.steps.map((s, j) =>
                  j === 2 ? { ...s, accent: true } : s,
                ),
              },
            }
          : v,
      ),
    };
    saveSession(modified);
    expect(loadSession()).not.toBeNull();
  });

  it('saves session when pattern has non-zero micro timing', () => {
    const session = createSession();
    const modified = {
      ...session,
      voices: session.voices.map((v, i) =>
        i === 1
          ? {
              ...v,
              pattern: {
                ...v.pattern,
                steps: v.pattern.steps.map((s, j) =>
                  j === 0 ? { ...s, micro: 0.3 } : s,
                ),
              },
            }
          : v,
      ),
    };
    saveSession(modified);
    expect(loadSession()).not.toBeNull();
  });

  it('saves session when pattern length differs from default', () => {
    const session = createSession();
    const modified = {
      ...session,
      voices: session.voices.map((v, i) =>
        i === 0 ? { ...v, pattern: createDefaultPattern(8) } : v,
      ),
    };
    saveSession(modified);
    expect(loadSession()).not.toBeNull();
  });

  it('strips undo stack on save', () => {
    const session = createSession();
    const withUndo = {
      ...session,
      messages: [{ role: 'human' as const, text: 'x', timestamp: 1 }],
      undoStack: [{
        kind: 'param' as const,
        voiceId: 'v0',
        prevValues: { timbre: 0.5 },
        aiTargetValues: { timbre: 0.8 },
        timestamp: 1,
        description: 'test',
      }],
    };
    saveSession(withUndo);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.undoStack).toEqual([]);
  });
});
