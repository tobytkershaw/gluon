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
      expect(result[0].pattern?.steps).toHaveLength(4);
    }
  });

  it('discards malformed JSON actions (sketch without voiceId)', () => {
    const json = JSON.stringify([{
      type: 'sketch',
      description: 'test',
      pattern: { steps: [] },
    }]);
    expect(parseAIResponse(json)).toHaveLength(0);
  });

  it('discards malformed JSON actions (sketch without pattern)', () => {
    const json = JSON.stringify([{
      type: 'sketch',
      voiceId: 'v0',
      description: 'test',
    }]);
    expect(parseAIResponse(json)).toHaveLength(0);
  });

  it('discards malformed JSON actions (sketch with non-array steps)', () => {
    const json = JSON.stringify([{
      type: 'sketch',
      voiceId: 'v0',
      description: 'test',
      pattern: { steps: 'not an array' },
    }]);
    expect(parseAIResponse(json)).toHaveLength(0);
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

  it('falls back to say for plain text', () => {
    const result = parseAIResponse('I can help with that!');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('say');
    if (result[0].type === 'say') {
      expect(result[0].text).toBe('I can help with that!');
    }
  });

  it('does not leak malformed JSON into chat', () => {
    expect(parseAIResponse('{"type":"move"}')).toHaveLength(0);
    expect(parseAIResponse('[{"type":"sketch"')).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    expect(parseAIResponse('')).toEqual([]);
  });

  // Canonical shape tests
  it('parses move with controlId (canonical shape)', () => {
    const json = JSON.stringify([{
      type: 'move', controlId: 'brightness', target: { absolute: 0.7 },
    }]);
    const result = parseAIResponse(json);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('move');
    if (result[0].type === 'move') {
      expect(result[0].param).toBe('brightness');
    }
  });

  it('parses sketch with events (canonical shape)', () => {
    const json = JSON.stringify([{
      type: 'sketch', voiceId: 'v0', description: 'kick pattern',
      events: [
        { kind: 'trigger', at: 0, velocity: 1.0, accent: true },
        { kind: 'trigger', at: 4, velocity: 0.8 },
      ],
    }]);
    const result = parseAIResponse(json);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('sketch');
    if (result[0].type === 'sketch') {
      expect(result[0].events).toHaveLength(2);
    }
  });

  it('discards invalid sketch with neither events nor pattern', () => {
    const json = JSON.stringify([{
      type: 'sketch', voiceId: 'v0', description: 'test',
    }]);
    expect(parseAIResponse(json)).toHaveLength(0);
  });

  it('discards sketch with invalid events', () => {
    const json = JSON.stringify([{
      type: 'sketch', voiceId: 'v0', description: 'test',
      events: [{ not: 'valid' }],
    }]);
    expect(parseAIResponse(json)).toHaveLength(0);
  });

  it('discards note event missing pitch', () => {
    const json = JSON.stringify([{
      type: 'sketch', voiceId: 'v0', description: 'test',
      events: [{ kind: 'note', at: 0, velocity: 0.8, duration: 0.25 }],
    }]);
    expect(parseAIResponse(json)).toHaveLength(0);
  });

  it('discards parameter event missing controlId', () => {
    const json = JSON.stringify([{
      type: 'sketch', voiceId: 'v0', description: 'test',
      events: [{ kind: 'parameter', at: 0, value: 0.5 }],
    }]);
    expect(parseAIResponse(json)).toHaveLength(0);
  });

  it('discards parameter event missing value', () => {
    const json = JSON.stringify([{
      type: 'sketch', voiceId: 'v0', description: 'test',
      events: [{ kind: 'parameter', at: 0, controlId: 'brightness' }],
    }]);
    expect(parseAIResponse(json)).toHaveLength(0);
  });

  it('discards unknown event kind', () => {
    const json = JSON.stringify([{
      type: 'sketch', voiceId: 'v0', description: 'test',
      events: [{ kind: 'unknown', at: 0 }],
    }]);
    expect(parseAIResponse(json)).toHaveLength(0);
  });
});
