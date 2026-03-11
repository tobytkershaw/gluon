// tests/ai/api-history.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the @google/genai module
const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = { generateContent: mockGenerateContent };
    },
  };
});

import { GluonAI } from '../../src/ai/api';
import { createSession } from '../../src/engine/session';

/** Helper: build a mock response with full candidate structure */
function mockResponse(text: string, extraParts: Record<string, unknown>[] = []) {
  const textPart = { text };
  const parts = [textPart, ...extraParts];
  return {
    text,
    candidates: [{ content: { role: 'model', parts } }],
  };
}

describe('GluonAI History Management', () => {
  let ai: GluonAI;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContent.mockResolvedValue(
      mockResponse(JSON.stringify([{ type: 'say', text: 'ok' }])),
    );
    ai = new GluonAI();
    ai.setApiKey('test-key');
  });

  it('trims history to MAX_EXCHANGES * 2 entries', async () => {
    const session = createSession();

    // Make 15 calls to exceed MAX_EXCHANGES (12)
    for (let i = 0; i < 15; i++) {
      await ai.ask(session, `message ${i}`);
    }

    // On the 15th call, the contents sent should have at most 24 history + 1 current = 25
    const lastCall = mockGenerateContent.mock.calls[14];
    const contents = lastCall[0].contents;
    // History trimmed to 24 (12 exchanges * 2) + 1 current turn = 25
    expect(contents.length).toBeLessThanOrEqual(25);
  });

  it('stores clean human text in history (not state JSON)', async () => {
    const session = createSession();

    await ai.ask(session, 'hello world');
    await ai.ask(session, 'second message');

    // Second call should have history from first call
    const secondCall = mockGenerateContent.mock.calls[1];
    const contents = secondCall[0].contents;

    // First entry in history should be clean human text
    const historyUser = contents[0];
    expect(historyUser.role).toBe('user');
    expect(historyUser.parts[0].text).toBe('hello world');

    // Second entry should be model response
    const historyModel = contents[1];
    expect(historyModel.role).toBe('model');
  });

  it('includes compressed state in current turn only', async () => {
    const session = createSession();

    await ai.ask(session, 'test message');

    const firstCall = mockGenerateContent.mock.calls[0];
    const contents = firstCall[0].contents;

    // Current turn (only entry) should include state
    const currentTurn = contents[contents.length - 1];
    expect(currentTurn.role).toBe('user');
    expect(currentTurn.parts[0].text).toContain('Project state:');
    expect(currentTurn.parts[0].text).toContain('Human says: test message');
  });

  it('clearHistory empties history and resets backoff', async () => {
    const session = createSession();
    await ai.ask(session, 'message 1');

    ai.clearHistory();

    await ai.ask(session, 'message 2');
    // After clearHistory, second call should have no history — just 1 current turn
    const call = mockGenerateContent.mock.calls[1];
    const contents = call[0].contents;
    expect(contents.length).toBe(1);
    expect(contents[0].parts[0].text).toContain('Human says: message 2');
  });

  it('preserves full model Content with thoughtSignature in history', async () => {
    const session = createSession();

    // First call returns response with thoughtSignature parts
    const signature = 'opaque-base64-signature-data';
    mockGenerateContent.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify([{ type: 'say', text: 'thinking result' }]),
        [{ thoughtSignature: signature }],
      ),
    );

    await ai.ask(session, 'first message');

    // Second call — check that history includes the full model Content
    mockGenerateContent.mockResolvedValueOnce(
      mockResponse(JSON.stringify([{ type: 'say', text: 'ok' }])),
    );
    await ai.ask(session, 'second message');

    const secondCall = mockGenerateContent.mock.calls[1];
    const contents = secondCall[0].contents;

    // History model entry (index 1) should be the full Content from the first response
    const modelEntry = contents[1];
    expect(modelEntry.role).toBe('model');
    expect(modelEntry.parts).toHaveLength(2);
    expect(modelEntry.parts[0].text).toBeDefined();
    expect(modelEntry.parts[1].thoughtSignature).toBe(signature);
  });

  it('stores text fallback when candidates are missing', async () => {
    const session = createSession();

    // Response with no candidates (edge case)
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify([{ type: 'say', text: 'no candidates' }]),
      candidates: undefined,
    });

    await ai.ask(session, 'first message');

    // Second call
    mockGenerateContent.mockResolvedValueOnce(
      mockResponse(JSON.stringify([{ type: 'say', text: 'ok' }])),
    );
    await ai.ask(session, 'second message');

    const secondCall = mockGenerateContent.mock.calls[1];
    const contents = secondCall[0].contents;

    // Should fall back to plain text Content
    const modelEntry = contents[1];
    expect(modelEntry.role).toBe('model');
    expect(modelEntry.parts[0].text).toContain('no candidates');
  });

  it('sends thinkingConfig in API calls', async () => {
    const session = createSession();
    await ai.ask(session, 'test');

    const call = mockGenerateContent.mock.calls[0];
    expect(call[0].config.thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' });
  });

  it('uses gemini-3-flash-preview model', async () => {
    const session = createSession();
    await ai.ask(session, 'test');

    const call = mockGenerateContent.mock.calls[0];
    expect(call[0].model).toBe('gemini-3-flash-preview');
  });
});
