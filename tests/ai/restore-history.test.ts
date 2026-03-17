// tests/ai/restore-history.test.ts — Tests for restoreHistory on providers and GluonAI
import { describe, it, expect, vi } from 'vitest';
import { OpenAIPlannerProvider } from '../../src/ai/providers/openai-planner';
import { GeminiPlannerProvider } from '../../src/ai/providers/gemini-planner';
import { GluonAI } from '../../src/ai/api';
import type { ChatMessage } from '../../src/engine/types';
import type { PlannerProvider, ListenerProvider } from '../../src/ai/types';

function makeMsgs(...pairs: Array<[string, string]>): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  let t = 1000;
  for (const [human, ai] of pairs) {
    msgs.push({ role: 'human', text: human, timestamp: t++ });
    msgs.push({ role: 'ai', text: ai, timestamp: t++ });
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// OpenAI provider
// ---------------------------------------------------------------------------

describe('OpenAIPlannerProvider.restoreHistory', () => {
  it('populates exchanges from chat messages', () => {
    const provider = new OpenAIPlannerProvider('');
    const messages = makeMsgs(['hello', 'hi there'], ['how are you', 'fine']);
    provider.restoreHistory(messages);

    // Access internal state for verification
    const exchanges = (provider as unknown as { exchanges: unknown[] }).exchanges;
    expect(exchanges).toHaveLength(2);
  });

  it('limits restored exchanges to 20', () => {
    const provider = new OpenAIPlannerProvider('');
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < 30; i++) {
      pairs.push([`q${i}`, `a${i}`]);
    }
    provider.restoreHistory(makeMsgs(...pairs));

    const exchanges = (provider as unknown as { exchanges: unknown[] }).exchanges;
    expect(exchanges).toHaveLength(20);
  });

  it('marks chain as broken after restore', () => {
    const provider = new OpenAIPlannerProvider('');
    provider.restoreHistory(makeMsgs(['hello', 'world']));

    const chainBroken = (provider as unknown as { chainBroken: boolean }).chainBroken;
    expect(chainBroken).toBe(true);
  });

  it('clears existing history before restoring', () => {
    const provider = new OpenAIPlannerProvider('');
    // Restore once
    provider.restoreHistory(makeMsgs(['a', 'b']));
    // Restore again with different data
    provider.restoreHistory(makeMsgs(['c', 'd'], ['e', 'f']));

    const exchanges = (provider as unknown as { exchanges: unknown[] }).exchanges;
    expect(exchanges).toHaveLength(2);
  });

  it('handles empty messages gracefully', () => {
    const provider = new OpenAIPlannerProvider('');
    provider.restoreHistory([]);

    const exchanges = (provider as unknown as { exchanges: unknown[] }).exchanges;
    expect(exchanges).toHaveLength(0);
    const chainBroken = (provider as unknown as { chainBroken: boolean }).chainBroken;
    expect(chainBroken).toBe(false);
  });

  it('skips unpaired human messages', () => {
    const provider = new OpenAIPlannerProvider('');
    const messages: ChatMessage[] = [
      { role: 'human', text: 'first', timestamp: 1 },
      { role: 'ai', text: 'response', timestamp: 2 },
      { role: 'human', text: 'trailing', timestamp: 3 },
      // No AI response for the last human message
    ];
    provider.restoreHistory(messages);

    const exchanges = (provider as unknown as { exchanges: unknown[] }).exchanges;
    expect(exchanges).toHaveLength(1);
  });

  it('skips system messages', () => {
    const provider = new OpenAIPlannerProvider('');
    const messages: ChatMessage[] = [
      { role: 'system', text: 'welcome', timestamp: 1 },
      { role: 'human', text: 'hello', timestamp: 2 },
      { role: 'ai', text: 'hi', timestamp: 3 },
    ];
    provider.restoreHistory(messages);

    const exchanges = (provider as unknown as { exchanges: unknown[] }).exchanges;
    expect(exchanges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Gemini provider
// ---------------------------------------------------------------------------

describe('GeminiPlannerProvider.restoreHistory', () => {
  it('populates contents from chat messages', () => {
    const provider = new GeminiPlannerProvider('');
    provider.restoreHistory(makeMsgs(['hello', 'hi'], ['bye', 'cya']));

    const contents = (provider as unknown as { permanentContents: unknown[] }).permanentContents;
    // 2 pairs × 2 contents each (user + model)
    expect(contents).toHaveLength(4);
  });

  it('tracks exchange boundaries', () => {
    const provider = new GeminiPlannerProvider('');
    provider.restoreHistory(makeMsgs(['hello', 'hi'], ['bye', 'cya']));

    const boundaries = (provider as unknown as { exchangeBoundaries: unknown[] }).exchangeBoundaries;
    expect(boundaries).toHaveLength(2);
  });

  it('limits restored exchanges to 20', () => {
    const provider = new GeminiPlannerProvider('');
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < 30; i++) {
      pairs.push([`q${i}`, `a${i}`]);
    }
    provider.restoreHistory(makeMsgs(...pairs));

    const contents = (provider as unknown as { permanentContents: unknown[] }).permanentContents;
    expect(contents).toHaveLength(40); // 20 pairs × 2
  });

  it('handles empty messages gracefully', () => {
    const provider = new GeminiPlannerProvider('');
    provider.restoreHistory([]);

    const contents = (provider as unknown as { permanentContents: unknown[] }).permanentContents;
    expect(contents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GluonAI.restoreHistory delegates to planner
// ---------------------------------------------------------------------------

describe('GluonAI.restoreHistory', () => {
  it('delegates to planner.restoreHistory when available', () => {
    const restoreHistoryFn = vi.fn();
    const planner: PlannerProvider = {
      name: 'mock',
      isConfigured: () => true,
      startTurn: vi.fn(async () => ({ textParts: [], functionCalls: [] })),
      continueTurn: vi.fn(async () => ({ textParts: [], functionCalls: [] })),
      commitTurn: vi.fn(),
      discardTurn: vi.fn(),
      trimHistory: vi.fn(),
      clearHistory: vi.fn(),
      restoreHistory: restoreHistoryFn,
    };
    const listener: ListenerProvider = {
      name: 'mock',
      isConfigured: () => true,
      evaluate: vi.fn(async () => ''),
    };

    const ai = new GluonAI(planner, listener);
    const messages = makeMsgs(['a', 'b']);
    ai.restoreHistory(messages);

    expect(restoreHistoryFn).toHaveBeenCalledWith(messages);
  });

  it('does not throw when planner lacks restoreHistory', () => {
    const planner: PlannerProvider = {
      name: 'mock',
      isConfigured: () => true,
      startTurn: vi.fn(async () => ({ textParts: [], functionCalls: [] })),
      continueTurn: vi.fn(async () => ({ textParts: [], functionCalls: [] })),
      commitTurn: vi.fn(),
      discardTurn: vi.fn(),
      trimHistory: vi.fn(),
      clearHistory: vi.fn(),
      // No restoreHistory
    };
    const listener: ListenerProvider = {
      name: 'mock',
      isConfigured: () => true,
      evaluate: vi.fn(async () => ''),
    };

    const ai = new GluonAI(planner, listener);
    expect(() => ai.restoreHistory(makeMsgs(['a', 'b']))).not.toThrow();
  });
});
