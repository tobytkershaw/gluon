// tests/ui/turn-summary-card.test.ts
// Unit tests for TurnSummaryCard derivation functions.

import { describe, it, expect } from 'vitest';
import { deriveChanged, deriveWhy, deriveFollowUps } from '../../src/ui/TurnSummaryCard';
import type { ActionLogEntry } from '../../src/engine/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entry(overrides: Partial<ActionLogEntry> = {}): ActionLogEntry {
  return {
    trackId: 'kick',
    trackLabel: 'Kick',
    description: 'test action',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// deriveChanged
// ---------------------------------------------------------------------------

describe('deriveChanged', () => {
  it('returns empty string for empty actions', () => {
    expect(deriveChanged([])).toBe('');
  });

  it('summarises a param change', () => {
    const result = deriveChanged([
      entry({ diff: { kind: 'param-change', controlId: 'timbre', from: 0.3, to: 0.7 } }),
    ]);
    expect(result).toBe('Kick timbre');
  });

  it('joins multiple changes with +', () => {
    const result = deriveChanged([
      entry({ diff: { kind: 'param-change', controlId: 'timbre', from: 0.3, to: 0.7 } }),
      entry({ diff: { kind: 'transport-change', field: 'swing', from: 0, to: 0.3 } }),
    ]);
    expect(result).toBe('Kick timbre + swing');
  });

  it('truncates beyond 3 items', () => {
    const result = deriveChanged([
      entry({ diff: { kind: 'param-change', controlId: 'timbre', from: 0.3, to: 0.7 } }),
      entry({ diff: { kind: 'transport-change', field: 'swing', from: 0, to: 0.3 } }),
      entry({ diff: { kind: 'transport-change', field: 'bpm', from: 120, to: 130 } }),
      entry({ diff: { kind: 'pattern-change', eventsBefore: 4, eventsAfter: 8, description: 'more hits' } }),
    ]);
    expect(result).toContain('+ 2 more');
  });

  it('deduplicates identical summaries', () => {
    const result = deriveChanged([
      entry({ diff: { kind: 'param-change', controlId: 'timbre', from: 0.3, to: 0.5 } }),
      entry({ diff: { kind: 'param-change', controlId: 'timbre', from: 0.5, to: 0.7 } }),
    ]);
    expect(result).toBe('Kick timbre');
  });

  it('falls back to description when no diff', () => {
    const result = deriveChanged([entry({ description: 'set model' })]);
    expect(result).toBe('set model');
  });

  it('summarises processor add', () => {
    const result = deriveChanged([
      entry({ diff: { kind: 'processor-add', processorType: 'rings' } }),
    ]);
    expect(result).toBe('+rings');
  });

  it('summarises master change', () => {
    const result = deriveChanged([
      entry({ diff: { kind: 'master-change', field: 'volume', from: 0.5, to: 0.8 } }),
    ]);
    expect(result).toBe('master volume');
  });
});

// ---------------------------------------------------------------------------
// deriveWhy
// ---------------------------------------------------------------------------

describe('deriveWhy', () => {
  it('returns empty string for empty text', () => {
    expect(deriveWhy('')).toBe('');
  });

  it('extracts first sentence', () => {
    const result = deriveWhy('More pressure on the low end. Also adjusted the swing to give it more bounce.');
    expect(result).toBe('More pressure on the low end.');
  });

  it('strips markdown formatting', () => {
    const result = deriveWhy('**More pressure** on the _low end_. Done.');
    expect(result).toBe('More pressure on the low end.');
  });

  it('truncates long text without sentence boundary', () => {
    const longText = 'A '.repeat(100);
    const result = deriveWhy(longText);
    expect(result.length).toBeLessThanOrEqual(125); // 120 + ellipsis
    expect(result.endsWith('\u2026')).toBe(true);
  });

  it('returns full text if short and no sentence boundary', () => {
    expect(deriveWhy('Quick fix')).toBe('Quick fix');
  });
});

// ---------------------------------------------------------------------------
// deriveFollowUps
// ---------------------------------------------------------------------------

describe('deriveFollowUps', () => {
  it('returns empty array for empty actions', () => {
    expect(deriveFollowUps([])).toEqual([]);
  });

  it('returns timbre chips for param changes', () => {
    const chips = deriveFollowUps([
      entry({ diff: { kind: 'param-change', controlId: 'timbre', from: 0.3, to: 0.7 } }),
    ]);
    expect(chips.length).toBeGreaterThanOrEqual(2);
    expect(chips.length).toBeLessThanOrEqual(4);
    const labels = chips.map(c => c.label);
    expect(labels).toContain('more bright');
  });

  it('returns pattern chips for pattern changes', () => {
    const chips = deriveFollowUps([
      entry({ diff: { kind: 'pattern-change', eventsBefore: 4, eventsAfter: 8, description: 'more hits' } }),
    ]);
    const labels = chips.map(c => c.label);
    expect(labels).toContain('more notes');
  });

  it('caps at 4 chips', () => {
    const chips = deriveFollowUps([
      entry({ diff: { kind: 'param-change', controlId: 'timbre', from: 0.3, to: 0.7 } }),
      entry({ diff: { kind: 'pattern-change', eventsBefore: 4, eventsAfter: 8, description: 'more hits' } }),
      entry({ diff: { kind: 'transport-change', field: 'swing', from: 0, to: 0.3 } }),
    ]);
    expect(chips.length).toBeLessThanOrEqual(4);
  });

  it('always includes undo if room', () => {
    const chips = deriveFollowUps([
      entry({ diff: { kind: 'param-change', controlId: 'timbre', from: 0.3, to: 0.7 } }),
    ]);
    const labels = chips.map(c => c.label);
    expect(labels).toContain('undo');
  });

  it('each chip has both label and prompt', () => {
    const chips = deriveFollowUps([
      entry({ diff: { kind: 'param-change', controlId: 'timbre', from: 0.3, to: 0.7 } }),
    ]);
    for (const chip of chips) {
      expect(chip.label).toBeTruthy();
      expect(chip.prompt).toBeTruthy();
    }
  });

  it('falls back to other category when no diffs', () => {
    const chips = deriveFollowUps([entry()]);
    expect(chips.length).toBeGreaterThanOrEqual(1);
    const labels = chips.map(c => c.label);
    expect(labels).toContain('undo');
  });
});
