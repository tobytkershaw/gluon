// tests/ai/providers/openai-planner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderError } from '../../../src/ai/types';

// Mock the openai module
const mockCreate = vi.fn();
vi.mock('openai', () => {
  class RateLimitError extends Error { constructor(m: string) { super(m); this.name = 'RateLimitError'; } }
  class AuthenticationError extends Error { constructor(m: string) { super(m); this.name = 'AuthenticationError'; } }
  class InternalServerError extends Error { constructor(m: string) { super(m); this.name = 'InternalServerError'; } }

  class MockOpenAI {
    responses = { create: mockCreate };
  }

  // Attach error classes as static properties (matches real SDK export pattern)
  Object.assign(MockOpenAI, { RateLimitError, AuthenticationError, InternalServerError });

  return { default: MockOpenAI, RateLimitError, AuthenticationError, InternalServerError };
});

import { OpenAIPlannerProvider } from '../../../src/ai/providers/openai-planner';
import { GLUON_TOOLS } from '../../../src/ai/tool-schemas';

function mockTextResponse(text: string, id = 'resp_1'): Record<string, unknown> {
  return {
    id,
    output: [
      {
        type: 'message',
        id: 'msg_1',
        content: [{ type: 'output_text', text }],
      },
    ],
  };
}

function mockFunctionCallResponse(
  functionCalls: Array<{ call_id: string; name: string; args: Record<string, unknown> }>,
  id = 'resp_1',
): Record<string, unknown> {
  return {
    id,
    output: functionCalls.map(fc => ({
      type: 'function_call',
      call_id: fc.call_id,
      name: fc.name,
      arguments: JSON.stringify(fc.args),
    })),
  };
}

describe('OpenAIPlannerProvider', () => {
  let planner: OpenAIPlannerProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    planner = new OpenAIPlannerProvider('test-key');
  });

  it('isConfigured returns true with valid key', () => {
    expect(planner.isConfigured()).toBe(true);
  });

  it('isConfigured returns false with empty key', () => {
    const empty = new OpenAIPlannerProvider('');
    expect(empty.isConfigured()).toBe(false);
  });

  it('extracts text parts from response', async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse('hello'));
    const result = await planner.startTurn({
      systemPrompt: 'system',
      userMessage: 'hi',
      tools: GLUON_TOOLS,
    });
    expect(result.textParts).toEqual(['hello']);
    expect(result.functionCalls).toEqual([]);
  });

  it('extracts function calls from response', async () => {
    mockCreate.mockResolvedValueOnce(mockFunctionCallResponse([
      { call_id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 } } },
    ]));
    const result = await planner.startTurn({
      systemPrompt: 'system',
      userMessage: 'brighten',
      tools: GLUON_TOOLS,
    });
    expect(result.functionCalls).toHaveLength(1);
    expect(result.functionCalls[0]).toEqual({
      id: 'c1',
      name: 'move',
      args: { param: 'timbre', target: { absolute: 0.5 } },
    });
  });

  it('extracts parallel function calls from response', async () => {
    mockCreate.mockResolvedValueOnce(mockFunctionCallResponse([
      { call_id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 } } },
      { call_id: 'c2', name: 'move', args: { param: 'morph', target: { absolute: 0.8 } } },
    ]));
    const result = await planner.startTurn({
      systemPrompt: 'system',
      userMessage: 'adjust both',
      tools: GLUON_TOOLS,
    });
    expect(result.functionCalls).toHaveLength(2);
    expect(result.functionCalls[0].id).toBe('c1');
    expect(result.functionCalls[1].id).toBe('c2');
  });

  it('function response round-tripping via continueTurn', async () => {
    mockCreate
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { call_id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 } } },
      ], 'resp_turn1'))
      .mockResolvedValueOnce(mockTextResponse('Done.', 'resp_turn1b'));

    await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });

    const result = await planner.continueTurn({
      systemPrompt: 'system',
      tools: GLUON_TOOLS,
      functionResponses: [{ id: 'c1', name: 'move', result: { applied: true } }],
    });

    expect(result.textParts).toEqual(['Done.']);

    // Verify the second call includes function_call_output with correct call_id
    const call = mockCreate.mock.calls[1][0];
    const funcOutput = call.input.find(
      (item: Record<string, unknown>) => item.type === 'function_call_output',
    );
    expect(funcOutput).toBeDefined();
    expect(funcOutput.call_id).toBe('c1');
    expect(funcOutput.output).toBe(JSON.stringify({ applied: true }));
  });

  it('chains responses via previous_response_id', async () => {
    // First exchange
    mockCreate.mockResolvedValueOnce(mockTextResponse('first reply', 'resp_1'));
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'first', tools: GLUON_TOOLS });
    planner.commitTurn();

    // Second exchange should chain from resp_1
    mockCreate.mockResolvedValueOnce(mockTextResponse('second reply', 'resp_2'));
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'second', tools: GLUON_TOOLS });

    const call = mockCreate.mock.calls[1][0];
    expect(call.previous_response_id).toBe('resp_1');
  });

  it('mid-turn continuation chains from pending response, not committed', async () => {
    // Commit an exchange
    mockCreate.mockResolvedValueOnce(mockTextResponse('committed', 'resp_committed'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'first', tools: [] });
    planner.commitTurn();

    // Start a new turn — chains from committed
    mockCreate.mockResolvedValueOnce(mockFunctionCallResponse([
      { call_id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 } } },
    ], 'resp_pending'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'second', tools: GLUON_TOOLS });

    // Continue the turn — should chain from pending (resp_pending), not committed (resp_committed)
    mockCreate.mockResolvedValueOnce(mockTextResponse('done', 'resp_pending_b'));
    await planner.continueTurn({
      systemPrompt: 's',
      tools: GLUON_TOOLS,
      functionResponses: [{ id: 'c1', name: 'move', result: { ok: true } }],
    });

    const continueCall = mockCreate.mock.calls[2][0];
    expect(continueCall.previous_response_id).toBe('resp_pending');
  });

  it('trimHistory replays surviving exchanges as input without chaining', async () => {
    // Commit 3 exchanges with distinct response IDs
    for (let i = 0; i < 3; i++) {
      mockCreate.mockResolvedValueOnce(mockTextResponse(`reply ${i}`, `resp_${i}`));
      await planner.startTurn({ systemPrompt: 's', userMessage: `msg ${i}`, tools: [] });
      planner.commitTurn();
    }

    // Trim to 2 — should drop exchange 0, keep exchanges 1 and 2
    planner.trimHistory(2);

    // Next turn should NOT chain via previous_response_id (chain is broken)
    // and should replay the surviving exchanges as input items
    mockCreate.mockResolvedValueOnce(mockTextResponse('after trim', 'resp_3'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'next', tools: [] });

    const call = mockCreate.mock.calls[3][0];
    // No previous_response_id — chain was broken by trim
    expect(call.previous_response_id).toBeUndefined();

    // Input should contain replayed exchanges (user + model output for each)
    // plus the new user message
    const userMessages = call.input.filter(
      (item: Record<string, unknown>) => item.role === 'user',
    );
    // 2 surviving exchanges + 1 new message = 3 user messages
    expect(userMessages).toHaveLength(3);
    expect(userMessages[0].content).toBe('msg 1');
    expect(userMessages[1].content).toBe('msg 2');
    expect(userMessages[2].content).toBe('next');

    // Model output items from surviving exchanges should also be replayed
    const messageItems = call.input.filter(
      (item: Record<string, unknown>) => item.type === 'message',
    );
    expect(messageItems).toHaveLength(2); // one per surviving exchange
  });

  it('after trim + commit, chain is re-established', async () => {
    // Commit 3 exchanges
    for (let i = 0; i < 3; i++) {
      mockCreate.mockResolvedValueOnce(mockTextResponse(`reply ${i}`, `resp_${i}`));
      await planner.startTurn({ systemPrompt: 's', userMessage: `msg ${i}`, tools: [] });
      planner.commitTurn();
    }

    // Trim to 2 — breaks the chain
    planner.trimHistory(2);

    // First post-trim turn: replays as input (no chain)
    mockCreate.mockResolvedValueOnce(mockTextResponse('post-trim', 'resp_post_trim'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'after trim', tools: [] });
    planner.commitTurn();

    // Second post-trim turn: chain is re-established via resp_post_trim
    mockCreate.mockResolvedValueOnce(mockTextResponse('chained again', 'resp_chained'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'should chain', tools: [] });

    const call = mockCreate.mock.calls[4][0];
    expect(call.previous_response_id).toBe('resp_post_trim');
    // Input should be just the new user message (no replay needed)
    expect(call.input).toHaveLength(1);
    expect(call.input[0].content).toBe('should chain');
  });

  it('trimHistory with max larger than exchanges is a no-op', async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse('reply', 'resp_0'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'msg', tools: [] });
    planner.commitTurn();

    planner.trimHistory(10);

    mockCreate.mockResolvedValueOnce(mockTextResponse('ok', 'resp_1'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'next', tools: [] });

    const call = mockCreate.mock.calls[1][0];
    expect(call.previous_response_id).toBe('resp_0');
  });

  it('discardTurn clears pending without affecting committed chain', async () => {
    // Commit one exchange
    mockCreate.mockResolvedValueOnce(mockTextResponse('committed', 'resp_committed'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'first', tools: [] });
    planner.commitTurn();

    // Start and discard a turn
    mockCreate.mockResolvedValueOnce(mockTextResponse('discarded', 'resp_discarded'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'will discard', tools: [] });
    planner.discardTurn();

    // Next turn should still chain from committed, not discarded
    mockCreate.mockResolvedValueOnce(mockTextResponse('fresh', 'resp_fresh'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'new', tools: [] });

    const call = mockCreate.mock.calls[2][0];
    expect(call.previous_response_id).toBe('resp_committed');
  });

  it('clearHistory resets all state', async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse('reply', 'resp_0'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'msg', tools: [] });
    planner.commitTurn();
    planner.clearHistory();

    // Next call should have no previous_response_id
    mockCreate.mockResolvedValueOnce(mockTextResponse('fresh', 'resp_fresh'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'new', tools: [] });

    const call = mockCreate.mock.calls[1][0];
    expect(call.previous_response_id).toBeUndefined();
  });

  it('passes system prompt as instructions', async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse('ok'));
    await planner.startTurn({
      systemPrompt: 'You are a music assistant.',
      userMessage: 'test',
      tools: GLUON_TOOLS,
    });

    const call = mockCreate.mock.calls[0][0];
    expect(call.instructions).toBe('You are a music assistant.');
  });

  it('passes gpt-5.4 as model', async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse('ok'));
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });

    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe('gpt-5.4');
  });

  it('passes tools in OpenAI format', async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse('ok'));
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });

    const call = mockCreate.mock.calls[0][0];
    expect(call.tools).toBeDefined();
    expect(call.tools[0].type).toBe('function');
    expect(call.tools[0].name).toBe('move');
    expect(call.tools[0].parameters).toBeDefined();
  });

  it('handles empty response output gracefully', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'resp_empty', output: [] });
    const result = await planner.startTurn({
      systemPrompt: 'system',
      userMessage: 'test',
      tools: GLUON_TOOLS,
    });
    expect(result.textParts).toEqual([]);
    expect(result.functionCalls).toEqual([]);
  });

  it('translates RateLimitError to ProviderError rate_limited', async () => {
    // Use the mocked error class
    const { RateLimitError } = await import('openai');
    mockCreate.mockRejectedValueOnce(new RateLimitError('Rate limited'));

    try {
      await planner.startTurn({ systemPrompt: 's', userMessage: 'test', tools: [] });
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).kind).toBe('rate_limited');
    }
  });

  it('translates AuthenticationError to ProviderError auth', async () => {
    const { AuthenticationError } = await import('openai');
    mockCreate.mockRejectedValueOnce(new AuthenticationError('Invalid key'));

    try {
      await planner.startTurn({ systemPrompt: 's', userMessage: 'test', tools: [] });
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).kind).toBe('auth');
    }
  });

  it('translates InternalServerError to ProviderError server', async () => {
    const { InternalServerError } = await import('openai');
    mockCreate.mockRejectedValueOnce(new InternalServerError('Server error'));

    try {
      await planner.startTurn({ systemPrompt: 's', userMessage: 'test', tools: [] });
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).kind).toBe('server');
    }
  });

  it('first startTurn has no previous_response_id', async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse('hello', 'resp_first'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'first', tools: [] });

    const call = mockCreate.mock.calls[0][0];
    expect(call.previous_response_id).toBeUndefined();
  });
});
