import { describe, it, expect } from 'vitest';
import { executeOperations, generatePreservationReport } from '../../src/engine/operation-executor';
import { createSession, setApproval } from '../../src/engine/session';
import { Arbitrator } from '../../src/engine/arbitration';
import type { SourceAdapter, MusicalEvent } from '../../src/engine/canonical-types';
import type { AIAction, PreservationReport } from '../../src/engine/types';

function createTestAdapter(): SourceAdapter {
  return {
    id: 'test',
    name: 'Test Adapter',
    mapControl(controlId: string) {
      const map: Record<string, string> = { frequency: 'note' };
      return { adapterId: 'test', path: `params.${map[controlId] ?? controlId}` };
    },
    mapRuntimeParamKey(paramKey: string) {
      const map: Record<string, string> = { note: 'frequency' };
      return map[paramKey] ?? paramKey;
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

describe('PreservationReport generation', () => {
  const adapter = createTestAdapter();

  function setupSessionWithEvents(approval: 'exploratory' | 'liked' | 'approved' | 'anchor', events: MusicalEvent[]) {
    let session = createSession();
    if (approval !== 'exploratory') {
      session = setApproval(session, 'v0', approval);
    }
    // Write events to v0's region
    const track = session.tracks.find(v => v.id === 'v0')!;
    const region = { ...track.patterns[0], events: [...events] };
    session = {
      ...session,
      tracks: session.tracks.map(v => v.id === 'v0' ? { ...v, patterns: [region] } : v),
    };
    return session;
  }

  describe('generatePreservationReport (unit)', () => {
    it('reports rhythm preserved when positions match', () => {
      const oldEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
        { kind: 'trigger', at: 4, velocity: 0.8 },
        { kind: 'trigger', at: 8, velocity: 0.6 },
      ];
      // Same rhythm, different velocities
      const newEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.9 },
        { kind: 'trigger', at: 4, velocity: 0.5 },
        { kind: 'trigger', at: 8, velocity: 1.0 },
      ];

      const report = generatePreservationReport('v0', 'approved', oldEvents, newEvents);
      expect(report.preserved.rhythmPositions).toBe(true);
      expect(report.preserved.eventCount).toBe(true);
      expect(report.changed).toContain('3 velocity values modified');
    });

    it('reports rhythm NOT preserved when positions differ', () => {
      const oldEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
        { kind: 'trigger', at: 4, velocity: 0.8 },
      ];
      const newEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
        { kind: 'trigger', at: 6, velocity: 0.8 },
      ];

      const report = generatePreservationReport('v0', 'approved', oldEvents, newEvents);
      expect(report.preserved.rhythmPositions).toBe(false);
      expect(report.changed.some(c => c.includes('rhythm'))).toBe(true);
    });

    it('reports event count change when events added', () => {
      const oldEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
      ];
      const newEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
        { kind: 'trigger', at: 4, velocity: 0.8 },
        { kind: 'trigger', at: 8, velocity: 0.6 },
      ];

      const report = generatePreservationReport('v0', 'liked', oldEvents, newEvents);
      expect(report.preserved.eventCount).toBe(false);
      expect(report.changed.some(c => c.includes('added'))).toBe(true);
    });

    it('reports pitch contour preserved when relative intervals match', () => {
      const oldEvents: MusicalEvent[] = [
        { kind: 'note', at: 0, pitch: 60, velocity: 1.0, duration: 1 },
        { kind: 'note', at: 1, pitch: 64, velocity: 1.0, duration: 1 },
        { kind: 'note', at: 2, pitch: 62, velocity: 1.0, duration: 1 },
      ];
      // Transposed up but same contour (up, down)
      const newEvents: MusicalEvent[] = [
        { kind: 'note', at: 0, pitch: 72, velocity: 1.0, duration: 1 },
        { kind: 'note', at: 1, pitch: 76, velocity: 1.0, duration: 1 },
        { kind: 'note', at: 2, pitch: 74, velocity: 1.0, duration: 1 },
      ];

      const report = generatePreservationReport('v0', 'approved', oldEvents, newEvents);
      expect(report.preserved.pitchContour).toBe(true);
    });

    it('reports pitch contour NOT preserved when intervals change direction', () => {
      const oldEvents: MusicalEvent[] = [
        { kind: 'note', at: 0, pitch: 60, velocity: 1.0, duration: 1 },
        { kind: 'note', at: 1, pitch: 64, velocity: 1.0, duration: 1 },
        { kind: 'note', at: 2, pitch: 62, velocity: 1.0, duration: 1 },
      ];
      // Different contour: up, up (was up, down)
      const newEvents: MusicalEvent[] = [
        { kind: 'note', at: 0, pitch: 60, velocity: 1.0, duration: 1 },
        { kind: 'note', at: 1, pitch: 64, velocity: 1.0, duration: 1 },
        { kind: 'note', at: 2, pitch: 67, velocity: 1.0, duration: 1 },
      ];

      const report = generatePreservationReport('v0', 'approved', oldEvents, newEvents);
      expect(report.preserved.pitchContour).toBe(false);
      expect(report.changed).toContain('pitch contour modified');
    });

    it('includes approval level in report', () => {
      const report = generatePreservationReport('v0', 'anchor', [], []);
      expect(report.approvalLevel).toBe('anchor');
      expect(report.trackId).toBe('v0');
    });

    it('handles parameter event changes', () => {
      const oldEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
        { kind: 'parameter', at: 0, controlId: 'timbre', value: 0.5 },
      ];
      const newEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
        { kind: 'parameter', at: 0, controlId: 'timbre', value: 0.5 },
        { kind: 'parameter', at: 4, controlId: 'timbre', value: 0.8 },
      ];

      const report = generatePreservationReport('v0', 'liked', oldEvents, newEvents);
      expect(report.changed.some(c => c.includes('parameter event'))).toBe(true);
    });
  });

  describe('executeOperations integration', () => {
    it('generates report for sketch on approved track', () => {
      const oldEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
        { kind: 'trigger', at: 4, velocity: 0.8 },
      ];
      const session = setupSessionWithEvents('approved', oldEvents);

      const newEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.9 },
        { kind: 'trigger', at: 4, velocity: 0.5 },
      ];
      const actions: AIAction[] = [{
        type: 'sketch',
        trackId: 'v0',
        description: 'adjust velocities',
        events: newEvents,
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);
      expect(report.preservationReports).toHaveLength(1);

      const pr = report.preservationReports[0];
      expect(pr.trackId).toBe('v0');
      expect(pr.approvalLevel).toBe('approved');
      expect(pr.preserved.rhythmPositions).toBe(true);
      expect(pr.preserved.eventCount).toBe(true);
      expect(pr.changed.some(c => c.includes('velocity'))).toBe(true);
    });

    it('generates report for sketch on liked track', () => {
      const oldEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
      ];
      const session = setupSessionWithEvents('liked', oldEvents);

      const newEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
        { kind: 'trigger', at: 8, velocity: 0.8 },
      ];
      const actions: AIAction[] = [{
        type: 'sketch',
        trackId: 'v0',
        description: 'add a beat',
        events: newEvents,
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.preservationReports).toHaveLength(1);
      expect(report.preservationReports[0].approvalLevel).toBe('liked');
    });

    it('rejects sketch on anchor track (preservation enforcement)', () => {
      const oldEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
      ];
      const session = setupSessionWithEvents('anchor', oldEvents);

      const newEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.9 },
      ];
      const actions: AIAction[] = [{
        type: 'sketch',
        trackId: 'v0',
        description: 'soften',
        events: newEvents,
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      // Anchor tracks block all event mutations — sketch is rejected, no preservation report
      expect(report.accepted).toHaveLength(0);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('anchored');
      expect(report.preservationReports).toHaveLength(0);
    });

    it('does NOT generate report for sketch on exploratory track', () => {
      const oldEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
      ];
      const session = setupSessionWithEvents('exploratory', oldEvents);

      const newEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.5 },
        { kind: 'trigger', at: 8, velocity: 1.0 },
      ];
      const actions: AIAction[] = [{
        type: 'sketch',
        trackId: 'v0',
        description: 'change everything',
        events: newEvents,
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      expect(report.accepted).toHaveLength(1);
      expect(report.preservationReports).toHaveLength(0);
    });

    it('report correctly detects rhythm preservation', () => {
      const oldEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
        { kind: 'trigger', at: 4, velocity: 0.8 },
        { kind: 'trigger', at: 8, velocity: 0.6 },
      ];
      const session = setupSessionWithEvents('approved', oldEvents);

      // Same rhythm positions, different velocities — accepted on approved tracks
      const preservedEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 0.9 },
        { kind: 'trigger', at: 4, velocity: 0.7 },
        { kind: 'trigger', at: 8, velocity: 1.0 },
      ];
      const actions1: AIAction[] = [{
        type: 'sketch',
        trackId: 'v0',
        description: 'velocity only',
        events: preservedEvents,
      }];
      const report1 = executeOperations(session, actions1, adapter, new Arbitrator());
      expect(report1.preservationReports[0].preserved.rhythmPositions).toBe(true);

      // Changed rhythm positions — rejected on approved tracks (preservation enforcement)
      const changedEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
        { kind: 'trigger', at: 2, velocity: 0.8 },
        { kind: 'trigger', at: 8, velocity: 0.6 },
      ];
      const actions2: AIAction[] = [{
        type: 'sketch',
        trackId: 'v0',
        description: 'shift beat',
        events: changedEvents,
      }];
      const report2 = executeOperations(session, actions2, adapter, new Arbitrator());
      expect(report2.accepted).toHaveLength(0);
      expect(report2.rejected).toHaveLength(1);
      expect(report2.rejected[0].reason).toContain('rhythm positions');
      expect(report2.preservationReports).toHaveLength(0);
    });

    it('rejects legacy sketch on approved track (preservation enforcement)', () => {
      const oldEvents: MusicalEvent[] = [
        { kind: 'trigger', at: 0, velocity: 1.0 },
      ];
      const session = setupSessionWithEvents('approved', oldEvents);

      const actions: AIAction[] = [{
        type: 'sketch',
        trackId: 'v0',
        description: 'legacy pattern',
        stepGrid: { steps: [{ index: 0, gate: true }] },
      }];

      const report = executeOperations(session, actions, adapter, new Arbitrator());
      // Legacy pattern sketches are blocked on approved tracks — rejected, no preservation report
      expect(report.accepted).toHaveLength(0);
      expect(report.rejected).toHaveLength(1);
      expect(report.rejected[0].reason).toContain('legacy pattern sketches are blocked');
      expect(report.preservationReports).toHaveLength(0);
    });
  });
});

describe('compressState with preservation reports', () => {
  it('includes preservation reports in compressed state when provided', async () => {
    const { compressState } = await import('../../src/ai/state-compression');
    const { createSession } = await import('../../src/engine/session');

    const session = createSession();
    const reports: PreservationReport[] = [{
      trackId: 'v0',
      preserved: { rhythmPositions: true, eventCount: true, pitchContour: false },
      changed: ['pitch contour modified', '2 velocity values modified'],
      approvalLevel: 'approved',
    }];

    const compressed = compressState(session, reports);
    expect(compressed.recent_preservation).toBeDefined();
    expect(compressed.recent_preservation).toHaveLength(1);
    expect(compressed.recent_preservation![0].trackId).toBe('v0');
    expect(compressed.recent_preservation![0].approval).toBe('approved');
    expect(compressed.recent_preservation![0].preserved).toEqual(['rhythm', 'event_count']);
    expect(compressed.recent_preservation![0].changed).toEqual(['pitch contour modified', '2 velocity values modified']);
  });

  it('omits preservation field when no reports provided', async () => {
    const { compressState } = await import('../../src/ai/state-compression');
    const { createSession } = await import('../../src/engine/session');

    const session = createSession();
    const compressed = compressState(session);
    expect(compressed.recent_preservation).toBeUndefined();
  });

  it('omits preservation field when empty array provided', async () => {
    const { compressState } = await import('../../src/ai/state-compression');
    const { createSession } = await import('../../src/engine/session');

    const session = createSession();
    const compressed = compressState(session, []);
    expect(compressed.recent_preservation).toBeUndefined();
  });
});
