// tests/ai/context-summary.test.ts — Tests for LLM-summarized context trimming (#785 Phase 2)
import { describe, it, expect } from 'vitest';
import { extractOldestExchanges, buildSummaryPrompt } from '../../src/ai/context-summary';
import type { ChatMessage } from '../../src/engine/types';

function msg(role: 'human' | 'ai' | 'system', text: string): ChatMessage {
  return { role, text, timestamp: Date.now() };
}

describe('extractOldestExchanges', () => {
  it('returns empty for zero exchange count', () => {
    const messages = [msg('human', 'hi'), msg('ai', 'hello')];
    expect(extractOldestExchanges(messages, 0)).toEqual([]);
  });

  it('returns empty for empty messages', () => {
    expect(extractOldestExchanges([], 5)).toEqual([]);
  });

  it('extracts a single exchange (human + ai)', () => {
    const messages = [
      msg('human', 'make a kick'),
      msg('ai', 'here is a kick pattern'),
      msg('human', 'now a snare'),
      msg('ai', 'added snare'),
    ];
    const dropped = extractOldestExchanges(messages, 1);
    expect(dropped).toHaveLength(2);
    expect(dropped[0].text).toBe('make a kick');
    expect(dropped[1].text).toBe('here is a kick pattern');
  });

  it('extracts multiple exchanges', () => {
    const messages = [
      msg('human', 'first'),
      msg('ai', 'reply 1'),
      msg('human', 'second'),
      msg('ai', 'reply 2'),
      msg('human', 'third'),
      msg('ai', 'reply 3'),
    ];
    const dropped = extractOldestExchanges(messages, 2);
    expect(dropped).toHaveLength(4);
    expect(dropped[0].text).toBe('first');
    expect(dropped[3].text).toBe('reply 2');
  });

  it('handles exchanges with multiple AI responses', () => {
    const messages = [
      msg('human', 'do something'),
      msg('ai', 'thinking...'),
      msg('system', 'tool result'),
      msg('ai', 'done'),
      msg('human', 'next'),
      msg('ai', 'ok'),
    ];
    const dropped = extractOldestExchanges(messages, 1);
    expect(dropped).toHaveLength(4);
    expect(dropped[0].text).toBe('do something');
    expect(dropped[3].text).toBe('done');
  });

  it('returns all messages when exchange count exceeds boundaries', () => {
    const messages = [
      msg('human', 'hi'),
      msg('ai', 'hello'),
    ];
    const dropped = extractOldestExchanges(messages, 10);
    expect(dropped).toHaveLength(2);
  });

  it('handles messages with no human messages', () => {
    const messages = [
      msg('ai', 'welcome'),
      msg('system', 'init'),
    ];
    expect(extractOldestExchanges(messages, 1)).toEqual([]);
  });

  it('handles leading system messages before first human', () => {
    const messages = [
      msg('system', 'init'),
      msg('human', 'hi'),
      msg('ai', 'hello'),
      msg('human', 'next'),
      msg('ai', 'ok'),
    ];
    // First exchange starts at the first human message, includes preceding system msg
    // Actually: boundaries are defined by human messages, so system before first human
    // is NOT part of any exchange boundary. The first boundary is at index 1.
    const dropped = extractOldestExchanges(messages, 1);
    // Should get messages from index 0 up to (but not including) index 3
    // Wait — boundaries only track human-message indices. Index 1 is first human.
    // extractOldestExchanges: boundaries = [1, 3]. take=1, endIndex=3.
    // slice(0, 3) = [system, human, ai]
    expect(dropped).toHaveLength(3);
    expect(dropped[0].role).toBe('system');
    expect(dropped[1].text).toBe('hi');
  });
});

describe('buildSummaryPrompt', () => {
  it('builds prompt without existing summary', () => {
    const messages = [msg('human', 'make techno'), msg('ai', 'setting up a techno track')];
    const prompt = buildSummaryPrompt(null, messages);
    expect(prompt).toContain('New exchanges being archived:');
    expect(prompt).toContain('[Human]: make techno');
    expect(prompt).toContain('[AI]: setting up a techno track');
    expect(prompt).not.toContain('Current session memory:');
  });

  it('includes existing summary when present', () => {
    const messages = [msg('human', 'add reverb'), msg('ai', 'done')];
    const prompt = buildSummaryPrompt('Track 1 is a kick drum in techno style', messages);
    expect(prompt).toContain('Current session memory:');
    expect(prompt).toContain('Track 1 is a kick drum in techno style');
    expect(prompt).toContain('[Human]: add reverb');
  });

  it('includes prioritization instructions', () => {
    const prompt = buildSummaryPrompt(null, [msg('human', 'hi'), msg('ai', 'hello')]);
    expect(prompt).toContain('Creative decisions');
    expect(prompt).toContain('Explicit rejections');
    expect(prompt).toContain('AI commitments');
    expect(prompt).toContain('Track roles');
    expect(prompt).toContain('Arrangement plans');
  });

  it('handles system messages', () => {
    const messages = [msg('system', 'tool executed'), msg('human', 'ok'), msg('ai', 'done')];
    const prompt = buildSummaryPrompt(null, messages);
    expect(prompt).toContain('[System]: tool executed');
  });
});
