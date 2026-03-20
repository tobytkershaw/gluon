import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutomationEngine } from '../../src/ai/automation';
import type { ParamSnapshot, ProcessorStateSnapshot, ActionGroupSnapshot, UndoEntry, Snapshot } from '../../src/engine/types';

/**
 * Helper that mirrors the cancelAutomationsForEntry logic in App.tsx.
 * We test this separately to verify the cancellation pattern works
 * for all three bug scenarios (#1165, #1170, #1172).
 */
function cancelAutomationsForEntry(engine: AutomationEngine, entry: UndoEntry): void {
  if (entry.kind === 'param') {
    for (const param of Object.keys(entry.prevValues)) {
      engine.cancel(entry.trackId, param);
    }
  } else if (entry.kind === 'processor-state') {
    for (const param of Object.keys(entry.prevParams)) {
      engine.cancel(entry.trackId, param);
    }
  } else if (entry.kind === 'group') {
    for (const snapshot of entry.snapshots) {
      cancelAutomationsForEntry(engine, snapshot);
    }
  }
}

describe('Automation cancellation on undo', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('#1165: cancels in-flight processor ramp on undo of processor-state entry', () => {
    const engine = new AutomationEngine();
    const cb = vi.fn();
    engine.start('t1', 'cutoff', 0.2, 0.8, 2000, cb);
    expect(engine.getActiveCount()).toBe(1);

    const entry: ProcessorStateSnapshot = {
      kind: 'processor-state',
      trackId: 't1',
      processorId: 'filter-1',
      prevParams: { cutoff: 0.2 },
      prevModel: 0,
      timestamp: Date.now(),
      description: 'Ramp cutoff',
    };

    cancelAutomationsForEntry(engine, entry);
    expect(engine.getActiveCount()).toBe(0);

    // Verify the ramp no longer fires
    vi.advanceTimersByTime(1000);
    engine.tick(Date.now());
    expect(cb).not.toHaveBeenCalled();
  });

  it('#1165: cancels in-flight source param ramp on undo of param entry', () => {
    const engine = new AutomationEngine();
    const cb = vi.fn();
    engine.start('t1', 'timbre', 0.0, 1.0, 2000, cb);
    expect(engine.getActiveCount()).toBe(1);

    const entry: ParamSnapshot = {
      kind: 'param',
      trackId: 't1',
      prevValues: { timbre: 0.0 },
      aiTargetValues: { timbre: 1.0 },
      timestamp: Date.now(),
      description: 'Ramp timbre',
    };

    cancelAutomationsForEntry(engine, entry);
    expect(engine.getActiveCount()).toBe(0);
  });

  it('#1170: cancels automations for all entries in a message-level undo range', () => {
    const engine = new AutomationEngine();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    engine.start('t1', 'timbre', 0.0, 1.0, 2000, cb1);
    engine.start('t2', 'morph', 0.0, 0.5, 2000, cb2);
    expect(engine.getActiveCount()).toBe(2);

    // Simulate undoing a range of entries (as handleUndoMessage does)
    const entries: UndoEntry[] = [
      {
        kind: 'param',
        trackId: 't1',
        prevValues: { timbre: 0.0 },
        aiTargetValues: { timbre: 1.0 },
        timestamp: Date.now(),
        description: 'Move timbre',
      },
      {
        kind: 'param',
        trackId: 't2',
        prevValues: { morph: 0.0 },
        aiTargetValues: { morph: 0.5 },
        timestamp: Date.now(),
        description: 'Move morph',
      },
    ];

    for (const entry of entries) {
      cancelAutomationsForEntry(engine, entry);
    }

    expect(engine.getActiveCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    engine.tick(Date.now());
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
  });

  it('#1172: cancels automations for all snapshots inside a group entry', () => {
    const engine = new AutomationEngine();
    const cbTimbre = vi.fn();
    const cbCutoff = vi.fn();
    engine.start('t1', 'timbre', 0.0, 1.0, 2000, cbTimbre);
    engine.start('t1', 'cutoff', 0.1, 0.9, 2000, cbCutoff);
    expect(engine.getActiveCount()).toBe(2);

    const groupEntry: ActionGroupSnapshot = {
      kind: 'group',
      snapshots: [
        {
          kind: 'param',
          trackId: 't1',
          prevValues: { timbre: 0.0 },
          aiTargetValues: { timbre: 1.0 },
          timestamp: Date.now(),
          description: 'Move timbre',
        },
        {
          kind: 'processor-state',
          trackId: 't1',
          processorId: 'filter-1',
          prevParams: { cutoff: 0.1 },
          prevModel: 0,
          timestamp: Date.now(),
          description: 'Move cutoff',
        },
      ],
      timestamp: Date.now(),
      description: 'AI action group',
    };

    cancelAutomationsForEntry(engine, groupEntry);
    expect(engine.getActiveCount()).toBe(0);
  });

  it('does not cancel unrelated automations on other tracks', () => {
    const engine = new AutomationEngine();
    const cbT1 = vi.fn();
    const cbT2 = vi.fn();
    engine.start('t1', 'timbre', 0.0, 1.0, 2000, cbT1);
    engine.start('t2', 'timbre', 0.0, 1.0, 2000, cbT2);

    const entry: ParamSnapshot = {
      kind: 'param',
      trackId: 't1',
      prevValues: { timbre: 0.0 },
      aiTargetValues: { timbre: 1.0 },
      timestamp: Date.now(),
      description: 'Move timbre',
    };

    cancelAutomationsForEntry(engine, entry);
    expect(engine.getActiveCount()).toBe(1);

    vi.advanceTimersByTime(1000);
    engine.tick(Date.now());
    expect(cbT1).not.toHaveBeenCalled();
    expect(cbT2).toHaveBeenCalled();
  });

  it('handles non-param entry kinds gracefully (no-op)', () => {
    const engine = new AutomationEngine();
    const cb = vi.fn();
    engine.start('t1', 'timbre', 0.0, 1.0, 2000, cb);

    // A pattern entry has no params to cancel
    const entry: Snapshot = {
      kind: 'pattern',
      trackId: 't1',
      prevEvents: [],
      timestamp: Date.now(),
      description: 'Pattern edit',
    };

    cancelAutomationsForEntry(engine, entry);
    expect(engine.getActiveCount()).toBe(1); // unchanged
  });
});
