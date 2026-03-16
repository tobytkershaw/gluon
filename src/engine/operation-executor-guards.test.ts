// Tests for defense-in-depth guards in executeOperations (issue #206)
// Separate file because vi.mock is file-scoped and these tests need
// chain-validation and instrument-registry mocked out.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chain-validation to bypass prevalidation for modulator/processor not-found cases
vi.mock('./chain-validation', () => ({
  validateChainMutation: () => ({ valid: true, errors: [] }),
  validateProcessorTarget: () => ({ valid: true, errors: [] }),
  validateModulatorMutation: () => ({ valid: true, errors: [] }),
  validateModulationTarget: () => ({ valid: true, errors: [] }),
  validateModulatorTarget: () => ({ valid: true, errors: [] }),
}));

// Mock instrument-registry to avoid loading real WASM engines
vi.mock('../audio/instrument-registry', () => ({
  getEngineById: () => undefined,
  plaitsInstrument: { id: 'plaits', name: 'Plaits', models: [] },
  getProcessorEngineByName: () => undefined,
  getModulatorEngineByName: () => undefined,
  getRegisteredProcessorTypes: () => [],
  getProcessorControlIds: () => [],
  getRegisteredModulatorTypes: () => [],
  getModulatorControlIds: () => [],
  getModelName: () => 'unknown',
}));

import { executeOperations } from './operation-executor';
import { Arbitrator } from './arbitration';
import type { Session, AIMoveAction } from './types';
import type { SourceAdapter, MusicalEvent, ControlState, Pattern, ControlSchema, ControlBinding } from './canonical-types';

function makeSession(overrides?: Partial<Session>): Session {
  const triggerEvent: MusicalEvent = {
    kind: 'trigger',
    at: 0,
    velocity: 0.8,
  };
  return {
    tracks: [{
      id: 'v1',
      engine: 'plaits',
      model: 0,
      params: { harmonics: 0.5, timbre: 0.5, morph: 0.5, note: 0.5 },
      agency: 'ON',
      muted: false,
      solo: false,
      pattern: { steps: [], length: 16 },
      patterns: [{
        id: 'r1',
        duration: 16,
        events: [triggerEvent],
      }],
      surface: {
        semanticControls: [],
        pinnedControls: [],
        xyAxes: { x: 'timbre', y: 'morph' },
        thumbprint: { type: 'static-color' },
      },
    }],
    activeTrackId: 'v1',
    transport: { status: 'playing', bpm: 120, swing: 0, playing: true },
    undoStack: [],
    context: { key: null, scale: null, tempo: null, energy: 0.5, density: 0.5 },
    messages: [],
    recentHumanActions: [],
    ...overrides,
  };
}

/** Adapter stub that resolves nothing (for testing unresolvable params) */
function makeNullAdapter(): SourceAdapter {
  return {
    id: 'test',
    name: 'Test Adapter',
    mapControl: () => ({ adapterId: 'test', path: 'params.unknown' } as ControlBinding),
    applyControlChanges: () => {},
    mapEvents: () => [],
    readControlState: () => ({} as ControlState),
    readRegions: () => [] as Pattern[],
    mapRuntimeParamKey: () => null,
    getControlSchemas: () => [] as ControlSchema[],
    validateOperation: () => ({ valid: true }),
    midiToNormalisedPitch: (m: number) => m / 127,
    normalisedPitchToMidi: (n: number) => Math.round(n * 127),
  };
}

/** Adapter stub that resolves params normally */
function makeResolvingAdapter(): SourceAdapter {
  return {
    ...makeNullAdapter(),
    mapRuntimeParamKey: (key: string) => {
      const known: Record<string, string> = {
        timbre: 'timbre',
        morph: 'morph',
        harmonics: 'harmonics',
        note: 'frequency',
      };
      return known[key] ?? null;
    },
    validateOperation: () => ({ valid: true }),
  };
}

describe('executeOperations — defense-in-depth guards (#206)', () => {
  let arbitrator: Arbitrator;

  beforeEach(() => {
    arbitrator = new Arbitrator(0); // zero cooldown
  });

  it('rejects move with unresolvable source param instead of crashing', () => {
    const session = makeSession();
    let resolveCount = 0;
    const adapter: SourceAdapter = {
      ...makeResolvingAdapter(),
      mapRuntimeParamKey: (key: string) => {
        resolveCount++;
        // First call (prevalidation's resolveMoveParam): resolve OK
        if (resolveCount === 1) {
          return key === 'flaky' ? 'timbre' : null;
        }
        // Second call (execution's resolveMoveParam): return null to trigger guard
        return null;
      },
    };

    const action: AIMoveAction = {
      type: 'move',
      param: 'flaky',
      target: { absolute: 0.7 },
    };

    const result = executeOperations(session, [action], adapter, arbitrator);

    // Should be rejected, not crash
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0].reason).toContain('unresolvable');
    expect(result.accepted.length).toBe(0);
  });

  it('rejects move targeting non-existent modulator instead of crashing', () => {
    const session = makeSession();
    const adapter = makeResolvingAdapter();

    const action: AIMoveAction = {
      type: 'move',
      modulatorId: 'ghost-mod',
      param: 'rate',
      target: { absolute: 0.5 },
    };

    const result = executeOperations(session, [action], adapter, arbitrator);

    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0].reason).toContain('modulator');
    expect(result.rejected[0].reason).toContain('ghost-mod');
    expect(result.accepted.length).toBe(0);
  });

  it('rejects move targeting non-existent processor instead of crashing', () => {
    const session = makeSession();
    const adapter = makeResolvingAdapter();

    const action: AIMoveAction = {
      type: 'move',
      processorId: 'ghost-proc',
      param: 'mix',
      target: { absolute: 0.3 },
    };

    const result = executeOperations(session, [action], adapter, arbitrator);

    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0].reason).toContain('processor');
    expect(result.rejected[0].reason).toContain('ghost-proc');
    expect(result.accepted.length).toBe(0);
  });

  it('still accepts valid source moves', () => {
    const session = makeSession();
    const adapter = makeResolvingAdapter();

    const action: AIMoveAction = {
      type: 'move',
      param: 'timbre',
      target: { absolute: 0.8 },
    };

    const result = executeOperations(session, [action], adapter, arbitrator);

    expect(result.accepted.length).toBe(1);
    expect(result.rejected.length).toBe(0);
  });
});
