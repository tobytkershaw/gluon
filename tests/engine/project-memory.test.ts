// tests/engine/project-memory.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { saveSession, loadSession, clearSavedSession, restoreSession } from '../../src/engine/persistence';
import { createSession } from '../../src/engine/session';
import { applyUndo, applyRedo } from '../../src/engine/primitives';
import {
  MAX_PROJECT_MEMORIES,
  MAX_MEMORY_CONTENT_LENGTH,
  PROJECT_MEMORY_TYPES,
  isValidMemoryType,
  isValidMemoryContent,
  isValidConfidence,
} from '../../src/engine/types';
import type { ProjectMemory, MemorySnapshot, Session } from '../../src/engine/types';

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

function makeMemory(overrides: Partial<ProjectMemory> = {}): ProjectMemory {
  return {
    id: 'mem-1',
    type: 'direction',
    content: 'Keep the bass dark and minimal.',
    confidence: 0.8,
    evidence: 'User said "darker bass"',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('ProjectMemory types and validation', () => {
  it('creates a valid ProjectMemory with all required fields', () => {
    const mem = makeMemory();
    expect(mem.id).toBe('mem-1');
    expect(mem.type).toBe('direction');
    expect(mem.content).toBe('Keep the bass dark and minimal.');
    expect(mem.confidence).toBe(0.8);
    expect(mem.evidence).toBe('User said "darker bass"');
    expect(mem.createdAt).toBeGreaterThan(0);
    expect(mem.updatedAt).toBeGreaterThan(0);
  });

  it('supports optional trackId for track-scoped memories', () => {
    const mem = makeMemory({ type: 'track-narrative', trackId: 'v0' });
    expect(mem.trackId).toBe('v0');
  });

  describe('isValidMemoryType', () => {
    it('accepts valid memory types', () => {
      expect(isValidMemoryType('direction')).toBe(true);
      expect(isValidMemoryType('track-narrative')).toBe(true);
      expect(isValidMemoryType('decision')).toBe(true);
    });

    it('rejects invalid memory types', () => {
      expect(isValidMemoryType('invalid')).toBe(false);
      expect(isValidMemoryType('')).toBe(false);
      expect(isValidMemoryType('Direction')).toBe(false);
    });
  });

  describe('isValidMemoryContent', () => {
    it('accepts valid content', () => {
      expect(isValidMemoryContent('A short memory.')).toBe(true);
    });

    it('accepts content at max length', () => {
      expect(isValidMemoryContent('x'.repeat(MAX_MEMORY_CONTENT_LENGTH))).toBe(true);
    });

    it('rejects empty content', () => {
      expect(isValidMemoryContent('')).toBe(false);
    });

    it('rejects content exceeding max length', () => {
      expect(isValidMemoryContent('x'.repeat(MAX_MEMORY_CONTENT_LENGTH + 1))).toBe(false);
    });
  });

  it('MAX_PROJECT_MEMORIES is 30', () => {
    expect(MAX_PROJECT_MEMORIES).toBe(30);
  });

  it('MAX_MEMORY_CONTENT_LENGTH is 500', () => {
    expect(MAX_MEMORY_CONTENT_LENGTH).toBe(500);
  });
});

describe('PROJECT_MEMORY_TYPES const array', () => {
  it('contains all expected types', () => {
    expect(PROJECT_MEMORY_TYPES).toContain('direction');
    expect(PROJECT_MEMORY_TYPES).toContain('track-narrative');
    expect(PROJECT_MEMORY_TYPES).toContain('decision');
    expect(PROJECT_MEMORY_TYPES).toHaveLength(3);
  });

  it('isValidMemoryType agrees with PROJECT_MEMORY_TYPES', () => {
    for (const t of PROJECT_MEMORY_TYPES) {
      expect(isValidMemoryType(t)).toBe(true);
    }
  });
});

describe('isValidConfidence', () => {
  it('accepts values within [0, 1]', () => {
    expect(isValidConfidence(0)).toBe(true);
    expect(isValidConfidence(0.5)).toBe(true);
    expect(isValidConfidence(1)).toBe(true);
  });

  it('rejects values outside [0, 1]', () => {
    expect(isValidConfidence(-0.1)).toBe(false);
    expect(isValidConfidence(1.1)).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(isValidConfidence(NaN)).toBe(false);
    expect(isValidConfidence(Infinity)).toBe(false);
    expect(isValidConfidence(-Infinity)).toBe(false);
  });
});

describe('MemorySnapshot type', () => {
  it('has the correct kind discriminator', () => {
    const snapshot: MemorySnapshot = {
      kind: 'memory',
      prevMemories: [makeMemory()],
      timestamp: Date.now(),
      description: 'save memory',
    };
    expect(snapshot.kind).toBe('memory');
    expect(snapshot.prevMemories).toHaveLength(1);
  });
});

describe('MemorySnapshot undo contract', () => {
  function sessionWithMemories(memories: ProjectMemory[]): Session {
    const session = createSession();
    return { ...session, memories };
  }

  it('undo restores previous memories from MemorySnapshot', () => {
    const oldMemories = [makeMemory({ id: 'mem-old' })];
    const newMemories = [makeMemory({ id: 'mem-old' }), makeMemory({ id: 'mem-new', content: 'New direction.' })];

    // Build session with new memories and a MemorySnapshot on the undo stack
    const snapshot: MemorySnapshot = {
      kind: 'memory',
      prevMemories: oldMemories,
      timestamp: Date.now(),
      description: 'save memory: mem-new',
    };
    const session = sessionWithMemories(newMemories);
    const withUndo: Session = { ...session, undoStack: [snapshot] };

    const undone = applyUndo(withUndo);
    expect(undone.memories).toEqual(oldMemories);
    expect(undone.undoStack).toHaveLength(0);
    expect(undone.redoStack).toHaveLength(1);
  });

  it('redo restores memories after undo (round-trip)', () => {
    const oldMemories = [makeMemory({ id: 'mem-old' })];
    const newMemories = [makeMemory({ id: 'mem-old' }), makeMemory({ id: 'mem-new', content: 'New direction.' })];

    const snapshot: MemorySnapshot = {
      kind: 'memory',
      prevMemories: oldMemories,
      timestamp: Date.now(),
      description: 'save memory: mem-new',
    };
    const session = sessionWithMemories(newMemories);
    const withUndo: Session = { ...session, undoStack: [snapshot] };

    const undone = applyUndo(withUndo);
    expect(undone.memories).toEqual(oldMemories);

    const redone = applyRedo(undone);
    expect(redone.memories).toEqual(newMemories);
    expect(redone.undoStack).toHaveLength(1);
    expect(redone.redoStack).toHaveLength(0);
  });

  it('undo with empty prevMemories clears memories', () => {
    const newMemories = [makeMemory({ id: 'mem-1' })];
    const snapshot: MemorySnapshot = {
      kind: 'memory',
      prevMemories: [],
      timestamp: Date.now(),
      description: 'save first memory',
    };
    const session = sessionWithMemories(newMemories);
    const withUndo: Session = { ...session, undoStack: [snapshot] };

    const undone = applyUndo(withUndo);
    expect(undone.memories).toEqual([]);
  });
});

describe('Session persistence with memories', () => {
  beforeEach(() => {
    store.clear();
  });

  it('round-trips memories through save and load', () => {
    const session = createSession();
    const mem = makeMemory();
    const modified = {
      ...session,
      memories: [mem],
      messages: [{ role: 'human' as const, text: 'test', timestamp: 1 }],
    };
    saveSession(modified);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.memories).toHaveLength(1);
    expect(loaded!.memories![0].id).toBe('mem-1');
    expect(loaded!.memories![0].type).toBe('direction');
    expect(loaded!.memories![0].content).toBe('Keep the bass dark and minimal.');
  });

  it('restoreSession defaults memories to [] when absent', () => {
    const session = createSession();
    // Simulate a session without memories field (older format)
    const withoutMemories = { ...session } as Record<string, unknown>;
    delete withoutMemories.memories;

    const restored = restoreSession(withoutMemories as typeof session);
    expect(restored.memories).toEqual([]);
  });

  it('preserves existing memories through restoreSession', () => {
    const session = createSession();
    const mem = makeMemory();
    const withMemories = { ...session, memories: [mem] };

    const restored = restoreSession(withMemories);
    expect(restored.memories).toHaveLength(1);
    expect(restored.memories![0].id).toBe('mem-1');
  });
});
