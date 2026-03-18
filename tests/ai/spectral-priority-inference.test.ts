// tests/ai/spectral-priority-inference.test.ts — Tests for spectral slot
// priority inference from musical role (#883).

import { describe, it, expect, vi } from 'vitest';
import { inferSpectralPriorityFromRole } from '../../src/ai/api';
import { GluonAI } from '../../src/ai/api';
import type { PlannerProvider, ListenerProvider, GenerateResult, FunctionResponse, NeutralFunctionCall } from '../../src/ai/types';
import type { Session } from '../../src/engine/types';
import { createSession } from '../../src/engine/session';

// ---------------------------------------------------------------------------
// Unit tests for inferSpectralPriorityFromRole
// ---------------------------------------------------------------------------

describe('inferSpectralPriorityFromRole', () => {
  it('returns 9 for bass/sub/kick/low roles', () => {
    expect(inferSpectralPriorityFromRole('main kick')).toBe(9);
    expect(inferSpectralPriorityFromRole('deep bass')).toBe(9);
    expect(inferSpectralPriorityFromRole('sub bass')).toBe(9);
    expect(inferSpectralPriorityFromRole('low end rumble')).toBe(9);
  });

  it('returns 7 for lead/vocal/melody roles', () => {
    expect(inferSpectralPriorityFromRole('lead synth')).toBe(7);
    expect(inferSpectralPriorityFromRole('main vocal')).toBe(7);
    expect(inferSpectralPriorityFromRole('melody line')).toBe(7);
  });

  it('returns 6 for rhythm/percussion roles', () => {
    expect(inferSpectralPriorityFromRole('hi hat')).toBe(6);
    expect(inferSpectralPriorityFromRole('snare drum')).toBe(6);
    expect(inferSpectralPriorityFromRole('drum machine')).toBe(6);
    expect(inferSpectralPriorityFromRole('percussion loop')).toBe(6);
    expect(inferSpectralPriorityFromRole('driving rhythm')).toBe(6);
  });

  it('returns 4 for harmony/chord/pad roles', () => {
    expect(inferSpectralPriorityFromRole('ambient pad')).toBe(4);
    expect(inferSpectralPriorityFromRole('chord stabs')).toBe(4);
    expect(inferSpectralPriorityFromRole('harmony layer')).toBe(4);
  });

  it('returns 2 for texture/ambient/noise/atmosphere/fx roles', () => {
    expect(inferSpectralPriorityFromRole('ambient texture')).toBe(2);
    expect(inferSpectralPriorityFromRole('noise sweep')).toBe(2);
    expect(inferSpectralPriorityFromRole('atmosphere bed')).toBe(2);
    expect(inferSpectralPriorityFromRole('fx riser')).toBe(2);
  });

  it('returns 5 for undefined or unrecognized roles', () => {
    expect(inferSpectralPriorityFromRole(undefined)).toBe(5);
    expect(inferSpectralPriorityFromRole('')).toBe(5);
    expect(inferSpectralPriorityFromRole('something unknown')).toBe(5);
  });

  it('is case-insensitive', () => {
    expect(inferSpectralPriorityFromRole('MAIN KICK')).toBe(9);
    expect(inferSpectralPriorityFromRole('Lead Synth')).toBe(7);
    expect(inferSpectralPriorityFromRole('AMBIENT TEXTURE')).toBe(2);
  });

  it('matches first applicable keyword when role contains multiple', () => {
    // "bass" matches before "lead" because bass check comes first
    expect(inferSpectralPriorityFromRole('bass lead')).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: assign_spectral_slot handler uses role inference
// ---------------------------------------------------------------------------

function createMockPlanner(calls: NeutralFunctionCall[]): PlannerProvider {
  let firstCall = true;
  return {
    name: 'mock',
    isConfigured: () => true,
    startTurn: vi.fn(async (): Promise<GenerateResult> => {
      if (firstCall) {
        firstCall = false;
        return { textParts: [], functionCalls: calls };
      }
      return { textParts: [], functionCalls: [] };
    }),
    continueTurn: vi.fn(async (): Promise<GenerateResult> => {
      return { textParts: [], functionCalls: [] };
    }),
    commitTurn: vi.fn(),
    discardTurn: vi.fn(),
    trimHistory: vi.fn(),
    clearHistory: vi.fn(),
  };
}

function createMockListener(): ListenerProvider {
  return {
    name: 'mock',
    isConfigured: () => true,
    evaluate: vi.fn(async () => 'sounds good'),
  };
}

async function callTool(
  session: Session,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ actions: unknown[]; response: Record<string, unknown> }> {
  const fc: NeutralFunctionCall = { id: 'test-call-1', name: toolName, args };
  const planner = createMockPlanner([fc]);
  const listener = createMockListener();
  const ai = new GluonAI(planner, listener);
  const actions = await ai.ask(session, 'test');

  const continueMock = planner.continueTurn as ReturnType<typeof vi.fn>;
  const callArgs = continueMock.mock.calls[0];
  const funcResponses: FunctionResponse[] = callArgs?.[0]?.functionResponses ?? [];
  const resp = funcResponses.find(r => r.id === 'test-call-1');

  const toolActions = actions.filter((a: { type: string }) => a.type !== 'say');

  return {
    actions: toolActions,
    response: (resp?.result ?? {}) as Record<string, unknown>,
  };
}

function makeSessionWithRole(musicalRole?: string): Session {
  const session = createSession();
  session.tracks[0].agency = 'on';
  if (musicalRole !== undefined) {
    session.tracks[0].musicalRole = musicalRole;
  }
  return session;
}

describe('assign_spectral_slot — priority inference from musicalRole', () => {
  it('respects explicit priority (no regression)', async () => {
    const session = makeSessionWithRole('main kick');
    const { actions } = await callTool(session, 'assign_spectral_slot', {
      trackId: session.tracks[0].id,
      bands: ['sub', 'low'],
      priority: 3,
    });
    expect(actions).toHaveLength(1);
    const action = actions[0] as { priority: number };
    expect(action.priority).toBe(3);
  });

  it('infers high priority for a kick track', async () => {
    const session = makeSessionWithRole('main kick');
    const { actions } = await callTool(session, 'assign_spectral_slot', {
      trackId: session.tracks[0].id,
      bands: ['sub', 'low'],
    });
    expect(actions).toHaveLength(1);
    const action = actions[0] as { priority: number };
    expect(action.priority).toBe(9);
  });

  it('infers low priority for an ambient texture track', async () => {
    const session = makeSessionWithRole('ambient texture');
    const { actions } = await callTool(session, 'assign_spectral_slot', {
      trackId: session.tracks[0].id,
      bands: ['high', 'air'],
    });
    expect(actions).toHaveLength(1);
    const action = actions[0] as { priority: number };
    expect(action.priority).toBe(2);
  });

  it('defaults to 5 when track has no musical role', async () => {
    const session = makeSessionWithRole();
    const { actions } = await callTool(session, 'assign_spectral_slot', {
      trackId: session.tracks[0].id,
      bands: ['mid'],
    });
    expect(actions).toHaveLength(1);
    const action = actions[0] as { priority: number };
    expect(action.priority).toBe(5);
  });

  it('explicit priority overrides role-based inference', async () => {
    const session = makeSessionWithRole('deep bass');
    const { actions } = await callTool(session, 'assign_spectral_slot', {
      trackId: session.tracks[0].id,
      bands: ['sub'],
      priority: 1,
    });
    expect(actions).toHaveLength(1);
    const action = actions[0] as { priority: number };
    // Explicit 1 should override the role-inferred 9
    expect(action.priority).toBe(1);
  });
});
