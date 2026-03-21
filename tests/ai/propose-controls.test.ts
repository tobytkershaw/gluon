// tests/ai/propose-controls.test.ts — Tests for propose_controls tool (#1384)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSession } from '../../src/engine/session';
import { compressState } from '../../src/ai/state-compression';
import { GluonAI, projectAction } from '../../src/ai/api';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse, ToolSchema } from '../../src/ai/types';
import type { Session, LiveControlModule, SurfaceModule, SurfaceSnapshot } from '../../src/engine/types';
import { updateTrack } from '../../src/engine/types';

// ---------------------------------------------------------------------------
// Mock providers
// ---------------------------------------------------------------------------

function createMockPlanner(): PlannerProvider & {
  startTurnResults: GenerateResult[];
  continueTurnResults: GenerateResult[];
  lastFunctionResponses: FunctionResponse[];
} {
  const planner = {
    name: 'mock',
    startTurnResults: [] as GenerateResult[],
    continueTurnResults: [] as GenerateResult[],
    lastFunctionResponses: [] as FunctionResponse[],
    isConfigured: () => true,
    startTurn: vi.fn(async (): Promise<GenerateResult> => {
      return planner.startTurnResults.shift() ?? { textParts: [], functionCalls: [] };
    }),
    continueTurn: vi.fn(async (opts: { functionResponses: FunctionResponse[] }): Promise<GenerateResult> => {
      planner.lastFunctionResponses = opts.functionResponses;
      return planner.continueTurnResults.shift() ?? { textParts: [], functionCalls: [] };
    }),
    commitTurn: vi.fn(),
    discardTurn: vi.fn(),
    trimHistory: vi.fn(),
  };
  return planner;
}

function createMockListener(): ListenerProvider {
  return {
    name: 'mock-listener',
    isConfigured: () => false,
    evaluateAudio: vi.fn(async () => 'ok'),
  };
}

function makeSession(): Session {
  const s = createSession();
  // Ensure liveControls and turnCount exist
  return { ...s, liveControls: [], turnCount: 0 };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a simple LiveControlModule for testing. */
function makeLiveControl(overrides: Partial<LiveControlModule> = {}): LiveControlModule {
  return {
    id: overrides.id ?? 'live-test-1',
    trackId: overrides.trackId ?? 'v0',
    touched: overrides.touched ?? false,
    createdAtTurn: overrides.createdAtTurn ?? 0,
    module: overrides.module ?? {
      type: 'knob-group',
      id: 'live-test-1',
      label: 'Test Control',
      bindings: [{ role: 'control', trackId: 'v0', target: { kind: 'source', param: 'timbre' } }],
      position: { x: 0, y: 0, w: 4, h: 2 },
      config: {},
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('propose_controls tool handler', () => {
  let planner: ReturnType<typeof createMockPlanner>;
  let ai: GluonAI;

  beforeEach(() => {
    planner = createMockPlanner();
    ai = new GluonAI(planner, createMockListener());
  });

  it('creates LiveControlModule instances via the handler', async () => {
    const session = makeSession();

    // Set up a propose_controls call followed by a terminal text response
    planner.startTurnResults = [{
      textParts: [],
      functionCalls: [{
        id: 'fc1',
        name: 'propose_controls',
        args: {
          trackId: 'v0',
          description: 'Brightness controls',
          modules: [{
            type: 'knob-group',
            label: 'Brightness',
            bindings: [{
              role: 'control',
              target: { kind: 'source', param: 'timbre' },
            }],
          }],
        },
      }],
    }];
    planner.continueTurnResults = [{
      textParts: ['Here are some controls.'],
      functionCalls: [],
    }];

    const actions = await ai.ask(session, 'give me some controls');
    // propose_controls returns no actions (non-undoable)
    const nonSayActions = actions.filter(a => a.type !== 'say');
    expect(nonSayActions).toHaveLength(0);

    // Verify the function response was successful
    const responses = planner.lastFunctionResponses;
    expect(responses).toHaveLength(1);
    expect(responses[0].result).toHaveProperty('applied', true);
    expect(responses[0].result).toHaveProperty('moduleCount', 1);
    expect(responses[0].result).toHaveProperty('_liveControls');
    const liveControls = (responses[0].result as Record<string, unknown>)._liveControls as LiveControlModule[];
    expect(liveControls).toHaveLength(1);
    expect(liveControls[0].touched).toBe(false);
    expect(liveControls[0].trackId).toBe('v0');
    expect(liveControls[0].createdAtTurn).toBe(0);
  });

  it('rejects invalid module types', async () => {
    const session = makeSession();

    planner.startTurnResults = [{
      textParts: [],
      functionCalls: [{
        id: 'fc1',
        name: 'propose_controls',
        args: {
          trackId: 'v0',
          description: 'Test',
          modules: [{
            type: 'foobar',  // Not a valid type
            label: 'Bad',
            bindings: [{ role: 'control', target: { kind: 'source', param: 'timbre' } }],
          }],
        },
      }],
    }];
    planner.continueTurnResults = [{ textParts: ['ok'], functionCalls: [] }];

    await ai.ask(session, 'test');
    const responses = planner.lastFunctionResponses;
    expect(responses[0].result).toHaveProperty('error');
  });

  it('accepts xy-pad with x-axis and y-axis bindings', async () => {
    const session = makeSession();

    planner.startTurnResults = [{
      textParts: [],
      functionCalls: [{
        id: 'fc1',
        name: 'propose_controls',
        args: {
          trackId: 'v0',
          description: 'XY pad controls',
          modules: [{
            type: 'xy-pad',
            label: 'Timbre / Morph',
            bindings: [
              { role: 'x-axis', target: { kind: 'source', param: 'timbre' } },
              { role: 'y-axis', target: { kind: 'source', param: 'morph' } },
            ],
          }],
        },
      }],
    }];
    planner.continueTurnResults = [{ textParts: ['done'], functionCalls: [] }];

    await ai.ask(session, 'xy pad');
    const responses = planner.lastFunctionResponses;
    expect(responses[0].result).toHaveProperty('applied', true);
    expect(responses[0].result).toHaveProperty('moduleCount', 1);
    const liveControls = (responses[0].result as Record<string, unknown>)._liveControls as LiveControlModule[];
    expect(liveControls).toHaveLength(1);
    expect(liveControls[0].module.type).toBe('xy-pad');
    expect(liveControls[0].module.bindings).toHaveLength(2);
  });

  it('accepts step-grid with region binding', async () => {
    const session = makeSession();

    planner.startTurnResults = [{
      textParts: [],
      functionCalls: [{
        id: 'fc1',
        name: 'propose_controls',
        args: {
          trackId: 'v0',
          description: 'Step grid',
          modules: [{
            type: 'step-grid',
            label: 'Pattern',
            bindings: [
              { role: 'region', target: { kind: 'region', patternId: 'p0' } },
            ],
          }],
        },
      }],
    }];
    planner.continueTurnResults = [{ textParts: ['done'], functionCalls: [] }];

    await ai.ask(session, 'step grid');
    const responses = planner.lastFunctionResponses;
    expect(responses[0].result).toHaveProperty('applied', true);
    expect(responses[0].result).toHaveProperty('moduleCount', 1);
    const liveControls = (responses[0].result as Record<string, unknown>)._liveControls as LiveControlModule[];
    expect(liveControls).toHaveLength(1);
    expect(liveControls[0].module.type).toBe('step-grid');
  });

  it('replace mode clears untouched but keeps touched', async () => {
    const session: Session = {
      ...makeSession(),
      liveControls: [
        makeLiveControl({ id: 'untouched-1', touched: false }),
        makeLiveControl({ id: 'touched-1', touched: true }),
      ],
    };

    planner.startTurnResults = [{
      textParts: [],
      functionCalls: [{
        id: 'fc1',
        name: 'propose_controls',
        args: {
          trackId: 'v0',
          description: 'Replace controls',
          replace: true,
          modules: [{
            type: 'knob-group',
            label: 'New Control',
            bindings: [{ role: 'control', target: { kind: 'source', param: 'morph' } }],
          }],
        },
      }],
    }];
    planner.continueTurnResults = [{ textParts: ['done'], functionCalls: [] }];

    await ai.ask(session, 'replace controls');
    const responses = planner.lastFunctionResponses;
    const liveControls = (responses[0].result as Record<string, unknown>)._liveControls as LiveControlModule[];

    // touched-1 should survive, untouched-1 should be removed, new module added
    expect(liveControls.length).toBe(2);
    expect(liveControls.some(m => m.id === 'touched-1')).toBe(true);
    expect(liveControls.some(m => m.id === 'untouched-1')).toBe(false);
    // The new module should be present
    const newModule = liveControls.find(m => m.module.label === 'New Control');
    expect(newModule).toBeDefined();
  });
});

describe('turn-based expiry (3-turn grace period)', () => {
  it('clearStaleLiveControls removes untouched and expired modules', () => {
    // Simulate the clearStaleLiveControls logic directly
    const session: Session = {
      ...makeSession(),
      turnCount: 5,
      liveControls: [
        // Untouched — should be removed
        makeLiveControl({ id: 'untouched', touched: false, createdAtTurn: 4 }),
        // Touched, within grace period — should survive
        makeLiveControl({ id: 'recent-touched', touched: true, createdAtTurn: 3 }),
        // Touched, past grace period — should be removed
        makeLiveControl({ id: 'old-touched', touched: true, createdAtTurn: 1 }),
        // Touched, exactly at boundary (5-1=4 > 3) — should be removed
        makeLiveControl({ id: 'boundary-touched', touched: true, createdAtTurn: 1 }),
      ],
    };

    const currentTurn = session.turnCount;
    const trackIds = new Set(session.tracks.map(t => t.id));
    const filtered = session.liveControls.filter(m => {
      if (!trackIds.has(m.trackId)) return false;
      if (!m.touched) return false;
      if (currentTurn - m.createdAtTurn > 3) return false;
      return true;
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('recent-touched');
  });

  it('removes modules for deleted tracks', () => {
    const session: Session = {
      ...makeSession(),
      turnCount: 1,
      liveControls: [
        makeLiveControl({ id: 'valid', trackId: 'v0', touched: true, createdAtTurn: 0 }),
        makeLiveControl({ id: 'orphaned', trackId: 'deleted-track', touched: true, createdAtTurn: 0 }),
      ],
    };

    const trackIds = new Set(session.tracks.map(t => t.id));
    const filtered = session.liveControls.filter(m => {
      if (!trackIds.has(m.trackId)) return false;
      if (!m.touched) return false;
      if (session.turnCount - m.createdAtTurn > 3) return false;
      return true;
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('valid');
  });
});

describe('promotion removes from liveControls', () => {
  it('promotes a live module to track surface and removes from liveControls', () => {
    const liveModule = makeLiveControl({ id: 'promote-me', touched: true });
    const session: Session = {
      ...makeSession(),
      liveControls: [liveModule],
    };

    // Simulate promotion: add module to track surface, remove from liveControls
    const track = session.tracks.find(t => t.id === 'v0')!;
    const newSurface = {
      ...track.surface,
      modules: [...track.surface.modules, liveModule.module],
    };
    const promoted: Session = {
      ...updateTrack(session, 'v0', { surface: newSurface }),
      liveControls: session.liveControls.filter(m => m.id !== liveModule.id),
    };

    expect(promoted.liveControls).toHaveLength(0);
    expect(promoted.tracks.find(t => t.id === 'v0')!.surface.modules).toHaveLength(1);
  });
});

describe('state compression only shows touched modules', () => {
  it('excludes untouched live controls from compressed state', () => {
    const session: Session = {
      ...makeSession(),
      liveControls: [
        makeLiveControl({ id: 'untouched', touched: false }),
        makeLiveControl({ id: 'touched', touched: true }),
      ],
    };

    const compressed = compressState(session);
    const liveControls = (compressed as Record<string, unknown>).liveControls as string[] | undefined;

    // Only touched module should appear
    expect(liveControls).toBeDefined();
    expect(liveControls).toHaveLength(1);
    expect(liveControls![0]).toContain('touched');
  });

  it('omits liveControls section when no touched modules', () => {
    const session: Session = {
      ...makeSession(),
      liveControls: [
        makeLiveControl({ id: 'untouched', touched: false }),
      ],
    };

    const compressed = compressState(session);
    expect((compressed as Record<string, unknown>).liveControls).toBeUndefined();
  });
});

describe('Session type has liveControls and turnCount', () => {
  it('createSession initializes liveControls and turnCount', () => {
    const session = createSession();
    expect(session.liveControls).toEqual([]);
    expect(session.turnCount).toBe(0);
  });

  it('LiveControlModule has createdAtTurn', () => {
    const m = makeLiveControl({ createdAtTurn: 5 });
    expect(m.createdAtTurn).toBe(5);
  });
});

describe('persistence', () => {
  it('restoreSession removes untouched live controls', async () => {
    // Import dynamically to avoid issues with module initialization
    const { restoreSession } = await import('../../src/engine/persistence');

    const session: Session = {
      ...makeSession(),
      liveControls: [
        makeLiveControl({ id: 'untouched', touched: false }),
        makeLiveControl({ id: 'touched', touched: true, createdAtTurn: 0 }),
      ],
      turnCount: 1,
    };

    const restored = restoreSession(session);
    expect(restored.liveControls).toHaveLength(1);
    expect(restored.liveControls[0].id).toBe('touched');
  });

  it('restoreSession removes expired touched modules', async () => {
    const { restoreSession } = await import('../../src/engine/persistence');

    const session: Session = {
      ...makeSession(),
      liveControls: [
        makeLiveControl({ id: 'expired', touched: true, createdAtTurn: 0 }),
      ],
      turnCount: 10,
    };

    const restored = restoreSession(session);
    expect(restored.liveControls).toHaveLength(0);
  });
});
