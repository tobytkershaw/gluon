import { describe, it, expect } from 'vitest';
import { groupSnapshots, finalizeAITurn } from '../../src/engine/operation-executor';
import type { UndoEntry, ActionGroupSnapshot, Snapshot } from '../../src/engine/types';

function makeSnapshot(desc: string): Snapshot {
  return {
    kind: 'param' as const,
    trackId: 'v0',
    param: 'timbre',
    oldValue: 0.0,
    newValue: 0.5,
    timestamp: Date.now(),
    description: desc,
  };
}

function makeGroup(desc: string, count: number): ActionGroupSnapshot {
  const snapshots: Snapshot[] = [];
  for (let i = 0; i < count; i++) {
    snapshots.push(makeSnapshot(`${desc}-${i}`));
  }
  return { kind: 'group', snapshots, timestamp: Date.now(), description: desc };
}

describe('groupSnapshots', () => {
  it('returns stack unchanged when 0 new entries', () => {
    const stack: UndoEntry[] = [makeSnapshot('existing')];
    const result = groupSnapshots(stack, 1, 'noop');
    expect(result).toBe(stack); // same reference
  });

  it('returns stack unchanged when 1 new entry', () => {
    const stack: UndoEntry[] = [makeSnapshot('existing'), makeSnapshot('new')];
    const result = groupSnapshots(stack, 1, 'single');
    expect(result).toBe(stack);
  });

  it('groups 2+ entries into one ActionGroupSnapshot', () => {
    const stack: UndoEntry[] = [
      makeSnapshot('existing'),
      makeSnapshot('step-a'),
      makeSnapshot('step-b'),
    ];
    const result = groupSnapshots(stack, 1, 'step 1');
    expect(result).toHaveLength(2); // existing + group
    expect(result[0]).toBe(stack[0]);
    const group = result[1] as ActionGroupSnapshot;
    expect(group.kind).toBe('group');
    expect(group.snapshots).toHaveLength(2);
    expect(group.description).toBe('step 1');
  });

  it('flattens nested groups', () => {
    const stack: UndoEntry[] = [
      makeSnapshot('existing'),
      makeGroup('cascade', 3),
      makeSnapshot('extra'),
    ];
    const result = groupSnapshots(stack, 1, 'flattened');
    expect(result).toHaveLength(2);
    const group = result[1] as ActionGroupSnapshot;
    expect(group.kind).toBe('group');
    expect(group.snapshots).toHaveLength(4); // 3 from nested group + 1 extra
  });

  it('preserves entries before baseline', () => {
    const base = [makeSnapshot('a'), makeSnapshot('b')];
    const stack: UndoEntry[] = [...base, makeSnapshot('c'), makeSnapshot('d')];
    const result = groupSnapshots(stack, 2, 'grouped');
    expect(result).toHaveLength(3); // a, b, group
    expect(result[0]).toBe(base[0]);
    expect(result[1]).toBe(base[1]);
  });
});

describe('finalizeAITurn', () => {
  it('collapses by default (batch path)', () => {
    const session = {
      tracks: [],
      activeTrackId: 'v0',
      undoStack: [makeSnapshot('a'), makeSnapshot('b'), makeSnapshot('c')] as UndoEntry[],
      redoStack: [],
      messages: [],
      recentHumanActions: [],
      transport: { bpm: 120, playing: false, swing: 0, loop: true },
      reactionHistory: [],
    };
    const result = finalizeAITurn(session, 0, ['hello'], []);
    // All 3 snapshots collapsed into 1 group
    expect(result.undoStack).toHaveLength(1);
    expect(result.undoStack[0].kind).toBe('group');
  });

  it('preserves per-step groups when collapse=false', () => {
    const group1 = makeGroup('step1', 2);
    const group2 = makeGroup('step2', 3);
    const session = {
      tracks: [],
      activeTrackId: 'v0',
      undoStack: [group1, group2] as UndoEntry[],
      redoStack: [],
      messages: [],
      recentHumanActions: [],
      transport: { bpm: 120, playing: false, swing: 0, loop: true },
      reactionHistory: [],
    };
    const result = finalizeAITurn(session, 0, ['hello'], [], undefined, false);
    // Per-step groups should remain separate
    expect(result.undoStack).toHaveLength(2);
    expect(result.undoStack[0]).toBe(group1);
    expect(result.undoStack[1]).toBe(group2);
  });

  it('sets undoStackRange spanning all entries', () => {
    const group1 = makeGroup('step1', 2);
    const group2 = makeGroup('step2', 3);
    const session = {
      tracks: [],
      activeTrackId: 'v0',
      undoStack: [group1, group2] as UndoEntry[],
      redoStack: [],
      messages: [],
      recentHumanActions: [],
      transport: { bpm: 120, playing: false, swing: 0, loop: true },
      reactionHistory: [],
    };
    const result = finalizeAITurn(session, 0, ['hello'], [], undefined, false);
    const msg = result.messages[0];
    expect(msg.undoStackRange).toEqual({ start: 0, end: 1 });
  });

  it('sets single-entry range after collapse', () => {
    const session = {
      tracks: [],
      activeTrackId: 'v0',
      undoStack: [makeSnapshot('a'), makeSnapshot('b')] as UndoEntry[],
      redoStack: [],
      messages: [],
      recentHumanActions: [],
      transport: { bpm: 120, playing: false, swing: 0, loop: true },
      reactionHistory: [],
    };
    const result = finalizeAITurn(session, 0, ['hello'], []);
    const msg = result.messages[0];
    expect(msg.undoStackRange).toEqual({ start: 0, end: 0 });
  });

  it('omits undoStackRange when no undo entries produced', () => {
    const session = {
      tracks: [],
      activeTrackId: 'v0',
      undoStack: [] as UndoEntry[],
      redoStack: [],
      messages: [],
      recentHumanActions: [],
      transport: { bpm: 120, playing: false, swing: 0, loop: true },
      reactionHistory: [],
    };
    const result = finalizeAITurn(session, 0, ['just text'], []);
    const msg = result.messages[0];
    expect(msg.undoStackRange).toBeUndefined();
  });
});
