// tests/ai/providers/gemini-planner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderError } from '../../../src/ai/types';

// Mock the @google/genai module
const mockGenerateContent = vi.fn();
const mockCountTokens = vi.fn();
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = { generateContent: mockGenerateContent, countTokens: mockCountTokens };
    },
    Type: {
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      ARRAY: 'ARRAY',
      OBJECT: 'OBJECT',
    },
    FunctionCallingConfigMode: {
      AUTO: 'AUTO',
    },
    createPartFromFunctionResponse: (id: string, name: string, response: Record<string, unknown>) => ({
      functionResponse: { id, name, response },
    }),
  };
});

import { GeminiPlannerProvider } from '../../../src/ai/providers/gemini-planner';
import { GLUON_TOOLS } from '../../../src/ai/tool-schemas';

function mockTextResponse(text: string, extraParts: Record<string, unknown>[] = []) {
  const textPart = { text };
  const parts = [textPart, ...extraParts];
  return {
    text,
    functionCalls: undefined,
    candidates: [{ content: { role: 'model', parts } }],
  };
}

function mockFunctionCallResponse(functionCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>) {
  const parts = functionCalls.map(fc => ({ functionCall: fc }));
  return {
    text: undefined,
    functionCalls,
    candidates: [{ content: { role: 'model', parts } }],
  };
}

describe('GeminiPlannerProvider', () => {
  let planner: GeminiPlannerProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    planner = new GeminiPlannerProvider('test-key');
  });

  it('isConfigured returns true with valid key', () => {
    expect(planner.isConfigured()).toBe(true);
  });

  it('isConfigured returns false with empty key', () => {
    const empty = new GeminiPlannerProvider('');
    expect(empty.isConfigured()).toBe(false);
  });

  it('extracts text parts from response', async () => {
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('hello'));
    const result = await planner.startTurn({
      systemPrompt: 'system',
      userMessage: 'hi',
      tools: GLUON_TOOLS,
    });
    expect(result.textParts).toEqual(['hello']);
    expect(result.functionCalls).toEqual([]);
  });

  it('extracts function calls from response', async () => {
    mockGenerateContent.mockResolvedValueOnce(mockFunctionCallResponse([
      { id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 } } },
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

  it('filters out thought parts from text', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      functionCalls: undefined,
      candidates: [{
        content: {
          role: 'model',
          parts: [
            { text: 'thinking...', thought: true },
            { text: 'visible response' },
          ],
        },
      }],
    });
    const result = await planner.startTurn({
      systemPrompt: 'system',
      userMessage: 'test',
      tools: GLUON_TOOLS,
    });
    expect(result.textParts).toEqual(['visible response']);
  });

  it('preserves thoughtSignature in committed history', async () => {
    const signature = 'opaque-base64-signature-data';
    mockGenerateContent.mockResolvedValueOnce(
      mockTextResponse('thinking result', [{ thoughtSignature: signature }]),
    );
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'first', tools: GLUON_TOOLS });
    planner.commitTurn();

    // Second call should include the committed history with thoughtSignature
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('ok'));
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'second', tools: GLUON_TOOLS });

    const call = mockGenerateContent.mock.calls[1][0];
    const contents = call.contents;
    // permanent: user + model (with thoughtSignature), pending: user
    expect(contents).toHaveLength(3);
    const modelEntry = contents[1];
    expect(modelEntry.role).toBe('model');
    expect(modelEntry.parts.some((p: Record<string, unknown>) => p.thoughtSignature === signature)).toBe(true);
  });

  it('function response round-tripping via continueTurn', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 } } },
      ]))
      .mockResolvedValueOnce(mockTextResponse('Done.'));

    await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });
    await planner.continueTurn({
      systemPrompt: 'system',
      tools: GLUON_TOOLS,
      functionResponses: [{ id: 'c1', name: 'move', result: { applied: true } }],
    });

    // Second call should have function response in contents
    const call = mockGenerateContent.mock.calls[1][0];
    const contents = call.contents;
    // user msg, model fc, function response
    const funcResponseContent = contents.find((c: { role: string; parts: Array<Record<string, unknown>> }) =>
      c.role === 'user' && c.parts.some((p: Record<string, unknown>) => p.functionResponse),
    );
    expect(funcResponseContent).toBeDefined();
  });

  it('exchange-atomic trimming', async () => {
    // Commit 3 exchanges: 2 simple, 1 with tool calling
    mockGenerateContent.mockResolvedValue(mockTextResponse('reply'));
    for (let i = 0; i < 2; i++) {
      await planner.startTurn({ systemPrompt: 's', userMessage: `msg ${i}`, tools: [] });
      planner.commitTurn();
    }
    // 3rd exchange with tool call (more Contents)
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 } } },
      ]))
      .mockResolvedValueOnce(mockTextResponse('Applied.'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'do it', tools: GLUON_TOOLS });
    await planner.continueTurn({
      systemPrompt: 's',
      tools: GLUON_TOOLS,
      functionResponses: [{ id: 'c1', name: 'move', result: { applied: true } }],
    });
    planner.commitTurn();

    // Trim to 2 exchanges — should drop the first simple exchange
    planner.trimHistory(2);

    // Next call: verify no orphan function response
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('ok'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'next', tools: [] });

    const call = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
    const contents = call.contents;

    // Verify no function response without preceding model turn
    for (let i = 0; i < contents.length; i++) {
      const entry = contents[i];
      if (entry.role === 'user' && entry.parts?.[0]?.functionResponse) {
        expect(i).toBeGreaterThan(0);
        expect(contents[i - 1].role).toBe('model');
      }
    }
  });

  it('discardTurn clears pending contents', async () => {
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('response'));
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });
    planner.discardTurn();

    // Next call should not have the discarded turn in history
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('ok'));
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'fresh', tools: GLUON_TOOLS });

    const call = mockGenerateContent.mock.calls[1][0];
    expect(call.contents).toHaveLength(1); // Only the new user message
  });

  it('clearHistory resets all state', async () => {
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('reply'));
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });
    planner.commitTurn();
    planner.clearHistory();

    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('ok'));
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'fresh', tools: GLUON_TOOLS });

    const call = mockGenerateContent.mock.calls[1][0];
    expect(call.contents).toHaveLength(1);
  });

  it('translates 429 to ProviderError rate_limited', async () => {
    const error = new Error('Resource exhausted');
    (error as Record<string, unknown>).status = 429;
    mockGenerateContent.mockRejectedValueOnce(error);

    await expect(
      planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS }),
    ).rejects.toThrow(ProviderError);

    try {
      await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).kind).toBe('rate_limited');
    }
  });

  it('translates 401 to ProviderError auth', async () => {
    const error = new Error('Unauthorized');
    (error as Record<string, unknown>).status = 401;
    mockGenerateContent.mockRejectedValueOnce(error);

    try {
      await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).kind).toBe('auth');
    }
  });

  it('translates 403 to ProviderError auth', async () => {
    const error = new Error('Forbidden');
    (error as Record<string, unknown>).status = 403;
    mockGenerateContent.mockRejectedValueOnce(error);

    try {
      await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).kind).toBe('auth');
    }
  });

  it('translates 500 to ProviderError server', async () => {
    const error = new Error('Internal error');
    (error as Record<string, unknown>).status = 500;
    mockGenerateContent.mockRejectedValueOnce(error);

    try {
      await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).kind).toBe('server');
    }
  });

  it('passes gemini-3.1-pro-preview-customtools as model', async () => {
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('ok'));
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });

    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-3.1-pro-preview-customtools');
  });

  it('does not send thinkingConfig', async () => {
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('ok'));
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });

    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.config.thinkingConfig).toBeUndefined();
  });

  it('passes tools as functionDeclarations', async () => {
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('ok'));
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });

    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.config.tools).toBeDefined();
    expect(call.config.tools[0].functionDeclarations).toBeDefined();
    expect(call.config.toolConfig.functionCallingConfig.mode).toBe('AUTO');
  });

  it('handles empty response gracefully', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ content: { role: 'model', parts: [] } }],
    });
    const result = await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });
    expect(result.textParts).toEqual([]);
    expect(result.functionCalls).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Token-budget-aware methods (Phase 1a, #785)
  // -------------------------------------------------------------------------

  it('countContextTokens calls the Gemini countTokens API', async () => {
    mockCountTokens.mockResolvedValueOnce({ totalTokens: 42_000 });
    const tokens = await planner.countContextTokens('system prompt', GLUON_TOOLS);
    expect(tokens).toBe(42_000);
    expect(mockCountTokens).toHaveBeenCalledTimes(1);
    const call = mockCountTokens.mock.calls[0][0];
    expect(call.model).toBe('gemini-3.1-pro-preview-customtools');
    expect(call.config.systemInstruction).toBe('system prompt');
  });

  it('getTokenBudget returns the configured budget', () => {
    expect(planner.getTokenBudget()).toBe(170_000);
  });

  it('getExchangeCount returns the number of committed exchanges', async () => {
    expect(planner.getExchangeCount()).toBe(0);

    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('reply'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'msg', tools: [] });
    planner.commitTurn();

    expect(planner.getExchangeCount()).toBe(1);

    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('reply2'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'msg2', tools: [] });
    planner.commitTurn();

    expect(planner.getExchangeCount()).toBe(2);
  });

  it('getLastTokenUsage returns null before any request', () => {
    expect(planner.getLastTokenUsage()).toBeNull();
  });

  it('tracks usageMetadata from non-streaming response', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      ...mockTextResponse('hello'),
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, totalTokenCount: 1200 },
    });
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });
    const usage = planner.getLastTokenUsage();
    expect(usage).toEqual({ promptTokens: 1000, outputTokens: 200 });
  });

  it('countContextTokens throws when not configured', async () => {
    const unconfigured = new GeminiPlannerProvider('');
    await expect(unconfigured.countContextTokens('prompt', [])).rejects.toThrow(ProviderError);
  });
});
