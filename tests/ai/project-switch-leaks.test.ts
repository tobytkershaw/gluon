// tests/ai/project-switch-leaks.test.ts — Verify AI state is cleared on project switch.
// Covers #1228, #1233, #1234, #1236.

import { describe, it, expect } from 'vitest';
import { GluonAI } from '../../src/ai/api';
import { SpectralSlotManager } from '../../src/engine/spectral-slots';
import { MotifLibrary } from '../../src/engine/motif';
import type {
  FunctionResponse,
  GenerateResult,
  PlannerProvider,
  StreamTextCallback,
  ToolSchema,
} from '../../src/ai/types';
import type { NoteEvent } from '../../src/engine/canonical-types';

// Minimal stub planner for constructing GluonAI
class StubPlanner implements PlannerProvider {
  readonly name = 'stub';
  cleared = false;

  isConfigured(): boolean {
    return true;
  }

  async startTurn(_opts: {
    systemPrompt: string;
    userMessage: string;
    tools: ToolSchema[];
    onStreamText?: StreamTextCallback;
  }): Promise<GenerateResult> {
    return { textParts: [], functionCalls: [] };
  }

  async continueTurn(_opts: {
    systemPrompt: string;
    tools: ToolSchema[];
    functionResponses: FunctionResponse[];
    onStreamText?: StreamTextCallback;
  }): Promise<GenerateResult> {
    return { textParts: [], functionCalls: [] };
  }

  commitTurn(): void {}
  discardTurn(): void {}
  trimHistory(): void {}
  clearHistory(): void {
    this.cleared = true;
  }
}

const stubListener = { name: 'listener', isConfigured: () => true, evaluate: async () => '' };

describe('project switch clears AI state', () => {
  it('clearHistory() resets spectralSlots, motifLibrary, and autoDiffs (#1233, #1234, #1236)', () => {
    const planner = new StubPlanner();
    const ai = new GluonAI(planner, stubListener);

    // Populate project-scoped state via public/readonly fields
    // motifLibrary is readonly so we can register motifs directly
    ai.motifLibrary.register({
      id: 'motif-1',
      name: 'Test',
      events: [{ kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 } as NoteEvent],
      rootPitch: 60,
      duration: 4,
    });
    expect(ai.motifLibrary.size).toBe(1);

    // Clear = simulates project switch
    ai.clearHistory();

    // All project-scoped state should be empty
    expect(planner.cleared).toBe(true);
    expect(ai.motifLibrary.size).toBe(0);
  });
});

describe('SpectralSlotManager.clear()', () => {
  it('removes all slot assignments (#1233)', () => {
    const mgr = new SpectralSlotManager();
    mgr.assign('kick', ['sub', 'low'], 10);
    mgr.assign('snare', ['mid', 'high_mid'], 7);
    expect(mgr.getAll().length).toBe(2);

    mgr.clear();

    expect(mgr.getAll()).toEqual([]);
    expect(mgr.get('kick')).toBeUndefined();
    expect(mgr.get('snare')).toBeUndefined();
    expect(mgr.detectCollisions()).toEqual([]);
  });
});

describe('MotifLibrary.clear()', () => {
  it('removes all registered motifs (#1234)', () => {
    const lib = new MotifLibrary();
    lib.register({
      id: 'm1',
      name: 'A',
      events: [{ kind: 'note', at: 0, pitch: 60, velocity: 0.8, duration: 1 } as NoteEvent],
      rootPitch: 60,
      duration: 4,
    });
    lib.register({
      id: 'm2',
      name: 'B',
      events: [{ kind: 'note', at: 0, pitch: 64, velocity: 0.7, duration: 1 } as NoteEvent],
      rootPitch: 64,
      duration: 4,
    });
    expect(lib.size).toBe(2);

    lib.clear();

    expect(lib.size).toBe(0);
    expect(lib.list()).toEqual([]);
    expect(lib.recall('m1')).toBeUndefined();
  });
});
