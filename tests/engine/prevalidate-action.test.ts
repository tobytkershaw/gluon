// tests/engine/prevalidate-action.test.ts
import { describe, it, expect, vi } from 'vitest';
import { prevalidateAction } from '../../src/engine/operation-executor';
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

describe('prevalidateAction', () => {
  describe('move', () => {
    it('returns null for valid move on ON voice', () => {
      const session = createSession();
      // v0 has agency ON by default in createSession (voices are AI-editable unless protected)
      const s = {
        ...session,
        voices: session.voices.map(v => v.id === 'v0' ? { ...v, agency: 'ON' as const } : v),
      };
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, voiceId: 'v0' };
      expect(prevalidateAction(s, action, adapter, makeArbitrator())).toBeNull();
    });

    it('rejects move on non-existent voice', () => {
      const session = createSession();
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, voiceId: 'v99' };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBe('Voice not found: v99');
    });

    it('rejects move on voice with agency OFF', () => {
      const session = createSession();
      // Ensure v0 has agency OFF
      const s = {
        ...session,
        voices: session.voices.map(v => v.id === 'v0' ? { ...v, agency: 'OFF' as const } : v),
      };
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, voiceId: 'v0' };
      expect(prevalidateAction(s, action, adapter, makeArbitrator())).toBe('Voice v0 has agency OFF');
    });

    it('rejects move with unknown control', () => {
      const session = createSession();
      const s = {
        ...session,
        voices: session.voices.map(v => v.id === 'v0' ? { ...v, agency: 'ON' as const } : v),
      };
      const action: AIAction = { type: 'move', param: 'nonexistent_param', target: { absolute: 0.5 }, voiceId: 'v0' };
      expect(prevalidateAction(s, action, adapter, makeArbitrator())).toBe('Unknown control: nonexistent_param');
    });

    it('rejects move when arbitrator blocks', () => {
      const session = createSession();
      const s = {
        ...session,
        voices: session.voices.map(v => v.id === 'v0' ? { ...v, agency: 'ON' as const } : v),
      };
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, voiceId: 'v0' };
      const result = prevalidateAction(s, action, adapter, makeArbitrator(false));
      expect(result).toContain('Arbitration');
      expect(result).toContain('timbre');
    });

    it('accepts canonical controlId (brightness → timbre)', () => {
      const session = createSession();
      const s = {
        ...session,
        voices: session.voices.map(v => v.id === 'v0' ? { ...v, agency: 'ON' as const } : v),
      };
      const action: AIAction = { type: 'move', param: 'brightness', target: { absolute: 0.7 }, voiceId: 'v0' };
      expect(prevalidateAction(s, action, adapter, makeArbitrator())).toBeNull();
    });
  });

  describe('sketch', () => {
    it('returns null for valid sketch on ON voice', () => {
      const session = createSession();
      const s = {
        ...session,
        voices: session.voices.map(v => v.id === 'v0' ? { ...v, agency: 'ON' as const } : v),
      };
      const action: AIAction = {
        type: 'sketch', voiceId: 'v0', description: 'kick',
        events: [{ kind: 'trigger' as const, at: 0, velocity: 1 }],
      };
      expect(prevalidateAction(s, action, adapter, makeArbitrator())).toBeNull();
    });

    it('rejects sketch on non-existent voice', () => {
      const session = createSession();
      const action: AIAction = {
        type: 'sketch', voiceId: 'v99', description: 'kick',
        events: [{ kind: 'trigger' as const, at: 0, velocity: 1 }],
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBe('Voice not found: v99');
    });

    it('rejects sketch on voice with agency OFF', () => {
      const session = createSession();
      const s = {
        ...session,
        voices: session.voices.map(v => v.id === 'v0' ? { ...v, agency: 'OFF' as const } : v),
      };
      const action: AIAction = {
        type: 'sketch', voiceId: 'v0', description: 'kick',
        events: [{ kind: 'trigger' as const, at: 0, velocity: 1 }],
      };
      expect(prevalidateAction(s, action, adapter, makeArbitrator())).toBe('Voice v0 has agency OFF');
    });
  });

  describe('set_transport and say', () => {
    it('always accepts set_transport', () => {
      const session = createSession();
      const action: AIAction = { type: 'set_transport', bpm: 140 };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
    });

    it('always accepts say', () => {
      const session = createSession();
      const action: AIAction = { type: 'say', text: 'hello' };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
    });
  });
});
