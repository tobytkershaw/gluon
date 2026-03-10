// tests/ai/response-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseAIResponse } from '../../src/ai/response-parser';

describe('parseAIResponse (Phase 2)', () => {
  it('parses move actions', () => {
    const result = parseAIResponse('[{"type":"move","param":"timbre","target":{"absolute":0.8}}]');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('move');
  });

  it('parses say actions', () => {
    const result = parseAIResponse('[{"type":"say","text":"hello"}]');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('say');
  });

  it('parses sketch actions with PatternSketch', () => {
    const json = JSON.stringify([{
      type: 'sketch',
      voiceId: 'v0',
      description: 'four on the floor',
      pattern: {
        steps: [
          { index: 0, gate: true },
          { index: 4, gate: true },
          { index: 8, gate: true },
          { index: 12, gate: true },
        ],
      },
    }]);
    const result = parseAIResponse(json);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('sketch');
    if (result[0].type === 'sketch') {
      expect(result[0].voiceId).toBe('v0');
      expect(result[0].pattern.steps).toHaveLength(4);
    }
  });

  it('rejects sketch without voiceId', () => {
    const json = JSON.stringify([{
      type: 'sketch',
      description: 'test',
      pattern: { steps: [] },
    }]);
    const result = parseAIResponse(json);
    expect(result).toHaveLength(0);
  });

  it('rejects sketch without pattern', () => {
    const json = JSON.stringify([{
      type: 'sketch',
      voiceId: 'v0',
      description: 'test',
    }]);
    const result = parseAIResponse(json);
    expect(result).toHaveLength(0);
  });

  it('rejects sketch with non-array steps', () => {
    const json = JSON.stringify([{
      type: 'sketch',
      voiceId: 'v0',
      description: 'test',
      pattern: { steps: 'not an array' },
    }]);
    const result = parseAIResponse(json);
    expect(result).toHaveLength(0);
  });

  it('handles mixed valid and invalid actions', () => {
    const json = JSON.stringify([
      { type: 'say', text: 'here is a pattern' },
      { type: 'sketch', voiceId: 'v0', description: 'kick', pattern: { steps: [{ index: 0, gate: true }] } },
      { type: 'sketch', description: 'invalid' }, // missing voiceId
    ]);
    const result = parseAIResponse(json);
    expect(result).toHaveLength(2);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseAIResponse('not json')).toEqual([]);
  });

  it('returns empty array for non-array JSON', () => {
    expect(parseAIResponse('{"type":"move"}')).toEqual([]);
  });
});
