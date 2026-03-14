// tests/engine/processor-controls.test.ts
// Tests for #100: Processor Control Authority
// move(processorId?) and set_model(processorId?) targeting processors

import { describe, it, expect, vi } from 'vitest';
import { prevalidateAction, executeOperations } from '../../src/engine/operation-executor';
import { applyUndo } from '../../src/engine/primitives';
import { createSession } from '../../src/engine/session';
import { createPlaitsAdapter } from '../../src/audio/plaits-adapter';
import { Arbitrator } from '../../src/engine/arbitration';
import type { AIAction, ProcessorConfig, Session } from '../../src/engine/types';
import { getVoice } from '../../src/engine/types';

const adapter = createPlaitsAdapter();

function makeArbitrator(canAct = true) {
  const arb = new Arbitrator();
  vi.spyOn(arb, 'canAIAct').mockReturnValue(canAct);
  return arb;
}

/** Create a session with a Rings processor on v0 */
function sessionWithProcessor(): Session {
  const session = createSession();
  const proc: ProcessorConfig = {
    id: 'rings-test-1',
    type: 'rings',
    model: 0,
    params: { structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 },
  };
  return {
    ...session,
    voices: session.voices.map(v =>
      v.id === 'v0' ? { ...v, agency: 'ON' as const, processors: [proc] } : v,
    ),
  };
}

describe('Processor-targeted move', () => {
  describe('prevalidation', () => {
    it('accepts valid processor move', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'move', param: 'brightness', target: { absolute: 0.3 },
        voiceId: 'v0', processorId: 'rings-test-1',
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
    });

    it('rejects move on nonexistent processor', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'move', param: 'brightness', target: { absolute: 0.3 },
        voiceId: 'v0', processorId: 'nonexistent',
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator()))
        .toBe('Processor not found: nonexistent on voice v0');
    });

    it('rejects move with invalid processor control', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'move', param: 'invalid_control', target: { absolute: 0.3 },
        voiceId: 'v0', processorId: 'rings-test-1',
      };
      const result = prevalidateAction(session, action, adapter, makeArbitrator());
      expect(result).toContain('Unknown rings control: invalid_control');
      expect(result).toContain('structure');
    });

    it('rejects processor move with over (timed moves not supported)', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'move', param: 'brightness', target: { absolute: 0.3 },
        voiceId: 'v0', processorId: 'rings-test-1', over: 2000,
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator()))
        .toMatch(/not supported.*processor/i);
    });

    it('rejects processor move when agency OFF', () => {
      const session = sessionWithProcessor();
      const s = {
        ...session,
        voices: session.voices.map(v => v.id === 'v0' ? { ...v, agency: 'OFF' as const } : v),
      };
      const action: AIAction = {
        type: 'move', param: 'brightness', target: { absolute: 0.3 },
        voiceId: 'v0', processorId: 'rings-test-1',
      };
      expect(prevalidateAction(s, action, adapter, makeArbitrator()))
        .toBe('Voice v0 has agency OFF');
    });
  });

  describe('execution', () => {
    it('updates processor params, not voice params', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'move', param: 'brightness', target: { absolute: 0.3 },
        voiceId: 'v0', processorId: 'rings-test-1',
      };
      const result = executeOperations(session, [action], adapter, makeArbitrator());
      expect(result.accepted).toHaveLength(1);
      const voice = getVoice(result.session, 'v0');
      // Processor param updated
      expect(voice.processors![0].params.brightness).toBeCloseTo(0.3);
      // Voice source param unchanged
      expect(voice.params.timbre).toBe(0.5);
    });

    it('supports relative processor moves', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'move', param: 'brightness', target: { relative: 0.2 },
        voiceId: 'v0', processorId: 'rings-test-1',
      };
      const result = executeOperations(session, [action], adapter, makeArbitrator());
      const voice = getVoice(result.session, 'v0');
      expect(voice.processors![0].params.brightness).toBeCloseTo(0.7);
    });

    it('clamps processor param to 0-1', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'move', param: 'brightness', target: { absolute: 1.5 },
        voiceId: 'v0', processorId: 'rings-test-1',
      };
      const result = executeOperations(session, [action], adapter, makeArbitrator());
      const voice = getVoice(result.session, 'v0');
      expect(voice.processors![0].params.brightness).toBe(1);
    });

    it('creates ProcessorStateSnapshot for undo', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'move', param: 'brightness', target: { absolute: 0.3 },
        voiceId: 'v0', processorId: 'rings-test-1',
      };
      const result = executeOperations(session, [action], adapter, makeArbitrator());
      expect(result.session.undoStack).toHaveLength(1);
      const entry = result.session.undoStack[0];
      expect(entry.kind).toBe('processor-state');
      if (entry.kind === 'processor-state') {
        expect(entry.processorId).toBe('rings-test-1');
        expect(entry.prevParams.brightness).toBe(0.5);
        expect(entry.prevModel).toBe(0);
      }
    });
  });

  describe('undo', () => {
    it('reverts processor param change', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'move', param: 'brightness', target: { absolute: 0.3 },
        voiceId: 'v0', processorId: 'rings-test-1',
      };
      const result = executeOperations(session, [action], adapter, makeArbitrator());
      const undone = applyUndo(result.session);
      const voice = getVoice(undone, 'v0');
      expect(voice.processors![0].params.brightness).toBe(0.5);
    });
  });

  describe('backward compatibility', () => {
    it('move without processorId still works for voice params', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'move', param: 'timbre', target: { absolute: 0.8 }, voiceId: 'v0',
      };
      const result = executeOperations(session, [action], adapter, makeArbitrator());
      expect(result.accepted).toHaveLength(1);
      const voice = getVoice(result.session, 'v0');
      expect(voice.params.timbre).toBeCloseTo(0.8);
      // Processor unchanged
      expect(voice.processors![0].params.brightness).toBe(0.5);
    });
  });
});

describe('Processor-targeted set_model', () => {
  describe('prevalidation', () => {
    it('accepts valid processor model switch', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'set_model', voiceId: 'v0', model: 'string',
        processorId: 'rings-test-1',
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
    });

    it('rejects invalid processor model name', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'set_model', voiceId: 'v0', model: 'nonexistent',
        processorId: 'rings-test-1',
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator()))
        .toBe('Unknown rings model: nonexistent');
    });

    it('rejects model switch on nonexistent processor', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'set_model', voiceId: 'v0', model: 'string',
        processorId: 'nonexistent',
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator()))
        .toBe('Processor not found: nonexistent on voice v0');
    });
  });

  describe('execution', () => {
    it('updates processor model, not voice model', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'set_model', voiceId: 'v0', model: 'string',
        processorId: 'rings-test-1',
      };
      const result = executeOperations(session, [action], adapter, makeArbitrator());
      expect(result.accepted).toHaveLength(1);
      const voice = getVoice(result.session, 'v0');
      // Processor model updated (string is index 2 in Rings engines)
      expect(voice.processors![0].model).toBe(2);
      // Voice source model unchanged
      expect(voice.model).toBe(session.voices[0].model);
    });

    it('captures full processor state in snapshot', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'set_model', voiceId: 'v0', model: 'string',
        processorId: 'rings-test-1',
      };
      const result = executeOperations(session, [action], adapter, makeArbitrator());
      const entry = result.session.undoStack[0];
      expect(entry.kind).toBe('processor-state');
      if (entry.kind === 'processor-state') {
        expect(entry.prevModel).toBe(0);
        expect(entry.prevParams).toEqual({ structure: 0.5, brightness: 0.5, damping: 0.7, position: 0.5 });
      }
    });
  });

  describe('undo', () => {
    it('reverts processor model change', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'set_model', voiceId: 'v0', model: 'string',
        processorId: 'rings-test-1',
      };
      const result = executeOperations(session, [action], adapter, makeArbitrator());
      const undone = applyUndo(result.session);
      const voice = getVoice(undone, 'v0');
      expect(voice.processors![0].model).toBe(0);
    });
  });

  describe('backward compatibility', () => {
    it('set_model without processorId still works for voice', () => {
      const session = sessionWithProcessor();
      const action: AIAction = {
        type: 'set_model', voiceId: 'v0', model: 'fm',
      };
      const result = executeOperations(session, [action], adapter, makeArbitrator());
      expect(result.accepted).toHaveLength(1);
      const voice = getVoice(result.session, 'v0');
      expect(voice.model).toBe(2); // FM is index 2 in Plaits engines
      // Processor unchanged
      expect(voice.processors![0].model).toBe(0);
    });
  });
});

describe('Grouped undo for processor actions', () => {
  it('groups processor move + model change into single undo', () => {
    const session = sessionWithProcessor();
    const actions: AIAction[] = [
      { type: 'move', param: 'brightness', target: { absolute: 0.3 }, voiceId: 'v0', processorId: 'rings-test-1' },
      { type: 'set_model', voiceId: 'v0', model: 'string', processorId: 'rings-test-1' },
    ];
    const result = executeOperations(session, actions, adapter, makeArbitrator());
    expect(result.accepted).toHaveLength(2);
    // Should be grouped into one undo entry
    expect(result.session.undoStack).toHaveLength(1);
    expect(result.session.undoStack[0].kind).toBe('group');

    // Undo reverts both
    const undone = applyUndo(result.session);
    const voice = getVoice(undone, 'v0');
    expect(voice.processors![0].params.brightness).toBe(0.5);
    expect(voice.processors![0].model).toBe(0);
  });
});
