// tests/ai/api-history.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the @google/genai module
const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = { generateContent: mockGenerateContent };
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

import { GluonAI } from '../../src/ai/api';
import { createSession } from '../../src/engine/session';

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

describe('GluonAI History Management (Exchange-based)', () => {
  let ai: GluonAI;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContent.mockResolvedValue(mockTextResponse('ok'));
    ai = new GluonAI();
    ai.setApiKey('test-key');
  });

  it('trims history by exchange count, not raw Content count', async () => {
    const session = createSession();

    // Make 15 calls to exceed MAX_EXCHANGES (12)
    for (let i = 0; i < 15; i++) {
      await ai.ask(session, `message ${i}`);
    }

    // On the 16th call, history should be trimmed to 12 exchanges
    const lastCall = mockGenerateContent.mock.calls[14];
    const contents = lastCall[0].contents;

    // 12 exchanges * 2 (user text + model response) + 1 current turn = 25
    expect(contents.length).toBeLessThanOrEqual(25);
  });

  it('stores clean human text in history exchanges', async () => {
    const session = createSession();

    await ai.ask(session, 'hello world');
    await ai.ask(session, 'second message');

    const secondCall = mockGenerateContent.mock.calls[1];
    const contents = secondCall[0].contents;

    // First entry should be clean user text from exchange
    expect(contents[0].role).toBe('user');
    expect(contents[0].parts[0].text).toBe('hello world');
  });

  it('includes compressed state in current turn only', async () => {
    const session = createSession();
    await ai.ask(session, 'test message');

    const firstCall = mockGenerateContent.mock.calls[0];
    const contents = firstCall[0].contents;

    const currentTurn = contents[contents.length - 1];
    expect(currentTurn.role).toBe('user');
    expect(currentTurn.parts[0].text).toContain('Project state:');
    expect(currentTurn.parts[0].text).toContain('Human says: test message');
  });

  it('clearHistory empties exchanges and resets backoff', async () => {
    const session = createSession();
    await ai.ask(session, 'message 1');

    ai.clearHistory();

    await ai.ask(session, 'message 2');
    const call = mockGenerateContent.mock.calls[1];
    const contents = call[0].contents;
    expect(contents.length).toBe(1);
    expect(contents[0].parts[0].text).toContain('Human says: message 2');
  });

  it('preserves thoughtSignature in exchange turns', async () => {
    const session = createSession();
    const signature = 'opaque-base64-signature-data';

    mockGenerateContent.mockResolvedValueOnce(
      mockTextResponse('thinking result', [{ thoughtSignature: signature }]),
    );

    await ai.ask(session, 'first message');

    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('ok'));
    await ai.ask(session, 'second message');

    const secondCall = mockGenerateContent.mock.calls[1];
    const contents = secondCall[0].contents;

    // Model entry from first exchange should have thoughtSignature
    const modelEntry = contents[1];
    expect(modelEntry.role).toBe('model');
    expect(modelEntry.parts).toHaveLength(2);
    expect(modelEntry.parts[1].thoughtSignature).toBe(signature);
  });

  it('stores function call/response turns in exchange', async () => {
    const session = createSession();

    // First call: model makes a function call
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.7 } } },
      ]))
      .mockResolvedValueOnce(mockTextResponse('Done.'));

    await ai.ask(session, 'brighten it');

    // Second call
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('ok'));
    await ai.ask(session, 'thanks');

    const secondCall = mockGenerateContent.mock.calls[2];
    const contents = secondCall[0].contents;

    // Exchange 1: user text, model function call, function response, model text
    // user text (clean)
    expect(contents[0].role).toBe('user');
    expect(contents[0].parts[0].text).toBe('brighten it');
    // model function call turn
    expect(contents[1].role).toBe('model');
    // function response turn
    expect(contents[2].role).toBe('user');
    expect(contents[2].parts[0].functionResponse).toBeDefined();
    // model text response
    expect(contents[3].role).toBe('model');
  });

  it('exchange-based trimming never splits mid-tool-sequence', async () => {
    const session = createSession();

    // Fill with 13 exchanges (1 over MAX_EXCHANGES)
    for (let i = 0; i < 12; i++) {
      mockGenerateContent.mockResolvedValueOnce(mockTextResponse(`reply ${i}`));
      await ai.ask(session, `msg ${i}`);
    }

    // 13th call: function calling exchange (produces multiple Content entries)
    mockGenerateContent
      .mockResolvedValueOnce(mockFunctionCallResponse([
        { id: 'c1', name: 'move', args: { param: 'brightness', target: { absolute: 0.5 } } },
      ]))
      .mockResolvedValueOnce(mockTextResponse('Applied.'));
    await ai.ask(session, 'do something');

    // 14th call: verify the function call exchange is intact or trimmed as a unit
    mockGenerateContent.mockResolvedValueOnce(mockTextResponse('ok'));
    await ai.ask(session, 'next');

    const lastCall = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1];
    const contents = lastCall[0].contents;

    // Verify no orphan function response without preceding model function call
    for (let i = 0; i < contents.length - 1; i++) {
      const entry = contents[i];
      if (entry.role === 'user' && entry.parts?.[0]?.functionResponse) {
        // Must be preceded by a model turn
        expect(i).toBeGreaterThan(0);
        expect(contents[i - 1].role).toBe('model');
      }
    }
  });

  it('does not send thinkingConfig (unsupported on gemini-2.5-flash)', async () => {
    const session = createSession();
    await ai.ask(session, 'test');

    const call = mockGenerateContent.mock.calls[0];
    expect(call[0].config.thinkingConfig).toBeUndefined();
  });

  it('uses gemini-2.5-flash model', async () => {
    const session = createSession();
    await ai.ask(session, 'test');

    const call = mockGenerateContent.mock.calls[0];
    expect(call[0].model).toBe('gemini-2.5-flash');
  });
});
