// tests/engine/revert-snapshot.test.ts
// Tests for revertSnapshot (via applyUndo) covering all snapshot kinds,
// and executeOperations group-flattening (via ActionGroupSnapshot undo).
import { describe, it, expect } from 'vitest';
import { applyUndo } from '../../src/engine/primitives';
import { createSession, setModel, setMaster } from '../../src/engine/session';
import { getTrack } from '../../src/engine/types';
import type {
  Session,
  TransportSnapshot,
  ModelSnapshot,
  ViewSnapshot,
  ProcessorSnapshot,
  ProcessorStateSnapshot,
  ModulatorSnapshot,
  ModulatorStateSnapshot,
  ModulationRoutingSnapshot,
  MasterSnapshot,
  RegionSnapshot,
  ActionGroupSnapshot,
  Snapshot,
} from '../../src/engine/types';

/** Push a snapshot onto the undo stack and return the modified session. */
function withSnapshot(session: Session, snapshot: Snapshot): Session {
  return { ...session, undoStack: [...session.undoStack, snapshot] };
}

describe('revertSnapshot (via applyUndo)', () => {
  it('reverts a transport snapshot', () => {
    let s = createSession();
    const prevTransport = { ...s.transport };
    s = { ...s, transport: { ...s.transport, bpm: 180, swing: 0.5 } };
    const snapshot: TransportSnapshot = {
      kind: 'transport',
      prevTransport,
      timestamp: Date.now(),
      description: 'transport change',
    };
    const undone = applyUndo(withSnapshot(s, snapshot));
    expect(undone.transport.bpm).toBe(120);
    expect(undone.transport.swing).toBe(0);
    expect(undone.undoStack).toHaveLength(0);
  });

  it('reverts a model snapshot', () => {
    const s = createSession();
    const trackId = s.activeTrackId;
    const track = getTrack(s, trackId);
    // setModel already pushes a snapshot, so we use it directly
    const changed = setModel(s, trackId, 5);
    expect(getTrack(changed, trackId).model).toBe(5);
    const undone = applyUndo(changed);
    expect(getTrack(undone, trackId).model).toBe(track.model);
    expect(getTrack(undone, trackId).engine).toBe(track.engine);
  });

  it('reverts a view snapshot', () => {
    const s = createSession();
    const trackId = s.activeTrackId;
    const track = getTrack(s, trackId);
    const prevViews = track.views ? [...track.views] : [];
    // Simulate adding a view
    const newViews = [...prevViews, { kind: 'piano-roll' as const, id: 'piano-roll-test' }];
    let modified = {
      ...s,
      tracks: s.tracks.map(v => v.id === trackId ? { ...v, views: newViews } : v),
    };
    const snapshot: ViewSnapshot = {
      kind: 'view',
      trackId,
      prevViews,
      timestamp: Date.now(),
      description: 'add view',
    };
    modified = withSnapshot(modified, snapshot);
    expect(getTrack(modified, trackId).views).toHaveLength(prevViews.length + 1);
    const undone = applyUndo(modified);
    expect(getTrack(undone, trackId).views).toHaveLength(prevViews.length);
  });

  it('reverts a processor snapshot (full chain restore)', () => {
    const s = createSession();
    const trackId = s.activeTrackId;
    const prevProcessors = [
      { id: 'rings-0', type: 'rings', model: 0, params: { brightness: 0.5 } },
    ];
    // Simulate removing the processor
    let modified = {
      ...s,
      tracks: s.tracks.map(v => v.id === trackId ? { ...v, processors: [] } : v),
    };
    const snapshot: ProcessorSnapshot = {
      kind: 'processor',
      trackId,
      prevProcessors,
      timestamp: Date.now(),
      description: 'remove processor',
    };
    modified = withSnapshot(modified, snapshot);
    expect(getTrack(modified, trackId).processors).toHaveLength(0);
    const undone = applyUndo(modified);
    expect(getTrack(undone, trackId).processors).toHaveLength(1);
    expect(getTrack(undone, trackId).processors![0].id).toBe('rings-0');
  });

  it('reverts a processor-state snapshot', () => {
    const s = createSession();
    const trackId = s.activeTrackId;
    const proc = { id: 'rings-0', type: 'rings', model: 0, params: { brightness: 0.5, damping: 0.7 } };
    // Set up initial processor, then change its params
    let modified = {
      ...s,
      tracks: s.tracks.map(v => v.id === trackId
        ? { ...v, processors: [{ ...proc, params: { brightness: 0.9, damping: 0.3 }, model: 2 }] }
        : v),
    };
    const snapshot: ProcessorStateSnapshot = {
      kind: 'processor-state',
      trackId,
      processorId: 'rings-0',
      prevParams: { brightness: 0.5, damping: 0.7 },
      prevModel: 0,
      timestamp: Date.now(),
      description: 'processor param change',
    };
    modified = withSnapshot(modified, snapshot);
    const undone = applyUndo(modified);
    const restoredProc = getTrack(undone, trackId).processors![0];
    expect(restoredProc.params.brightness).toBe(0.5);
    expect(restoredProc.params.damping).toBe(0.7);
    expect(restoredProc.model).toBe(0);
  });

  it('reverts a modulator snapshot', () => {
    const s = createSession();
    const trackId = s.activeTrackId;
    const prevModulators = [
      { id: 'env-0', type: 'envelope', model: 0, params: { attack: 0.1 } },
    ];
    const prevModulations = [
      { id: 'route-0', modulatorId: 'env-0', target: { kind: 'source' as const, param: 'brightness' }, depth: 0.5 },
    ];
    // Simulate removing the modulator
    let modified = {
      ...s,
      tracks: s.tracks.map(v => v.id === trackId
        ? { ...v, modulators: [], modulations: [] }
        : v),
    };
    const snapshot: ModulatorSnapshot = {
      kind: 'modulator',
      trackId,
      prevModulators,
      prevModulations,
      timestamp: Date.now(),
      description: 'remove modulator',
    };
    modified = withSnapshot(modified, snapshot);
    const undone = applyUndo(modified);
    expect(getTrack(undone, trackId).modulators).toHaveLength(1);
    expect(getTrack(undone, trackId).modulations).toHaveLength(1);
  });

  it('reverts a modulator-state snapshot', () => {
    const s = createSession();
    const trackId = s.activeTrackId;
    const mod = { id: 'env-0', type: 'envelope', model: 0, params: { attack: 0.1 } };
    let modified = {
      ...s,
      tracks: s.tracks.map(v => v.id === trackId
        ? { ...v, modulators: [{ ...mod, params: { attack: 0.8 }, model: 2 }] }
        : v),
    };
    const snapshot: ModulatorStateSnapshot = {
      kind: 'modulator-state',
      trackId,
      modulatorId: 'env-0',
      prevParams: { attack: 0.1 },
      prevModel: 0,
      timestamp: Date.now(),
      description: 'modulator param change',
    };
    modified = withSnapshot(modified, snapshot);
    const undone = applyUndo(modified);
    const restoredMod = getTrack(undone, trackId).modulators![0];
    expect(restoredMod.params.attack).toBe(0.1);
    expect(restoredMod.model).toBe(0);
  });

  it('reverts a modulation-routing snapshot', () => {
    const s = createSession();
    const trackId = s.activeTrackId;
    const prevModulations = [
      { id: 'route-0', modulatorId: 'env-0', target: { kind: 'source' as const, param: 'brightness' }, depth: 0.5 },
    ];
    // Simulate adding a second route
    let modified = {
      ...s,
      tracks: s.tracks.map(v => v.id === trackId
        ? {
            ...v,
            modulations: [
              ...prevModulations,
              { id: 'route-1', modulatorId: 'env-0', target: { kind: 'source' as const, param: 'texture' }, depth: 0.3 },
            ],
          }
        : v),
    };
    const snapshot: ModulationRoutingSnapshot = {
      kind: 'modulation-routing',
      trackId,
      prevModulations,
      timestamp: Date.now(),
      description: 'add modulation route',
    };
    modified = withSnapshot(modified, snapshot);
    expect(getTrack(modified, trackId).modulations).toHaveLength(2);
    const undone = applyUndo(modified);
    expect(getTrack(undone, trackId).modulations).toHaveLength(1);
  });

  it('reverts a master snapshot', () => {
    const s = createSession();
    const changed = setMaster(s, { volume: 0.7, pan: -0.5 });
    expect(changed.master.volume).toBeCloseTo(0.7);
    expect(changed.master.pan).toBeCloseTo(-0.5);
    const undone = applyUndo(changed);
    expect(undone.master.volume).toBe(s.master.volume);
    expect(undone.master.pan).toBe(s.master.pan);
  });

  it('reverts a region snapshot', () => {
    const s = createSession();
    const trackId = s.activeTrackId;
    const track = getTrack(s, trackId);
    const prevEvents = track.regions[0]?.events ?? [];
    // Simulate adding events to the region
    const newEvents = [
      { kind: 'trigger' as const, at: 0, velocity: 0.8 },
      { kind: 'trigger' as const, at: 4, velocity: 0.6 },
    ];
    let modified = {
      ...s,
      tracks: s.tracks.map(v => v.id === trackId
        ? {
            ...v,
            regions: v.regions.map((r, i) => i === 0 ? { ...r, events: newEvents } : r),
          }
        : v),
    };
    const snapshot: RegionSnapshot = {
      kind: 'region',
      trackId,
      prevEvents,
      timestamp: Date.now(),
      description: 'edit region',
    };
    modified = withSnapshot(modified, snapshot);
    expect(getTrack(modified, trackId).regions[0].events).toHaveLength(2);
    const undone = applyUndo(modified);
    expect(getTrack(undone, trackId).regions[0].events).toHaveLength(prevEvents.length);
  });
});

describe('ActionGroupSnapshot undo (group-flattening)', () => {
  it('reverts all snapshots in a group in reverse order', () => {
    const s = createSession();
    const trackId = s.activeTrackId;
    const track = getTrack(s, trackId);

    // Simulate: change model + change transport (two independent operations grouped)
    let modified: Session = {
      ...s,
      tracks: s.tracks.map(v => v.id === trackId ? { ...v, model: 5, engine: 'plaits:wavetable' } : v),
      transport: { ...s.transport, bpm: 140 },
    };

    const modelSnap: ModelSnapshot = {
      kind: 'model',
      trackId,
      prevModel: track.model,
      prevEngine: track.engine,
      timestamp: Date.now(),
      description: 'change model',
    };
    const transportSnap: TransportSnapshot = {
      kind: 'transport',
      prevTransport: { ...s.transport },
      timestamp: Date.now(),
      description: 'change transport',
    };

    const group: ActionGroupSnapshot = {
      kind: 'group',
      snapshots: [modelSnap, transportSnap],
      timestamp: Date.now(),
      description: 'AI response (2 actions)',
    };

    modified = { ...modified, undoStack: [group] };

    // Single undo should revert both
    const undone = applyUndo(modified);
    expect(getTrack(undone, trackId).model).toBe(track.model);
    expect(getTrack(undone, trackId).engine).toBe(track.engine);
    expect(undone.transport.bpm).toBe(120);
    expect(undone.undoStack).toHaveLength(0);
  });

  it('handles groups with processor and modulator snapshots together', () => {
    const s = createSession();
    const trackId = s.activeTrackId;

    // Set up: track has a processor and modulator
    const proc = { id: 'rings-0', type: 'rings', model: 0, params: { brightness: 0.5 } };
    const mod = { id: 'env-0', type: 'envelope', model: 0, params: { attack: 0.1 } };
    let modified = {
      ...s,
      tracks: s.tracks.map(v => v.id === trackId
        ? { ...v, processors: [], modulators: [] }
        : v),
    };

    const procSnap: ProcessorSnapshot = {
      kind: 'processor',
      trackId,
      prevProcessors: [proc],
      timestamp: Date.now(),
      description: 'remove processor',
    };
    const modSnap: ModulatorSnapshot = {
      kind: 'modulator',
      trackId,
      prevModulators: [mod],
      prevModulations: [],
      timestamp: Date.now(),
      description: 'remove modulator',
    };

    const group: ActionGroupSnapshot = {
      kind: 'group',
      snapshots: [procSnap, modSnap],
      timestamp: Date.now(),
      description: 'AI response',
    };

    modified = { ...modified, undoStack: [group] };
    const undone = applyUndo(modified);
    expect(getTrack(undone, trackId).processors).toHaveLength(1);
    expect(getTrack(undone, trackId).modulators).toHaveLength(1);
  });

  it('does nothing when undo stack is empty', () => {
    const s = createSession();
    const result = applyUndo(s);
    expect(result).toBe(s);
  });
});
