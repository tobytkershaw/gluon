// tests/engine/visual-identity-tool.test.ts
// Contract tests: set_track_identity must be undoable, bounded, and merge partials correctly.
import { describe, it, expect, vi } from 'vitest';
import { executeOperations } from '../../src/engine/operation-executor';
import { applyUndo } from '../../src/engine/primitives';
import { createSession } from '../../src/engine/session';
import { Arbitrator } from '../../src/engine/arbitration';
import type { AIAction, TrackVisualIdentity } from '../../src/engine/types';
import type { SourceAdapter } from '../../src/engine/canonical-types';

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

function makeArbitrator() {
  const arb = new Arbitrator();
  vi.spyOn(arb, 'canAIAct').mockReturnValue(true);
  return arb;
}

function setupSession() {
  return createSession();
}

describe('set_track_identity', () => {
  // --- Basic application ---

  it('applies full visual identity to a track', () => {
    const session = setupSession();
    const identity: Partial<TrackVisualIdentity> = {
      colour: { hue: 220, saturation: 0.8, brightness: 0.6 },
      weight: 0.9,
      edgeStyle: 'soft',
      prominence: 0.7,
    };
    const actions: AIAction[] = [
      { type: 'set_track_identity', trackId: 'v0', identity },
    ];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.accepted).toHaveLength(1);

    const track = report.session.tracks.find(t => t.id === 'v0')!;
    expect(track.visualIdentity).toBeDefined();
    expect(track.visualIdentity!.colour.hue).toBe(220);
    expect(track.visualIdentity!.colour.saturation).toBe(0.8);
    expect(track.visualIdentity!.colour.brightness).toBe(0.6);
    expect(track.visualIdentity!.weight).toBe(0.9);
    expect(track.visualIdentity!.edgeStyle).toBe('soft');
    expect(track.visualIdentity!.prominence).toBe(0.7);
  });

  // --- Partial merge ---

  it('merges partial identity with defaults when no existing identity', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'set_track_identity', trackId: 'v0', identity: { weight: 0.2 } },
    ];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.accepted).toHaveLength(1);

    const track = report.session.tracks.find(t => t.id === 'v0')!;
    expect(track.visualIdentity).toBeDefined();
    expect(track.visualIdentity!.weight).toBe(0.2);
    // Other fields should fall back to defaults
    expect(track.visualIdentity!.edgeStyle).toBe('crisp');
    expect(track.visualIdentity!.prominence).toBe(0.5);
  });

  it('merges partial identity with existing identity', () => {
    let session = setupSession();

    // First: set full identity
    const actions1: AIAction[] = [
      {
        type: 'set_track_identity',
        trackId: 'v0',
        identity: {
          colour: { hue: 120, saturation: 0.7, brightness: 0.5 },
          weight: 0.8,
          edgeStyle: 'glow',
          prominence: 0.6,
        },
      },
    ];
    const report1 = executeOperations(session, actions1, adapter, makeArbitrator());
    session = report1.session;

    // Second: update only weight
    const actions2: AIAction[] = [
      { type: 'set_track_identity', trackId: 'v0', identity: { weight: 0.3 } },
    ];
    const report2 = executeOperations(session, actions2, adapter, makeArbitrator());

    const track = report2.session.tracks.find(t => t.id === 'v0')!;
    expect(track.visualIdentity!.weight).toBe(0.3);
    // Other fields preserved from first set
    expect(track.visualIdentity!.colour.hue).toBe(120);
    expect(track.visualIdentity!.edgeStyle).toBe('glow');
    expect(track.visualIdentity!.prominence).toBe(0.6);
  });

  // --- Undoable ---

  it('pushes an undo snapshot', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'set_track_identity', trackId: 'v0', identity: { weight: 0.5 } },
    ];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    const newEntries = report.session.undoStack.length - session.undoStack.length;
    expect(newEntries).toBeGreaterThanOrEqual(1);
  });

  it('undo reverts to previous visual identity', () => {
    const session = setupSession();
    const originalIdentity = session.tracks.find(t => t.id === 'v0')!.visualIdentity;

    const actions: AIAction[] = [
      {
        type: 'set_track_identity',
        trackId: 'v0',
        identity: { colour: { hue: 300, saturation: 0.9, brightness: 0.8 }, prominence: 0.95 },
      },
    ];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.session.tracks.find(t => t.id === 'v0')!.visualIdentity).toBeDefined();

    const undone = applyUndo(report.session);
    expect(undone.tracks.find(t => t.id === 'v0')!.visualIdentity).toBe(originalIdentity);
  });

  it('undo reverts multiple sequential changes in LIFO order', () => {
    let session = setupSession();

    const actions1: AIAction[] = [
      { type: 'set_track_identity', trackId: 'v0', identity: { weight: 0.3, edgeStyle: 'soft' } },
    ];
    const report1 = executeOperations(session, actions1, adapter, makeArbitrator());
    session = report1.session;

    const actions2: AIAction[] = [
      { type: 'set_track_identity', trackId: 'v0', identity: { weight: 0.9, edgeStyle: 'glow' } },
    ];
    const report2 = executeOperations(session, actions2, adapter, makeArbitrator());
    session = report2.session;

    expect(session.tracks.find(t => t.id === 'v0')!.visualIdentity!.weight).toBe(0.9);

    // Undo second
    session = applyUndo(session);
    expect(session.tracks.find(t => t.id === 'v0')!.visualIdentity!.weight).toBe(0.3);
    expect(session.tracks.find(t => t.id === 'v0')!.visualIdentity!.edgeStyle).toBe('soft');

    // Undo first
    session = applyUndo(session);
    expect(session.tracks.find(t => t.id === 'v0')!.visualIdentity).toBeUndefined();
  });

  // --- Bounded ---

  it('clamps values to valid ranges', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      {
        type: 'set_track_identity',
        trackId: 'v0',
        identity: {
          colour: { hue: 400, saturation: 1.5, brightness: -0.3 },
          weight: 2.0,
          prominence: -1,
        },
      },
    ];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    const track = report.session.tracks.find(t => t.id === 'v0')!;
    expect(track.visualIdentity!.colour.hue).toBe(360);
    expect(track.visualIdentity!.colour.saturation).toBe(1);
    expect(track.visualIdentity!.colour.brightness).toBe(0);
    expect(track.visualIdentity!.weight).toBe(1);
    expect(track.visualIdentity!.prominence).toBe(0);
  });

  // --- Error handling ---

  it('rejects when track not found', () => {
    const session = setupSession();
    const actions: AIAction[] = [
      { type: 'set_track_identity', trackId: 'nonexistent', identity: { weight: 0.5 } },
    ];
    const report = executeOperations(session, actions, adapter, makeArbitrator());
    expect(report.rejected).toHaveLength(1);
    expect(report.accepted).toHaveLength(0);
  });
});
