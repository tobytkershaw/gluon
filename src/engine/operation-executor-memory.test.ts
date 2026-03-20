import { describe, it, expect } from 'vitest';
import { executeOperations, prevalidateAction } from './operation-executor';
import type { Session, AIAction, ProjectMemory, ActionGroupSnapshot } from './types';
import type { SourceAdapter } from './canonical-types';
import { Arbitrator } from './arbitration';

/** Factory for a ProjectMemory with sensible defaults. */
function makeMemory(overrides?: Partial<ProjectMemory>): ProjectMemory {
  return {
    id: 'mem-1',
    type: 'direction',
    content: 'Keep things dark and minimal',
    confidence: 0.9,
    evidence: 'Human said "dark techno"',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    tracks: [{
      id: 'v1',
      engine: 'plaits',
      model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      muted: false,
      solo: false,
      stepGrid: { steps: [], length: 16 },
      patterns: [],
      processors: [],
      modulators: [],
      modulations: [],
      surface: { modules: [], thumbprint: { type: 'static-color' } },
      volume: 0.8,
      pan: 0,
      sequence: [],
    }],
    activeTrackId: 'v1',
    transport: { status: 'stopped', bpm: 120, swing: 0 },
    master: { volume: 0.8, pan: 0 },
    undoStack: [],
    redoStack: [],
    context: { key: null, scale: null, tempo: null, energy: 0.5, density: 0.5 },
    messages: [],
    recentHumanActions: [],
    ...overrides,
  };
}

const stubAdapter: SourceAdapter = {
  id: 'test',
  name: 'Test Adapter',
  mapControl: () => ({ target: 'source' as const, runtimeParam: 'harmonics' }),
  applyControlChanges: () => {},
  mapEvents: (events) => events,
  readControlState: () => ({}),
  readRegions: () => [],
  mapRuntimeParamKey: () => null,
  getControlSchemas: () => [],
  validateOperation: () => ({ valid: true }),
  midiToNormalisedPitch: (midi: number) => midi / 127,
  normalisedPitchToMidi: (norm: number) => Math.round(norm * 127),
};

// -----------------------------------------------------------------------
// recall_memories
// -----------------------------------------------------------------------

describe('recall_memories', () => {
  it('returns all memories when no filters', () => {
    const m1 = makeMemory({ id: 'mem-1', type: 'direction' });
    const m2 = makeMemory({ id: 'mem-2', type: 'track-narrative', trackId: 'v1' });
    const session = makeSession({ memories: [m1, m2] });
    const arbitrator = new Arbitrator();

    const action: AIAction = { type: 'recall_memories' };
    const result = executeOperations(session, [action], stubAdapter, arbitrator);

    expect(result.accepted).toHaveLength(1);
    // Session should not be mutated
    expect(result.session.memories).toEqual([m1, m2]);
  });

  it('filters by trackId', () => {
    const m1 = makeMemory({ id: 'mem-1', trackId: 'v1' });
    const m2 = makeMemory({ id: 'mem-2', trackId: 'v2' });
    const session = makeSession({ memories: [m1, m2] });
    const arbitrator = new Arbitrator();

    // Prevalidation should pass for existing trackId
    const action: AIAction = { type: 'recall_memories', trackId: 'v1' };
    const rejection = prevalidateAction(session, action, stubAdapter, arbitrator);
    expect(rejection).toBeNull();

    // Prevalidation should fail for non-existent trackId
    const badAction: AIAction = { type: 'recall_memories', trackId: 'nonexistent' };
    const badRejection = prevalidateAction(session, badAction, stubAdapter, arbitrator);
    expect(badRejection).toContain('Track not found');
  });

  it('filters by type', () => {
    const m1 = makeMemory({ id: 'mem-1', type: 'direction' });
    const m2 = makeMemory({ id: 'mem-2', type: 'decision' });
    const session = makeSession({ memories: [m1, m2] });
    const arbitrator = new Arbitrator();

    const action: AIAction = { type: 'recall_memories', memoryType: 'direction' };
    const rejection = prevalidateAction(session, action, stubAdapter, arbitrator);
    expect(rejection).toBeNull();

    // Invalid type should be rejected
    const badAction: AIAction = { type: 'recall_memories', memoryType: 'invalid' as never };
    const badRejection = prevalidateAction(session, badAction, stubAdapter, arbitrator);
    expect(badRejection).toContain('Invalid memory type');
  });

  it('filters by both trackId and type', () => {
    const m1 = makeMemory({ id: 'mem-1', type: 'direction', trackId: 'v1' });
    const m2 = makeMemory({ id: 'mem-2', type: 'track-narrative', trackId: 'v1' });
    const m3 = makeMemory({ id: 'mem-3', type: 'direction', trackId: 'v2' });
    const session = makeSession({ memories: [m1, m2, m3] });
    const arbitrator = new Arbitrator();

    const action: AIAction = { type: 'recall_memories', trackId: 'v1', memoryType: 'direction' };
    const rejection = prevalidateAction(session, action, stubAdapter, arbitrator);
    expect(rejection).toBeNull();

    const result = executeOperations(session, [action], stubAdapter, arbitrator);
    expect(result.accepted).toHaveLength(1);
  });

  it('returns empty array when no matches', () => {
    const session = makeSession({ memories: [] });
    const arbitrator = new Arbitrator();

    const action: AIAction = { type: 'recall_memories' };
    const result = executeOperations(session, [action], stubAdapter, arbitrator);
    expect(result.accepted).toHaveLength(1);
    expect(result.session.memories ?? []).toEqual([]);
  });

  it('does not modify session state', () => {
    const m1 = makeMemory({ id: 'mem-1' });
    const session = makeSession({ memories: [m1] });
    const arbitrator = new Arbitrator();

    const action: AIAction = { type: 'recall_memories' };
    const result = executeOperations(session, [action], stubAdapter, arbitrator);

    // Memories unchanged
    expect(result.session.memories).toEqual([m1]);
    // No undo entry
    expect(result.session.undoStack).toHaveLength(0);
    // No log entry (read-only)
    expect(result.log).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// forget_memory
// -----------------------------------------------------------------------

describe('forget_memory', () => {
  it('removes the targeted memory from session.memories', () => {
    const m1 = makeMemory({ id: 'mem-1' });
    const m2 = makeMemory({ id: 'mem-2' });
    const session = makeSession({ memories: [m1, m2] });
    const arbitrator = new Arbitrator();

    const action: AIAction = { type: 'forget_memory', memoryId: 'mem-1', reason: 'outdated' };
    const result = executeOperations(session, [action], stubAdapter, arbitrator);

    expect(result.accepted).toHaveLength(1);
    expect(result.session.memories).toHaveLength(1);
    expect(result.session.memories![0].id).toBe('mem-2');
  });

  it('rejects non-existent memoryId', () => {
    const session = makeSession({ memories: [makeMemory({ id: 'mem-1' })] });
    const arbitrator = new Arbitrator();

    const action: AIAction = { type: 'forget_memory', memoryId: 'nonexistent', reason: 'test' };
    const rejection = prevalidateAction(session, action, stubAdapter, arbitrator);
    expect(rejection).toContain('Memory not found');
  });

  it('rejects empty reason', () => {
    const session = makeSession({ memories: [makeMemory({ id: 'mem-1' })] });
    const arbitrator = new Arbitrator();

    const action: AIAction = { type: 'forget_memory', memoryId: 'mem-1', reason: '' };
    const rejection = prevalidateAction(session, action, stubAdapter, arbitrator);
    expect(rejection).toContain('reason');
  });

  it('pushes MemorySnapshot and undo restores the deleted memory', () => {
    const m1 = makeMemory({ id: 'mem-1' });
    const m2 = makeMemory({ id: 'mem-2' });
    const session = makeSession({ memories: [m1, m2] });
    const arbitrator = new Arbitrator();

    const action: AIAction = { type: 'forget_memory', memoryId: 'mem-1', reason: 'direction changed' };
    const result = executeOperations(session, [action], stubAdapter, arbitrator);

    // Memory removed
    expect(result.session.memories).toHaveLength(1);

    // Undo stack has an entry
    expect(result.session.undoStack).toHaveLength(1);
    const entry = result.session.undoStack[0];
    // May be wrapped in a group or be a direct snapshot
    if (entry.kind === 'group') {
      const memSnap = (entry as ActionGroupSnapshot).snapshots.find(s => s.kind === 'memory');
      expect(memSnap).toBeDefined();
      expect((memSnap as { prevMemories: ProjectMemory[] }).prevMemories).toHaveLength(2);
    } else {
      expect(entry.kind).toBe('memory');
      expect((entry as { prevMemories: ProjectMemory[] }).prevMemories).toHaveLength(2);
    }
  });

  it('appears in the action log', () => {
    const session = makeSession({ memories: [makeMemory({ id: 'mem-1' })] });
    const arbitrator = new Arbitrator();

    const action: AIAction = { type: 'forget_memory', memoryId: 'mem-1', reason: 'no longer relevant' };
    const result = executeOperations(session, [action], stubAdapter, arbitrator);

    expect(result.log).toHaveLength(1);
    expect(result.log[0].description).toContain('forgot memory');
    expect(result.log[0].description).toContain('mem-1');
  });
});
