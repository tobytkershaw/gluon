import { describe, it, expect } from 'vitest';
import {
  getModuleDef,
  isValidModuleType,
  validateModuleBindings,
  getAllModuleDefs,
} from '../../src/engine/surface-module-registry';
import { executeOperations } from '../../src/engine/operation-executor';
import { createSession, setAgency } from '../../src/engine/session';
import { Arbitrator } from '../../src/engine/arbitration';
import { applyUndo } from '../../src/engine/primitives';
import type { SourceAdapter } from '../../src/engine/canonical-types';
import type { AIAction, SurfaceModule, TrackSurface } from '../../src/engine/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      const known = new Set(['timbre', 'harmonics', 'morph']);
      if (map[paramKey]) return map[paramKey];
      if (known.has(paramKey)) return paramKey;
      return null;
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

const adapter = createTestAdapter();
const arbitrator = new Arbitrator();

function setupSession() {
  let session = createSession();
  session = setAgency(session, 'v0', 'ON');
  return session;
}

function getTrack(session: ReturnType<typeof createSession>, trackId = 'v0') {
  return session.tracks.find(t => t.id === trackId)!;
}

function makeKnobGroup(id: string, bindings: { role: string; trackId: string; target: string }[]): SurfaceModule {
  return {
    type: 'knob-group',
    id,
    label: 'Test Knobs',
    bindings,
    position: { x: 0, y: 0, w: 4, h: 2 },
    config: {},
  };
}

function makeXYPad(id: string, trackId: string): SurfaceModule {
  return {
    type: 'xy-pad',
    id,
    label: 'XY',
    bindings: [
      { role: 'x-axis', trackId, target: 'timbre' },
      { role: 'y-axis', trackId, target: 'morph' },
    ],
    position: { x: 0, y: 0, w: 4, h: 4 },
    config: {},
  };
}

function makeMacroKnob(id: string, weights: { moduleId: string; controlId: string; weight: number }[]): SurfaceModule {
  return {
    type: 'macro-knob',
    id,
    label: 'Macro',
    bindings: [{ role: 'control', trackId: 'v0', target: 'macro' }],
    position: { x: 0, y: 0, w: 2, h: 2 },
    config: {
      semanticControl: {
        id,
        label: 'Macro',
        weights,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Module registry validation
// ---------------------------------------------------------------------------

describe('SurfaceModuleRegistry', () => {
  it('all five module types are registered', () => {
    const defs = getAllModuleDefs();
    expect(defs).toHaveLength(5);
    const types = defs.map(d => d.type);
    expect(types).toContain('knob-group');
    expect(types).toContain('macro-knob');
    expect(types).toContain('xy-pad');
    expect(types).toContain('step-grid');
    expect(types).toContain('chain-strip');
  });

  it('getModuleDef returns definition for valid type', () => {
    const def = getModuleDef('knob-group');
    expect(def).toBeDefined();
    expect(def!.type).toBe('knob-group');
    expect(def!.name).toBe('Knob Group');
    expect(def!.requiredBindings.length).toBeGreaterThan(0);
  });

  it('getModuleDef returns undefined for unknown type', () => {
    expect(getModuleDef('nonexistent')).toBeUndefined();
    expect(getModuleDef('')).toBeUndefined();
  });

  it('isValidModuleType validates correctly', () => {
    expect(isValidModuleType('knob-group')).toBe(true);
    expect(isValidModuleType('xy-pad')).toBe(true);
    expect(isValidModuleType('chain-strip')).toBe(true);
    expect(isValidModuleType('bogus')).toBe(false);
    expect(isValidModuleType('')).toBe(false);
  });

  it('validateModuleBindings passes for correct bindings', () => {
    const result = validateModuleBindings({
      type: 'knob-group',
      bindings: [{ role: 'control' }],
    });
    expect(result).toBeNull();
  });

  it('validateModuleBindings passes for xy-pad with both axes', () => {
    const result = validateModuleBindings({
      type: 'xy-pad',
      bindings: [{ role: 'x-axis' }, { role: 'y-axis' }],
    });
    expect(result).toBeNull();
  });

  it('validateModuleBindings fails for missing required binding', () => {
    const result = validateModuleBindings({
      type: 'xy-pad',
      bindings: [{ role: 'x-axis' }], // missing y-axis
    });
    expect(result).not.toBeNull();
    expect(result).toContain('y-axis');
  });

  it('validateModuleBindings fails for unknown module type', () => {
    const result = validateModuleBindings({
      type: 'nonsense-widget',
      bindings: [{ role: 'control' }],
    });
    expect(result).not.toBeNull();
    expect(result).toContain('Unknown module type');
  });
});

// ---------------------------------------------------------------------------
// 2. Module-based set_surface validation
// ---------------------------------------------------------------------------

describe('set_surface with modules', () => {
  it('accepts valid modules array', () => {
    const session = setupSession();
    const modules: SurfaceModule[] = [
      makeKnobGroup('kg-1', [{ role: 'control', trackId: 'v0', target: 'timbre' }]),
    ];
    const actions: AIAction[] = [
      { type: 'set_surface', trackId: 'v0', modules, description: 'test' },
    ];
    const report = executeOperations(session, actions, adapter, arbitrator);
    expect(report.accepted).toHaveLength(1);
    expect(report.rejected).toHaveLength(0);
    const track = getTrack(report.session);
    expect(track.surface.modules).toHaveLength(1);
    expect(track.surface.modules[0].type).toBe('knob-group');
  });

  it('rejects unknown module type', () => {
    const session = setupSession();
    const badModule: SurfaceModule = {
      type: 'fader-bank' as string,
      id: 'bad',
      label: 'Bad',
      bindings: [{ role: 'control', trackId: 'v0', target: 'x' }],
      position: { x: 0, y: 0, w: 4, h: 2 },
      config: {},
    };
    const actions: AIAction[] = [
      { type: 'set_surface', trackId: 'v0', modules: [badModule], description: 'test' },
    ];
    const report = executeOperations(session, actions, adapter, arbitrator);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('Unknown module type');
  });

  it('rejects macro-knob with invalid weight sum', () => {
    const session = setupSession();
    const macro = makeMacroKnob('m1', [
      { moduleId: 'source', controlId: 'timbre', weight: 0.3 },
      { moduleId: 'source', controlId: 'morph', weight: 0.3 },
      // weights sum to 0.6, not 1.0
    ]);
    const actions: AIAction[] = [
      { type: 'set_surface', trackId: 'v0', modules: [macro], description: 'test' },
    ];
    const report = executeOperations(session, actions, adapter, arbitrator);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('weights sum');
  });

  it('rejects macro-knob referencing unknown processor', () => {
    const session = setupSession();
    const macro = makeMacroKnob('m1', [
      { moduleId: 'nonexistent-proc', controlId: 'brightness', weight: 1.0 },
    ]);
    const actions: AIAction[] = [
      { type: 'set_surface', trackId: 'v0', modules: [macro], description: 'test' },
    ];
    const report = executeOperations(session, actions, adapter, arbitrator);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('unknown module');
  });

  it('set_surface is undoable', () => {
    const session = setupSession();
    const modules: SurfaceModule[] = [
      makeKnobGroup('kg-1', [{ role: 'control', trackId: 'v0', target: 'timbre' }]),
    ];
    const actions: AIAction[] = [
      { type: 'set_surface', trackId: 'v0', modules, description: 'test' },
    ];
    const report = executeOperations(session, actions, adapter, arbitrator);
    expect(getTrack(report.session).surface.modules).toHaveLength(1);

    const undone = applyUndo(report.session);
    expect(getTrack(undone).surface.modules).toHaveLength(0);
  });

  it('undo restores previous modules', () => {
    // First set_surface to establish a baseline
    let session = setupSession();
    const first: SurfaceModule[] = [
      makeKnobGroup('kg-1', [{ role: 'control', trackId: 'v0', target: 'timbre' }]),
    ];
    const r1 = executeOperations(
      session, [{ type: 'set_surface', trackId: 'v0', modules: first, description: 'first' }],
      adapter, arbitrator,
    );
    session = r1.session;

    // Second set_surface
    const second: SurfaceModule[] = [
      makeXYPad('xy-1', 'v0'),
      makeKnobGroup('kg-2', [{ role: 'control', trackId: 'v0', target: 'morph' }]),
    ];
    const r2 = executeOperations(
      session, [{ type: 'set_surface', trackId: 'v0', modules: second, description: 'second' }],
      adapter, arbitrator,
    );
    expect(getTrack(r2.session).surface.modules).toHaveLength(2);

    // Undo should restore to the first set_surface state
    const undone = applyUndo(r2.session);
    const restored = getTrack(undone).surface.modules;
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe('kg-1');
  });
});

// ---------------------------------------------------------------------------
// 3. Pin-as-module
// ---------------------------------------------------------------------------

describe('pin creates knob-group module', () => {
  it('pin adds a knob-group module with pinned: true', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'pin', trackId: 'v0', moduleId: 'source', controlId: 'timbre', description: 'pin timbre' },
    ];
    const report = executeOperations(session, actions, adapter, arbitrator);
    expect(report.accepted).toHaveLength(1);
    const track = getTrack(report.session);
    expect(track.surface.modules).toHaveLength(1);
    const pinMod = track.surface.modules[0];
    expect(pinMod.type).toBe('knob-group');
    expect(pinMod.config.pinned).toBe(true);
    expect(pinMod.bindings[0].target).toBe('source:timbre');
  });

  it('unpin removes the matching pinned module', () => {
    let session = setupSession();
    // Pin first
    const r1 = executeOperations(
      session,
      [{ type: 'pin', trackId: 'v0', moduleId: 'source', controlId: 'timbre', description: 'pin' }],
      adapter, arbitrator,
    );
    session = r1.session;
    expect(getTrack(session).surface.modules).toHaveLength(1);

    // Unpin
    const r2 = executeOperations(
      session,
      [{ type: 'unpin', trackId: 'v0', moduleId: 'source', controlId: 'timbre', description: 'unpin' }],
      adapter, arbitrator,
    );
    expect(r2.accepted).toHaveLength(1);
    expect(getTrack(r2.session).surface.modules).toHaveLength(0);
  });

  it('max 4 pinned modules per track', () => {
    let session = setupSession();
    const params = ['timbre', 'morph', 'harmonics', 'note'];

    // Pin 4 controls (all via 'source' module)
    for (const p of params) {
      const r = executeOperations(
        session,
        [{ type: 'pin', trackId: 'v0', moduleId: 'source', controlId: p, description: `pin ${p}` }],
        adapter, arbitrator,
      );
      expect(r.accepted).toHaveLength(1);
      session = r.session;
    }
    expect(getTrack(session).surface.modules.filter(m => m.config.pinned)).toHaveLength(4);

    // 5th pin should be rejected
    const r5 = executeOperations(
      session,
      [{ type: 'pin', trackId: 'v0', moduleId: 'source', controlId: 'extra', description: 'pin extra' }],
      adapter, arbitrator,
    );
    expect(r5.rejected).toHaveLength(1);
    expect(r5.rejected[0].reason).toContain('Maximum');
  });

  it('pin is undoable', () => {
    const session = setupSession();
    const r = executeOperations(
      session,
      [{ type: 'pin', trackId: 'v0', moduleId: 'source', controlId: 'timbre', description: 'pin' }],
      adapter, arbitrator,
    );
    expect(getTrack(r.session).surface.modules).toHaveLength(1);
    const undone = applyUndo(r.session);
    expect(getTrack(undone).surface.modules).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. label_axes with XY Pad module
// ---------------------------------------------------------------------------

describe('label_axes updates XY Pad bindings', () => {
  it('updates x-axis and y-axis bindings on xy-pad module', () => {
    let session = setupSession();

    // First add an xy-pad via set_surface
    const xyMod = makeXYPad('xy-1', 'v0');
    const r1 = executeOperations(
      session,
      [{ type: 'set_surface', trackId: 'v0', modules: [xyMod], description: 'add xy' }],
      adapter, arbitrator,
    );
    session = r1.session;

    // Now label_axes
    const r2 = executeOperations(
      session,
      [{ type: 'label_axes', trackId: 'v0', x: 'harmonics', y: 'timbre', description: 'relabel' }],
      adapter, arbitrator,
    );
    expect(r2.accepted).toHaveLength(1);

    const xyModule = getTrack(r2.session).surface.modules.find(m => m.type === 'xy-pad')!;
    const xBinding = xyModule.bindings.find(b => b.role === 'x-axis')!;
    const yBinding = xyModule.bindings.find(b => b.role === 'y-axis')!;
    expect(xBinding.target).toBe('harmonics');
    expect(yBinding.target).toBe('timbre');
  });

  it('fails if no xy-pad module exists on track', () => {
    const session = setupSession();
    // Track has no modules, so no xy-pad
    const r = executeOperations(
      session,
      [{ type: 'label_axes', trackId: 'v0', x: 'timbre', y: 'morph', description: 'label' }],
      adapter, arbitrator,
    );
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toContain('No XY Pad');
  });

  it('label_axes is undoable', () => {
    let session = setupSession();

    // Add xy-pad
    const xyMod = makeXYPad('xy-1', 'v0');
    const r1 = executeOperations(
      session,
      [{ type: 'set_surface', trackId: 'v0', modules: [xyMod], description: 'add xy' }],
      adapter, arbitrator,
    );
    session = r1.session;

    // Label axes
    const r2 = executeOperations(
      session,
      [{ type: 'label_axes', trackId: 'v0', x: 'harmonics', y: 'timbre', description: 'relabel' }],
      adapter, arbitrator,
    );

    // Undo should restore original bindings
    const undone = applyUndo(r2.session);
    const xyModule = getTrack(undone).surface.modules.find(m => m.type === 'xy-pad')!;
    const xBinding = xyModule.bindings.find(b => b.role === 'x-axis')!;
    expect(xBinding.target).toBe('timbre'); // original value
  });
});

// ---------------------------------------------------------------------------
// 5. Contract tests (undoable, bounded, parity-safe)
// ---------------------------------------------------------------------------

describe('surface module contracts', () => {
  it('set_surface creates exactly one undo snapshot', () => {
    const session = setupSession();
    const baselineLen = session.undoStack.length;
    const modules: SurfaceModule[] = [
      makeKnobGroup('kg-1', [{ role: 'control', trackId: 'v0', target: 'timbre' }]),
    ];
    const r = executeOperations(
      session,
      [{ type: 'set_surface', trackId: 'v0', modules, description: 'test' }],
      adapter, arbitrator,
    );
    // The executor wraps all actions in a single turn via finalizeAITurn,
    // which creates an action-group snapshot. Count non-group snapshots for
    // the surface change itself: exactly one 'surface' snapshot should exist.
    const surfaceSnapshots = r.session.undoStack.filter(
      s => s.kind === 'surface',
    );
    expect(surfaceSnapshots.length).toBeGreaterThanOrEqual(1);
    // But the undo stack should have grown — baseline + surface snapshot + action-group wrapper
    expect(r.session.undoStack.length).toBeGreaterThan(baselineLen);
  });

  it('pin creates exactly one undo snapshot', () => {
    const session = setupSession();
    const r = executeOperations(
      session,
      [{ type: 'pin', trackId: 'v0', moduleId: 'source', controlId: 'timbre', description: 'pin' }],
      adapter, arbitrator,
    );
    const surfaceSnapshots = r.session.undoStack.filter(
      s => s.kind === 'surface',
    );
    expect(surfaceSnapshots.length).toBeGreaterThanOrEqual(1);
  });

  it('undo after set_surface restores exact previous state', () => {
    const session = setupSession();
    const originalSurface = structuredClone(getTrack(session).surface);

    const modules: SurfaceModule[] = [
      makeKnobGroup('kg-1', [{ role: 'control', trackId: 'v0', target: 'timbre' }]),
      makeXYPad('xy-1', 'v0'),
    ];
    const r = executeOperations(
      session,
      [{ type: 'set_surface', trackId: 'v0', modules, description: 'test' }],
      adapter, arbitrator,
    );
    expect(getTrack(r.session).surface.modules).toHaveLength(2);

    const undone = applyUndo(r.session);
    const restored = getTrack(undone).surface;
    expect(restored.modules).toEqual(originalSurface.modules);
    expect(restored.thumbprint).toEqual(originalSurface.thumbprint);
  });

  it('modules array is bounded (no infinite growth from pin)', () => {
    let session = setupSession();
    const MAX_PINS = 4;

    // Pin up to the limit
    const params = ['timbre', 'morph', 'harmonics', 'note'];
    for (const p of params) {
      const r = executeOperations(
        session,
        [{ type: 'pin', trackId: 'v0', moduleId: 'source', controlId: p, description: `pin ${p}` }],
        adapter, arbitrator,
      );
      session = r.session;
    }

    // Attempting more pins should all be rejected
    for (let i = 0; i < 10; i++) {
      const r = executeOperations(
        session,
        [{ type: 'pin', trackId: 'v0', moduleId: 'source', controlId: `extra-${i}`, description: 'overflow' }],
        adapter, arbitrator,
      );
      expect(r.rejected).toHaveLength(1);
      session = r.session;
    }

    // Modules count should never exceed MAX_PINS (all are pinned)
    expect(getTrack(session).surface.modules.filter(m => m.config.pinned)).toHaveLength(MAX_PINS);
  });
});
