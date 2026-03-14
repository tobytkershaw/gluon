import { describe, it, expect } from 'vitest';
import { executeOperations } from '../../src/engine/operation-executor';
import { createSession, setAgency } from '../../src/engine/session';
import { Arbitrator } from '../../src/engine/arbitration';
import type { SourceAdapter } from '../../src/engine/canonical-types';
import type { AIAction } from '../../src/engine/types';
import { applyUndo } from '../../src/engine/primitives';

function createTestAdapter(): SourceAdapter {
  return {
    id: 'test',
    name: 'Test Adapter',
    mapControl(controlId: string) {
      const map: Record<string, string> = { brightness: 'timbre', richness: 'harmonics', texture: 'morph', pitch: 'note' };
      return { adapterId: 'test', path: `params.${map[controlId] ?? controlId}` };
    },
    mapRuntimeParamKey(paramKey: string) {
      const map: Record<string, string> = { timbre: 'brightness', harmonics: 'richness', morph: 'texture', note: 'pitch' };
      return map[paramKey] ?? null;
    },
    applyControlChanges() {},
    mapEvents() { return []; },
    readControlState() { return {}; },
    readRegions() { return []; },
    getControlSchemas() { return []; },
    validateOperation() { return { valid: true }; },
    midiToNormalisedPitch(midi: number) { return midi / 127; },
    normalisedPitchToMidi(n: number) { return Math.round(n * 127); },
  };
}

describe('operation-executor', () => {
  const adapter = createTestAdapter();

  function setupSession() {
    let session = createSession();
    session = setAgency(session, 'v0', 'ON');
    return session;
  }

  it('rejects move on agency-OFF track', () => {
    let session = createSession();
    session = setAgency(session, 'v0', 'OFF');
    const actions: AIAction[] = [{ type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.8 } }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('agency OFF');
    expect(report.accepted).toHaveLength(0);
  });

  it('applies move on agency-ON track', () => {
    const session = setupSession();
    const actions: AIAction[] = [{ type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.8 } }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    expect(report.accepted).toHaveLength(1);
    expect(report.rejected).toHaveLength(0);
    const track = report.session.tracks.find(v => v.id === 'v0')!;
    expect(track.params.timbre).toBeCloseTo(0.8);
  });

  it('rejects move when arbitration holds param', () => {
    const session = setupSession();
    const arb = new Arbitrator(10000);
    arb.humanTouched('v0', 'timbre', 0.5);
    const actions: AIAction[] = [{ type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.8 } }];
    const report = executeOperations(session, actions, adapter, arb);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('Arbitration');
  });

  it('sets provenance to ai after move', () => {
    const session = setupSession();
    const actions: AIAction[] = [{ type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.8 } }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    const track = report.session.tracks.find(v => v.id === 'v0')!;
    expect(track.controlProvenance?.brightness?.source).toBe('ai');
  });

  it('rejects unknown track', () => {
    const session = setupSession();
    const actions: AIAction[] = [{ type: 'move', trackId: 'v99', param: 'timbre', target: { absolute: 0.8 } }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('not found');
  });

  it('groups multiple snapshots into single undo entry', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.8 } },
      { type: 'move', trackId: 'v0', param: 'morph', target: { absolute: 0.3 } },
    ];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    const newEntries = report.session.undoStack.length - session.undoStack.length;
    expect(newEntries).toBe(1);
    expect(report.session.undoStack[report.session.undoStack.length - 1].kind).toBe('group');
  });

  it('undo restores param values AND provenance', () => {
    const session = setupSession();
    const actions: AIAction[] = [{ type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.8 } }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());

    const afterMove = report.session;
    const trackAfter = afterMove.tracks.find(v => v.id === 'v0')!;
    expect(trackAfter.params.timbre).toBeCloseTo(0.8);
    expect(trackAfter.controlProvenance?.brightness?.source).toBe('ai');

    const afterUndo = applyUndo(afterMove);
    const trackUndo = afterUndo.tracks.find(v => v.id === 'v0')!;
    expect(trackUndo.params.timbre).toBeCloseTo(0.5);
    expect(trackUndo.controlProvenance?.brightness?.source).toBe('default');
  });

  it('produces execution report with log entries', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.8 } },
      { type: 'say', text: 'darkened the bass' },
    ];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    expect(report.accepted).toHaveLength(2);
    expect(report.log).toHaveLength(1);
    expect(report.log[0].trackId).toBe('v0');
  });

  it('applies sketch on agency-ON track', () => {
    const session = setupSession();
    const actions: AIAction[] = [{
      type: 'sketch',
      trackId: 'v0',
      description: 'four on the floor',
      pattern: { steps: [{ index: 0, gate: true }, { index: 4, gate: true }] },
    }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    expect(report.accepted).toHaveLength(1);
    const track = report.session.tracks.find(v => v.id === 'v0')!;
    expect(track.pattern.steps[0].gate).toBe(true);
    expect(track.pattern.steps[4].gate).toBe(true);
  });

  it('mixes accepted and rejected in same batch', () => {
    let session = createSession();
    session = setAgency(session, 'v1', 'OFF');
    const actions: AIAction[] = [
      { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.8 } },
      { type: 'move', trackId: 'v1', param: 'timbre', target: { absolute: 0.8 } },
    ];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    expect(report.accepted).toHaveLength(1);
    expect(report.rejected).toHaveLength(1);
    expect(report.session.tracks.find(v => v.id === 'v0')!.params.timbre).toBeCloseTo(0.8);
    expect(report.session.tracks.find(v => v.id === 'v1')!.params.timbre).toBeCloseTo(0.5);
  });

  it('adds chat message with say text and action log', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.8 } },
      { type: 'say', text: 'done' },
    ];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    const lastMsg = report.session.messages[report.session.messages.length - 1];
    expect(lastMsg.role).toBe('ai');
    expect(lastMsg.text).toBe('done');
    expect(lastMsg.actions).toHaveLength(1);
  });

  it('handles relative move targets', () => {
    const session = setupSession();
    const actions: AIAction[] = [{ type: 'move', trackId: 'v0', param: 'timbre', target: { relative: 0.2 } }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    const track = report.session.tracks.find(v => v.id === 'v0')!;
    expect(track.params.timbre).toBeCloseTo(0.7);
  });

  it('clamps move targets to [0, 1]', () => {
    const session = setupSession();
    const actions: AIAction[] = [{ type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 1.5 } }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    const track = report.session.tracks.find(v => v.id === 'v0')!;
    expect(track.params.timbre).toBe(1);
  });

  it('resolves controlId to runtime param', () => {
    const session = setupSession();
    const actions: AIAction[] = [{ type: 'move', trackId: 'v0', param: 'brightness', target: { absolute: 0.8 } }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    expect(report.accepted).toHaveLength(1);
    const track = report.session.tracks.find(v => v.id === 'v0')!;
    expect(track.params.timbre).toBeCloseTo(0.8);
    expect(track.controlProvenance?.brightness?.source).toBe('ai');
  });

  it('handles drift move (records snapshot without applying param)', () => {
    const session = setupSession();
    const actions: AIAction[] = [{ type: 'move', trackId: 'v0', param: 'timbre', target: { absolute: 0.8 }, over: 1000 }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    expect(report.accepted).toHaveLength(1);
    expect(report.session.undoStack.length).toBe(1);
    expect(report.session.undoStack[0].kind).toBe('param');
    const track = report.session.tracks.find(v => v.id === 'v0')!;
    expect(track.controlProvenance?.brightness?.source).toBe('ai');
  });

  it('rejects unknown control IDs that are not declared by the adapter', () => {
    const session = setupSession();
    const actions: AIAction[] = [{ type: 'move', trackId: 'v0', param: 'foo', target: { absolute: 0.5 } }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('Unknown control');
    expect(report.accepted).toHaveLength(0);
    // Ensure no arbitrary param was written
    const track = report.session.tracks.find(v => v.id === 'v0')!;
    expect((track.params as Record<string, unknown>)['foo']).toBeUndefined();
  });

  it('applies canonical sketch with events', () => {
    const session = setupSession();
    const actions: AIAction[] = [{
      type: 'sketch',
      trackId: 'v0',
      description: 'test events',
      events: [
        { kind: 'trigger', at: 0, velocity: 1.0, accent: true },
        { kind: 'trigger', at: 4, velocity: 0.8 },
      ],
    }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    expect(report.accepted).toHaveLength(1);
    const track = report.session.tracks.find(v => v.id === 'v0')!;
    expect(track.pattern.steps[0].gate).toBe(true);
    expect(track.pattern.steps[0].accent).toBe(true);
    expect(track.pattern.steps[4].gate).toBe(true);
  });

  it('preserves param-only events on silent steps in canonical sketch', () => {
    const session = setupSession();
    const actions: AIAction[] = [{
      type: 'sketch',
      trackId: 'v0',
      description: 'automation on silent step',
      events: [
        { kind: 'trigger', at: 0, velocity: 1.0, accent: false },
        { kind: 'parameter', at: 2, controlId: 'brightness', value: 0.9 },
      ],
    }];
    const report = executeOperations(session, actions, adapter, new Arbitrator());
    expect(report.accepted).toHaveLength(1);
    const track = report.session.tracks.find(v => v.id === 'v0')!;
    expect(track.pattern.steps[0].gate).toBe(true);
    // Step 2 is silent but should have the param lock
    expect(track.pattern.steps[2].gate).toBe(false);
    expect((track.pattern.steps[2].params as Record<string, unknown>)?.['timbre']).toBe(0.9);
  });

  describe('transform actions', () => {
    function setupWithEvents() {
      let session = createSession();
      session = setAgency(session, 'v0', 'ON');
      // Write trigger events to v0's region
      const track = session.tracks.find(v => v.id === 'v0')!;
      const region = { ...track.regions[0], events: [
        { kind: 'trigger' as const, at: 0, velocity: 1.0 },
        { kind: 'trigger' as const, at: 4, velocity: 0.8 },
        { kind: 'trigger' as const, at: 8, velocity: 0.6 },
      ]};
      session = {
        ...session,
        tracks: session.tracks.map(v => v.id === 'v0' ? { ...v, regions: [region] } : v),
      };
      return session;
    }

    it('rotate flows through executor with correct events', () => {
      const session = setupWithEvents();
      const actions: AIAction[] = [{
        type: 'transform',
        trackId: 'v0',
        operation: 'rotate',
        steps: 2,
        description: 'shift pattern forward',
      }];
      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);
      const track = report.session.tracks.find(v => v.id === 'v0')!;
      const ats = track.regions[0].events.map(e => e.at);
      expect(ats).toEqual([2, 6, 10]);
    });

    it('reverse flows through executor with correct events', () => {
      const session = setupWithEvents();
      const actions: AIAction[] = [{
        type: 'transform',
        trackId: 'v0',
        operation: 'reverse',
        description: 'reverse the pattern',
      }];
      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);
      const track = report.session.tracks.find(v => v.id === 'v0')!;
      const ats = track.regions[0].events.map(e => e.at);
      // 0 → 0 (wraps), 4 → 12, 8 → 8
      expect(ats).toEqual([0, 8, 12]);
    });

    it('transform on agency-OFF track is rejected', () => {
      let session = createSession();
      session = setAgency(session, 'v0', 'OFF');
      const actions: AIAction[] = [{
        type: 'transform',
        trackId: 'v0',
        operation: 'reverse',
        description: 'should fail',
      }];
      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('agency OFF');
      expect(report.accepted).toHaveLength(0);
    });

    it('undo reverts transform cleanly', () => {
      const session = setupWithEvents();
      const originalAts = session.tracks.find(v => v.id === 'v0')!.regions[0].events.map(e => e.at);

      const actions: AIAction[] = [{
        type: 'transform',
        trackId: 'v0',
        operation: 'rotate',
        steps: 3,
        description: 'shift then undo',
      }];
      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);

      const afterUndo = applyUndo(report.session);
      const restoredAts = afterUndo.tracks.find(v => v.id === 'v0')!.regions[0].events.map(e => e.at);
      expect(restoredAts).toEqual(originalAts);
    });

    it('duplicate doubles events and duration', () => {
      const session = setupWithEvents();
      const origDuration = session.tracks.find(v => v.id === 'v0')!.regions[0].duration;

      const actions: AIAction[] = [{
        type: 'transform',
        trackId: 'v0',
        operation: 'duplicate',
        description: 'double the pattern',
      }];
      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);
      const track = report.session.tracks.find(v => v.id === 'v0')!;
      expect(track.regions[0].events.length).toBe(6);
      expect(track.regions[0].duration).toBe(origDuration * 2);
    });
  });
});
