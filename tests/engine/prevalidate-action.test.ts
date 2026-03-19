// tests/engine/prevalidate-action.test.ts
import { describe, it, expect, vi } from 'vitest';
import { prevalidateAction } from '../../src/engine/operation-executor';
import { createSession } from '../../src/engine/session';
import { createPlaitsAdapter } from '../../src/audio/plaits-adapter';
import { Arbitrator } from '../../src/engine/arbitration';
import type { AIAction } from '../../src/engine/types';

import type { ProcessorConfig, ModulatorConfig, ModulationRouting, Session } from '../../src/engine/types';

const adapter = createPlaitsAdapter();

function makeArbitrator(canAct = true) {
  const arb = new Arbitrator();
  vi.spyOn(arb, 'canAIAct').mockReturnValue(canAct);
  return arb;
}

function makeTrackArbitrator(canActOnTrack = true, canAct = true) {
  const arb = new Arbitrator();
  vi.spyOn(arb, 'canAIAct').mockReturnValue(canAct);
  vi.spyOn(arb, 'canAIActOnTrack').mockReturnValue(canActOnTrack);
  return arb;
}

function sessionWithProcessor(): Session {
  const session = createSession();
  const proc: ProcessorConfig = {
    id: 'rings-1',
    type: 'rings',
    model: 0,
    params: { structure: 0.5 },
  };
  return {
    ...session,
    tracks: session.tracks.map(v =>
      v.id === 'v0' ? { ...v, agency: 'ON' as const, processors: [proc] } : v,
    ),
  };
}

function sessionWithModulator(): Session {
  const session = createSession();
  const mod: ModulatorConfig = {
    id: 'tides-1',
    type: 'tides',
    model: 0,
    params: { frequency: 0.5 },
  };
  const routing: ModulationRouting = {
    id: 'mod-route-1',
    modulatorId: 'tides-1',
    target: { kind: 'source', param: 'timbre' },
    depth: 0.3,
  };
  return {
    ...session,
    tracks: session.tracks.map(v =>
      v.id === 'v0' ? { ...v, agency: 'ON' as const, modulators: [mod], modulations: [routing] } : v,
    ),
  };
}

describe('prevalidateAction', () => {
  describe('move', () => {
    it('returns null for valid move on ON track', () => {
      const session = createSession();
      // v0 has agency ON by default in createSession (tracks are AI-editable unless protected)
      const s = {
        ...session,
        tracks: session.tracks.map(v => v.id === 'v0' ? { ...v, agency: 'ON' as const } : v),
      };
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, trackId: 'v0' };
      expect(prevalidateAction(s, action, adapter, makeArbitrator())).toBeNull();
    });

    it('rejects move on non-existent track', () => {
      const session = createSession();
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, trackId: 'v99' };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBe('Track not found: v99');
    });

    // Agency enforcement removed in #926.

    it('rejects move with unknown control', () => {
      const session = createSession();
      const action: AIAction = { type: 'move', param: 'nonexistent_param', target: { absolute: 0.5 }, trackId: 'v0' };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBe('Unknown control: nonexistent_param');
    });

    it('rejects move when arbitrator blocks', () => {
      const session = createSession();
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, trackId: 'v0' };
      const result = prevalidateAction(session, action, adapter, makeArbitrator(false));
      expect(result).toContain('Arbitration');
      expect(result).toContain('timbre');
    });

    it('accepts canonical controlId (timbre)', () => {
      const session = createSession();
      const action: AIAction = { type: 'move', param: 'timbre', target: { absolute: 0.7 }, trackId: 'v0' };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
    });
  });

  describe('sketch', () => {
    it('returns null for valid sketch', () => {
      const session = createSession();
      const action: AIAction = {
        type: 'sketch', trackId: 'v0', description: 'kick',
        events: [{ kind: 'trigger' as const, at: 0, velocity: 1 }],
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
    });

    it('rejects sketch on non-existent track', () => {
      const session = createSession();
      const action: AIAction = {
        type: 'sketch', trackId: 'v99', description: 'kick',
        events: [{ kind: 'trigger' as const, at: 0, velocity: 1 }],
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBe('Track not found: v99');
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

  describe('canAIActOnTrack gates structural operations on tracks', () => {
    it('rejects add_processor when human is interacting with track', () => {
      const s = sessionWithProcessor();
      const action: AIAction = { type: 'add_processor', trackId: 'v0', processorId: 'rings-2', moduleType: 'rings', description: 'add rings' };
      expect(prevalidateAction(s, action, adapter, makeTrackArbitrator(false))).toContain('Arbitration');
    });

    it('accepts add_processor when human is not interacting', () => {
      const s = sessionWithProcessor();
      const action: AIAction = { type: 'add_processor', trackId: 'v0', processorId: 'rings-2', moduleType: 'rings', description: 'add rings' };
      expect(prevalidateAction(s, action, adapter, makeTrackArbitrator(true))).toBeNull();
    });

    it('rejects remove_processor when human is interacting with track', () => {
      const s = sessionWithProcessor();
      const action: AIAction = { type: 'remove_processor', trackId: 'v0', processorId: 'rings-1', description: 'remove rings' };
      expect(prevalidateAction(s, action, adapter, makeTrackArbitrator(false))).toContain('Arbitration');
    });

    it('rejects replace_processor when human is interacting with track', () => {
      const s = sessionWithProcessor();
      const action: AIAction = { type: 'replace_processor', trackId: 'v0', processorId: 'rings-1', newProcessorId: 'rings-2', newModuleType: 'rings', description: 'replace' };
      expect(prevalidateAction(s, action, adapter, makeTrackArbitrator(false))).toContain('Arbitration');
    });

    it('rejects add_modulator when human is interacting with track', () => {
      const session = createSession();
      const s = { ...session, tracks: session.tracks.map(v => v.id === 'v0' ? { ...v, agency: 'ON' as const } : v) };
      const action: AIAction = { type: 'add_modulator', trackId: 'v0', modulatorId: 'tides-2', moduleType: 'tides', description: 'add tides' };
      expect(prevalidateAction(s, action, adapter, makeTrackArbitrator(false))).toContain('Arbitration');
    });

    it('rejects remove_modulator when human is interacting with track', () => {
      const s = sessionWithModulator();
      const action: AIAction = { type: 'remove_modulator', trackId: 'v0', modulatorId: 'tides-1', description: 'remove tides' };
      expect(prevalidateAction(s, action, adapter, makeTrackArbitrator(false))).toContain('Arbitration');
    });

    it('rejects connect_modulator when human is interacting with track', () => {
      const s = sessionWithModulator();
      const action: AIAction = { type: 'connect_modulator', trackId: 'v0', modulatorId: 'tides-1', target: { kind: 'source', param: 'harmonics' }, depth: 0.5, description: 'connect' };
      expect(prevalidateAction(s, action, adapter, makeTrackArbitrator(false))).toContain('Arbitration');
    });

    it('rejects disconnect_modulator when human is interacting with track', () => {
      const s = sessionWithModulator();
      const action: AIAction = { type: 'disconnect_modulator', trackId: 'v0', modulationId: 'mod-route-1', description: 'disconnect' };
      expect(prevalidateAction(s, action, adapter, makeTrackArbitrator(false))).toContain('Arbitration');
    });

    it('rejects set_model (source) when human is interacting with track', () => {
      const session = createSession();
      const s = { ...session, tracks: session.tracks.map(v => v.id === 'v0' ? { ...v, agency: 'ON' as const } : v) };
      const action: AIAction = { type: 'set_model', trackId: 'v0', model: 'virtual-analog' };
      expect(prevalidateAction(s, action, adapter, makeTrackArbitrator(false))).toContain('Arbitration');
    });

    it('rejects set_model (processor) when human is interacting with track', () => {
      const s = sessionWithProcessor();
      const action: AIAction = { type: 'set_model', trackId: 'v0', processorId: 'rings-1', model: 'string' };
      expect(prevalidateAction(s, action, adapter, makeTrackArbitrator(false))).toContain('Arbitration');
    });

    it('rejects set_model (modulator) when human is interacting with track', () => {
      const s = sessionWithModulator();
      const action: AIAction = { type: 'set_model', trackId: 'v0', modulatorId: 'tides-1', model: 'looping' };
      expect(prevalidateAction(s, action, adapter, makeTrackArbitrator(false))).toContain('Arbitration');
    });
  });

  describe('canAIAct gates processor/modulator move operations', () => {
    it('rejects processor move when arbitrator blocks namespaced key', () => {
      const s = sessionWithProcessor();
      const arb = new Arbitrator();
      vi.spyOn(arb, 'canAIAct').mockImplementation((_trackId, param) => {
        return param !== 'processor:rings-1:structure';
      });
      const action: AIAction = { type: 'move', trackId: 'v0', processorId: 'rings-1', param: 'structure', target: { absolute: 0.8 } };
      const result = prevalidateAction(s, action, adapter, arb);
      expect(result).toContain('Arbitration');
      expect(result).toContain('rings-1:structure');
    });

    it('accepts processor move when arbitrator allows namespaced key', () => {
      const s = sessionWithProcessor();
      const action: AIAction = { type: 'move', trackId: 'v0', processorId: 'rings-1', param: 'structure', target: { absolute: 0.8 } };
      expect(prevalidateAction(s, action, adapter, makeArbitrator(true))).toBeNull();
    });

    it('rejects modulator move when arbitrator blocks namespaced key', () => {
      const s = sessionWithModulator();
      const arb = new Arbitrator();
      vi.spyOn(arb, 'canAIAct').mockImplementation((_trackId, param) => {
        return param !== 'modulator:tides-1:frequency';
      });
      const action: AIAction = { type: 'move', trackId: 'v0', modulatorId: 'tides-1', param: 'frequency', target: { absolute: 0.8 } };
      const result = prevalidateAction(s, action, adapter, arb);
      expect(result).toContain('Arbitration');
      expect(result).toContain('tides-1:frequency');
    });

    it('accepts modulator move when arbitrator allows namespaced key', () => {
      const s = sessionWithModulator();
      const action: AIAction = { type: 'move', trackId: 'v0', modulatorId: 'tides-1', param: 'frequency', target: { absolute: 0.8 } };
      expect(prevalidateAction(s, action, adapter, makeArbitrator(true))).toBeNull();
    });
  });
});
