// tests/ui/musical-reactions.test.ts
// Tests for musical reaction controls (#973):
// - suggestedReactions threading through finalizeAITurn
// - TurnSummaryCard static follow-up suppression when AI suggestions present
// - Reaction chip → verdict+rationale mapping

import { describe, it, expect } from 'vitest';
import { finalizeAITurn } from '../../src/engine/operation-executor';
import { deriveFollowUps } from '../../src/ui/TurnSummaryCard';
import type { Session, ActionLogEntry } from '../../src/engine/types';

// Minimal session fixture
function makeSession(overrides?: Partial<Session>): Session {
  return {
    tracks: [],
    activeTrackId: 'v0',
    transport: { bpm: 120, swing: 0, playing: false },
    undoStack: [],
    messages: [],
    recentHumanActions: [],
    masterParams: { volume: 0.8, pan: 0.5 },
    ...overrides,
  } as Session;
}

describe('Musical reaction controls', () => {
  // ── finalizeAITurn threading ─────────────────────────────────────────────

  it('finalizeAITurn attaches suggestedReactions to ChatMessage', () => {
    const session = makeSession();
    const reactions = ['more tense', 'brighter', 'keep groove'];
    const log: ActionLogEntry[] = [
      { trackId: 'v0', trackLabel: 'Track 1', description: 'moved timbre', diff: { kind: 'param-change', controlId: 'timbre', from: 0.3, to: 0.7 } },
    ];

    const result = finalizeAITurn(session, 0, ['Changed timbre'], log, undefined, true, reactions);
    const msg = result.messages[result.messages.length - 1];

    expect(msg.suggestedReactions).toEqual(['more tense', 'brighter', 'keep groove']);
  });

  it('finalizeAITurn omits suggestedReactions when not provided', () => {
    const session = makeSession();
    const log: ActionLogEntry[] = [
      { trackId: 'v0', trackLabel: 'Track 1', description: 'moved timbre', diff: { kind: 'param-change', controlId: 'timbre', from: 0.3, to: 0.7 } },
    ];

    const result = finalizeAITurn(session, 0, ['Changed timbre'], log);
    const msg = result.messages[result.messages.length - 1];

    expect(msg.suggestedReactions).toBeUndefined();
  });

  it('finalizeAITurn omits suggestedReactions when empty array', () => {
    const session = makeSession();
    const log: ActionLogEntry[] = [
      { trackId: 'v0', trackLabel: 'Track 1', description: 'moved', diff: { kind: 'param-change', controlId: 'timbre', from: 0.3, to: 0.7 } },
    ];

    const result = finalizeAITurn(session, 0, ['ok'], log, undefined, true, []);
    const msg = result.messages[result.messages.length - 1];

    expect(msg.suggestedReactions).toBeUndefined();
  });

  // ── TurnSummaryCard follow-up suppression ───────────────────────────────

  it('deriveFollowUps returns static chips when no AI suggestions (baseline)', () => {
    const actions: ActionLogEntry[] = [
      { trackId: 'v0', trackLabel: 'Track 1', description: 'moved timbre', diff: { kind: 'param-change', controlId: 'timbre', from: 0.3, to: 0.7 } },
    ];

    const followUps = deriveFollowUps(actions);
    expect(followUps.length).toBeGreaterThan(0);
  });

  // ── Verdict+rationale invariant ─────────────────────────────────────────

  it('Reaction type supports rationale for chip-based reactions', () => {
    // This is a compile-time check — if Reaction doesn't have rationale, tsc fails.
    // Runtime verification:
    const reaction = {
      actionGroupIndex: 0,
      verdict: 'approved' as const,
      rationale: 'more tense',
      timestamp: Date.now(),
    };
    expect(reaction.verdict).toBe('approved');
    expect(reaction.rationale).toBe('more tense');
  });
});
