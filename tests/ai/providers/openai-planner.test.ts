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
      { call_id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.5 } } },
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
      args: { param: 'brightness', target: { absolute: 0.5 } },
    });
  });

  it('extracts parallel function calls from response', async () => {
    mockCreate.mockResolvedValueOnce(mockFunctionCallResponse([
      { call_id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.5 } } },
      { call_id: 'c2', name: 'move', args: { param: 'texture', target: { absolute: 0.8 } } },
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
        { call_id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.5 } } },
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
      { call_id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.5 } } },
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

  it('exchange-aware trimming preserves chaining from surviving suffix', async () => {
    // Commit 3 exchanges with distinct response IDs
    for (let i = 0; i < 3; i++) {
      mockCreate.mockResolvedValueOnce(mockTextResponse(`reply ${i}`, `resp_${i}`));
      await planner.startTurn({ systemPrompt: 's', userMessage: `msg ${i}`, tools: [] });
      planner.commitTurn();
    }

    // Trim to 2 — should drop resp_0, keep resp_1 and resp_2
    planner.trimHistory(2);

    // Next turn should chain from resp_2 (last surviving)
    mockCreate.mockResolvedValueOnce(mockTextResponse('after trim', 'resp_3'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'next', tools: [] });

    const call = mockCreate.mock.calls[3][0];
    expect(call.previous_response_id).toBe('resp_2');
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
