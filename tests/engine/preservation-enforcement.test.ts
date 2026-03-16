// tests/engine/preservation-enforcement.test.ts
//
// Tests for preservation enforcement on approved/anchor tracks (#258).
// Validates that the operation executor blocks rhythm-mutating operations
// on protected tracks while allowing parameter moves and safe transforms.

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
import type { AIAction, Session, ApprovalLevel } from '../../src/engine/types';
import type { MusicalEvent } from '../../src/engine/canonical-types';

const adapter = createPlaitsAdapter();

function makeArbitrator(canAct = true) {
  const arb = new Arbitrator();
  vi.spyOn(arb, 'canAIAct').mockReturnValue(canAct);
  vi.spyOn(arb, 'canAIActOnTrack').mockReturnValue(canAct);
  return arb;
}

/** Create a session with track v0 at the given approval level and with given events. */
function sessionWithApproval(
  approval: ApprovalLevel,
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
            approval,
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

describe('preservation enforcement — sketch', () => {
  it('blocks sketch on anchor track', () => {
    const session = sessionWithApproval('anchor');
    const action: AIAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'new pattern',
      events: [{ kind: 'trigger', at: 0, velocity: 1 }],
    };
    const result = prevalidateAction(session, action, adapter, makeArbitrator());
    expect(result).toContain('Preservation');
    expect(result).toContain('anchored');
    expect(result).toContain('event mutations are blocked');
  });

  it('allows sketch on exploratory track', () => {
    const session = sessionWithApproval('exploratory');
    const action: AIAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'new pattern',
      events: [{ kind: 'trigger', at: 0, velocity: 1 }],
    };
    expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
  });

  it('allows sketch on liked track', () => {
    const session = sessionWithApproval('liked');
    const action: AIAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'new pattern',
      events: [{ kind: 'trigger', at: 2, velocity: 1 }],
    };
    expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
  });

  it('allows sketch with same rhythm on approved track', () => {
    const session = sessionWithApproval('approved');
    // Same rhythm positions (0, 4, 8, 12), different velocities
    const action: AIAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'velocity tweak',
      events: [
        { kind: 'trigger', at: 0, velocity: 0.5 },
        { kind: 'trigger', at: 4, velocity: 0.5 },
        { kind: 'trigger', at: 8, velocity: 0.5 },
        { kind: 'trigger', at: 12, velocity: 0.5 },
      ],
    };
    expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
  });

  it('blocks sketch with changed rhythm on approved track', () => {
    const session = sessionWithApproval('approved');
    // Different rhythm positions — adding a hit at beat 6
    const action: AIAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'add hit',
      events: [
        { kind: 'trigger', at: 0, velocity: 1 },
        { kind: 'trigger', at: 4, velocity: 0.8 },
        { kind: 'trigger', at: 6, velocity: 0.6 },
        { kind: 'trigger', at: 8, velocity: 1 },
        { kind: 'trigger', at: 12, velocity: 0.8 },
      ],
    };
    const result = prevalidateAction(session, action, adapter, makeArbitrator());
    expect(result).toContain('Preservation');
    expect(result).toContain('approved');
    expect(result).toContain('rhythm positions');
  });

  it('allows adding parameter events without changing rhythm on approved track', () => {
    const session = sessionWithApproval('approved');
    // Same trigger rhythm, but with added parameter events (which don't count as rhythm)
    const action: AIAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'add automation',
      events: [
        { kind: 'trigger', at: 0, velocity: 1 },
        { kind: 'parameter', at: 2, controlId: 'timbre', value: 0.7 },
        { kind: 'trigger', at: 4, velocity: 0.8 },
        { kind: 'trigger', at: 8, velocity: 1 },
        { kind: 'trigger', at: 12, velocity: 0.8 },
      ],
    };
    expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
  });

  it('blocks sketch that removes a trigger on approved track', () => {
    const session = sessionWithApproval('approved');
    // Missing the hit at beat 12
    const action: AIAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'simplify',
      events: [
        { kind: 'trigger', at: 0, velocity: 1 },
        { kind: 'trigger', at: 4, velocity: 0.8 },
        { kind: 'trigger', at: 8, velocity: 1 },
      ],
    };
    const result = prevalidateAction(session, action, adapter, makeArbitrator());
    expect(result).toContain('Preservation');
    expect(result).toContain('rhythm positions');
  });
});

// ---------------------------------------------------------------------------
// Prevalidation tests: transform operations
// ---------------------------------------------------------------------------

describe('preservation enforcement — transform', () => {
  it('blocks rotate on anchor track', () => {
    const session = sessionWithApproval('anchor');
    const action: AIAction = {
      type: 'transform',
      trackId: 'v0',
      operation: 'rotate',
      steps: 2,
      description: 'rotate pattern',
    };
    const result = prevalidateAction(session, action, adapter, makeArbitrator());
    expect(result).toContain('Preservation');
    expect(result).toContain('anchored');
  });

  it('blocks reverse on anchor track', () => {
    const session = sessionWithApproval('anchor');
    const action: AIAction = {
      type: 'transform',
      trackId: 'v0',
      operation: 'reverse',
      description: 'reverse pattern',
    };
    const result = prevalidateAction(session, action, adapter, makeArbitrator());
    expect(result).toContain('Preservation');
    expect(result).toContain('anchored');
  });

  it('blocks transpose on anchor track', () => {
    const session = sessionWithApproval('anchor');
    const action: AIAction = {
      type: 'transform',
      trackId: 'v0',
      operation: 'transpose',
      semitones: 5,
      description: 'transpose up',
    };
    const result = prevalidateAction(session, action, adapter, makeArbitrator());
    expect(result).toContain('Preservation');
    expect(result).toContain('anchored');
  });

  it('blocks rotate on approved track', () => {
    const session = sessionWithApproval('approved');
    const action: AIAction = {
      type: 'transform',
      trackId: 'v0',
      operation: 'rotate',
      steps: 2,
      description: 'rotate pattern',
    };
    const result = prevalidateAction(session, action, adapter, makeArbitrator());
    expect(result).toContain('Preservation');
    expect(result).toContain('rhythm positions');
    expect(result).toContain('rotate');
  });

  it('blocks reverse on approved track', () => {
    const session = sessionWithApproval('approved');
    const action: AIAction = {
      type: 'transform',
      trackId: 'v0',
      operation: 'reverse',
      description: 'reverse',
    };
    const result = prevalidateAction(session, action, adapter, makeArbitrator());
    expect(result).toContain('Preservation');
    expect(result).toContain('reverse');
  });

  it('allows transpose on approved track', () => {
    const session = sessionWithApproval('approved');
    const action: AIAction = {
      type: 'transform',
      trackId: 'v0',
      operation: 'transpose',
      semitones: 3,
      description: 'transpose up',
    };
    expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
  });

  it('blocks duplicate on approved track', () => {
    const session = sessionWithApproval('approved');
    const action: AIAction = {
      type: 'transform',
      trackId: 'v0',
      operation: 'duplicate',
      description: 'double length',
    };
    const result = prevalidateAction(session, action, adapter, makeArbitrator());
    expect(result).toContain('Preservation');
    expect(result).toContain('duplicate');
  });

  it('allows all transforms on exploratory track', () => {
    const session = sessionWithApproval('exploratory');
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
// Prevalidation tests: move operations (never blocked by preservation)
// ---------------------------------------------------------------------------

describe('preservation enforcement — move', () => {
  it('allows move on anchor track', () => {
    const session = sessionWithApproval('anchor');
    const action: AIAction = {
      type: 'move',
      param: 'timbre',
      target: { absolute: 0.7 },
      trackId: 'v0',
    };
    expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
  });

  it('allows move on approved track', () => {
    const session = sessionWithApproval('approved');
    const action: AIAction = {
      type: 'move',
      param: 'timbre',
      target: { absolute: 0.3 },
      trackId: 'v0',
    };
    expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
  });

  it('allows move on exploratory track', () => {
    const session = sessionWithApproval('exploratory');
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
// Prevalidation tests: say and listen never blocked
// ---------------------------------------------------------------------------

describe('preservation enforcement — say', () => {
  it('say is never blocked regardless of approval level', () => {
    const session = sessionWithApproval('anchor');
    const action: AIAction = { type: 'say', text: 'The kick pattern sounds great' };
    expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration test: executeOperations rejects and reports correctly
// ---------------------------------------------------------------------------

describe('preservation enforcement — executeOperations integration', () => {
  it('rejected sketch includes preservation reason in execution report', () => {
    const session = sessionWithApproval('anchor');
    const action: AIAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'new pattern',
      events: [{ kind: 'trigger', at: 0, velocity: 1 }],
    };
    const result = executeOperations(session, [action], adapter, makeArbitrator());
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Preservation');
    expect(result.rejected[0].reason).toContain('anchored');
  });

  it('accepts sketch with unchanged rhythm on approved track via executeOperations', () => {
    const session = sessionWithApproval('approved');
    const action: AIAction = {
      type: 'sketch',
      trackId: 'v0',
      description: 'velocity adjustment',
      events: [
        { kind: 'trigger', at: 0, velocity: 0.6 },
        { kind: 'trigger', at: 4, velocity: 0.6 },
        { kind: 'trigger', at: 8, velocity: 0.6 },
        { kind: 'trigger', at: 12, velocity: 0.6 },
      ],
    };
    const result = executeOperations(session, [action], adapter, makeArbitrator());
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('mixed batch: preserving ops accepted, violating ops rejected', () => {
    const session = sessionWithApproval('approved');
    const actions: AIAction[] = [
      // This should be accepted (same rhythm, different velocity)
      {
        type: 'sketch',
        trackId: 'v0',
        description: 'velocity tweak',
        events: [
          { kind: 'trigger', at: 0, velocity: 0.5 },
          { kind: 'trigger', at: 4, velocity: 0.5 },
          { kind: 'trigger', at: 8, velocity: 0.5 },
          { kind: 'trigger', at: 12, velocity: 0.5 },
        ],
      },
      // This should be rejected (rotate changes rhythm)
      {
        type: 'transform',
        trackId: 'v0',
        operation: 'rotate',
        steps: 2,
        description: 'rotate pattern',
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
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].op.type).toBe('transform');
    expect(result.rejected[0].reason).toContain('Preservation');
  });
});
