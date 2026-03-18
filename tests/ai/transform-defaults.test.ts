// tests/ai/transform-defaults.test.ts — Verify transform tool applies schema defaults
//
// The transform tool schema describes defaults for optional parameters
// (velocity_amount=0.3, timing_amount=0.1, rotation=0). The handler must
// enforce these when the caller omits them.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GluonAI } from '../../src/ai/api';
import { GLUON_TOOLS } from '../../src/ai/tool-schemas';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse, ToolSchema } from '../../src/ai/types';
import { createSession, addTrack } from '../../src/engine/session';
import type { AITransformAction, AIAction } from '../../src/engine/types';

// ---------------------------------------------------------------------------
// Mock providers (same pattern as api-structural.test.ts)
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

    startTurn: vi.fn(async (_opts: { systemPrompt: string; userMessage: string; tools: ToolSchema[] }): Promise<GenerateResult> => {
      return planner.startTurnResults.shift() ?? { textParts: [], functionCalls: [] };
    }),

    continueTurn: vi.fn(async (opts: { systemPrompt: string; tools: ToolSchema[]; functionResponses: FunctionResponse[] }): Promise<GenerateResult> => {
      planner.lastFunctionResponses = opts.functionResponses;
      return planner.continueTurnResults.shift() ?? { textParts: [], functionCalls: [] };
    }),

    commitTurn: vi.fn(() => {}),
    discardTurn: vi.fn(() => {}),
    trimHistory: vi.fn((_n: number) => {}),
    clearHistory: vi.fn(() => {}),
  };
  return planner;
}

function createMockListener(): ListenerProvider {
  return {
    name: 'mock',
    isConfigured: () => true,
    evaluate: vi.fn(async () => 'sounds good'),
  };
}

// ---------------------------------------------------------------------------
// Helper: run a transform tool call and return the resulting actions
// ---------------------------------------------------------------------------

async function runTransform(
  ai: GluonAI,
  planner: ReturnType<typeof createMockPlanner>,
  args: Record<string, unknown>,
): Promise<AITransformAction[]> {
  planner.startTurnResults.push({
    textParts: [],
    functionCalls: [{ id: 'test-transform', name: 'transform', args }],
  });
  planner.continueTurnResults.push({ textParts: [], functionCalls: [] });

  const session = createSession();
  addTrack(session);

  const actions: AIAction[] = await ai.ask(session, 'test');
  return actions.filter((a): a is AITransformAction => a.type === 'transform');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Transform tool param defaults', () => {
  let planner: ReturnType<typeof createMockPlanner>;
  let listener: ReturnType<typeof createMockListener>;
  let ai: GluonAI;

  beforeEach(() => {
    planner = createMockPlanner();
    listener = createMockListener();
    ai = new GluonAI(planner, listener);
  });

  it('applies schema defaults when optional params are omitted', async () => {
    const transforms = await runTransform(ai, planner, {
      trackId: 'Track 1',
      operation: 'humanize',
      description: 'test humanize defaults',
    });

    expect(transforms).toHaveLength(1);
    const action = transforms[0];
    expect(action.velocity_amount).toBe(0.3);
    expect(action.timing_amount).toBe(0.1);
    expect(action.rotation).toBe(0);
  });

  it('uses explicit values when provided', async () => {
    const transforms = await runTransform(ai, planner, {
      trackId: 'Track 1',
      operation: 'humanize',
      description: 'test explicit values',
      velocity_amount: 0.7,
      timing_amount: 0.5,
      rotation: 3,
    });

    expect(transforms).toHaveLength(1);
    const action = transforms[0];
    expect(action.velocity_amount).toBe(0.7);
    expect(action.timing_amount).toBe(0.5);
    expect(action.rotation).toBe(3);
  });

  it('applies defaults only to omitted params when partially specified', async () => {
    const transforms = await runTransform(ai, planner, {
      trackId: 'Track 1',
      operation: 'euclidean',
      description: 'test partial defaults',
      hits: 5,
      velocity_amount: 0.9,
      // timing_amount and rotation omitted — should get defaults
    });

    expect(transforms).toHaveLength(1);
    const action = transforms[0];
    expect(action.velocity_amount).toBe(0.9);
    expect(action.timing_amount).toBe(0.1);
    expect(action.rotation).toBe(0);
    expect(action.hits).toBe(5);
  });
});
