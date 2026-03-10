import { describe, it, expect } from 'vitest';
import { parseAIResponse } from '../../src/ai/response-parser';

describe('parseAIResponse', () => {
  it('parses a move action', () => {
    const response = '[{ "type": "move", "param": "timbre", "target": { "absolute": 0.7 } }]';
    const actions = parseAIResponse(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('move');
    if (actions[0].type === 'move') {
      expect(actions[0].param).toBe('timbre');
      expect(actions[0].target).toEqual({ absolute: 0.7 });
    }
  });

  it('parses a say action', () => {
    const response = '[{ "type": "say", "text": "Hello" }]';
    const actions = parseAIResponse(response);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ type: 'say', text: 'Hello' });
  });

  it('parses multiple actions', () => {
    const response = `[
      { "type": "move", "param": "morph", "target": { "absolute": 0.3 } },
      { "type": "say", "text": "Darkened the color." }
    ]`;
    const actions = parseAIResponse(response);
    expect(actions).toHaveLength(2);
  });

  it('parses suggest action', () => {
    const response = '[{ "type": "suggest", "changes": { "timbre": 0.8 }, "reason": "try this" }]';
    const actions = parseAIResponse(response);
    expect(actions[0].type).toBe('suggest');
  });

  it('parses audition action', () => {
    const response = '[{ "type": "audition", "changes": { "morph": 0.2 }, "duration": 3000 }]';
    const actions = parseAIResponse(response);
    expect(actions[0].type).toBe('audition');
  });

  it('returns empty array for empty response', () => {
    expect(parseAIResponse('[]')).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseAIResponse('not json')).toEqual([]);
  });

  it('filters out actions with unknown types', () => {
    const response = '[{ "type": "unknown", "foo": "bar" }, { "type": "say", "text": "hi" }]';
    const actions = parseAIResponse(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('say');
  });

  it('extracts JSON from markdown code blocks', () => {
    const response = 'Here is my response:\n```json\n[{ "type": "say", "text": "hi" }]\n```';
    const actions = parseAIResponse(response);
    expect(actions).toHaveLength(1);
  });
});
