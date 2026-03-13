// tests/engine/replace-processor.test.ts
// Tests for #104: replace_processor tool

import { describe, it, expect, vi } from 'vitest';
import { prevalidateAction, executeOperations } from '../../src/engine/operation-executor';
import { applyUndo } from '../../src/engine/primitives';
import { createSession } from '../../src/engine/session';
import { createPlaitsAdapter } from '../../src/audio/plaits-adapter';
import { Arbitrator } from '../../src/engine/arbitration';
import type { AIAction, ProcessorConfig, Session } from '../../src/engine/types';
import { getVoice } from '../../src/engine/types';

const adapter = createPlaitsAdapter();

function makeArbitrator() {
  const arb = new Arbitrator();
  vi.spyOn(arb, 'canAIAct').mockReturnValue(true);
  return arb;
}

function sessionWithRings(): Session {
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

describe('replace_processor', () => {
  describe('prevalidation', () => {
    it('accepts valid replace (Rings → Clouds)', () => {
      const session = sessionWithRings();
      const action: AIAction = {
        type: 'replace_processor',
        voiceId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'clouds',
        description: 'swap Rings for Clouds',
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
    });

    it('rejects when old processor does not exist', () => {
      const session = sessionWithRings();
      const action: AIAction = {
        type: 'replace_processor',
        voiceId: 'v0',
        processorId: 'nonexistent',
        newModuleType: 'clouds',
        description: 'swap',
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toMatch(/not found/i);
    });

    it('rejects when new type is invalid', () => {
      const session = sessionWithRings();
      const action: AIAction = {
        type: 'replace_processor',
        voiceId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'invalid',
        description: 'swap',
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toMatch(/invalid|unknown/i);
    });

    it('rejects when agency is OFF', () => {
      const session = sessionWithRings();
      const s = {
        ...session,
        voices: session.voices.map(v => v.id === 'v0' ? { ...v, agency: 'OFF' as const } : v),
      };
      const action: AIAction = {
        type: 'replace_processor',
        voiceId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'clouds',
        description: 'swap',
      };
      expect(prevalidateAction(s, action, adapter, makeArbitrator())).toMatch(/agency/i);
    });
  });

  describe('execution', () => {
    it('replaces processor at same index', () => {
      const session = sessionWithRings();
      const action: AIAction = {
        type: 'replace_processor',
        voiceId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'clouds',
        description: 'swap Rings for Clouds',
      };
      const report = executeOperations(session, [action], adapter, makeArbitrator());
      expect(report.accepted).toHaveLength(1);

      const voice = getVoice(report.session, 'v0');
      expect(voice.processors).toHaveLength(1);
      expect(voice.processors![0].type).toBe('clouds');
      expect(voice.processors![0].model).toBe(0);
      expect(voice.processors![0].id).not.toBe('rings-test-1'); // new ID
    });

    it('preserves chain position when multiple processors exist', () => {
      const session = sessionWithRings();
      // Add a second processor
      const proc2: ProcessorConfig = {
        id: 'clouds-test-1', type: 'clouds', model: 0,
        params: { position: 0.5, size: 0.5, density: 0.5, feedback: 0 },
      };
      const s = {
        ...session,
        voices: session.voices.map(v =>
          v.id === 'v0' ? { ...v, processors: [...(v.processors ?? []), proc2] } : v,
        ),
      };

      const action: AIAction = {
        type: 'replace_processor',
        voiceId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'clouds',
        description: 'swap first processor',
      };
      const report = executeOperations(s, [action], adapter, makeArbitrator());
      const voice = getVoice(report.session, 'v0');

      // First processor replaced, second unchanged
      expect(voice.processors).toHaveLength(2);
      expect(voice.processors![0].type).toBe('clouds');
      expect(voice.processors![1].id).toBe('clouds-test-1');
    });
  });

  describe('undo', () => {
    it('restores original processor on undo', () => {
      const session = sessionWithRings();
      const action: AIAction = {
        type: 'replace_processor',
        voiceId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'clouds',
        description: 'swap Rings for Clouds',
      };
      const report = executeOperations(session, [action], adapter, makeArbitrator());
      const undone = applyUndo(report.session);

      const voice = getVoice(undone, 'v0');
      expect(voice.processors).toHaveLength(1);
      expect(voice.processors![0].type).toBe('rings');
      expect(voice.processors![0].id).toBe('rings-test-1');
      expect(voice.processors![0].params.structure).toBe(0.5);
    });
  });
});
