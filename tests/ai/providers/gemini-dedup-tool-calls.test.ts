// tests/ai/providers/gemini-dedup-tool-calls.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the @google/genai module
const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();
const mockCountTokens = vi.fn();
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
        countTokens: mockCountTokens,
      };
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

import { GeminiPlannerProvider, deduplicateFunctionCalls } from '../../../src/ai/providers/gemini-planner';
import type { NeutralFunctionCall } from '../../../src/ai/types';

// ---------------------------------------------------------------------------
// Unit tests for the deduplication helper
// ---------------------------------------------------------------------------

describe('deduplicateFunctionCalls', () => {
  it('removes identical function calls (same name and args)', () => {
    const calls: NeutralFunctionCall[] = [
      { id: 'a', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 } } },
      { id: 'b', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 } } },
      { id: 'c', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 } } },
    ];
    const result = deduplicateFunctionCalls(calls);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a'); // first occurrence kept
  });

  it('keeps calls with same name but different args', () => {
    const calls: NeutralFunctionCall[] = [
      { id: 'a', name: 'move', args: { param: 'timbre', target: { absolute: 0.3 } } },
      { id: 'b', name: 'move', args: { param: 'timbre', target: { absolute: 0.7 } } },
      { id: 'c', name: 'move', args: { param: 'morph', target: { absolute: 0.5 } } },
    ];
    const result = deduplicateFunctionCalls(calls);
    expect(result).toHaveLength(3);
  });

  it('preserves order (first occurrence kept)', () => {
    const calls: NeutralFunctionCall[] = [
      { id: '1', name: 'alpha', args: { x: 1 } },
      { id: '2', name: 'beta', args: { y: 2 } },
      { id: '3', name: 'alpha', args: { x: 1 } }, // dup of 1
      { id: '4', name: 'gamma', args: { z: 3 } },
      { id: '5', name: 'beta', args: { y: 2 } },  // dup of 2
    ];
    const result = deduplicateFunctionCalls(calls);
    expect(result.map(c => c.id)).toEqual(['1', '2', '4']);
  });

  it('returns the same array content when there are no duplicates', () => {
    const calls: NeutralFunctionCall[] = [
      { id: 'a', name: 'move', args: { param: 'timbre' } },
      { id: 'b', name: 'sketch', args: { events: [] } },
    ];
    const result = deduplicateFunctionCalls(calls);
    expect(result).toHaveLength(2);
  });

  it('handles empty array', () => {
    expect(deduplicateFunctionCalls([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Integration test: deduplication through the non-streaming path
// ---------------------------------------------------------------------------

describe('GeminiPlannerProvider deduplication (non-streaming)', () => {
  let planner: GeminiPlannerProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    planner = new GeminiPlannerProvider('test-key');
  });

  it('deduplicates identical function calls from a single response', async () => {
    const fc = { id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 } } };
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          role: 'model',
          parts: [
            { functionCall: fc },
            { functionCall: fc },
            { functionCall: fc },
          ],
        },
      }],
    });

    const result = await planner.startTurn({
      systemPrompt: 'system',
      userMessage: 'test',
      tools: [],
    });

    expect(result.functionCalls).toHaveLength(1);
    expect(result.functionCalls[0].name).toBe('move');
  });

  it('keeps function calls with different args on the same tool', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          role: 'model',
          parts: [
            { functionCall: { id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.3 } } } },
            { functionCall: { id: 'c2', name: 'move', args: { param: 'timbre', target: { absolute: 0.8 } } } },
          ],
        },
      }],
    });

    const result = await planner.startTurn({
      systemPrompt: 'system',
      userMessage: 'test',
      tools: [],
    });

    expect(result.functionCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Integration test: deduplication through the streaming path
// ---------------------------------------------------------------------------

describe('GeminiPlannerProvider deduplication (streaming)', () => {
  let planner: GeminiPlannerProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    planner = new GeminiPlannerProvider('test-key');
  });

  it('deduplicates identical function calls from streamed chunks', async () => {
    const fc = { id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.5 } } };

    // Simulate an async generator yielding chunks with duplicate function calls
    async function* fakeStream() {
      yield { candidates: [{ content: { role: 'model', parts: [{ functionCall: fc }] } }] };
      yield { candidates: [{ content: { role: 'model', parts: [{ functionCall: fc }] } }] };
      yield { candidates: [{ content: { role: 'model', parts: [{ functionCall: fc }] } }] };
    }

    mockGenerateContentStream.mockResolvedValueOnce(fakeStream());

    const streamedText: string[] = [];
    const result = await planner.startTurn({
      systemPrompt: 'system',
      userMessage: 'test',
      tools: [],
      onStreamText: (t) => streamedText.push(t),
    });

    expect(result.functionCalls).toHaveLength(1);
    expect(result.functionCalls[0].name).toBe('move');
  });

  it('keeps different function calls in streaming path', async () => {
    async function* fakeStream() {
      yield {
        candidates: [{
          content: {
            role: 'model',
            parts: [
              { functionCall: { id: 'c1', name: 'move', args: { param: 'timbre', target: { absolute: 0.3 } } } },
            ],
          },
        }],
      };
      yield {
        candidates: [{
          content: {
            role: 'model',
            parts: [
              { functionCall: { id: 'c2', name: 'move', args: { param: 'morph', target: { absolute: 0.7 } } } },
            ],
          },
        }],
      };
    }

    mockGenerateContentStream.mockResolvedValueOnce(fakeStream());

    const result = await planner.startTurn({
      systemPrompt: 'system',
      userMessage: 'test',
      tools: [],
      onStreamText: () => {},
    });

    expect(result.functionCalls).toHaveLength(2);
  });
});
