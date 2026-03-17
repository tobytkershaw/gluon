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
// OpenAI provider — uses context summary (not exchange replay)
// ---------------------------------------------------------------------------

describe('OpenAIPlannerProvider.restoreHistory', () => {
  it('builds conversation context from chat messages', () => {
    const provider = new OpenAIPlannerProvider('');
    provider.restoreHistory(makeMsgs(['hello', 'hi there'], ['how are you', 'fine']));

    const ctx = provider.consumeConversationContext();
    expect(ctx).toBeTruthy();
    expect(ctx).toContain('hello');
    expect(ctx).toContain('hi there');
    expect(ctx).toContain('how are you');
    expect(ctx).toContain('fine');
  });

  it('does not populate exchanges (avoids Responses API ID conflicts)', () => {
    const provider = new OpenAIPlannerProvider('');
    provider.restoreHistory(makeMsgs(['hello', 'hi there']));

    const exchanges = (provider as unknown as { exchanges: unknown[] }).exchanges;
    expect(exchanges).toHaveLength(0);
  });

  it('limits restored messages', () => {
    const provider = new OpenAIPlannerProvider('');
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < 30; i++) {
      pairs.push([`q${i}`, `a${i}`]);
    }
    provider.restoreHistory(makeMsgs(...pairs));

    const ctx = provider.consumeConversationContext();
    expect(ctx).toBeTruthy();
    // Should not contain earliest messages (trimmed to recent)
    expect(ctx).not.toContain('q0');
    // Should contain recent messages
    expect(ctx).toContain('q29');
  });

  it('context is consumed once then returns null', () => {
    const provider = new OpenAIPlannerProvider('');
    provider.restoreHistory(makeMsgs(['hello', 'world']));

    expect(provider.consumeConversationContext()).toBeTruthy();
    expect(provider.consumeConversationContext()).toBeNull();
  });

  it('clears context on re-restore', () => {
    const provider = new OpenAIPlannerProvider('');
    provider.restoreHistory(makeMsgs(['a', 'b']));
    provider.restoreHistory(makeMsgs(['c', 'd'], ['e', 'f']));

    const ctx = provider.consumeConversationContext();
    expect(ctx).toContain('c');
    expect(ctx).toContain('e');
  });

  it('handles empty messages gracefully', () => {
    const provider = new OpenAIPlannerProvider('');
    provider.restoreHistory([]);

    expect(provider.consumeConversationContext()).toBeNull();
  });

  it('skips system messages in context', () => {
    const provider = new OpenAIPlannerProvider('');
    const messages: ChatMessage[] = [
      { role: 'system', text: 'welcome', timestamp: 1 },
      { role: 'human', text: 'hello', timestamp: 2 },
      { role: 'ai', text: 'hi', timestamp: 3 },
    ];
    provider.restoreHistory(messages);

    const ctx = provider.consumeConversationContext();
    expect(ctx).toBeTruthy();
    expect(ctx).not.toContain('welcome');
    expect(ctx).toContain('hello');
    expect(ctx).toContain('hi');
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
