import { describe, it, expect } from 'vitest';
import { UndoStack } from '../../src/engine/undo';
import { Snapshot } from '../../src/engine/types';

describe('UndoStack', () => {
  function makeSnapshot(desc: string): Snapshot {
    return {
      prevValues: { timbre: 0.5 },
      aiTargetValues: { timbre: 0.8 },
      timestamp: Date.now(),
      description: desc,
    };
  }

  it('starts empty', () => {
    const stack = new UndoStack();
    expect(stack.isEmpty()).toBe(true);
    expect(stack.size()).toBe(0);
  });

  it('pushes and pops snapshots', () => {
    const stack = new UndoStack();
    const s1 = makeSnapshot('action 1');
    const s2 = makeSnapshot('action 2');
    stack.push(s1);
    stack.push(s2);
    expect(stack.size()).toBe(2);
    expect(stack.pop()).toEqual(s2);
    expect(stack.pop()).toEqual(s1);
    expect(stack.isEmpty()).toBe(true);
  });

  it('returns undefined when popping empty stack', () => {
    const stack = new UndoStack();
    expect(stack.pop()).toBeUndefined();
  });

  it('clears all entries', () => {
    const stack = new UndoStack();
    stack.push(makeSnapshot('a'));
    stack.push(makeSnapshot('b'));
    stack.clear();
    expect(stack.isEmpty()).toBe(true);
  });

  it('peeks without removing', () => {
    const stack = new UndoStack();
    const s = makeSnapshot('test');
    stack.push(s);
    expect(stack.peek()).toEqual(s);
    expect(stack.size()).toBe(1);
  });

  it('limits max size, discarding oldest', () => {
    const stack = new UndoStack(3);
    stack.push(makeSnapshot('1'));
    stack.push(makeSnapshot('2'));
    stack.push(makeSnapshot('3'));
    stack.push(makeSnapshot('4'));
    expect(stack.size()).toBe(3);
    const all = stack.toArray();
    expect(all[0].description).toBe('2');
  });
});
