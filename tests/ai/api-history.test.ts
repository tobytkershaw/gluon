// tests/ai/api-history.test.ts — Orchestrator tests using mock providers
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GluonAI } from '../../src/ai/api';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse, ToolSchema } from '../../src/ai/types';
import { ProviderError } from '../../src/ai/types';
import { createSession } from '../../src/engine/session';

// ---------------------------------------------------------------------------
// Mock planner that records calls and returns configurable responses
// ---------------------------------------------------------------------------

function createMockPlanner(): PlannerProvider & {
  startTurnResults: GenerateResult[];
  continueTurnResults: GenerateResult[];
  startTurnCalls: number;
  continueTurnCalls: number;
  committed: number;
  discarded: number;
  trimCalls: Array<number>;
  clearCalls: number;
  userMessages: string[];
} {
  const planner = {
    name: 'mock',
    startTurnResults: [] as GenerateResult[],
    continueTurnResults: [] as GenerateResult[],
    startTurnCalls: 0,
    continueTurnCalls: 0,
    committed: 0,
    discarded: 0,
    trimCalls: [] as number[],
    clearCalls: 0,
    userMessages: [] as string[],

    isConfigured: () => true,

    startTurn: vi.fn(async (opts: { systemPrompt: string; userMessage: string; tools: ToolSchema[] }): Promise<GenerateResult> => {
      planner.startTurnCalls++;
      planner.userMessages.push(opts.userMessage);
      return planner.startTurnResults.shift() ?? { textParts: [], functionCalls: [] };
    }),

    continueTurn: vi.fn(async (_opts: { systemPrompt: string; tools: ToolSchema[]; functionResponses: FunctionResponse[] }): Promise<GenerateResult> => {
      planner.continueTurnCalls++;
      return planner.continueTurnResults.shift() ?? { textParts: [], functionCalls: [] };
    }),

    commitTurn: vi.fn(() => { planner.committed++; }),
    discardTurn: vi.fn(() => { planner.discarded++; }),
    trimHistory: vi.fn((n: number) => { planner.trimCalls.push(n); }),
    clearHistory: vi.fn(() => { planner.clearCalls++; }),
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

describe('GluonAI Orchestrator (provider-agnostic)', () => {
  let planner: ReturnType<typeof createMockPlanner>;
  let listener: ReturnType<typeof createMockListener>;
  let ai: GluonAI;

  beforeEach(() => {
    planner = createMockPlanner();
    listener = createMockListener();
    ai = new GluonAI(planner, listener);
  });

  it('trims history before each ask', async () => {
    planner.startTurnResults.push({ textParts: ['ok'], functionCalls: [] });
    const session = createSession();
    await ai.ask(session, 'hello');
    expect(planner.trimCalls).toEqual([12]);
  });

  it('commits turn on success', async () => {
    planner.startTurnResults.push({ textParts: ['ok'], functionCalls: [] });
    const session = createSession();
    await ai.ask(session, 'hello');
    expect(planner.committed).toBe(1);
    expect(planner.discarded).toBe(0);
  });

  it('discards turn on error', async () => {
    planner.startTurn = vi.fn(async () => { throw new Error('network fail'); });
    const session = createSession();
    await ai.ask(session, 'hello');
    expect(planner.committed).toBe(0);
    expect(planner.discarded).toBe(1);
  });

  it('discards turn when stale', async () => {
    planner.startTurnResults.push({ textParts: ['ok'], functionCalls: [] });
    const session = createSession();
    await ai.ask(session, 'hello', { isStale: () => true });
    expect(planner.committed).toBe(0);
    expect(planner.discarded).toBe(1);
  });

  it('collects text-only responses as say actions', async () => {
    planner.startTurnResults.push({ textParts: ['Water is indeed wet.'], functionCalls: [] });
    const session = createSession();
    const actions = await ai.ask(session, 'water is wet');
    const sayActions = actions.filter(a => a.type === 'say');
    expect(sayActions).toHaveLength(1);
    if (sayActions[0].type === 'say') {
      expect(sayActions[0].text).toBe('Water is indeed wet.');
    }
  });

  it('converts move function call to AIMoveAction', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.7 }, trackId: 'v0' } }],
    });
    planner.continueTurnResults.push({ textParts: ['Done.'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'brighten the kick');

    const moveActions = actions.filter(a => a.type === 'move');
    expect(moveActions).toHaveLength(1);
    expect(moveActions[0]).toMatchObject({
      type: 'move',
      param: 'brightness',
      target: { absolute: 0.7 },
      trackId: 'v0',
    });
  });

  it('converts sketch function call to AISketchAction', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{
        id: 'c1', name: 'sketch', args: {
          trackId: 'v0', description: 'four on the floor',
          events: [
            { kind: 'trigger', at: 0, velocity: 1.0, accent: true },
            { kind: 'trigger', at: 4, velocity: 0.8 },
          ],
        },
      }],
    });
    planner.continueTurnResults.push({ textParts: ['Here you go.'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'make a kick pattern');

    const sketchActions = actions.filter(a => a.type === 'sketch');
    expect(sketchActions).toHaveLength(1);
    if (sketchActions[0].type === 'sketch') {
      expect(sketchActions[0].trackId).toBe('v0');
      expect(sketchActions[0].events).toHaveLength(2);
    }
  });

  it('converts set_transport function call to AITransportAction', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'set_transport', args: { bpm: 140, swing: 0.3 } }],
    });
    planner.continueTurnResults.push({ textParts: ['Speeded up.'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'speed it up');

    const transportActions = actions.filter(a => a.type === 'set_transport');
    expect(transportActions).toHaveLength(1);
    expect(transportActions[0]).toMatchObject({
      type: 'set_transport',
      bpm: 140,
      swing: 0.3,
    });
  });

  it('handles multiple tool calls in one turn', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [
        { id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.3 } } },
        { id: 'c2', name: 'set_transport', args: { bpm: 90 } },
      ],
    });
    planner.continueTurnResults.push({ textParts: ['Darkened and slowed.'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'darken and slow down');

    expect(actions.filter(a => a.type === 'move')).toHaveLength(1);
    expect(actions.filter(a => a.type === 'set_transport')).toHaveLength(1);
    expect(actions.filter(a => a.type === 'say')).toHaveLength(1);
  });

  it('respects MAX_PLANNER_INVOCATIONS limit', async () => {
    // Always return function calls — should stop after 5 invocations
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c0', name: 'move', args: { param: 'brightness', target: { absolute: 0.5 } } }],
    });
    for (let i = 1; i < 5; i++) {
      planner.continueTurnResults.push({
        textParts: [],
        functionCalls: [{ id: `c${i}`, name: 'move', args: { param: 'brightness', target: { absolute: 0.5 } } }],
      });
    }

    const session = createSession();
    const actions = await ai.ask(session, 'keep going');

    // 5 invocations total: 1 startTurn + 4 continueTurn
    expect(actions.filter(a => a.type === 'move')).toHaveLength(5);
    expect(planner.startTurnCalls).toBe(1);
    expect(planner.continueTurnCalls).toBe(4);
  });

  it('cancellation prevents further API calls', async () => {
    let stale = false;
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.5 } } }],
    });

    const session = createSession();
    const actions = await ai.ask(session, 'test', {
      isStale: () => {
        const wasStale = stale;
        stale = true;
        return wasStale;
      },
    });

    // First invocation proceeds, second round cancelled by stale check
    expect(planner.startTurnCalls).toBe(1);
    expect(planner.continueTurnCalls).toBe(0);
    expect(actions.filter(a => a.type === 'move')).toHaveLength(1);
  });

  it('stale request discards turn', async () => {
    const session = createSession();
    await ai.ask(session, 'stale message', { isStale: () => true });
    expect(planner.startTurnCalls).toBe(0); // short-circuited before startTurn
    expect(planner.discarded).toBe(1);
  });

  it('returns error response for move with missing param', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'move', args: { target: { absolute: 0.5 } } }],
    });
    planner.continueTurnResults.push({ textParts: ['Sorry about that.'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'move something');

    expect(actions.filter(a => a.type === 'move')).toHaveLength(0);
    expect(actions.filter(a => a.type === 'say')).toHaveLength(1);
  });

  it('returns error response for move with missing target', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'move', args: { param: 'brightness' } }],
    });
    planner.continueTurnResults.push({ textParts: ['I need a target value.'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'brighten');

    expect(actions.filter(a => a.type === 'move')).toHaveLength(0);
  });

  it('returns error response for sketch with missing trackId', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'sketch', args: { description: 'kick', events: [] } }],
    });
    planner.continueTurnResults.push({ textParts: ['Which track?'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'make a pattern');

    expect(actions.filter(a => a.type === 'sketch')).toHaveLength(0);
  });

  it('returns error response for sketch with non-array events', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'sketch', args: { trackId: 'v0', description: 'kick', events: 'not-array' } }],
    });
    planner.continueTurnResults.push({ textParts: ['Let me fix that.'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'make a kick');

    expect(actions.filter(a => a.type === 'sketch')).toHaveLength(0);
  });

  it('returns error response for set_transport with no valid fields', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'set_transport', args: {} }],
    });
    planner.continueTurnResults.push({ textParts: ['What should I change?'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'change transport');

    expect(actions.filter(a => a.type === 'set_transport')).toHaveLength(0);
  });

  it('validateAction rejection prevents action collection and returns error to model', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.7 }, trackId: 'v0' } }],
    });
    planner.continueTurnResults.push({ textParts: ['That track has agency off, sorry.'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'brighten the kick', {
      validateAction: () => 'Track v0 has agency OFF',
    });

    expect(actions.filter(a => a.type === 'move')).toHaveLength(0);
    expect(actions.filter(a => a.type === 'say')).toHaveLength(1);
  });

  it('validateAction null allows action to be collected', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.7 }, trackId: 'v0' } }],
    });
    planner.continueTurnResults.push({ textParts: ['Done.'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'brighten the kick', {
      validateAction: () => null,
    });

    expect(actions.filter(a => a.type === 'move')).toHaveLength(1);
  });

  it('clearHistory delegates to planner', () => {
    ai.clearHistory();
    expect(planner.clearCalls).toBe(1);
  });

  it('continueTurn receives function responses with correct structure', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.7 }, trackId: 'v0' } }],
    });
    planner.continueTurnResults.push({ textParts: ['Done.'], functionCalls: [] });

    const session = createSession();
    await ai.ask(session, 'brighten');

    expect(planner.continueTurn).toHaveBeenCalledTimes(1);
    const callArgs = (planner.continueTurn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.functionResponses).toHaveLength(1);
    expect(callArgs.functionResponses[0]).toMatchObject({
      id: 'c1',
      name: 'move',
      result: expect.objectContaining({ applied: true }),
    });
  });

  it('handles ProviderError with rate_limited kind', async () => {
    planner.startTurn = vi.fn(async () => {
      throw new ProviderError('Rate limited', 'rate_limited', 5000);
    });

    const session = createSession();
    const actions = await ai.ask(session, 'hello');

    const sayActions = actions.filter(a => a.type === 'say');
    expect(sayActions).toHaveLength(1);
    if (sayActions[0].type === 'say') {
      expect(sayActions[0].text).toContain('Rate limited');
    }
  });

  it('handles ProviderError with auth kind', async () => {
    planner.startTurn = vi.fn(async () => {
      throw new ProviderError('Invalid key', 'auth');
    });

    const session = createSession();
    const actions = await ai.ask(session, 'hello');

    const sayActions = actions.filter(a => a.type === 'say');
    expect(sayActions).toHaveLength(1);
    if (sayActions[0].type === 'say') {
      expect(sayActions[0].text).toContain('API key invalid');
    }
  });

  it('includes compressed state in user message', async () => {
    planner.startTurnResults.push({ textParts: ['ok'], functionCalls: [] });
    const session = createSession();
    await ai.ask(session, 'test message');

    expect(planner.userMessages).toHaveLength(1);
    expect(planner.userMessages[0]).toContain('Project state:');
    expect(planner.userMessages[0]).toContain('Human says: test message');
  });
});
