// tests/engine/live-control-promotion.test.ts
import { describe, it, expect } from 'vitest';
import { applyUndo } from '../../src/engine/primitives';
import { createSession } from '../../src/engine/session';
import { getTrack, updateTrack } from '../../src/engine/types';
import type { Session, LiveControlModule, SurfaceSnapshot, TrackSurface, SurfaceModule } from '../../src/engine/types';

/** Simulate the promotion logic from App.tsx handleLiveModuleAddToSurface. */
function promoteLiveModule(s: Session, liveModule: LiveControlModule): Session {
  const track = getTrack(s, liveModule.trackId);
  const newSurface: TrackSurface = {
    ...track.surface,
    modules: [...track.surface.modules, liveModule.module],
  };
  const prevSurface: TrackSurface = {
    ...track.surface,
    modules: track.surface.modules.map(m => ({
      ...m,
      bindings: [...m.bindings],
      position: { ...m.position },
      config: structuredClone(m.config),
    })),
  };
  const snapshot: SurfaceSnapshot = {
    kind: 'surface',
    trackId: liveModule.trackId,
    prevSurface,
    prevLiveControls: [...s.liveControls],
    timestamp: Date.now(),
    description: `Added ${liveModule.module.label} from Live Controls`,
  };
  return {
    ...updateTrack(s, liveModule.trackId, { surface: newSurface }),
    undoStack: [...s.undoStack, snapshot],
    liveControls: s.liveControls.filter(m => m.id !== liveModule.id),
  };
}

function makeLiveModule(trackId: string): LiveControlModule {
  const surfaceModule: SurfaceModule = {
    id: 'live-mod-1',
    type: 'knob',
    label: 'Test Knob',
    bindings: [{ param: 'timbre', label: 'Timbre', range: [0, 1] }],
    position: { x: 0, y: 0, w: 1, h: 1 },
    config: {},
  };
  return {
    id: 'lc-1',
    trackId,
    touched: true,
    createdAtTurn: 0,
    module: surfaceModule,
  };
}

describe('Live Control Module Promotion', () => {
  it('promotes a live module to the track surface and removes from liveControls', () => {
    const s0 = createSession();
    const trackId = s0.activeTrackId;
    const liveModule = makeLiveModule(trackId);
    const s1: Session = { ...s0, liveControls: [liveModule] };

    const s2 = promoteLiveModule(s1, liveModule);

    // Module appears on track surface
    const track = getTrack(s2, trackId);
    expect(track.surface.modules).toHaveLength(1);
    expect(track.surface.modules[0].id).toBe('live-mod-1');

    // Removed from liveControls
    expect(s2.liveControls).toHaveLength(0);

    // Undo entry was pushed
    expect(s2.undoStack).toHaveLength(1);
    expect(s2.undoStack[0].kind).toBe('surface');
  });

  it('undo restores both surface and liveControls', () => {
    const s0 = createSession();
    const trackId = s0.activeTrackId;
    const liveModule = makeLiveModule(trackId);
    const s1: Session = { ...s0, liveControls: [liveModule] };

    const s2 = promoteLiveModule(s1, liveModule);
    expect(s2.liveControls).toHaveLength(0);
    expect(getTrack(s2, trackId).surface.modules).toHaveLength(1);

    // Undo the promotion
    const s3 = applyUndo(s2);

    // Surface should be restored (empty)
    expect(getTrack(s3, trackId).surface.modules).toHaveLength(0);

    // liveControls should be restored
    expect(s3.liveControls).toHaveLength(1);
    expect(s3.liveControls[0].id).toBe('lc-1');
  });

  it('preserves other live modules during promotion', () => {
    const s0 = createSession();
    const trackId = s0.activeTrackId;
    const liveModule1 = makeLiveModule(trackId);
    const liveModule2: LiveControlModule = {
      ...makeLiveModule(trackId),
      id: 'lc-2',
      module: { ...makeLiveModule(trackId).module, id: 'live-mod-2', label: 'Other Knob' },
    };
    const s1: Session = { ...s0, liveControls: [liveModule1, liveModule2] };

    const s2 = promoteLiveModule(s1, liveModule1);

    // Only promoted module removed
    expect(s2.liveControls).toHaveLength(1);
    expect(s2.liveControls[0].id).toBe('lc-2');

    // Undo restores both
    const s3 = applyUndo(s2);
    expect(s3.liveControls).toHaveLength(2);
  });
});
