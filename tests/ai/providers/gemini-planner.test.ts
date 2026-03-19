// tests/ai/providers/gemini-planner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderError } from '../../../src/ai/types';

// Mock the @google/genai module
const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();
const mockCountTokens = vi.fn();
const mockCachesCreate = vi.fn();
const mockCachesUpdate = vi.fn();
const mockCachesDelete = vi.fn();
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
        countTokens: mockCountTokens,
      };
      caches = { create: mockCachesCreate, update: mockCachesUpdate, delete: mockCachesDelete };
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
    // Add some history so contents is non-empty
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('reply'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'msg', tools: [] });
    planner.commitTurn();
    vi.clearAllMocks();

    // First call counts system prompt tokens, second counts message + tool tokens
    mockCountTokens.mockResolvedValueOnce({ totalTokens: 2_000 });
    mockCountTokens.mockResolvedValueOnce({ totalTokens: 40_000 });
    const tokens = await planner.countContextTokens('system prompt', GLUON_TOOLS);
    expect(tokens).toBe(42_000);
    expect(mockCountTokens).toHaveBeenCalledTimes(2);
    // First call: system prompt as content (no systemInstruction config)
    const sysCall = mockCountTokens.mock.calls[0][0];
    expect(sysCall.model).toBe('gemini-3.1-pro-preview-customtools');
    expect(sysCall.contents).toEqual([{ role: 'user', parts: [{ text: 'system prompt' }] }]);
    // Second call: messages + tools
    const msgCall = mockCountTokens.mock.calls[1][0];
    expect(msgCall.config.tools).toBeDefined();
    expect(msgCall.config.systemInstruction).toBeUndefined();
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
    expect(usage).toEqual({ promptTokens: 1000, outputTokens: 200, cachedTokens: 0 });
  });

  it('countContextTokens throws when not configured', async () => {
    const unconfigured = new GeminiPlannerProvider('');
    await expect(unconfigured.countContextTokens('prompt', [])).rejects.toThrow(ProviderError);
  });

  it('countContextTokens handles empty history without error (#917)', async () => {
    // On the first turn, no history exists. The Gemini countTokens API requires
    // at least one content entry, so we skip the message count call.
    mockCountTokens.mockResolvedValueOnce({ totalTokens: 3_000 });
    const tokens = await planner.countContextTokens('system prompt', GLUON_TOOLS);
    // Only the system prompt count should be returned
    expect(tokens).toBe(3_000);
    // Only one countTokens call (system prompt), not two
    expect(mockCountTokens).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Context caching (Phase 1b, #785)
  // -------------------------------------------------------------------------

  it('cache created on first generate()', async () => {
    mockCachesCreate.mockResolvedValueOnce({ name: 'caches/abc123' });
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('hello'));

    await planner.startTurn({
      systemPrompt: 'system',
      userMessage: 'hi',
      tools: GLUON_TOOLS,
    });

    expect(mockCachesCreate).toHaveBeenCalledTimes(1);
    const createArg = mockCachesCreate.mock.calls[0][0];
    expect(createArg.config.systemInstruction).toBe('system');
    expect(createArg.config.tools).toBeDefined();
    expect(createArg.config.tools[0].functionDeclarations).toBeDefined();
    expect(createArg.config.toolConfig.functionCallingConfig.mode).toBe('AUTO');
    expect(createArg.config.ttl).toBe('3600s');

    // Request should use cachedContent instead of systemInstruction/tools/toolConfig
    const genArg = mockGenerateContent.mock.calls[0][0];
    expect(genArg.config.cachedContent).toBe('caches/abc123');
    expect(genArg.config.systemInstruction).toBeUndefined();
    expect(genArg.config.tools).toBeUndefined();
    expect(genArg.config.toolConfig).toBeUndefined();
  });

  it('cache reused when prompt unchanged', async () => {
    mockCachesCreate.mockResolvedValueOnce({ name: 'caches/abc123' });
    mockGenerateContent.mockResolvedValue(mockTextResponse('hello'));

    await planner.startTurn({ systemPrompt: 'system', userMessage: 'hi', tools: GLUON_TOOLS });
    planner.commitTurn();

    // Second call with same prompt — should NOT create a new cache
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'hi again', tools: GLUON_TOOLS });

    expect(mockCachesCreate).toHaveBeenCalledTimes(1);
    // Both requests should use cached content
    expect(mockGenerateContent.mock.calls[1][0].config.cachedContent).toBe('caches/abc123');
  });

  it('streaming requests use cachedContent when cache creation succeeds', async () => {
    mockCachesCreate.mockResolvedValueOnce({ name: 'caches/stream' });
    mockGenerateContentStream.mockResolvedValueOnce((async function* () {
      yield {
        candidates: [{ content: { role: 'model', parts: [{ text: 'hello' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, cachedContentTokenCount: 8 },
      };
    })());

    const chunks: string[] = [];
    const result = await planner.startTurn({
      systemPrompt: 'system',
      userMessage: 'hi',
      tools: GLUON_TOOLS,
      onStreamText: (chunk) => chunks.push(chunk),
    });

    expect(result.textParts).toEqual(['hello']);
    expect(chunks).toEqual(['hello']);
    const call = mockGenerateContentStream.mock.calls[0][0];
    expect(call.config.cachedContent).toBe('caches/stream');
    expect(call.config.systemInstruction).toBeUndefined();
    expect(call.config.tools).toBeUndefined();
    expect(call.config.toolConfig).toBeUndefined();
  });

  it('cache invalidated on prompt change', async () => {
    mockCachesCreate
      .mockResolvedValueOnce({ name: 'caches/first' })
      .mockResolvedValueOnce({ name: 'caches/second' });
    mockCachesDelete.mockResolvedValue(undefined);
    mockGenerateContent.mockResolvedValue(mockTextResponse('hello'));

    await planner.startTurn({ systemPrompt: 'system-v1', userMessage: 'hi', tools: GLUON_TOOLS });
    planner.commitTurn();

    // Change system prompt — should delete old cache and create new
    await planner.startTurn({ systemPrompt: 'system-v2', userMessage: 'hi', tools: GLUON_TOOLS });

    expect(mockCachesDelete).toHaveBeenCalledWith({ name: 'caches/first' });
    expect(mockCachesCreate).toHaveBeenCalledTimes(2);
    expect(mockGenerateContent.mock.calls[1][0].config.cachedContent).toBe('caches/second');
  });

  it('permanent error disables caching', async () => {
    const error400 = new Error('Bad request');
    (error400 as Record<string, unknown>).status = 400;
    mockCachesCreate.mockRejectedValueOnce(error400);
    mockGenerateContent.mockResolvedValue(mockTextResponse('hello'));

    // First call — cache create fails with 400, falls back to inline
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'hi', tools: GLUON_TOOLS });
    planner.commitTurn();

    // Second call — should skip caching entirely (cacheUnsupported latched)
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'hi again', tools: GLUON_TOOLS });

    expect(mockCachesCreate).toHaveBeenCalledTimes(1); // Only the first attempt
    // Both should use inline config
    expect(mockGenerateContent.mock.calls[0][0].config.systemInstruction).toBe('system');
    expect(mockGenerateContent.mock.calls[1][0].config.systemInstruction).toBe('system');
  });

  it('transient error falls back for one request', async () => {
    const error500 = new Error('Internal error');
    (error500 as Record<string, unknown>).status = 500;
    mockCachesCreate
      .mockRejectedValueOnce(error500)
      .mockResolvedValueOnce({ name: 'caches/recovered' });
    mockGenerateContent.mockResolvedValue(mockTextResponse('hello'));

    // First call — cache create fails with 500, falls back to inline
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'hi', tools: GLUON_TOOLS });
    planner.commitTurn();

    // Second call — should try caching again (transient error, not latched)
    await planner.startTurn({ systemPrompt: 'system', userMessage: 'hi again', tools: GLUON_TOOLS });

    expect(mockCachesCreate).toHaveBeenCalledTimes(2);
    expect(mockGenerateContent.mock.calls[0][0].config.systemInstruction).toBe('system');
    expect(mockGenerateContent.mock.calls[1][0].config.cachedContent).toBe('caches/recovered');
  });

  it('stale cache at generate time triggers retry', async () => {
    mockCachesCreate.mockResolvedValueOnce({ name: 'caches/stale' });

    const error404 = new Error('Cached content not found');
    (error404 as Record<string, unknown>).status = 404;

    // First call uses cache, but generateContent throws 404 (stale cache)
    mockGenerateContent
      .mockRejectedValueOnce(error404)
      .mockResolvedValueOnce(mockTextResponse('recovered'));

    const result = await planner.startTurn({
      systemPrompt: 'system',
      userMessage: 'hi',
      tools: GLUON_TOOLS,
    });

    expect(result.textParts).toEqual(['recovered']);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);

    // First call used cached content
    expect(mockGenerateContent.mock.calls[0][0].config.cachedContent).toBe('caches/stale');
    // Retry used inline config
    expect(mockGenerateContent.mock.calls[1][0].config.systemInstruction).toBe('system');
    expect(mockGenerateContent.mock.calls[1][0].config.cachedContent).toBeUndefined();
  });

  it('cachedTokens tracked in token usage', async () => {
    mockCachesCreate.mockResolvedValueOnce({ name: 'caches/abc' });
    mockGenerateContent.mockResolvedValueOnce({
      ...mockTextResponse('hello'),
      usageMetadata: {
        promptTokenCount: 1000,
        candidatesTokenCount: 200,
        cachedContentTokenCount: 800,
        totalTokenCount: 1200,
      },
    });

    await planner.startTurn({ systemPrompt: 'system', userMessage: 'test', tools: GLUON_TOOLS });

    const usage = planner.getLastTokenUsage();
    expect(usage).toEqual({ promptTokens: 1000, outputTokens: 200, cachedTokens: 800 });
  });

  it('clearHistory deletes cache', async () => {
    mockCachesCreate.mockResolvedValueOnce({ name: 'caches/to-delete' });
    mockCachesDelete.mockResolvedValue(undefined);
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('hello'));

    await planner.startTurn({ systemPrompt: 'system', userMessage: 'hi', tools: GLUON_TOOLS });
    planner.commitTurn();

    planner.clearHistory();

    // Wait for the fire-and-forget delete to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockCachesDelete).toHaveBeenCalledWith({ name: 'caches/to-delete' });
  });

  // -------------------------------------------------------------------------
  // LLM-summarized context trimming (Phase 2, #785)
  // -------------------------------------------------------------------------

  it('getContextSummary returns null initially', () => {
    expect(planner.getContextSummary()).toBeNull();
  });

  it('summarizeBeforeTrim stores summary and trims history', async () => {
    // Set up 3 committed exchanges
    mockGenerateContent.mockResolvedValue(mockTextResponse('reply'));
    for (let i = 0; i < 3; i++) {
      await planner.startTurn({ systemPrompt: 's', userMessage: `msg ${i}`, tools: [] });
      planner.commitTurn();
    }
    expect(planner.getExchangeCount()).toBe(3);

    // Mock the summarization call (summarizeDroppedExchanges uses generateContent)
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ content: { role: 'model', parts: [{ text: 'Track 1 is a kick drum' }] } }],
    });

    const droppedMessages = [
      { role: 'human' as const, text: 'make a kick', timestamp: 1 },
      { role: 'ai' as const, text: 'here is a kick', timestamp: 2 },
    ];
    await planner.summarizeBeforeTrim(droppedMessages, 2);

    expect(planner.getContextSummary()).toBe('Track 1 is a kick drum');
    expect(planner.getExchangeCount()).toBe(2);
  });

  it('summarizeBeforeTrim keeps existing summary on failure', async () => {
    // Set up 2 committed exchanges
    mockGenerateContent.mockResolvedValue(mockTextResponse('reply'));
    for (let i = 0; i < 2; i++) {
      await planner.startTurn({ systemPrompt: 's', userMessage: `msg ${i}`, tools: [] });
      planner.commitTurn();
    }

    // First summarization succeeds
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ content: { role: 'model', parts: [{ text: 'existing summary' }] } }],
    });
    await planner.summarizeBeforeTrim(
      [{ role: 'human', text: 'hi', timestamp: 1 }], 1,
    );
    expect(planner.getContextSummary()).toBe('existing summary');

    // Second summarization fails — summary should persist
    mockGenerateContent.mockRejectedValueOnce(new Error('network'));
    await planner.summarizeBeforeTrim(
      [{ role: 'human', text: 'bye', timestamp: 2 }], 1,
    );
    expect(planner.getContextSummary()).toBe('existing summary');
  });

  it('clearHistory clears the context summary', async () => {
    mockGenerateContent.mockResolvedValue(mockTextResponse('reply'));
    await planner.startTurn({ systemPrompt: 's', userMessage: 'msg', tools: [] });
    planner.commitTurn();

    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ content: { role: 'model', parts: [{ text: 'summary' }] } }],
    });
    await planner.summarizeBeforeTrim(
      [{ role: 'human', text: 'hi', timestamp: 1 }], 0,
    );
    expect(planner.getContextSummary()).toBe('summary');

    planner.clearHistory();
    expect(planner.getContextSummary()).toBeNull();
  });

  it('summarizeBeforeTrim with empty messages still trims', async () => {
    mockGenerateContent.mockResolvedValue(mockTextResponse('reply'));
    for (let i = 0; i < 3; i++) {
      await planner.startTurn({ systemPrompt: 's', userMessage: `msg ${i}`, tools: [] });
      planner.commitTurn();
    }

    await planner.summarizeBeforeTrim([], 2);
    expect(planner.getExchangeCount()).toBe(2);
    expect(planner.getContextSummary()).toBeNull(); // No summary from empty messages
  });
});
