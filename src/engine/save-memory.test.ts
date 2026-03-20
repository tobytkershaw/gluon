import { describe, it, expect } from 'vitest';
import { executeOperations } from './operation-executor';
import type { Session, AIAction, AISaveMemoryAction, ProjectMemory, MemorySnapshot, ActionGroupSnapshot } from './types';
import { MAX_PROJECT_MEMORIES } from './types';
import type { SourceAdapter } from './canonical-types';
import { Arbitrator } from './arbitration';

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
      surface: {
        modules: [],
        thumbprint: { type: 'static-color' },
      },
    }],
    activeTrackId: 'v1',
    transport: { status: 'playing', bpm: 120, swing: 0 },
    undoStack: [],
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

function run(session: Session, actions: AIAction[]) {
  return executeOperations(
    session,
    actions,
    new Arbitrator(),
    new Map([['v1', stubAdapter]]),
  );
}

function makeSaveMemoryAction(overrides?: Partial<AISaveMemoryAction>): AISaveMemoryAction {
  return {
    type: 'save_memory',
    memoryType: 'direction',
    content: 'The project aims for dark minimal techno.',
    evidence: 'Human said "make it dark and minimal"',
    ...overrides,
  };
}

function makeMemory(id: string, overrides?: Partial<ProjectMemory>): ProjectMemory {
  return {
    id,
    type: 'direction',
    content: 'Some existing memory',
    confidence: 1.0,
    evidence: 'test',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('save_memory action', () => {
  it('creates a memory in session.memories', () => {
    const session = makeSession();
    const result = run(session, [makeSaveMemoryAction()]);

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.session.memories).toHaveLength(1);
    expect(result.session.memories![0].type).toBe('direction');
    expect(result.session.memories![0].content).toBe('The project aims for dark minimal techno.');
    expect(result.session.memories![0].evidence).toBe('Human said "make it dark and minimal"');
    expect(result.session.memories![0].id).toMatch(/^mem-/);
    expect(result.session.memories![0].confidence).toBe(1.0);
  });

  it('creates a track-specific memory when trackId is provided', () => {
    const session = makeSession();
    const result = run(session, [makeSaveMemoryAction({ memoryType: 'track-narrative', trackId: 'v1' })]);

    expect(result.accepted).toHaveLength(1);
    expect(result.session.memories![0].trackId).toBe('v1');
    expect(result.session.memories![0].type).toBe('track-narrative');
  });

  it('rejects empty content', () => {
    const session = makeSession();
    const result = run(session, [makeSaveMemoryAction({ content: '' })]);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Invalid memory content');
  });

  it('rejects content over 500 characters', () => {
    const session = makeSession();
    const result = run(session, [makeSaveMemoryAction({ content: 'x'.repeat(501) })]);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Invalid memory content');
  });

  it('rejects invalid type', () => {
    const session = makeSession();
    const result = run(session, [makeSaveMemoryAction({ memoryType: 'invalid' as any })]);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Invalid memory type');
  });

  it('rejects non-existent trackId', () => {
    const session = makeSession();
    const result = run(session, [makeSaveMemoryAction({ trackId: 'nonexistent' })]);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Track not found');
  });

  it('rejects non-existent supersedes ID', () => {
    const session = makeSession();
    const result = run(session, [makeSaveMemoryAction({ supersedes: 'mem-999' })]);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Memory not found for supersedes');
  });

  it('rejects when at memory cap without supersedes', () => {
    const memories = Array.from({ length: MAX_PROJECT_MEMORIES }, (_, i) =>
      makeMemory(`mem-${i}`),
    );
    const session = makeSession({ memories });
    const result = run(session, [makeSaveMemoryAction()]);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Memory cap reached');
  });

  it('allows supersedes when at memory cap', () => {
    const memories = Array.from({ length: MAX_PROJECT_MEMORIES }, (_, i) =>
      makeMemory(`mem-${i}`),
    );
    const session = makeSession({ memories });
    const result = run(session, [makeSaveMemoryAction({ supersedes: 'mem-5' })]);

    expect(result.accepted).toHaveLength(1);
    expect(result.session.memories).toHaveLength(MAX_PROJECT_MEMORIES);
    const replaced = result.session.memories!.find(m => m.content === 'The project aims for dark minimal techno.');
    expect(replaced).toBeDefined();
    const old = result.session.memories!.filter(m => m.id === 'mem-5');
    expect(old).toHaveLength(0);
  });

  it('supersedes replaces the targeted memory without increasing count', () => {
    const memories = [
      makeMemory('mem-1', { content: 'Old direction' }),
      makeMemory('mem-2', { content: 'Another memory' }),
    ];
    const session = makeSession({ memories });
    const result = run(session, [makeSaveMemoryAction({ supersedes: 'mem-1', content: 'New direction' })]);

    expect(result.accepted).toHaveLength(1);
    expect(result.session.memories).toHaveLength(2);
    expect(result.session.memories!.find(m => m.id === 'mem-1')).toBeUndefined();
    expect(result.session.memories!.find(m => m.content === 'New direction')).toBeDefined();
    expect(result.session.memories!.find(m => m.id === 'mem-2')).toBeDefined();
  });

  it('pushes MemorySnapshot to undo stack', () => {
    const session = makeSession();
    const result = run(session, [makeSaveMemoryAction()]);

    expect(result.session.undoStack).toHaveLength(1);
    const snap = result.session.undoStack[0] as MemorySnapshot;
    expect(snap.kind).toBe('memory');
    expect(snap.prevMemories).toEqual([]);
  });

  it('undo restores previous memories via MemorySnapshot', () => {
    const existingMemories = [makeMemory('mem-existing')];
    const session = makeSession({ memories: existingMemories });
    const result = run(session, [makeSaveMemoryAction()]);

    expect(result.session.memories).toHaveLength(2);

    const snap = result.session.undoStack[0] as MemorySnapshot;
    expect(snap.kind).toBe('memory');
    expect(snap.prevMemories).toHaveLength(1);
    expect(snap.prevMemories[0].id).toBe('mem-existing');
  });

  it('action appears in log', () => {
    const session = makeSession();
    const result = run(session, [makeSaveMemoryAction()]);

    expect(result.log).toHaveLength(1);
    expect(result.log[0].description).toContain('memory saved');
    expect(result.log[0].description).toContain('direction');
  });

  it('rejects missing evidence', () => {
    const session = makeSession();
    const result = run(session, [makeSaveMemoryAction({ evidence: '' })]);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('evidence');
  });
});
