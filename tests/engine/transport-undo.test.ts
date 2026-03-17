// tests/engine/transport-undo.test.ts
import { describe, it, expect, vi } from 'vitest';
import { executeOperations } from '../../src/engine/operation-executor';
import { applyUndo } from '../../src/engine/primitives';
import { createSession } from '../../src/engine/session';
import { createPlaitsAdapter } from '../../src/audio/plaits-adapter';
import { Arbitrator } from '../../src/engine/arbitration';
import type { AIAction } from '../../src/engine/types';

const adapter = createPlaitsAdapter();

function makeArbitrator() {
  const arb = new Arbitrator();
  // Allow all AI actions
  vi.spyOn(arb, 'canAIAct').mockReturnValue(true);
  return arb;
}

describe('Transport Undo', () => {
  it('creates TransportSnapshot with prevTransport', () => {
    const session = createSession();
    const actions: AIAction[] = [{ type: 'set_transport', bpm: 140 }];
    const report = executeOperations(session, actions, adapter, makeArbitrator());

    expect(report.accepted).toHaveLength(1);
    expect(report.session.transport.bpm).toBe(140);
    expect(report.session.undoStack).toHaveLength(1);

    const snapshot = report.session.undoStack[0];
    expect(snapshot.kind).toBe('transport');
    if (snapshot.kind === 'transport') {
      expect(snapshot.prevTransport.bpm).toBe(session.transport.bpm);
    }
  });

  it('undo reverts to previous transport state', () => {
    const session = createSession();
    const originalBpm = session.transport.bpm;

    const actions: AIAction[] = [{ type: 'set_transport', bpm: 180 }];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.session.transport.bpm).toBe(180);

    const undone = applyUndo(report.session);
    expect(undone.transport.bpm).toBe(originalBpm);
  });

  it('clamps BPM to 20-300 range', () => {
    const session = createSession();

    const tooLow: AIAction[] = [{ type: 'set_transport', bpm: 10 }];
    const reportLow = executeOperations(session, tooLow, adapter, makeArbitrator());
    expect(reportLow.session.transport.bpm).toBe(20);

    const tooHigh: AIAction[] = [{ type: 'set_transport', bpm: 400 }];
    const reportHigh = executeOperations(session, tooHigh, adapter, makeArbitrator());
    expect(reportHigh.session.transport.bpm).toBe(300);
  });

  it('clamps swing to 0-1 range', () => {
    const session = createSession();

    const actions: AIAction[] = [{ type: 'set_transport', swing: 1.5 }];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.session.transport.swing).toBe(1);
  });

  it('handles bpm changes and undo', () => {
    const session = createSession();
    expect(session.transport.bpm).toBe(120);

    const actions: AIAction[] = [{ type: 'set_transport', bpm: 140 }];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.session.transport.bpm).toBe(140);

    const undone = applyUndo(report.session);
    expect(undone.transport.bpm).toBe(120);
  });

  it('transport grouped with other actions in ActionGroupSnapshot', () => {
    const session = createSession();
    // Ensure v0 has agency ON for the move
    const sessionWithAgency = {
      ...session,
      tracks: session.tracks.map(v => v.id === 'v0' ? { ...v, agency: 'ON' as const } : v),
    };

    const actions: AIAction[] = [
      { type: 'set_transport', bpm: 140 },
      { type: 'move', param: 'timbre', target: { absolute: 0.8 }, trackId: 'v0' },
    ];
    const report = executeOperations(sessionWithAgency, actions, adapter, makeArbitrator());

    expect(report.accepted).toHaveLength(2);
    // Multiple snapshots collapsed into a group
    expect(report.session.undoStack).toHaveLength(1);
    expect(report.session.undoStack[0].kind).toBe('group');
  });

  it('logs with trackLabel TRANSPORT', () => {
    const session = createSession();
    const actions: AIAction[] = [{ type: 'set_transport', bpm: 100 }];
    const report = executeOperations(session, actions, adapter, makeArbitrator());

    expect(report.log).toHaveLength(1);
    expect(report.log[0].trackLabel).toBe('TRANSPORT');
    expect(report.log[0].description).toContain('bpm');
  });

  it('handles multiple transport fields at once', () => {
    const session = createSession();
    const actions: AIAction[] = [{
      type: 'set_transport', bpm: 140, swing: 0.6,
    }];
    const report = executeOperations(session, actions, adapter, makeArbitrator());

    expect(report.session.transport.bpm).toBe(140);
    expect(report.session.transport.swing).toBe(0.6);
  });
});
