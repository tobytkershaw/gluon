// tests/engine/preservation-enforcement.test.ts
//
// Tests for claim enforcement (#1307).
// Validates that the operation executor blocks mutations on claimed tracks
// while allowing parameter moves on claimed tracks and all operations on unclaimed tracks.

import { describe, it, expect, vi } from 'vitest';
import {
  prevalidateAction,
  executeOperations,
  extractRhythmPositions,
  rhythmsMatch,
} from '../../src/engine/operation-executor';
import { createSession } from '../../src/engine/session';
import { createPlaitsAdapter } from '../../src/audio/plaits-adapter';
import { Arbitrator } from '../../src/engine/arbitration';
import type { AIAction, Session } from '../../src/engine/types';
import type { MusicalEvent } from '../../src/engine/canonical-types';

const adapter = createPlaitsAdapter();

function makeArbitrator(canAct = true) {
  const arb = new Arbitrator();
  vi.spyOn(arb, 'canAIAct').mockReturnValue(canAct);
  vi.spyOn(arb, 'canAIActOnTrack').mockReturnValue(canAct);
  return arb;
}

/** Create a session with track v0 at the given claim state and with given events. */
function sessionWithClaim(
  claimed: boolean,
  events: MusicalEvent[] = [
    { kind: 'trigger', at: 0, velocity: 1 },
    { kind: 'trigger', at: 4, velocity: 0.8 },
    { kind: 'trigger', at: 8, velocity: 1 },
    { kind: 'trigger', at: 12, velocity: 0.8 },
  ],
): Session {
  const session = createSession();
  return {
    ...session,
    tracks: session.tracks.map(v =>
      v.id === 'v0'
        ? {
            ...v,
            agency: 'ON' as const,
            claimed,
            patterns: [
              {
                ...v.patterns[0],
                events,
              },
              ...v.patterns.slice(1),
            ],
          }
        : v,
    ),
  };
}

// ---------------------------------------------------------------------------
// Unit tests for rhythm extraction and comparison helpers
// ---------------------------------------------------------------------------

describe('extractRhythmPositions', () => {
  it('extracts note and trigger positions, ignoring parameter events', () => {
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 0, velocity: 1 },
      { kind: 'parameter', at: 2, controlId: 'timbre', value: 0.5 },
      { kind: 'note', at: 4, pitch: 60, velocity: 0.8, duration: 1 },
      { kind: 'trigger', at: 8, velocity: 0.7 },
    ];
    expect(extractRhythmPositions(events)).toEqual([0, 4, 8]);
  });

  it('returns sorted positions', () => {
    const events: MusicalEvent[] = [
      { kind: 'trigger', at: 8 },
      { kind: 'trigger', at: 0 },
      { kind: 'trigger', at: 4 },
    ];
    expect(extractRhythmPositions(events)).toEqual([0, 4, 8]);
  });

  it('returns empty array for parameter-only events', () => {
    const events: MusicalEvent[] = [
      { kind: 'parameter', at: 0, controlId: 'timbre', value: 0.5 },
    ];
    expect(extractRhythmPositions(events)).toEqual([]);
  });
});

describe('rhythmsMatch', () => {
  it('returns true for identical positions', () => {
    expect(rhythmsMatch([0, 4, 8, 12], [0, 4, 8, 12])).toBe(true);
  });

  it('returns false for different lengths', () => {
    expect(rhythmsMatch([0, 4, 8], [0, 4, 8, 12])).toBe(false);
  });

  it('returns false for different positions', () => {
    expect(rhythmsMatch([0, 4, 8, 12], [0, 4, 8, 13])).toBe(false);
  });

  it('handles tolerance within 0.001', () => {
    expect(rhythmsMatch([0, 4.0005], [0, 4.0009])).toBe(true);
  });

  it('returns true for empty arrays', () => {
    expect(rhythmsMatch([], [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Prevalidation tests: sketch operations
// ---------------------------------------------------------------------------

describe('claim enforcement — sketch', () => {
  it('blocks sketch on claimed track', () => {
    const session = sessionWithClaim(true);
    const action: AIAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'new pattern',
      events: [{ kind: 'trigger', at: 0, velocity: 1 }],
    };
    const result = prevalidateAction(session, action, adapter, makeArbitrator());
    expect(result).toContain('Claimed');
    expect(result).toContain('claimed by the human');
  });

  it('allows sketch on unclaimed track', () => {
    const session = sessionWithClaim(false);
    const action: AIAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'new pattern',
      events: [{ kind: 'trigger', at: 0, velocity: 1 }],
    };
    expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Prevalidation tests: transform operations
// ---------------------------------------------------------------------------

describe('claim enforcement — transform', () => {
  it('blocks all transforms on claimed track', () => {
    const session = sessionWithClaim(true);
    for (const operation of ['rotate', 'transpose', 'reverse', 'duplicate'] as const) {
      const action: AIAction = {
        type: 'transform',
        trackId: 'v0',
        operation,
        description: `${operation} test`,
        ...(operation === 'rotate' ? { steps: 2 } : {}),
        ...(operation === 'transpose' ? { semitones: 3 } : {}),
      };
      const result = prevalidateAction(session, action, adapter, makeArbitrator());
      expect(result).toContain('Claimed');
    }
  });

  it('allows all transforms on unclaimed track', () => {
    const session = sessionWithClaim(false);
    for (const operation of ['rotate', 'transpose', 'reverse', 'duplicate'] as const) {
      const action: AIAction = {
        type: 'transform',
        trackId: 'v0',
        operation,
        description: `${operation} test`,
        ...(operation === 'rotate' ? { steps: 2 } : {}),
        ...(operation === 'transpose' ? { semitones: 3 } : {}),
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Prevalidation tests: move operations (never blocked by claims)
// ---------------------------------------------------------------------------

describe('claim enforcement — move', () => {
  it('allows move on claimed track', () => {
    const session = sessionWithClaim(true);
    const action: AIAction = {
      type: 'move',
      param: 'timbre',
      target: { absolute: 0.7 },
      trackId: 'v0',
    };
    expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
  });

  it('allows move on unclaimed track', () => {
    const session = sessionWithClaim(false);
    const action: AIAction = {
      type: 'move',
      param: 'timbre',
      target: { absolute: 0.5 },
      trackId: 'v0',
    };
    expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Prevalidation tests: say never blocked
// ---------------------------------------------------------------------------

describe('claim enforcement — say', () => {
  it('say is never blocked regardless of claim state', () => {
    const session = sessionWithClaim(true);
    const action: AIAction = { type: 'say', text: 'The kick pattern sounds great' };
    expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration test: executeOperations rejects and reports correctly
// ---------------------------------------------------------------------------

describe('claim enforcement — executeOperations integration', () => {
  it('rejected sketch on claimed track includes claim reason in execution report', () => {
    const session = sessionWithClaim(true);
    const action: AIAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'new pattern',
      events: [{ kind: 'trigger', at: 0, velocity: 1 }],
    };
    const result = executeOperations(session, [action], adapter, makeArbitrator());
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Claimed');
  });

  it('accepts all operations on unclaimed track via executeOperations', () => {
    const session = sessionWithClaim(false);
    const action: AIAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'velocity adjustment',
      events: [
        { kind: 'trigger', at: 0, velocity: 0.6 },
        { kind: 'trigger', at: 4, velocity: 0.6 },
      ],
    };
    const result = executeOperations(session, [action], adapter, makeArbitrator());
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('mixed batch: move on claimed track accepted, sketch on claimed track rejected', () => {
    const session = sessionWithClaim(true);
    const actions: AIAction[] = [
      // This should be rejected (claimed track, sketch changes events)
      {
        type: 'sketch',
        trackId: 'v0',
        description: 'new events',
        events: [
          { kind: 'trigger', at: 0, velocity: 0.5 },
        ],
      },
      // This should be accepted (move never blocked)
      {
        type: 'move',
        param: 'timbre',
        target: { absolute: 0.9 },
        trackId: 'v0',
      },
    ];
    const result = executeOperations(session, actions, adapter, makeArbitrator());
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].type).toBe('move');
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].op.type).toBe('sketch');
    expect(result.rejected[0].reason).toContain('Claimed');
  });
});
