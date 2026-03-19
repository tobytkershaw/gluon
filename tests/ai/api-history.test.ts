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
      functionCalls: [{ id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.7 }, trackId: 'v0' } }],
    });
    planner.continueTurnResults.push({ textParts: ['Done.'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'brighten the kick');

    const moveActions = actions.filter(a => a.type === 'move');
    expect(moveActions).toHaveLength(1);
    expect(moveActions[0]).toMatchObject({
      type: 'move',
      param: 'timbre',
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
        { id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.3 } } },
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

  it('respects MAX_STREAMING_STEPS limit', async () => {
    // Always return function calls — should stop after MAX_STREAMING_STEPS (10)
    // Use different target values each time so the circuit breaker doesn't
    // short-circuit them as duplicate successful calls (see #918).
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c0', name: 'move', args: { param: 'timbre', target: { absolute: 0.0 } } }],
    });
    // Enqueue enough continue results to exceed the step limit
    for (let i = 1; i <= 12; i++) {
      planner.continueTurnResults.push({
        textParts: [],
        functionCalls: [{ id: `c${i}`, name: 'move', args: { param: 'timbre', target: { absolute: i / 20 } } }],
      });
    }

    const session = createSession();
    const actions = await ai.ask(session, 'keep going');

    // MAX_STREAMING_STEPS = 10: processes startTurn + 9 continueTurn rounds
    // (stepCount increments after each round; loop exits when stepCount === 10)
    expect(actions.filter(a => a.type === 'move')).toHaveLength(10);
    expect(planner.startTurnCalls).toBe(1);
    expect(planner.continueTurnCalls).toBe(9);
  });

  it('cancellation prevents further API calls', async () => {
    let stale = false;
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 } } }],
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
      functionCalls: [{ id: 'c1', name: 'move', args: { param: 'timbre' } }],
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

  it('validateAction agency rejection raises decision instead of hard error', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.7 }, trackId: 'v0' } }],
    });
    planner.continueTurnResults.push({ textParts: ['I need permission for that track.'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'brighten the kick', {
      validateAction: (_s, _a) => 'Agency: Track v0 has agency OFF',
    });

    // Move should not be applied
    expect(actions.filter(a => a.type === 'move')).toHaveLength(0);
    // A raise_decision should be emitted for the human to approve/deny
    const decisions = actions.filter(a => a.type === 'raise_decision');
    expect(decisions).toHaveLength(1);
    expect(actions.filter(a => a.type === 'say')).toHaveLength(1);
  });

  it('validateAction non-agency rejection returns hard error to model', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.7 }, trackId: 'v0' } }],
    });
    planner.continueTurnResults.push({ textParts: ['That failed.'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'brighten the kick', {
      validateAction: (_s, _a) => 'Arbitration: human is holding timbre',
    });

    expect(actions.filter(a => a.type === 'move')).toHaveLength(0);
    expect(actions.filter(a => a.type === 'raise_decision')).toHaveLength(0);
    expect(actions.filter(a => a.type === 'say')).toHaveLength(1);
  });

  it('validateAction null allows action to be collected', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.7 }, trackId: 'v0' } }],
    });
    planner.continueTurnResults.push({ textParts: ['Done.'], functionCalls: [] });

    const session = createSession();
    const actions = await ai.ask(session, 'brighten the kick', {
      validateAction: (_s, _a) => null,
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
      functionCalls: [{ id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.7 }, trackId: 'v0' } }],
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

  it('does not commit turn when model returns empty response', async () => {
    // Simulate safety filter suppression or thinking-only response
    planner.startTurnResults.push({ textParts: [], functionCalls: [] });
    const session = createSession();
    await ai.ask(session, 'filtered message');

    // Empty response should discard, not commit — prevents orphaned user-only exchanges
    expect(planner.committed).toBe(0);
    expect(planner.discarded).toBe(1);
  });

  it('isConfigured returns false when providers have empty keys', () => {
    const emptyPlanner = createMockPlanner();
    emptyPlanner.isConfigured = () => false;
    const emptyListener = createMockListener();
    emptyListener.isConfigured = () => false;
    const unconfiguredAI = new GluonAI(emptyPlanner, emptyListener);
    expect(unconfiguredAI.isConfigured()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Token-budget-aware trimming (Phase 1a, #785)
  // -------------------------------------------------------------------------

  describe('token-budget-aware trimming', () => {
    it('skips trimming when provider reports under budget', async () => {
      const tokenPlanner = createMockPlanner();
      tokenPlanner.startTurnResults.push({ textParts: ['ok'], functionCalls: [] });
      // Token-aware provider: under budget
      tokenPlanner.countContextTokens = vi.fn(async () => 50_000);
      tokenPlanner.getTokenBudget = () => 170_000;
      tokenPlanner.getExchangeCount = () => 10;

      const tokenAI = new GluonAI(tokenPlanner, listener);
      const session = createSession();
      await tokenAI.ask(session, 'hello');

      // Should NOT have called trimHistory — we're under budget
      expect(tokenPlanner.trimCalls).toEqual([]);
      // countContextTokens should have been called once
      expect(tokenPlanner.countContextTokens).toHaveBeenCalledTimes(1);
    });

    it('trims exchanges when provider reports over budget', async () => {
      const tokenPlanner = createMockPlanner();
      tokenPlanner.startTurnResults.push({ textParts: ['ok'], functionCalls: [] });
      // Start over budget, then under after trim
      let callCount = 0;
      tokenPlanner.countContextTokens = vi.fn(async () => {
        callCount++;
        return callCount === 1 ? 200_000 : 100_000; // Over, then under
      });
      tokenPlanner.getTokenBudget = () => 170_000;
      tokenPlanner.getExchangeCount = () => 20;

      const tokenAI = new GluonAI(tokenPlanner, listener);
      const session = createSession();
      await tokenAI.ask(session, 'hello');

      // Should have trimmed
      expect(tokenPlanner.trimCalls.length).toBeGreaterThan(0);
      // The kept count should be less than the original 20
      expect(tokenPlanner.trimCalls[0]).toBeLessThan(20);
    });

    it('falls back to exchange cap when countContextTokens throws', async () => {
      const tokenPlanner = createMockPlanner();
      tokenPlanner.startTurnResults.push({ textParts: ['ok'], functionCalls: [] });
      tokenPlanner.countContextTokens = vi.fn(async () => { throw new Error('network'); });
      tokenPlanner.getTokenBudget = () => 170_000;
      tokenPlanner.getExchangeCount = () => 5; // Must be > 0 to enter token counting path

      const tokenAI = new GluonAI(tokenPlanner, listener);
      const session = createSession();
      await tokenAI.ask(session, 'hello');

      // Should fall back to the exchange-count cap
      expect(tokenPlanner.trimCalls).toEqual([12]);
    });

    it('falls back to exchange cap for providers without countContextTokens', async () => {
      // The default mock planner has no countContextTokens — this is the existing test
      planner.startTurnResults.push({ textParts: ['ok'], functionCalls: [] });
      const session = createSession();
      await ai.ask(session, 'hello');
      expect(planner.trimCalls).toEqual([12]);
    });

    it('calls summarizeBeforeTrim instead of trimHistory when available', async () => {
      const tokenPlanner = createMockPlanner();
      tokenPlanner.startTurnResults.push({ textParts: ['ok'], functionCalls: [] });
      let callCount = 0;
      tokenPlanner.countContextTokens = vi.fn(async () => {
        callCount++;
        return callCount === 1 ? 200_000 : 100_000;
      });
      tokenPlanner.getTokenBudget = () => 170_000;
      tokenPlanner.getExchangeCount = () => 20;

      const summarizeCalls: Array<{ messages: unknown[]; keepCount: number }> = [];
      tokenPlanner.summarizeBeforeTrim = vi.fn(async (msgs: unknown[], keep: number) => {
        summarizeCalls.push({ messages: msgs, keepCount: keep });
      });

      const tokenAI = new GluonAI(tokenPlanner, listener);
      const session = createSession();
      // Add some messages to session so extractOldestExchanges has data
      session.messages.push(
        { role: 'human', text: 'make a beat', timestamp: 1 },
        { role: 'ai', text: 'here is a beat', timestamp: 2 },
        { role: 'human', text: 'add hi-hat', timestamp: 3 },
        { role: 'ai', text: 'added', timestamp: 4 },
      );
      await tokenAI.ask(session, 'hello');

      // Should have called summarizeBeforeTrim, not trimHistory
      expect(summarizeCalls.length).toBeGreaterThan(0);
      expect(tokenPlanner.trimCalls).toEqual([]); // trimHistory should NOT be called directly
    });

    it('injects context summary into user message', async () => {
      const tokenPlanner = createMockPlanner();
      tokenPlanner.startTurnResults.push({ textParts: ['ok'], functionCalls: [] });
      tokenPlanner.getContextSummary = () => 'Track 1 is a kick in a techno project';

      const tokenAI = new GluonAI(tokenPlanner, listener);
      const session = createSession();
      await tokenAI.ask(session, 'brighten it');

      expect(tokenPlanner.userMessages).toHaveLength(1);
      expect(tokenPlanner.userMessages[0]).toContain('[Session memory — summarized from earlier conversation]');
      expect(tokenPlanner.userMessages[0]).toContain('Track 1 is a kick in a techno project');
      expect(tokenPlanner.userMessages[0]).toContain('Human says: brighten it');
    });

    it('does not inject summary when getContextSummary returns null', async () => {
      const tokenPlanner = createMockPlanner();
      tokenPlanner.startTurnResults.push({ textParts: ['ok'], functionCalls: [] });
      tokenPlanner.getContextSummary = () => null;

      const tokenAI = new GluonAI(tokenPlanner, listener);
      const session = createSession();
      await tokenAI.ask(session, 'hello');

      expect(tokenPlanner.userMessages[0]).not.toContain('Session memory');
    });
  });

  // -------------------------------------------------------------------------
  // Circuit breaker: repeated failing call detection
  // -------------------------------------------------------------------------

  it('short-circuits repeated failing calls across rounds', async () => {
    // Round 1: move to a non-existent track → fails
    // Round 2: model retries same call → should get synthetic error, not re-execute
    // Round 3: model gives up
    const badCall = { id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.7 }, trackId: 'v99' } };

    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [badCall],
    });
    // Round 2: model retries the exact same call
    planner.continueTurnResults.push({
      textParts: [],
      functionCalls: [{ ...badCall, id: 'c2' }],
    });
    // Round 3: model gives up
    planner.continueTurnResults.push({
      textParts: ['That track does not exist.'],
      functionCalls: [],
    });

    const session = createSession();
    const actions = await ai.ask(session, 'brighten track 99');

    // Both rounds should produce function responses (round 1 real error, round 2 synthetic)
    expect(planner.continueTurnCalls).toBe(2);

    // The second round's function response should contain the "already failed" message
    const round2Args = (planner.continueTurn as ReturnType<typeof vi.fn>).mock.calls[1][0];
    const round2Response = round2Args.functionResponses[0].result;
    expect(round2Response.error).toContain('already failed');

    // Final say should be present
    expect(actions.filter(a => a.type === 'say')).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Enriched error payloads
  // -------------------------------------------------------------------------

  it('returns enriched error with available tracks when track ID is unknown', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.7 }, trackId: 'nonexistent' } }],
    });
    planner.continueTurnResults.push({ textParts: ['Not found.'], functionCalls: [] });

    const session = createSession();
    await ai.ask(session, 'brighten nonexistent');

    // The first continueTurn should have received an enriched error
    const callArgs = (planner.continueTurn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const response = callArgs.functionResponses[0].result;
    expect(response.error).toContain('Unknown track');
    expect(response.hint).toBeDefined();
    expect(response.available).toBeInstanceOf(Array);
    expect(response.available.length).toBeGreaterThan(0);
    // Available should contain track ID = label mappings
    expect(response.available[0]).toContain('=');
  });

  it('returns enriched error with available archetypes when archetype is unknown', async () => {
    planner.startTurnResults.push({
      textParts: [],
      functionCalls: [{ id: 'c1', name: 'sketch', args: { trackId: 'v0', archetype: 'nonexistent_pattern', description: 'test' } }],
    });
    planner.continueTurnResults.push({ textParts: ['Not found.'], functionCalls: [] });

    const session = createSession();
    await ai.ask(session, 'use nonexistent pattern');

    const callArgs = (planner.continueTurn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const response = callArgs.functionResponses[0].result;
    expect(response.error).toContain('Unknown archetype');
    expect(response.available).toBeInstanceOf(Array);
    expect(response.available).toContain('four_on_the_floor');
  });
});
