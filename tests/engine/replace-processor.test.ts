// tests/engine/replace-processor.test.ts
// Tests for #104: replace_processor tool

import { describe, it, expect, vi } from 'vitest';
import { prevalidateAction, executeOperations } from '../../src/engine/operation-executor';
import { applyUndo } from '../../src/engine/primitives';
import { createSession } from '../../src/engine/session';
import { createPlaitsAdapter } from '../../src/audio/plaits-adapter';
import { Arbitrator } from '../../src/engine/arbitration';
import type { AIAction, ProcessorConfig, ModulationRouting, Session } from '../../src/engine/types';
import { getTrack } from '../../src/engine/types';

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
    tracks: session.tracks.map(v =>
      v.id === 'v0' ? { ...v, agency: 'ON' as const, processors: [proc] } : v,
    ),
  };
}

function sessionWithRingsAndRouting(): Session {
  const session = sessionWithRings();
  const routing: ModulationRouting = {
    id: 'mod-route-1',
    modulatorId: 'tides-test-1',
    target: { kind: 'processor', processorId: 'rings-test-1', param: 'brightness' },
    depth: 0.2,
  };
  return {
    ...session,
    tracks: session.tracks.map(v =>
      v.id === 'v0'
        ? {
            ...v,
            modulators: [{ id: 'tides-test-1', type: 'tides', model: 1, params: { frequency: 0.5, shape: 0.5, slope: 0.5, smoothness: 0.5 } }],
            modulations: [routing],
          }
        : v,
    ),
  };
}

describe('replace_processor', () => {
  describe('prevalidation', () => {
    it('accepts valid replace (Rings → Clouds)', () => {
      const session = sessionWithRings();
      const action: AIAction = {
        type: 'replace_processor',
        trackId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'clouds',
        newProcessorId: 'clouds-replace-1',
        description: 'swap Rings for Clouds',
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toBeNull();
    });

    it('rejects when old processor does not exist', () => {
      const session = sessionWithRings();
      const action: AIAction = {
        type: 'replace_processor',
        trackId: 'v0',
        processorId: 'nonexistent',
        newModuleType: 'clouds',
        newProcessorId: 'clouds-replace-x',
        description: 'swap',
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toMatch(/not found/i);
    });

    it('rejects when new type is invalid', () => {
      const session = sessionWithRings();
      const action: AIAction = {
        type: 'replace_processor',
        trackId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'invalid',
        newProcessorId: 'invalid-replace-x',
        description: 'swap',
      };
      expect(prevalidateAction(session, action, adapter, makeArbitrator())).toMatch(/invalid|unknown/i);
    });

    it('rejects when agency is OFF', () => {
      const session = sessionWithRings();
      const s = {
        ...session,
        tracks: session.tracks.map(v => v.id === 'v0' ? { ...v, agency: 'OFF' as const } : v),
      };
      const action: AIAction = {
        type: 'replace_processor',
        trackId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'clouds',
        newProcessorId: 'clouds-replace-x',
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
        trackId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'clouds',
        newProcessorId: 'clouds-replace-1',
        description: 'swap Rings for Clouds',
      };
      const report = executeOperations(session, [action], adapter, makeArbitrator());
      expect(report.accepted).toHaveLength(1);

      const track = getTrack(report.session, 'v0');
      expect(track.processors).toHaveLength(1);
      expect(track.processors![0].type).toBe('clouds');
      expect(track.processors![0].model).toBe(0);
      expect(track.processors![0].id).toBe('clouds-replace-1'); // uses pre-assigned ID
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
        tracks: session.tracks.map(v =>
          v.id === 'v0' ? { ...v, processors: [...(v.processors ?? []), proc2] } : v,
        ),
      };

      const action: AIAction = {
        type: 'replace_processor',
        trackId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'clouds',
        newProcessorId: 'clouds-replace-2',
        description: 'swap first processor',
      };
      const report = executeOperations(s, [action], adapter, makeArbitrator());
      const track = getTrack(report.session, 'v0');

      // First processor replaced, second unchanged
      expect(track.processors).toHaveLength(2);
      expect(track.processors![0].type).toBe('clouds');
      expect(track.processors![1].id).toBe('clouds-test-1');
    });

    it('uses pre-assigned newProcessorId for same-turn composition', () => {
      const session = sessionWithRings();
      const replaceAction: AIAction = {
        type: 'replace_processor',
        trackId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'clouds',
        newProcessorId: 'clouds-composed-1',
        description: 'swap Rings for Clouds',
      };
      // Follow-up action targets the new processor by its pre-assigned ID
      const moveAction: AIAction = {
        type: 'move',
        trackId: 'v0',
        processorId: 'clouds-composed-1',
        param: 'position',
        target: { absolute: 0.8 },
        description: 'move position',
      };
      const report = executeOperations(session, [replaceAction, moveAction], adapter, makeArbitrator());
      expect(report.accepted).toHaveLength(2);

      const track = getTrack(report.session, 'v0');
      expect(track.processors![0].id).toBe('clouds-composed-1');
      expect(track.processors![0].params.position).toBeCloseTo(0.8);
    });

    it('clears processor-targeted modulation routes when replacing a processor', () => {
      const session = sessionWithRingsAndRouting();
      const action: AIAction = {
        type: 'replace_processor',
        trackId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'clouds',
        newProcessorId: 'clouds-replace-3',
        description: 'swap Rings for Clouds',
      };
      const report = executeOperations(session, [action], adapter, makeArbitrator());
      const track = getTrack(report.session, 'v0');

      expect(track.processors?.[0].id).toBe('clouds-replace-3');
      expect(track.modulations ?? []).toHaveLength(0);
    });

    it('clears processor-targeted modulation routes when removing a processor', () => {
      const session = sessionWithRingsAndRouting();
      const action: AIAction = {
        type: 'remove_processor',
        trackId: 'v0',
        processorId: 'rings-test-1',
        description: 'remove Rings',
      };
      const report = executeOperations(session, [action], adapter, makeArbitrator());
      const track = getTrack(report.session, 'v0');

      expect(track.processors ?? []).toHaveLength(0);
      expect(track.modulations ?? []).toHaveLength(0);
    });
  });

  describe('undo', () => {
    it('restores original processor on undo', () => {
      const session = sessionWithRings();
      const action: AIAction = {
        type: 'replace_processor',
        trackId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'clouds',
        newProcessorId: 'clouds-replace-1',
        description: 'swap Rings for Clouds',
      };
      const report = executeOperations(session, [action], adapter, makeArbitrator());
      const undone = applyUndo(report.session);

      const track = getTrack(undone, 'v0');
      expect(track.processors).toHaveLength(1);
      expect(track.processors![0].type).toBe('rings');
      expect(track.processors![0].id).toBe('rings-test-1');
      expect(track.processors![0].params.structure).toBe(0.5);
    });

    it('restores cleared processor-targeted modulation routes on undo', () => {
      const session = sessionWithRingsAndRouting();
      const action: AIAction = {
        type: 'replace_processor',
        trackId: 'v0',
        processorId: 'rings-test-1',
        newModuleType: 'clouds',
        newProcessorId: 'clouds-replace-4',
        description: 'swap Rings for Clouds',
      };
      const report = executeOperations(session, [action], adapter, makeArbitrator());
      const undone = applyUndo(report.session);
      const track = getTrack(undone, 'v0');

      expect(track.processors?.[0].id).toBe('rings-test-1');
      expect(track.modulations ?? []).toHaveLength(1);
      expect((track.modulations ?? [])[0].target).toEqual({
        kind: 'processor',
        processorId: 'rings-test-1',
        param: 'brightness',
      });
    });
  });
});
