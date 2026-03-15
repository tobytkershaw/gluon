// tests/ai/observed-patterns.test.ts
import { describe, it, expect } from 'vitest';
import { deriveObservedPatterns, deriveRestraintLevel } from '../../src/ai/state-compression';
import type { Reaction } from '../../src/engine/types';

function makeReaction(
  verdict: Reaction['verdict'],
  rationale?: string,
  index = 0,
): Reaction {
  return {
    actionGroupIndex: index,
    verdict,
    rationale,
    timestamp: Date.now(),
  };
}

function makeReactions(verdicts: Reaction['verdict'][], rationales?: (string | undefined)[]): Reaction[] {
  return verdicts.map((v, i) => makeReaction(v, rationales?.[i], i));
}

// ---------------------------------------------------------------------------
// deriveObservedPatterns
// ---------------------------------------------------------------------------
describe('deriveObservedPatterns', () => {
  it('returns empty for fewer than 3 reactions', () => {
    expect(deriveObservedPatterns([])).toEqual([]);
    expect(deriveObservedPatterns([makeReaction('approved')])).toEqual([]);
    expect(deriveObservedPatterns([makeReaction('approved'), makeReaction('rejected')])).toEqual([]);
  });

  it('reports high approval rate', () => {
    const reactions = makeReactions(['approved', 'approved', 'approved', 'neutral', 'approved']);
    const patterns = deriveObservedPatterns(reactions);
    expect(patterns.some(p => p.includes('approved') && p.includes('generally receptive'))).toBe(true);
  });

  it('reports high rejection rate', () => {
    const reactions = makeReactions(['rejected', 'rejected', 'rejected', 'neutral', 'rejected']);
    const patterns = deriveObservedPatterns(reactions);
    expect(patterns.some(p => p.includes('rejected') && p.includes('generally unreceptive'))).toBe(true);
  });

  it('reports mixed reactions', () => {
    const reactions = makeReactions(['approved', 'rejected', 'rejected', 'approved', 'neutral']);
    const patterns = deriveObservedPatterns(reactions);
    expect(patterns.some(p => p.includes('Mixed reactions'))).toBe(true);
  });

  it('detects rejection streak of 3+', () => {
    const reactions = makeReactions(['approved', 'rejected', 'rejected', 'rejected']);
    const patterns = deriveObservedPatterns(reactions);
    expect(patterns.some(p => p.includes('Last 3 actions were all rejected'))).toBe(true);
  });

  it('detects approval streak of 3+', () => {
    const reactions = makeReactions(['rejected', 'approved', 'approved', 'approved']);
    const patterns = deriveObservedPatterns(reactions);
    expect(patterns.some(p => p.includes('Last 3 actions were all approved'))).toBe(true);
  });

  it('does not report neutral streaks', () => {
    const reactions = makeReactions(['approved', 'neutral', 'neutral', 'neutral']);
    const patterns = deriveObservedPatterns(reactions);
    expect(patterns.some(p => p.includes('Last 3'))).toBe(false);
  });

  it('extracts keyword themes from rejection rationales', () => {
    const reactions = makeReactions(
      ['rejected', 'rejected', 'rejected'],
      ['too bright for the bass', 'bright timbres are harsh', 'too harsh on everything'],
    );
    const patterns = deriveObservedPatterns(reactions);
    // "bright" appears in 2 rationales
    expect(patterns.some(p => p.includes('"bright"') && p.includes('rejection'))).toBe(true);
  });

  it('extracts keyword themes from approval rationales', () => {
    const reactions = makeReactions(
      ['approved', 'approved', 'approved'],
      ['nice sparse pattern', 'love the sparse arrangement', 'great groove'],
    );
    const patterns = deriveObservedPatterns(reactions);
    expect(patterns.some(p => p.includes('"sparse"') && p.includes('approval'))).toBe(true);
  });

  it('needs at least 2 rationales with shared keywords', () => {
    const reactions = makeReactions(
      ['rejected', 'rejected', 'rejected'],
      ['too bright', undefined, 'too loud'],
    );
    const patterns = deriveObservedPatterns(reactions);
    // "bright" appears in only 1 rationale, "loud" in 1 — neither should appear
    expect(patterns.some(p => p.includes('"bright"'))).toBe(false);
    expect(patterns.some(p => p.includes('"loud"'))).toBe(false);
  });

  it('only uses recent window (last 10)', () => {
    // 10 old approvals + 3 recent rejections
    const old = makeReactions(
      Array(10).fill('approved') as Reaction['verdict'][],
    );
    const recent = makeReactions(['rejected', 'rejected', 'rejected']);
    const all = [...old, ...recent];
    const patterns = deriveObservedPatterns(all);
    // The recent window should show the rejection streak
    expect(patterns.some(p => p.includes('rejected'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deriveRestraintLevel
// ---------------------------------------------------------------------------
describe('deriveRestraintLevel', () => {
  it('returns moderate for fewer than 3 reactions', () => {
    expect(deriveRestraintLevel([])).toBe('moderate');
    expect(deriveRestraintLevel([makeReaction('rejected')])).toBe('moderate');
    expect(deriveRestraintLevel([makeReaction('rejected'), makeReaction('rejected')])).toBe('moderate');
  });

  it('returns conservative when >= 60% rejected', () => {
    const reactions = makeReactions(['rejected', 'rejected', 'rejected', 'approved', 'neutral']);
    expect(deriveRestraintLevel(reactions)).toBe('conservative');
  });

  it('returns adventurous when >= 60% approved', () => {
    const reactions = makeReactions(['approved', 'approved', 'approved', 'rejected', 'neutral']);
    expect(deriveRestraintLevel(reactions)).toBe('adventurous');
  });

  it('returns moderate for balanced reactions', () => {
    const reactions = makeReactions(['approved', 'rejected', 'neutral', 'approved', 'rejected']);
    expect(deriveRestraintLevel(reactions)).toBe('moderate');
  });

  it('uses only the recent window', () => {
    // 10 old rejections + 5 recent approvals
    const old = makeReactions(Array(10).fill('rejected') as Reaction['verdict'][]);
    const recent = makeReactions(Array(5).fill('approved') as Reaction['verdict'][]);
    const all = [...old, ...recent];
    // Recent window (last 10) = 5 old rejections + 5 recent approvals → moderate/adventurous
    // Actually: last 10 of 15 = indices 5-14 = 5 rejected + 5 approved = 50/50 → moderate
    expect(deriveRestraintLevel(all)).toBe('moderate');
  });

  it('all-rejected → conservative', () => {
    const reactions = makeReactions(['rejected', 'rejected', 'rejected', 'rejected', 'rejected']);
    expect(deriveRestraintLevel(reactions)).toBe('conservative');
  });

  it('all-approved → adventurous', () => {
    const reactions = makeReactions(['approved', 'approved', 'approved', 'approved', 'approved']);
    expect(deriveRestraintLevel(reactions)).toBe('adventurous');
  });

  it('all-neutral → moderate', () => {
    const reactions = makeReactions(['neutral', 'neutral', 'neutral', 'neutral', 'neutral']);
    expect(deriveRestraintLevel(reactions)).toBe('moderate');
  });
});
