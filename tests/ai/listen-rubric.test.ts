import { describe, it, expect } from 'vitest';
import { parseRubricResponse, RUBRIC_CRITERIA } from '../../src/ai/listen-rubric';
import type { EvaluationRubric } from '../../src/ai/listen-rubric';

describe('parseRubricResponse', () => {
  it('parses valid JSON rubric', () => {
    const json = JSON.stringify({
      groove: 4,
      clarity: 3,
      energy: 5,
      coherence: 2,
      space: 4,
      summary: 'Good groove but needs more cohesion.',
      actionItems: ['Reduce reverb on snare', 'Boost kick low-end'],
    });
    const result = parseRubricResponse(json);
    expect(result).not.toBeNull();
    expect(result!.groove).toBe(4);
    expect(result!.clarity).toBe(3);
    expect(result!.energy).toBe(5);
    expect(result!.coherence).toBe(2);
    expect(result!.space).toBe(4);
    expect(result!.summary).toBe('Good groove but needs more cohesion.');
    expect(result!.actionItems).toEqual(['Reduce reverb on snare', 'Boost kick low-end']);
  });

  it('extracts JSON embedded in surrounding text', () => {
    const text = `Here's my evaluation:

{
  "groove": 3, "clarity": 4, "energy": 3, "coherence": 5, "space": 2,
  "summary": "Well-structured but spatial image is narrow.",
  "actionItems": ["Pan elements wider"]
}

Hope that helps!`;
    const result = parseRubricResponse(text);
    expect(result).not.toBeNull();
    expect(result!.groove).toBe(3);
    expect(result!.space).toBe(2);
    expect(result!.actionItems).toEqual(['Pan elements wider']);
  });

  it('returns null for text with no JSON', () => {
    expect(parseRubricResponse('This sounds great, no issues!')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseRubricResponse('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseRubricResponse('{ broken json')).toBeNull();
  });

  it('returns null for JSON without any score fields', () => {
    const json = JSON.stringify({ foo: 'bar', baz: 42 });
    expect(parseRubricResponse(json)).toBeNull();
  });

  it('clamps out-of-range scores to 1-5', () => {
    const json = JSON.stringify({
      groove: 0,
      clarity: 7,
      energy: -2,
      coherence: 10,
      space: 3,
      summary: 'test',
      actionItems: [],
    });
    const result = parseRubricResponse(json);
    expect(result).not.toBeNull();
    expect(result!.groove).toBe(1);   // clamped from 0
    expect(result!.clarity).toBe(5);  // clamped from 7
    expect(result!.energy).toBe(1);   // clamped from -2
    expect(result!.coherence).toBe(5); // clamped from 10
    expect(result!.space).toBe(3);    // unchanged
  });

  it('defaults missing score fields to 3', () => {
    const json = JSON.stringify({
      groove: 4,
      // clarity, energy, coherence, space omitted
      summary: 'partial',
      actionItems: [],
    });
    const result = parseRubricResponse(json);
    expect(result).not.toBeNull();
    expect(result!.groove).toBe(4);
    expect(result!.clarity).toBe(3);
    expect(result!.energy).toBe(3);
    expect(result!.coherence).toBe(3);
    expect(result!.space).toBe(3);
  });

  it('defaults missing summary to empty string', () => {
    const json = JSON.stringify({
      groove: 3, clarity: 3, energy: 3, coherence: 3, space: 3,
    });
    const result = parseRubricResponse(json);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe('');
  });

  it('defaults missing actionItems to empty array', () => {
    const json = JSON.stringify({
      groove: 3, clarity: 3, energy: 3, coherence: 3, space: 3,
      summary: 'ok',
    });
    const result = parseRubricResponse(json);
    expect(result).not.toBeNull();
    expect(result!.actionItems).toEqual([]);
  });

  it('converts non-string actionItems to strings', () => {
    const json = JSON.stringify({
      groove: 3, clarity: 3, energy: 3, coherence: 3, space: 3,
      summary: 'ok',
      actionItems: [42, true, 'real string'],
    });
    const result = parseRubricResponse(json);
    expect(result).not.toBeNull();
    expect(result!.actionItems).toEqual(['42', 'true', 'real string']);
  });
});

describe('RUBRIC_CRITERIA', () => {
  it('contains dimension names', () => {
    expect(RUBRIC_CRITERIA).toContain('Groove');
    expect(RUBRIC_CRITERIA).toContain('Clarity');
    expect(RUBRIC_CRITERIA).toContain('Energy');
    expect(RUBRIC_CRITERIA).toContain('Coherence');
    expect(RUBRIC_CRITERIA).toContain('Space');
  });

  it('contains scoring scale', () => {
    expect(RUBRIC_CRITERIA).toContain('1-5');
  });

  it('contains JSON response format', () => {
    expect(RUBRIC_CRITERIA).toContain('"groove"');
    expect(RUBRIC_CRITERIA).toContain('"actionItems"');
  });
});
