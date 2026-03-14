import { describe, it, expect } from 'vitest';
import { executeOperations } from './operation-executor';
import type { Session, AIAction, ActionGroupSnapshot } from './types';
import type { SourceAdapter } from './canonical-types';
import { Arbitrator } from './arbitration';

/**
 * Minimal session factory for operation-executor tests.
 */
function makeSession(overrides?: Partial<Session>): Session {
  return {
    voices: [{
      id: 'v1',
      engine: 'plaits',
      model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON' as const,
      muted: false,
      solo: false,
      pattern: { steps: [], length: 16 },
      regions: [],
      processors: [
        { id: 'fx1', type: 'delay', model: 0, params: { time: 0.5, feedback: 0.3 } },
      ],
      modulators: [],
      modulations: [
        {
          id: 'mod-route-1',
          modulatorId: 'lfo1',
          target: { kind: 'processor' as const, processorId: 'fx1', param: 'time' },
          depth: 0.5,
        },
      ],
      surface: {
        semanticControls: [],
        pinnedControls: [],
        xyAxes: { x: 'timbre', y: 'morph' },
        thumbprint: { type: 'static-color' },
      },
    }],
    activeVoiceId: 'v1',
    transport: { bpm: 120, swing: 0, playing: true },
    undoStack: [],
    context: { key: null, scale: null, tempo: null, energy: 0.5, density: 0.5 },
    messages: [],
    recentHumanActions: [],
    ...overrides,
  };
}

/** Stub adapter — only needs enough surface to pass prevalidation for non-move actions */
const stubAdapter: SourceAdapter = {
  id: 'test',
  name: 'Test Adapter',
  mapControl: () => ({ target: 'source' as const, runtimeParam: 'harmonics' }),
  applyControlChanges: () => {},
  mapEvents: (events) => events,
  readControlState: () => ({}),
  readRegions: () => [],
  mapRuntimeParamKey: () => null,
  getControlSchemas: () => [],
  validateOperation: () => ({ valid: true }),
  midiToNormalisedPitch: (midi: number) => midi / 127,
  normalisedPitchToMidi: (norm: number) => Math.round(norm * 127),
};

describe('executeOperations — undo group collapsing', () => {
  it('flattens nested ActionGroupSnapshots instead of dropping them', () => {
    const session = makeSession();
    const arbitrator = new Arbitrator();

    // Two actions: remove_processor (which cascades modulation-route removal
    // and pushes a nested group) + set_transport (pushes a simple snapshot).
    // Together they trigger the multi-snapshot grouping code path.
    const actions: AIAction[] = [
      { type: 'remove_processor', voiceId: 'v1', processorId: 'fx1', description: 'remove delay' },
      { type: 'set_transport', bpm: 140 },
    ];

    const result = executeOperations(session, actions, stubAdapter, arbitrator);

    // Both actions should be accepted
    expect(result.accepted).toHaveLength(2);

    // The undo stack should have exactly one group entry
    const { undoStack } = result.session;
    expect(undoStack).toHaveLength(1);

    const group = undoStack[0] as ActionGroupSnapshot;
    expect(group.kind).toBe('group');

    // The group should contain 3 flattened snapshots:
    //   1. ProcessorSnapshot (from remove_processor)
    //   2. ModulationRoutingSnapshot (cascaded route removal, was inside the nested group)
    //   3. TransportSnapshot (from set_transport)
    expect(group.snapshots).toHaveLength(3);

    const kinds = group.snapshots.map(s => s.kind);
    expect(kinds).toContain('processor');
    expect(kinds).toContain('modulation-routing');
    expect(kinds).toContain('transport');

    // Crucially: no nested groups remain
    for (const snap of group.snapshots) {
      expect(snap.kind).not.toBe('group');
    }
  });

  it('preserves single non-group snapshot without wrapping', () => {
    // When there's only one snapshot, it should stay as-is (no group wrapper)
    const session = makeSession();
    const arbitrator = new Arbitrator();
    const actions: AIAction[] = [
      { type: 'set_transport', bpm: 100 },
    ];

    const result = executeOperations(session, actions, stubAdapter, arbitrator);
    expect(result.accepted).toHaveLength(1);

    const { undoStack } = result.session;
    expect(undoStack).toHaveLength(1);
    expect(undoStack[0].kind).toBe('transport');
  });
});
