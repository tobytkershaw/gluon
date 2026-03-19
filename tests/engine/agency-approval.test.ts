// tests/engine/agency-approval.test.ts
// Tests for the master volume permission gate (#926)
// Previously tested agency-OFF approval prompts (#776), now replaced.
import { describe, it, expect, vi } from 'vitest';
import { prevalidateAction, MASTER_PERMISSION_PREFIX } from '../../src/engine/operation-executor';
import { createSession } from '../../src/engine/session';
import { createPlaitsAdapter } from '../../src/audio/plaits-adapter';
import { Arbitrator } from '../../src/engine/arbitration';
import type { AIAction } from '../../src/engine/types';

const adapter = createPlaitsAdapter();

function makeArbitrator(canAct = true) {
  const arb = new Arbitrator();
  vi.spyOn(arb, 'canAIAct').mockReturnValue(canAct);
  return arb;
}

describe('Master volume permission gate', () => {
  it('set_master with volume triggers permission rejection', () => {
    const session = createSession();
    const action: AIAction = { type: 'set_master', volume: 0.5 };
    const result = prevalidateAction(session, action, adapter, makeArbitrator());
    expect(result).not.toBeNull();
    expect(result!.startsWith(MASTER_PERMISSION_PREFIX)).toBe(true);
    expect(result).toContain('volume');
  });

  it('set_master with pan triggers permission rejection', () => {
    const session = createSession();
    const action: AIAction = { type: 'set_master', pan: 0.3 };
    const result = prevalidateAction(session, action, adapter, makeArbitrator());
    expect(result).not.toBeNull();
    expect(result!.startsWith(MASTER_PERMISSION_PREFIX)).toBe(true);
    expect(result).toContain('pan');
  });

  describe('agency removal — operations execute freely', () => {
    it('move on any track is allowed (no agency check)', () => {
      const session = createSession();
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, trackId: 'v0' };
      const result = prevalidateAction(session, action, adapter, makeArbitrator());
      expect(result).toBeNull();
    });

    it('sketch on any track is allowed (no agency check)', () => {
      const session = createSession();
      const action: AIAction = {
        type: 'sketch', trackId: 'v0', description: 'kick',
        events: [{ kind: 'trigger' as const, at: 0, velocity: 1 }],
      };
      const result = prevalidateAction(session, action, adapter, makeArbitrator());
      expect(result).toBeNull();
    });

    it('non-agency rejections still work (track not found)', () => {
      const session = createSession();
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, trackId: 'v99' };
      const result = prevalidateAction(session, action, adapter, makeArbitrator());
      expect(result).toBe('Track not found: v99');
    });

    it('arbitration rejections still work', () => {
      const session = createSession();
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, trackId: 'v0' };
      const result = prevalidateAction(session, action, adapter, makeArbitrator(false));
      expect(result).not.toBeNull();
      expect(result!).toContain('Arbitration');
    });
  });
});
