// tests/engine/project-memory.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { saveSession, loadSession, clearSavedSession, restoreSession } from '../../src/engine/persistence';
import { createSession } from '../../src/engine/session';
import {
  MAX_PROJECT_MEMORIES,
  MAX_MEMORY_CONTENT_LENGTH,
  isValidMemoryType,
  isValidMemoryContent,
} from '../../src/engine/types';
import type { ProjectMemory, MemorySnapshot } from '../../src/engine/types';

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
