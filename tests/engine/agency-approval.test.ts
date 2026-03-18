// tests/engine/agency-approval.test.ts
// Tests for the agency-OFF approval prompt behavior (#776)
import { describe, it, expect, vi } from 'vitest';
import { prevalidateAction } from '../../src/engine/operation-executor';
import { isAgencyRejection, buildAgencyApproval } from '../../src/ai/api';
import { createSession } from '../../src/engine/session';
import { createPlaitsAdapter } from '../../src/audio/plaits-adapter';
import { Arbitrator } from '../../src/engine/arbitration';
import type { AIAction } from '../../src/engine/types';
import { AGENCY_REJECTION_PREFIX } from '../../src/engine/types';

const adapter = createPlaitsAdapter();

function makeArbitrator(canAct = true) {
  const arb = new Arbitrator();
  vi.spyOn(arb, 'canAIAct').mockReturnValue(canAct);
  return arb;
}

describe('Agency approval prompt', () => {
  describe('prevalidateAction agency prefix', () => {
    it('agency-OFF rejection starts with AGENCY_REJECTION_PREFIX', () => {
      const session = createSession();
      const s = {
        ...session,
        tracks: session.tracks.map(v => v.id === 'v0' ? { ...v, agency: 'OFF' as const } : v),
      };
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, trackId: 'v0' };
      const result = prevalidateAction(s, action, adapter, makeArbitrator());
      expect(result).not.toBeNull();
      expect(result!.startsWith(AGENCY_REJECTION_PREFIX)).toBe(true);
    });

    it('sketch agency-OFF rejection starts with AGENCY_REJECTION_PREFIX', () => {
      const session = createSession();
      const s = {
        ...session,
        tracks: session.tracks.map(v => v.id === 'v0' ? { ...v, agency: 'OFF' as const } : v),
      };
      const action: AIAction = {
        type: 'sketch', trackId: 'v0', description: 'kick',
        events: [{ kind: 'trigger' as const, at: 0, velocity: 1 }],
      };
      const result = prevalidateAction(s, action, adapter, makeArbitrator());
      expect(result).not.toBeNull();
      expect(result!.startsWith(AGENCY_REJECTION_PREFIX)).toBe(true);
    });

    it('non-agency rejections do NOT start with agency prefix', () => {
      const session = createSession();
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, trackId: 'v99' };
      const result = prevalidateAction(session, action, adapter, makeArbitrator());
      expect(result).toBe('Track not found: v99');
      expect(result!.startsWith(AGENCY_REJECTION_PREFIX)).toBe(false);
    });

    it('arbitration rejections do NOT start with agency prefix', () => {
      const session = createSession();
      const s = {
        ...session,
        tracks: session.tracks.map(v => v.id === 'v0' ? { ...v, agency: 'ON' as const } : v),
      };
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, trackId: 'v0' };
      const result = prevalidateAction(s, action, adapter, makeArbitrator(false));
      expect(result).not.toBeNull();
      expect(result!.startsWith(AGENCY_REJECTION_PREFIX)).toBe(false);
      expect(result!).toContain('Arbitration');
    });
  });

  describe('isAgencyRejection', () => {
    it('detects agency rejection and extracts track ID', () => {
      const result = isAgencyRejection('Agency: Track v0 has agency OFF');
      expect(result).toBe('v0');
    });

    it('returns null for non-agency rejections', () => {
      expect(isAgencyRejection('Track not found: v99')).toBeNull();
      expect(isAgencyRejection('Arbitration: human is holding timbre')).toBeNull();
    });

    it('handles different track ID formats', () => {
      expect(isAgencyRejection('Agency: Track my-track-123 has agency OFF')).toBe('my-track-123');
    });
  });

  describe('buildAgencyApproval', () => {
    it('returns raise_decision action and structured response', () => {
      const session = createSession();
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, trackId: 'v0' };
      const result = buildAgencyApproval(session, action, 'v0');

      // Should have a raise_decision action
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('raise_decision');
      const decision = result.actions[0] as { type: 'raise_decision'; decisionId: string; question: string; options?: string[] };
      expect(decision.question).toContain('agency OFF');
      expect(decision.options).toEqual(['Allow', 'Deny']);

      // Response should be structured (not an error)
      expect(result.response).toHaveProperty('blocked', true);
      expect(result.response).toHaveProperty('reason', 'agency_off');
      expect(result.response).toHaveProperty('trackId', 'v0');
      expect(result.response).toHaveProperty('decisionId');
      expect(result.response).toHaveProperty('pendingAction');
      expect(result.response).toHaveProperty('message');
      expect(result.response).not.toHaveProperty('error');
    });

    it('includes the blocked action in the response', () => {
      const session = createSession();
      const action: AIAction = {
        type: 'sketch', trackId: 'v0', description: 'kick pattern',
        events: [{ kind: 'trigger' as const, at: 0, velocity: 1 }],
      };
      const result = buildAgencyApproval(session, action, 'v0');

      const pendingAction = (result.response as Record<string, unknown>).pendingAction as AIAction;
      expect(pendingAction).toEqual(action);
    });

    it('decision ID matches between action and response', () => {
      const session = createSession();
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, trackId: 'v0' };
      const result = buildAgencyApproval(session, action, 'v0');

      const decision = result.actions[0] as { type: 'raise_decision'; decisionId: string };
      const responseDecisionId = (result.response as Record<string, unknown>).decisionId;
      expect(decision.decisionId).toBe(responseDecisionId);
    });
  });
});
